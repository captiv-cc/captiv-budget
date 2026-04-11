import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { calcLine, calcSynthese, fmtEur, fmtPct, fmtNum, CATS, CAT_COLORS, REGIMES_SALARIES, CATS_HUMAINS, UNITES, TAUX_DEFAUT } from '../lib/cotisations'
import { exportDevisPDF } from '../lib/pdfExport'
import ProduitAutocomplete from '../components/ProduitAutocomplete'
import { BLOCS_CANONIQUES, getBlocInfo as _getBlocInfoByName } from '../lib/blocs'
import {
  CAT_ACCENT_COLORS,
  REGIME_COMPAT,
  normalizeRegime,
  REGIME_META,
  REGIME_TYPES,
  EMPTY_LINE,
  EMPTY_GLOBAL,
} from '../features/devis/constants'
import {
  Plus, Trash2, Copy, Download, ChevronLeft,
  ChevronDown, ChevronUp, ChevronRight, Save, Eye, RefreshCw,
  Check, GripVertical, Percent, ShieldCheck, Tag,
  TrendingUp, Users, BarChart3, X, Search, Database, Wrench, StickyNote
} from 'lucide-react'

// Re-export pour les modules qui importent BLOCS_CANONIQUES depuis DevisEditor
export { BLOCS_CANONIQUES }

// Adaptateur local : reçoit un objet category { name, ... }
function getBlocInfo(cat) {
  const info = _getBlocInfoByName(cat.name)
  return info
}

// Trie les catégories par ordre canonique + assigne les numéros 1-N
function computeSortedCategories(categories) {
  const withInfo = categories.map(cat => ({ cat, info: getBlocInfo(cat) }))
  withInfo.sort((a, b) => a.info.canonicalIdx - b.info.canonicalIdx || a.cat.sort_order - b.cat.sort_order)
  let num = 1
  return withInfo.map(({ cat, info }) => ({ cat, info, num: info.isCanonical ? num++ : null }))
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function DevisEditor({ embedded = false }) {
  const { id: projectId, devisId } = useParams()
  const navigate = useNavigate()
  const { org } = useAuth()

  const [devis, setDevis]         = useState(null)
  const [project, setProject]     = useState(null)
  const [client, setClient]       = useState(null)
  const [categories, setCategories] = useState([])
  const [collapsed, setCollapsed] = useState({})
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [loading, setLoading]     = useState(true)
  const [taux, setTaux]           = useState(TAUX_DEFAUT)
  const [bdd, setBdd]             = useState([])
  const [globalAdj, setGlobalAdj] = useState(EMPTY_GLOBAL)
  const [saveError, setSaveError]  = useState(null)
  // Modale ajout de ligne
  const [addLineModal, setAddLineModal] = useState(null)  // { catId, defaultRegime } | null
  const [showAnalyse, setShowAnalyse]   = useState(false) // toggle colonnes analyse
  const [showRemise, setShowRemise]     = useState(false) // toggle colonne remise
  const isSaving         = useRef(false)   // garde contre saves concurrentes
  const pendingSave      = useRef(null)    // dernier save en attente
  const insertingTempIds = useRef(new Set()) // évite double-INSERT
  const hasChanges       = useRef(false)   // true seulement après modif utilisateur

  // ── Chargement initial ────────────────────────────────────────────────────
  useEffect(() => { loadAll() }, [devisId])

  // ── Auto-save : useEffect avec dépendances ────────────────────────────────
  // Ne se déclenche QUE si l'utilisateur a fait une modification (hasChanges)
  useEffect(() => {
    if (!devis || loading || !hasChanges.current) return
    const snapCats = categories
    const snapAdj  = globalAdj
    const snapDv   = devis
    const timer = setTimeout(() => doSave(snapCats, snapDv, snapAdj), 1500)
    return () => clearTimeout(timer)
  }, [categories, globalAdj]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true)
    try {
      // Devis + categories + lines
      const { data: dv } = await supabase
        .from('devis')
        .select('*')
        .eq('id', devisId)
        .single()
      setDevis(dv)
      setGlobalAdj({
        marge_globale_pct:      Number(dv?.marge_globale_pct)      || 0,
        assurance_pct:          Number(dv?.assurance_pct)          || 0,
        remise_globale_pct:     Number(dv?.remise_globale_pct)     || 0,
        remise_globale_montant: Number(dv?.remise_globale_montant) || 0,
      })

      const { data: cats } = await supabase
        .from('devis_categories')
        .select('*')
        .eq('devis_id', devisId)
        .order('sort_order')

      const { data: lines } = await supabase
        .from('devis_lines')
        .select('*')
        .eq('devis_id', devisId)
        .order('sort_order')

      const catsWithLines = (cats || []).map(cat => ({
        ...cat,
        lines: (lines || [])
          .filter(l => l.category_id === cat.id)
          .map(l => ({ ...l, regime: normalizeRegime(l.regime) }))
      }))
      setCategories(catsWithLines)

      // Projet + client
      const { data: proj } = await supabase
        .from('projects')
        .select('*, clients(*)')
        .eq('id', projectId)
        .single()
      setProject(proj)
      setClient(proj?.clients)

      // BDD produits
      const { data: bddData } = await supabase
        .from('produits_bdd')
        .select('*')
        .order('categorie')
      setBdd(bddData || [])

      // Taux cotisations
      if (org?.id) {
        const { data: confData } = await supabase
          .from('cotisation_config')
          .select('*')
          .eq('org_id', org.id)
        if (confData?.length) {
          const t = { ...TAUX_DEFAUT }
          confData.forEach(c => { t[c.key] = Number(c.value) })
          setTaux(t)
        }
      }
    } finally {
      hasChanges.current = false  // reset : pas de save auto juste après le chargement
      setLoading(false)
    }
  }

  // ── doSave : reçoit les valeurs en paramètre → jamais de closure stale ─────
  async function doSave(cats, dv, adj) {
    if (isSaving.current) {
      // Mémorise le dernier état à sauvegarder pour l'exécuter après
      pendingSave.current = { cats, dv, adj }
      return
    }
    if (!dv) return

    isSaving.current = true
    setSaving(true)
    setSaveError(null)
    let errors = []

    try {
      for (const cat of cats) {
        for (const line of cat.lines) {
          const payload = {
            devis_id: devisId,
            category_id: cat.id,
            ref: line.ref, produit: line.produit,
            description: line.description,
            regime: line.regime,
            use_line: line.use_line,
            dans_marge: true,   // géré au niveau catégorie
            nb: line.nb ?? 1, quantite: line.quantite, unite: line.unite,
            tarif_ht: line.tarif_ht, cout_ht: line.cout_ht ?? null,
            remise_pct: line.remise_pct,
            sort_order: line.sort_order,
            is_crew: CATS_HUMAINS.includes(line.regime),
          }
          if (line.id) {
            // ── UPDATE ligne existante ─────────────────────────────────────
            const { error } = await supabase.from('devis_lines').update(payload).eq('id', line.id)
            if (error) {
              console.error('[doSave] UPDATE ligne failed:', error, 'payload:', payload)
              errors.push(`UPDATE: ${error.message}`)
            }
          } else if (!insertingTempIds.current.has(line._tempId)) {
            // ── INSERT nouvelle ligne (pas déjà en cours d'insertion) ──────
            insertingTempIds.current.add(line._tempId)
            const { data: newLine, error } = await supabase
              .from('devis_lines').insert(payload).select().single()
            insertingTempIds.current.delete(line._tempId)
            if (error) {
              console.error('[doSave] INSERT ligne failed:', error, 'payload:', payload)
              errors.push(`INSERT: ${error.message}`)
            } else if (newLine) {
              setCategories(prev => prev.map(c =>
                c.id === cat.id
                  ? { ...c, lines: c.lines.map(l => l._tempId === line._tempId ? { ...newLine } : l) }
                  : c
              ))
            }
          }
        }
      }

      const { error: devisErr } = await supabase.from('devis').update({
        updated_at:             new Date().toISOString(),
        status:                 dv.status,
        marge_globale_pct:      adj.marge_globale_pct,
        assurance_pct:          adj.assurance_pct,
        remise_globale_pct:     adj.remise_globale_pct,
        remise_globale_montant: adj.remise_globale_montant,
        tva_rate:               dv.tva_rate   != null ? Number(dv.tva_rate)   : 20,
        acompte_pct:            dv.acompte_pct!= null ? Number(dv.acompte_pct): 30,
      }).eq('id', devisId)
      if (devisErr) {
        console.error('[doSave] devis update failed:', devisErr)
        errors.push(`Devis: ${devisErr.message}`)
      }

      if (errors.length === 0) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        setSaveError(errors.join(' | '))
      }
    } finally {
      isSaving.current = false
      setSaving(false)
      // Exécute le save en attente (si l'utilisateur a modifié pendant le save)
      if (pendingSave.current) {
        const p = pendingSave.current
        pendingSave.current = null
        doSave(p.cats, p.dv, p.adj)
      }
    }
  }

  // Raccourci pour le bouton Sauvegarder (valeurs directes du render courant)
  function saveNow() {
    hasChanges.current = true  // force save même si hasChanges pas encore levé
    doSave(categories, devis, globalAdj)
  }

  // ── Mise à jour ajustements globaux ──────────────────────────────────────
  function updateGlobalAdj(field, value) {
    const num = parseFloat(value) || 0
    hasChanges.current = true
    setGlobalAdj(p => ({ ...p, [field]: num }))
  }

  // Mise à jour d'un champ direct du devis (tva_rate, acompte_pct…)
  function updateDevisField(field, value) {
    hasChanges.current = true
    setDevis(p => ({ ...p, [field]: value }))
  }

  // ── Gestion catégories ────────────────────────────────────────────────────
  async function addCategory(name) {
    const { data: cat } = await supabase
      .from('devis_categories')
      .insert({ devis_id: devisId, name: name || 'NOUVELLE CATÉGORIE', sort_order: categories.length, dans_marge: true })
      .select()
      .single()
    if (cat) setCategories(prev => [...prev, { ...cat, lines: [] }])
  }

  // Ajoute un bloc canonique (revient à sa place d'origine dans l'ordre)
  async function addBlocCanonique(bloc) {
    const canonicalIdx = BLOCS_CANONIQUES.findIndex(b => b.key === bloc.key)
    const { data: cat } = await supabase
      .from('devis_categories')
      .insert({ devis_id: devisId, name: bloc.key, sort_order: canonicalIdx * 10, dans_marge: true })
      .select()
      .single()
    if (cat) setCategories(prev => [...prev, { ...cat, lines: [] }])
  }

  async function renameCategory(catId, name) {
    await supabase.from('devis_categories').update({ name }).eq('id', catId)
    setCategories(prev => prev.map(c => c.id === catId ? { ...c, name } : c))
  }

  async function updateCategoryDansMarge(catId, val) {
    await supabase.from('devis_categories').update({ dans_marge: val }).eq('id', catId)
    setCategories(prev => prev.map(c => c.id === catId ? { ...c, dans_marge: val } : c))
  }

  async function updateCategoryNotes(catId, notes) {
    await supabase.from('devis_categories').update({ notes }).eq('id', catId)
    setCategories(prev => prev.map(c => c.id === catId ? { ...c, notes } : c))
  }

  async function deleteCategory(catId) {
    if (!confirm('Supprimer cette catégorie et toutes ses lignes ?')) return
    await supabase.from('devis_lines').delete().eq('category_id', catId)
    await supabase.from('devis_categories').delete().eq('id', catId)
    setCategories(prev => prev.filter(c => c.id !== catId))
  }

  // ── Gestion lignes ────────────────────────────────────────────────────────
  // Ouvre la modale régime-first (avec pré-remplissage optionnel)
  function addLine(catId, defaultRegime = null, prefilledProduit = null) {
    setCategories(prev => {
      const cat = prev.find(c => c.id === catId)
      const info = cat ? getBlocInfo(cat) : { defaultRegime: 'Frais' }
      const regime = defaultRegime || info.defaultRegime || EMPTY_LINE.regime
      setAddLineModal({ catId, defaultRegime: regime, prefilledProduit })
      return prev
    })
  }

  // Duplique une ligne existante et l'insère juste après
  function duplicateLine(catId, lineId, tempId) {
    const tempNewId = `tmp_${Date.now()}_${Math.random()}`
    hasChanges.current = true
    setCategories(prev => prev.map(c => {
      if (c.id !== catId) return c
      const idx = c.lines.findIndex(l => lineId ? l.id === lineId : l._tempId === tempId)
      if (idx === -1) return c
      const original = c.lines[idx]
      const clone = { ...original, id: null, _tempId: tempNewId, sort_order: idx + 1 }
      const lines = [...c.lines]
      lines.splice(idx + 1, 0, clone)
      return { ...c, lines: lines.map((l, i) => ({ ...l, sort_order: i })) }
    }))
  }

  // Insère une ligne directement (sans passer par la modale)
  function insertLine(catId, lineData) {
    const tempId = `tmp_${Date.now()}_${Math.random()}`
    hasChanges.current = true
    setCategories(prev => prev.map(c =>
      c.id === catId
        ? { ...c, lines: [...c.lines, { ...EMPTY_LINE, ...lineData, _tempId: tempId, sort_order: c.lines.length }] }
        : c
    ))
  }

  // Insère la ligne depuis la modale + ferme la modale
  function confirmAddLine(catId, lineData) {
    insertLine(catId, lineData)
    setAddLineModal(null)
  }

  async function deleteLine(catId, lineId, tempId) {
    if (lineId) await supabase.from('devis_lines').delete().eq('id', lineId)
    setCategories(prev => prev.map(c =>
      c.id === catId
        ? { ...c, lines: c.lines.filter(l => (lineId ? l.id !== lineId : l._tempId !== tempId)) }
        : c
    ))
  }

  function updateLine(catId, lineId, tempId, field, value) {
    hasChanges.current = true
    setCategories(prev => prev.map(c =>
      c.id === catId
        ? {
            ...c,
            lines: c.lines.map(l => {
              if (!(lineId ? l.id === lineId : l._tempId === tempId)) return l
              const updated = { ...l, [field]: value }
              updated.is_crew = CATS_HUMAINS.includes(updated.regime)
              return updated
            })
          }
        : c
    ))
  }

  function updateLineBatch(catId, lineId, tempId, updates) {
    hasChanges.current = true
    setCategories(prev => prev.map(c =>
      c.id === catId
        ? {
            ...c,
            lines: c.lines.map(l => {
              if (!(lineId ? l.id === lineId : l._tempId === tempId)) return l
              const updated = { ...l, ...updates }
              updated.is_crew = CATS_HUMAINS.includes(updated.regime)
              return updated
            })
          }
        : c
    ))
  }

  // ── Réordonner les lignes d'un bloc (drag & drop) ────────────────────────
  function reorderLines(catId, fromIdx, toIdx) {
    if (fromIdx === toIdx) return
    hasChanges.current = true
    setCategories(prev => prev.map(c => {
      if (c.id !== catId) return c
      const lines = [...c.lines]
      const [moved] = lines.splice(fromIdx, 1)
      lines.splice(toIdx, 0, moved)
      return { ...c, lines: lines.map((l, i) => ({ ...l, sort_order: i })) }
    }))
  }

  // ── Dupliquer en nouvelle version ─────────────────────────────────────────
  async function dupliquerVersion() {
    const { data: versions } = await supabase
      .from('devis')
      .select('version_number')
      .eq('project_id', projectId)
      .order('version_number', { ascending: false })
      .limit(1)

    const nextVersion = (versions?.[0]?.version_number || 0) + 1

    const { data: newDevis } = await supabase
      .from('devis')
      .insert({
        project_id: projectId,
        version_number: nextVersion,
        title: devis?.title,
        tva_rate: devis?.tva_rate,
        acompte_pct: devis?.acompte_pct,
        notes: devis?.notes,
        status: 'brouillon',
        marge_globale_pct:      globalAdj.marge_globale_pct,
        assurance_pct:          globalAdj.assurance_pct,
        remise_globale_pct:     globalAdj.remise_globale_pct,
        remise_globale_montant: globalAdj.remise_globale_montant,
      })
      .select()
      .single()

    if (!newDevis) return

    for (const cat of categories) {
      const { data: newCat } = await supabase
        .from('devis_categories')
        .insert({ devis_id: newDevis.id, name: cat.name, sort_order: cat.sort_order, dans_marge: cat.dans_marge !== false })
        .select()
        .single()

      if (newCat) {
        await supabase.from('devis_lines').insert(
          cat.lines.map(l => ({
            devis_id: newDevis.id,
            category_id: newCat.id,
            ref: l.ref, produit: l.produit, description: l.description,
            regime: l.regime, use_line: l.use_line,
            dans_marge: true,
            nb: l.nb ?? 1, quantite: l.quantite, unite: l.unite,
            tarif_ht: l.tarif_ht, cout_ht: l.cout_ht ?? null,
            remise_pct: l.remise_pct, sort_order: l.sort_order,
            is_crew: REGIMES_SALARIES.includes(l.regime),
          }))
        )
      }
    }

    navigate(`/projets/${projectId}/devis/${newDevis.id}`)
  }

  // ── Calcul synthèse global ────────────────────────────────────────────────
  // Si une catégorie a dans_marge=false, ses lignes ne comptent pas dans la marge globale
  const allLines = categories.flatMap(c =>
    c.lines.map(l => ({ ...l, dans_marge: c.dans_marge !== false ? l.dans_marge : false }))
  )
  // Affiche la colonne Remise si au moins une ligne a une remise, OU si l'utilisateur l'a forcée
  const hasAnyRemise = categories.some(c => c.lines.some(l => l.remise_pct > 0))
  const remiseVisible = showRemise || hasAnyRemise

  const synth = calcSynthese(
    allLines,
    devis?.tva_rate    || 20,
    devis?.acompte_pct || 30,
    taux,
    globalAdj
  )

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <header className="px-4 shrink-0" style={{ background: 'var(--bg-surf)', borderBottom: '1px solid var(--brd)' }}>
        <div className="flex items-center justify-between gap-4 py-2">

          {/* Gauche : navigation + titre */}
          <div className="flex items-center gap-2.5 shrink-0">
            {!embedded && (
              <Link to={`/projets/${projectId}`} className="btn-ghost btn-sm">
                <ChevronLeft className="w-4 h-4" />
              </Link>
            )}
            {embedded && (
              <Link
                to={`/projets/${projectId}/devis`}
                className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded transition-all"
                style={{
                  color: 'var(--txt)',
                  background: 'rgba(255,255,255,.07)',
                  border: '1px solid rgba(255,255,255,.12)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.07)'}
              >
                <ChevronLeft className="w-3.5 h-3.5" />Versions
              </Link>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold" style={{ color: 'var(--blue)' }}>Devis V{devis?.version_number}</span>
              <StatusSelect status={devis?.status} onChange={v => updateDevisField('status', v)} />
            </div>
          </div>

          {/* Droite : statut save + boutons ─────────────────────────────── */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-xs" style={{ width: '90px', justifyContent: 'flex-end' }}>
              {saving && <><RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--txt-3)' }} /><span style={{ color: 'var(--txt-3)' }}>Sauvegarde…</span></>}
              {saved && !saving && <><Check className="w-3.5 h-3.5" style={{ color: 'var(--green)' }} /><span style={{ color: 'var(--green)' }}>Sauvegardé</span></>}
              {saveError && !saving && (
                <span className="font-medium cursor-pointer" style={{ color: 'var(--red)' }} onClick={() => alert(`Erreur sauvegarde :\n${saveError}`)}>
                  ⚠ Erreur save
                </span>
              )}
            </div>
            <button onClick={saveNow} className="btn-secondary btn-sm">
              <Save className="w-3.5 h-3.5" />Sauvegarder
            </button>
            <button onClick={dupliquerVersion} className="btn-secondary btn-sm">
              <Copy className="w-3.5 h-3.5" />Dupliquer V{(devis?.version_number || 0) + 1}
            </button>
            <button
              onClick={() => exportDevisPDF({ ...devis, categories, globalAdj }, project, client, org, taux).catch(console.error)}
              className="btn-secondary btn-sm"
            >
              <Download className="w-3.5 h-3.5" />PDF
            </button>
            <button
              onClick={() => {
                const url = `${window.location.origin}/devis/public/${devis?.public_token}`
                navigator.clipboard.writeText(url)
                alert(`Lien copié :\n${url}`)
              }}
              className="btn-primary btn-sm"
            >
              <Eye className="w-3.5 h-3.5" />Lien client
            </button>
          </div>
        </div>
      </header>

      {/* ── Table principale — pleine largeur ────────────────────────────── */}
      <div className="flex-1 overflow-auto" style={{ paddingBottom: '80px' }}>

          <table className="devis-table w-full border-collapse" style={{ minWidth: showAnalyse ? '1310px' : '910px' }}>
            <thead className="sticky top-0 z-20">
              <tr>
                {/* Grip — collapse-all intégré */}
                <th className="w-8 text-center">
                  {(() => {
                    const allCollapsed = categories.length > 0 && categories.every(c => collapsed[c.id])
                    return (
                      <button
                        onClick={() => allCollapsed
                          ? setCollapsed({})
                          : setCollapsed(Object.fromEntries(categories.map(c => [c.id, true])))
                        }
                        title={allCollapsed ? 'Tout développer' : 'Tout réduire'}
                        className="flex items-center justify-center rounded transition-all"
                        style={{
                          width: '22px', height: '18px',
                          color: 'var(--txt-2)',
                          background: 'rgba(255,255,255,.06)',
                          border: '1px solid rgba(255,255,255,.10)',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.11)'; e.currentTarget.style.color = 'var(--txt)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.color = 'var(--txt-2)' }}
                      >
                        {allCollapsed
                          ? <ChevronRight className="w-2.5 h-2.5" />
                          : <ChevronDown className="w-2.5 h-2.5" />
                        }
                      </button>
                    )
                  })()}
                </th>
                <th className="w-6" title="Activer la ligne">✓</th>
                <th className="w-72">Produit / Poste</th>
                <th className="w-56">Description</th>
                <th className="w-24">Cat.</th>
                <th className="w-10">Nb</th>
                <th className="w-12">Qté</th>
                <th className="w-12">Unité</th>
                <th className="w-24">Tarif HT</th>
                <th className="col-cout w-24" title="Coût d'achat unitaire (vide = égal au tarif)">Coût unit.</th>
                {remiseVisible && (
                  <th className="w-16">
                    <button
                      onClick={() => setShowRemise(p => !p)}
                      title={showRemise && !hasAnyRemise ? 'Masquer la colonne remise' : 'Remise'}
                      className="flex items-center gap-1 rounded transition-all"
                      style={{
                        padding: '1px 5px', fontSize: '10px', fontWeight: 600,
                        color: hasAnyRemise ? 'var(--txt-2)' : 'var(--txt-3)',
                        background: showRemise && !hasAnyRemise ? 'rgba(255,255,255,.06)' : 'transparent',
                        border: showRemise && !hasAnyRemise ? '1px solid rgba(255,255,255,.10)' : '1px solid transparent',
                      }}
                    >
                      Remise {showRemise && !hasAnyRemise && <X className="w-2.5 h-2.5 ml-0.5" />}
                    </button>
                  </th>
                )}
                {!remiseVisible && (
                  <th className="w-5" title="Afficher la colonne remise">
                    <button
                      onClick={() => setShowRemise(true)}
                      style={{ color: 'var(--txt-3)', opacity: 0.4, padding: '2px' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}
                      title="Afficher la colonne Remise"
                    >
                      <Percent className="w-2.5 h-2.5" />
                    </button>
                  </th>
                )}
                <th className="col-vente w-28">Prix vente HT</th>
                {showAnalyse ? (
                  <>
                    <th className="col-dim w-24">Coût réel</th>
                    <th className="col-dim w-32">Marge / %</th>
                    <th className="col-dim w-24">Charges</th>
                    <th className="col-dim w-28">Coût chargé</th>
                  </>
                ) : (
                  <th className="col-dim w-16">Mg %</th>
                )}
                {/* Actions — toggle Analyse intégré */}
<th className="w-20 text-right" style={{ paddingRight: '6px' }}>
                  <button
                    onClick={() => setShowAnalyse(p => !p)}
                    title={showAnalyse ? 'Masquer l\'analyse' : 'Afficher l\'analyse'}
                    className="flex items-center gap-1 ml-auto rounded transition-all"
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      fontWeight: 600,
                      letterSpacing: '.03em',
                      whiteSpace: 'nowrap',
                      ...(showAnalyse ? {
                        color: 'var(--blue)',
                        background: 'rgba(77,159,255,.15)',
                        border: '1px solid rgba(77,159,255,.35)',
                      } : {
                        color: 'var(--txt-2)',
                        background: 'rgba(255,255,255,.06)',
                        border: '1px solid rgba(255,255,255,.10)',
                      })
                    }}
                    onMouseEnter={e => { if (!showAnalyse) { e.currentTarget.style.background = 'rgba(255,255,255,.11)'; e.currentTarget.style.color = 'var(--txt)' } }}
                    onMouseLeave={e => { if (!showAnalyse) { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.color = 'var(--txt-2)' } }}
                  >
                    <BarChart3 className="w-2.5 h-2.5" />
                    <span>Analyse</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {computeSortedCategories(categories).map(({ cat, info, num }) => (
                <CategoryBlock
                  key={cat.id}
                  cat={cat}
                  info={info}
                  num={num}
                  collapsed={!!collapsed[cat.id]}
                  taux={taux}
                  bdd={bdd}
                  showAnalyse={showAnalyse}
                  remiseVisible={remiseVisible}
                  onToggle={() => setCollapsed(p => ({ ...p, [cat.id]: !p[cat.id] }))}
                  onRename={name => renameCategory(cat.id, name)}
                  onDelete={() => deleteCategory(cat.id)}
                  onToggleDansMarge={val => updateCategoryDansMarge(cat.id, val)}
                  onUpdateNotes={notes => updateCategoryNotes(cat.id, notes)}
                  onAddLine={(defaultRegime, prefilledProduit) => addLine(cat.id, defaultRegime, prefilledProduit)}
                  onAddLineDirect={(lineData) => insertLine(cat.id, lineData)}
                  onOpenIntermittent={(item) => setAddLineModal({
                    catId: cat.id,
                    defaultRegime: item.filiere === 'Artiste' ? 'Intermittent Artiste' : 'Intermittent Technicien',
                    prefilledPoste: item.poste,
                    prefilledIsSpec: item.is_specialise || false,
                  })}
                  onUpdateLine={(lineId, tempId, field, val) => updateLine(cat.id, lineId, tempId, field, val)}
                  onUpdateLineBatch={(lineId, tempId, updates) => updateLineBatch(cat.id, lineId, tempId, updates)}
                  onDeleteLine={(lineId, tempId) => deleteLine(cat.id, lineId, tempId)}
                  onDuplicateLine={(lineId, tempId) => duplicateLine(cat.id, lineId, tempId)}
                  onReorderLines={(fromIdx, toIdx) => reorderLines(cat.id, fromIdx, toIdx)}
                />
              ))}
            </tbody>
          </table>

          {/* Ajouter bloc */}
          {(() => {
            const activeKeys = new Set(categories.map(c => c.name))
            const inactiveBlocs = BLOCS_CANONIQUES.filter(b => !activeKeys.has(b.key))
            return (
              <div className="p-4 flex flex-wrap items-center gap-2" style={{ borderTop: '1px solid var(--brd-sub)' }}>
                <span className="text-xs font-medium" style={{ color: 'var(--txt-3)' }}>Ajouter un bloc :</span>
                {inactiveBlocs.map(bloc => (
                  <button key={bloc.key} onClick={() => addBlocCanonique(bloc)}
                    className="btn-secondary btn-sm text-xs flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: bloc.color }} />
                    + {bloc.label}
                  </button>
                ))}
                {inactiveBlocs.length === 0 && (
                  <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>Tous les blocs sont actifs</span>
                )}
                <button onClick={() => addCategory('')}
                  className="btn-ghost btn-sm text-xs ml-2" style={{ color: 'var(--txt-3)' }}>
                  + Bloc personnalisé…
                </button>
              </div>
            )
          })()}
      </div>

      {/* ── Modale ajout de ligne — régime-first ─────────────────────────── */}
      {addLineModal && (
        <AddLineModal
          catId={addLineModal.catId}
          defaultRegime={addLineModal.defaultRegime}
          prefilledPoste={addLineModal.prefilledPoste || null}
          prefilledIsSpec={addLineModal.prefilledIsSpec || false}
          prefilledProduit={addLineModal.prefilledProduit || null}
          onConfirm={(lineData) => confirmAddLine(addLineModal.catId, lineData)}
          onClose={() => setAddLineModal(null)}
        />
      )}

      {/* ── Bandeau Synthèse — sticky bas pleine largeur ──────────────────── */}
      <SynthBar
        synth={synth}
        devis={devis}
        globalAdj={globalAdj}
        onUpdateGlobal={updateGlobalAdj}
        onUpdateDevis={updateDevisField}
      />
    </div>
  )
}

// ─── Catégorie ────────────────────────────────────────────────────────────────
function CategoryBlock({ cat, info, num, collapsed, taux, bdd, showAnalyse, remiseVisible, onToggle, onRename, onDelete, onToggleDansMarge, onUpdateNotes, onAddLine, onAddLineDirect, onOpenIntermittent, onUpdateLine, onUpdateLineBatch, onDeleteLine, onDuplicateLine, onReorderLines }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(info.label)
  const [showNotes, setShowNotes] = useState(!!(cat.notes))
  const [localNotes, setLocalNotes] = useState(cat.notes || '')
  const notesTimer = useRef(null)
  const dragIdx = useRef(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  const dansMarge   = cat.dans_marge !== false
  const accentColor = info.color || CAT_ACCENT_COLORS[0]
  const displayLabel = info.isCanonical ? info.label : cat.name
  const numLabel = num != null ? `${num} — ` : ''

  // ── Calculs agrégés de la catégorie ───────────────────────────────────────
  const activeLines = cat.lines.filter(l => l.use_line)
  const catStats = activeLines.reduce((acc, l) => {
    const c = calcLine(l, taux)
    return {
      sousTotal:  acc.sousTotal  + c.prixVenteHT,
      coutReel:   acc.coutReel   + c.coutReelHT,
      marge:      acc.marge      + (l.dans_marge ? c.margeHT : 0),
      charges:    acc.charges    + c.chargesPat,
      coutCharge: acc.coutCharge + c.coutCharge,
    }
  }, { sousTotal: 0, coutReel: 0, marge: 0, charges: 0, coutCharge: 0 })
  const pctMarge = catStats.sousTotal > 0 ? catStats.marge / catStats.sousTotal : 0

  return (
    <>
      {/* ── Séparateur haut — respiration entre blocs ────────────────────── */}
      <tr style={{ height: '40px' }}>
        <td colSpan={18} style={{ background: 'var(--bg)', padding: 0, border: 'none' }} />
      </tr>

      {/* ── En-tête catégorie — card top ─────────────────────────────────── */}
      <tr className="cat-row">
        <td
          className="px-3 py-1.5"
          colSpan={showAnalyse ? 16 : 13}
          style={{
            borderLeft:          `3px solid ${accentColor}`,
            borderTop:           `1px solid ${accentColor}30`,
            borderTopLeftRadius: '8px',
          }}
        >
          <div className="flex items-center gap-2">
            <button onClick={onToggle} style={{ color: 'var(--txt-3)' }} className="hover:text-white transition-colors shrink-0">
              {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {/* Numéro de bloc */}
            {num != null && (
              <span className="text-[10px] font-bold tabular-nums" style={{ color: `${accentColor}66`, minWidth: '1rem' }}>
                {num}
              </span>
            )}
            {/* Nom éditable — double-clic sur les blocs libres uniquement */}
            {!info.isCanonical && editing ? (
              <input
                autoFocus value={name}
                onChange={e => setName(e.target.value)}
                onBlur={() => { onRename(name); setEditing(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur()
                  if (e.key === 'Escape') { setName(cat.name); setEditing(false) }
                }}
                className="text-[11px] px-2 py-0.5 rounded border outline-none font-bold uppercase tracking-widest"
                style={{ background: 'var(--bg-elev)', color: accentColor, borderColor: accentColor + '50', minWidth: '120px' }}
              />
            ) : (
              <span
                className="text-[11px] font-bold uppercase tracking-widest transition-colors"
                style={{ color: accentColor, cursor: info.isCanonical ? 'default' : 'pointer' }}
                title={info.isCanonical ? undefined : 'Double-cliquer pour renommer'}
                onDoubleClick={info.isCanonical ? undefined : () => { setName(cat.name); setEditing(true) }}
              >
                {displayLabel}
              </span>
            )}
            <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              {activeLines.length} ligne{activeLines.length > 1 ? 's' : ''}
            </span>
            {/* Toggle dans_marge */}
            <button
              onClick={() => onToggleDansMarge(!dansMarge)}
              title={dansMarge ? 'Exclure du calcul de marge globale' : 'Inclure dans le calcul de marge globale'}
              className="text-[10px] px-1.5 py-[1px] rounded-full font-medium transition-all"
              style={dansMarge
                ? { background: 'rgba(0,200,117,.1)', color: 'rgba(0,200,117,.6)', border: '1px solid rgba(0,200,117,.2)' }
                : { background: 'var(--bg-elev)', color: 'var(--txt-3)', border: '1px solid var(--brd)', textDecoration: 'line-through' }
              }
            >
              {dansMarge ? 'Marge' : 'Hors marge'}
            </button>
            {/* Bouton notes */}
            <button
              onClick={() => setShowNotes(v => !v)}
              title={showNotes ? 'Masquer les notes' : 'Afficher les notes'}
              className="transition-all"
              style={{
                color: (showNotes || localNotes) ? 'var(--orange)' : 'var(--txt-3)',
                opacity: (showNotes || localNotes) ? 1 : 0.4,
              }}
            >
              <StickyNote className="w-3 h-3" />
            </button>
            {/* Total bloc — affiché à droite */}
            <span className="ml-auto text-[11px] tabular-nums font-semibold pr-2" style={{ color: accentColor }}>
              {fmtEur(catStats.sousTotal)}
            </span>
          </div>
        </td>
        <td className="px-2 py-1.5 text-center" style={{
          borderTop:            `1px solid ${accentColor}18`,
          borderRight:          `1px solid ${accentColor}18`,
          borderTopRightRadius: '8px',
        }}>
          <button onClick={onDelete} className="transition-colors" style={{ color: 'var(--txt-3)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </td>
      </tr>

      {!collapsed && showNotes && (
        <tr>
          <td
            colSpan={showAnalyse ? 17 : 14}
            style={{
              background:  'var(--bg-surf)',
              borderLeft:  `3px solid ${accentColor}`,
              borderRight: `1px solid ${accentColor}18`,
              padding:     '6px 12px',
            }}
          >
            <textarea
              value={localNotes}
              placeholder="Notes sur ce bloc…"
              rows={2}
              onChange={e => {
                const val = e.target.value
                setLocalNotes(val)
                clearTimeout(notesTimer.current)
                notesTimer.current = setTimeout(() => onUpdateNotes(val), 600)
              }}
              onBlur={() => { clearTimeout(notesTimer.current); onUpdateNotes(localNotes) }}
              className="w-full resize-none outline-none text-xs rounded px-2 py-1.5"
              style={{
                background:  'rgba(255,255,255,.04)',
                border:      `1px solid ${accentColor}25`,
                color:       'var(--txt-2)',
                lineHeight:  1.5,
              }}
            />
          </td>
        </tr>
      )}

      {!collapsed && cat.lines.map((line, idx) => (
        <DevisLine
          key={line.id || line._tempId}
          line={line}
          taux={taux}
          bdd={bdd}
          accentColor={accentColor}
          showAnalyse={showAnalyse}
          remiseVisible={remiseVisible}
          isDragOver={dragOverIdx === idx}
          onChange={(field, val) => onUpdateLine(line.id, line._tempId, field, val)}
          onChangeBatch={(updates) => onUpdateLineBatch(line.id, line._tempId, updates)}
          onDelete={() => onDeleteLine(line.id, line._tempId)}
          onDuplicate={() => onDuplicateLine(line.id, line._tempId)}
          onDragStart={() => { dragIdx.current = idx }}
          onDragOver={() => setDragOverIdx(idx)}
          onDrop={() => {
            if (dragIdx.current !== null) onReorderLines(dragIdx.current, idx)
            dragIdx.current = null
            setDragOverIdx(null)
          }}
          onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null) }}
        />
      ))}

      {!collapsed && (
        <tr>
          <td
            colSpan={showAnalyse ? 17 : 14}
            style={{
              background:  'var(--bg-surf)',
              borderLeft:  `3px solid ${accentColor}`,
              borderRight: `1px solid ${accentColor}18`,
              padding: 0,
            }}
          >
            <BlocSearchBar
              bdd={bdd}
              defaultRegime={info.defaultRegime}
              accentColor={accentColor}
              onAddDirect={onAddLineDirect}
              onOpenIntermittent={onOpenIntermittent}
              onAddFreeForm={(queryText) => onAddLine(info.defaultRegime, queryText || null)}
            />
          </td>
        </tr>
      )}

      {/* ── Footer de synthèse catégorie — card bottom ───────────────────── */}
      <tr className="bloc-footer">
        <td
          colSpan={11}
          className="px-4 py-1.5 text-[10px]"
          style={{
            color:                  'var(--txt-3)',
            borderLeft:             `3px solid ${accentColor}`,
            borderBottom:           `1px solid ${accentColor}30`,
            borderBottomLeftRadius: '8px',
          }}
        >
          {!dansMarge && <span className="italic" style={{ color: 'var(--orange)' }}>hors marge</span>}
        </td>
        {/* Prix vente HT — toujours visible */}
        <td className="px-2 py-1 text-right text-xs tabular-nums font-bold whitespace-nowrap" style={{ color: 'var(--blue)', borderBottom: `1px solid ${accentColor}30` }}>
          {fmtEur(catStats.sousTotal)}
        </td>
        {/* Colonnes analyse — conditionnelles */}
        {showAnalyse ? (
          <>
            {/* Coût réel */}
            <td className="px-2 py-1 text-right text-[11px] tabular-nums whitespace-nowrap" style={{ color: 'var(--txt-3)', borderBottom: `1px solid ${accentColor}30` }}>
              {fmtEur(catStats.coutReel)}
            </td>
            {/* Marge + % fusionnés */}
            <td className="px-2 py-1 text-right whitespace-nowrap" style={{ borderBottom: `1px solid ${accentColor}30` }}>
              <div className="text-[11px] tabular-nums font-semibold" style={{ color: catStats.marge >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtEur(catStats.marge)}
              </div>
              <div className="text-[10px] tabular-nums" style={{ color: pctMarge >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {(pctMarge * 100).toFixed(1)}%
              </div>
            </td>
            {/* Charges */}
            <td className="px-2 py-1 text-right text-[11px] tabular-nums whitespace-nowrap" style={{ color: 'var(--txt-3)', borderBottom: `1px solid ${accentColor}30` }}>
              {catStats.charges > 0 ? fmtEur(catStats.charges) : '—'}
            </td>
            {/* Coût chargé */}
            <td className="px-2 py-1 text-right text-[11px] tabular-nums whitespace-nowrap" style={{ color: 'var(--txt-3)', borderBottom: `1px solid ${accentColor}30` }}>
              {fmtEur(catStats.coutCharge)}
            </td>
          </>
        ) : (
          /* Résumé compact Mg% */
          <td className="px-2 py-1 text-right text-[11px] tabular-nums font-semibold whitespace-nowrap" style={{
            color: pctMarge >= 0 ? 'var(--green)' : 'var(--red)',
            borderBottom: `1px solid ${accentColor}30`,
          }}>
            {(pctMarge * 100).toFixed(1)}%
          </td>
        )}
        <td style={{
          borderRight:             `1px solid ${accentColor}18`,
          borderBottom:            `1px solid ${accentColor}30`,
          borderBottomRightRadius: '8px',
        }} />
      </tr>
    </>
  )
}

// ─── Sélecteur de régime visuel ───────────────────────────────────────────────
function RegimeSelect({ value, onChange: onChangeProp }) {
  const [open, setOpen]   = useState(false)
  const [pos,  setPos]    = useState(null)
  const triggerRef        = useRef(null)
  const dropdownRef       = useRef(null)

  const meta     = REGIME_META[value] || { abbr: value, type: 'frais' }
  const typeMeta = REGIME_TYPES[meta.type] || REGIME_TYPES.frais
  const { Icon } = typeMeta

  function openDropdown() {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left })
    setOpen(true)
  }

  // Fermeture au clic extérieur
  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (triggerRef.current?.contains(e.target)) return
      if (dropdownRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Fermeture si le tableau scrolle
  useEffect(() => {
    if (!open) return
    function handleScroll() { setOpen(false) }
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [open])

  return (
    <>
      {/* ── Trigger — compact ──────────────────────────────────────────────── */}
      <button
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openDropdown()}
        className="flex items-center gap-1 w-full px-1 py-0.5 rounded transition-all"
        style={{ background: 'transparent', color: 'var(--txt-2)' }}
      >
        <Icon className="w-3 h-3 shrink-0" style={{ color: 'var(--txt-3)' }} />
        <span className="text-[11px] truncate flex-1 text-left">{meta.abbr}</span>
        <ChevronDown className="w-2.5 h-2.5 shrink-0 opacity-30" />
      </button>

      {/* ── Dropdown via portal ─────────────────────────────────────────────── */}
      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top:       pos.top,
            left:      pos.left,
            zIndex:    9999,
            minWidth:  '210px',
            background: 'var(--bg-elev)',
            border:    '1px solid var(--brd)',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,.8)',
            overflow:  'hidden',
          }}
        >
          {Object.entries(REGIME_TYPES).map(([typeKey, tm]) => {
            const GroupIcon = tm.Icon
            const options = CATS.filter(r => (REGIME_META[r]?.type ?? 'frais') === typeKey)
            if (!options.length) return null
            return (
              <div key={typeKey}>
                {/* En-tête de groupe */}
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5"
                  style={{ borderBottom: '1px solid var(--brd-sub)', background: 'rgba(255,255,255,.03)' }}
                >
                  <GroupIcon className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--txt-3)' }}>
                    {tm.label}
                  </span>
                </div>
                {/* Options */}
                {options.map(r => {
                  const isSelected = r === value
                  return (
                    <button
                      key={r}
                      className="w-full text-left flex items-center gap-2 px-4 py-1.5 text-xs transition-colors"
                      style={{ color: isSelected ? 'var(--txt)' : 'var(--txt-2)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      onClick={() => { onChangeProp(r); setOpen(false) }}
                    >
                      <span className="w-3 h-3 flex items-center justify-center shrink-0">
                        {isSelected && <Check className="w-2.5 h-2.5" style={{ color: 'var(--green)' }} />}
                      </span>
                      {r}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}

// ─── Ligne de devis ───────────────────────────────────────────────────────────
function DevisLine({ line, taux, bdd, accentColor, onChange, onChangeBatch, onDelete, onDuplicate, showAnalyse = false, remiseVisible = false, isDragOver = false, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const c = calcLine(line, taux)
  const inactive = !line.use_line

  function handleSelectProduit(p) {
    const updates = { produit: p.produit }
    if (p.regime)        updates.regime    = normalizeRegime(p.regime)
    if (p.tarif_defaut)  updates.tarif_ht  = Number(p.tarif_defaut)
    if (p.unite)         updates.unite     = p.unite
    if (p.description)   updates.description = p.description
    onChangeBatch(updates)
  }

  return (
    <tr
      className={inactive ? 'opacity-40' : ''}
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.() }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver?.() }}
      onDrop={e => { e.preventDefault(); onDrop?.() }}
      onDragEnd={onDragEnd}
      style={{
        background: isDragOver ? 'rgba(255,255,255,.04)' : 'var(--bg-surf)',
        outline: isDragOver ? `2px solid ${accentColor}60` : 'none',
        transition: 'outline 80ms, background 80ms',
      }}
    >
      <td className="text-center" style={{ color: 'var(--txt-3)', borderLeft: `3px solid ${accentColor}`, cursor: 'grab' }}>
        <GripVertical className="w-3 h-3 mx-auto opacity-40" />
      </td>
      {/* ✓ USE */}
      <td className="text-center">
        <input type="checkbox" className="toggle"
          checked={!!line.use_line}
          onChange={e => onChange('use_line', e.target.checked)} />
      </td>
      {/* Produit avec autocomplete BDD — colonne principale */}
      <td className="produit-cell">
        <ProduitAutocomplete
          value={line.produit || ''}
          bdd={bdd}
          onChange={val => onChange('produit', val)}
          onSelect={handleSelectProduit}
        />
      </td>
      {/* Description — textarea multilignes, auto-resize */}
      <td className="align-top">
        <textarea
          className="input-cell w-full"
          style={{
            resize: 'none',
            overflow: 'hidden',
            lineHeight: '1.4',
            minHeight: '22px',
          }}
          rows={1}
          value={line.description || ''}
          placeholder="Description…"
          ref={el => {
            if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
          }}
          onChange={e => {
            onChange('description', e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
          }}
          onKeyDown={e => {
            if (e.key === 'Tab') {
              e.preventDefault()
              const sel = 'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
              const all = [...document.querySelectorAll(sel)]
              const idx = all.indexOf(e.currentTarget)
              const next = e.shiftKey ? all[idx - 1] : all[idx + 1]
              if (next) next.focus()
            }
          }}
        />
      </td>
      <td>
        <RegimeSelect
          value={line.regime}
          onChange={val => onChange('regime', val)}
        />
      </td>
      {/* Nb — unités physiques (caméras, micros…) */}
      <td style={{ padding: 0 }}>
        <input
          type="number"
          className="input-cell w-full text-right"
          value={line.nb ?? 1}
          onChange={e => onChange('nb', parseFloat(e.target.value) || 1)}
          min={1} step={1}
          title="Nombre d'unités (ex : 2 caméras)"
        />
      </td>
      {/* Qté — jours / périodes */}
      <td style={{ padding: 0 }}>
        <input
          type="number"
          className="input-cell w-full text-right"
          value={line.quantite || ''}
          onChange={e => onChange('quantite', parseFloat(e.target.value) || 0)}
          min={0} step={0.5}
          title="Quantité (ex : 2 jours)"
        />
      </td>
      {/* Unité */}
      <td>
        <select className="w-full text-xs border-0 cursor-pointer text-center rounded"
          style={{ background: 'transparent', color: 'var(--txt-2)' }}
          value={line.unite || 'F'}
          onChange={e => onChange('unite', e.target.value)}>
          {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </td>
      {/* Tarif vente HT */}
      <td>
        <PriceCell value={line.tarif_ht} onChange={v => onChange('tarif_ht', v)} />
      </td>
      {/* Coût unitaire — fixe pour salariés, saisissable sinon (vide = coût égal vente) */}
      <td>
        {REGIMES_SALARIES.includes(line.regime) ? (
          /* Intermittents purs : coût = salaire brut = tarif, non éditable */
          <div className="text-right px-2 tabular-nums text-xs" style={{ color: 'var(--txt-3)' }}
            title="Coût = tarif brut (régime intermittent)">
            {fmtEur(line.tarif_ht)}
          </div>
        ) : (
          /* Tous les autres (Ext. Intermittent, Externe, Interne, Technique, Frais) : coût saisissable */
          <div className="flex flex-col items-end">
            <PriceCell
              value={line.cout_ht}
              onChange={v => onChange('cout_ht', v)}
              placeholder={line.regime === 'Ext. Intermittent' ? 'brut' : '= vente'}
              nullable
              style={{ color: line.regime === 'Ext. Intermittent' ? 'var(--purple, #7c3aed)' : 'var(--orange)' }}
              title={line.regime === 'Ext. Intermittent' ? 'Salaire brut intermittent (base cotisations 67%)' : undefined}
            />
            {line.regime === 'Ext. Intermittent' && c.chargesPat > 0 && (
              <div
                className="text-[9px] tabular-nums leading-none whitespace-nowrap pr-2"
                style={{ color: 'var(--purple, #7c3aed)', opacity: 0.7 }}
                title="Cotisations patronales estimées (67% × brut)"
              >
                +{fmtEur(c.chargesPat)} charg.
              </div>
            )}
          </div>
        )}
      </td>
      {/* Remise % — visible seulement si remiseVisible */}
      {remiseVisible && (
        <td>
          <div className="relative">
            <input type="number" className="input-cell w-full text-right pr-5" value={line.remise_pct || ''}
              onChange={e => onChange('remise_pct', parseFloat(e.target.value) || 0)}
              min={0} max={100} step={1} placeholder="0" />
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: 'var(--txt-3)' }}>%</span>
          </div>
        </td>
      )}
      {!remiseVisible && <td className="w-5" />}
      {/* Colonne clé — Prix vente HT, toujours visible */}
      <CalcCell val={c.prixVenteHT} style={{ color: 'var(--blue)', fontWeight: 600 }} />
      {/* Colonnes analyse — conditionnelles */}
      {(() => {
        // Interne sans coût renseigné → marge non significative
        const isInterneNonValuee = line.regime === 'Interne' && (line.cout_ht === null || line.cout_ht === undefined)
        return showAnalyse ? (
          <>
            <CalcCell
              val={line.regime === 'Ext. Intermittent' ? c.coutCharge : c.coutReelHT}
              dim
              style={{ color: 'var(--txt-3)' }}
              title={line.regime === 'Ext. Intermittent' ? 'Coût chargé (brut + cotisations)' : undefined}
            />
            <td className="text-right px-2 py-[3px]">
              {isInterneNonValuee ? (
                <div className="text-[10px] italic" style={{ color: 'var(--purple)', opacity: 0.7 }} title="Ressource interne sans coût renseigné">interne</div>
              ) : (
                <>
                  <div className="text-[11px] tabular-nums" style={{ color: c.margeHT < 0 ? 'var(--red)' : 'var(--txt-3)' }}>
                    {c.margeHT !== 0 ? fmtEur(c.margeHT) : '—'}
                  </div>
                  <div className="text-[10px] tabular-nums leading-tight" style={{ color: c.pctMarge < 0 ? 'var(--red)' : 'var(--txt-3)' }}>
                    {fmtPct(c.pctMarge)}
                  </div>
                </>
              )}
            </td>
            <CalcCell val={c.chargesPat} dim style={{ color: 'var(--txt-3)' }} />
            <CalcCell val={c.coutCharge} dim style={{ color: 'var(--txt-3)' }} />
          </>
        ) : (
          <td className="text-right px-2 py-[3px]">
            {isInterneNonValuee ? (
              <span className="text-[10px] italic" style={{ color: 'var(--purple)', opacity: 0.7 }} title="Ressource interne sans coût renseigné">int.</span>
            ) : (
              <span className="text-[11px] tabular-nums font-medium" style={{
                color: c.pctMarge < 0 ? 'var(--red)' : c.pctMarge > 0.15 ? 'var(--green)' : 'var(--txt-3)'
              }}>
                {fmtPct(c.pctMarge)}
              </span>
            )}
          </td>
        )
      })()}
      {/* Actions */}
      <td className="text-center" style={{ borderRight: `1px solid ${accentColor}18` }}>
        <div className="flex items-center justify-center gap-2">
          <button onClick={onDuplicate} className="transition-colors" title="Dupliquer la ligne"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--blue)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}
          >
            <Copy className="w-3 h-3" />
          </button>
          <button onClick={onDelete} className="transition-colors" title="Supprimer la ligne"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// Cellule saisie prix — formatée au repos, input au clic
// nullable=true : vide → null (ex: cout_ht où null = "= vente")
function PriceCell({ value, onChange, placeholder = '—', style = {}, nullable = false }) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef(null)

  function commit(raw) {
    if (nullable) {
      onChange(raw === '' ? null : parseFloat(raw) ?? null)
    } else {
      onChange(parseFloat(raw) || 0)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        className="input-cell w-full text-right"
        defaultValue={value || ''}
        autoFocus
        min={0} step={0.01}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value) }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        style={style}
      />
    )
  }

  return (
    <div
      className="input-cell w-full text-right tabular-nums cursor-text"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onFocus={() => setEditing(true)}
      style={style}
    >
      {value !== null && value !== undefined ? fmtEur(value) : <span style={{ color: 'var(--txt-3)', fontStyle: 'italic' }}>{placeholder}</span>}
    </div>
  )
}

function CalcCell({ val, cls = '', style = {}, dim = false }) {
  return (
    <td
      className={`text-right px-2 py-[3px] tabular-nums ${dim ? 'text-[11px]' : 'text-xs'} ${cls}`}
      style={style}
    >
      {val !== 0 ? fmtEur(val) : <span style={{ color: 'var(--txt-3)' }}>—</span>}
    </td>
  )
}

// ─── KPI inline dans le topbar ────────────────────────────────────────────────
function TopbarKpi({ label, value, sub, color }) {
  return (
    <div className="flex flex-col items-center px-4">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>{label}</span>
      <span className="text-sm font-bold leading-tight" style={{ color }}>{value}</span>
      {sub && <span className="text-[10px] leading-tight" style={{ color: 'var(--txt-3)' }}>{sub}</span>}
    </div>
  )
}

// ─── Bandeau synthèse sticky bas + tiroir détails ─────────────────────────────
function SynthBar({ synth, devis, globalAdj, onUpdateGlobal, onUpdateDevis }) {
  const [open, setOpen] = useState(false)

  const margeColor = synth.pctMargeFinale < 0 ? 'var(--red)'
    : synth.pctMargeFinale > 0.2 ? 'var(--green)' : 'var(--amber)'

  const hasGlobalAdj = synth.totalCharges > 0 || globalAdj.marge_globale_pct > 0 ||
    globalAdj.assurance_pct > 0 || globalAdj.remise_globale_pct > 0 || globalAdj.remise_globale_montant > 0

  return (
    <>
      {/* Overlay sombre quand tiroir ouvert */}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,.35)' }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Bulle flottante — commence après la sidebar (w-56 = 14rem) ──────── */}
      <div style={{
        position: 'fixed',
        bottom: '12px',
        left: 'calc(14rem + 12px)',
        right: '12px',
        zIndex: 50,
        borderRadius: '14px',
        background: 'var(--bg-elev)',
        border: '1px solid rgba(255,255,255,.08)',
        boxShadow: '0 12px 48px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.04)',
        overflow: 'hidden',
      }}>

      {/* ── Tiroir détails — s'ouvre vers le haut (à l'intérieur de la bulle) ── */}
      {open && (
        <div style={{
          background: 'var(--bg-elev)',
          borderBottom: '1px solid rgba(255,255,255,.07)',
          maxHeight: '55vh',
          overflowY: 'auto',
        }}>
          {/* Grille 3 colonnes */}
          <div className="grid grid-cols-3 gap-0 px-6 py-4" style={{ maxWidth: '900px' }}>

            {/* Colonne 1 — Ajustements globaux */}
            <div className="pr-6" style={{ borderRight: '1px solid var(--brd-sub)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--txt-3)' }}>
                Ajustements globaux
              </p>
              <div className="space-y-2.5">
                <AdjRow
                  icon={<Percent className="w-3 h-3" style={{ color: 'var(--blue)' }} />}
                  label="Mg + Fg"
                  value={globalAdj.marge_globale_pct}
                  onChange={v => onUpdateGlobal('marge_globale_pct', v)}
                  suffix="%" computed={fmtEur(synth.montantMargeGlobale)}
                />
                <AdjRow
                  icon={<ShieldCheck className="w-3 h-3" style={{ color: 'var(--purple)' }} />}
                  label="Assurance"
                  value={globalAdj.assurance_pct}
                  onChange={v => onUpdateGlobal('assurance_pct', v)}
                  suffix="%" computed={fmtEur(synth.montantAssurance)}
                />
                <div>
                  <p className="text-[10px] mb-1.5 flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
                    <Tag className="w-3 h-3" style={{ color: 'var(--orange)' }} /> Remise globale
                  </p>
                  <div className="flex gap-1.5">
                    <div className="flex-1 relative">
                      <input type="number" className="input text-xs text-right pr-5 py-1 h-7 w-full"
                        value={globalAdj.remise_globale_pct || ''}
                        onChange={e => onUpdateGlobal('remise_globale_pct', e.target.value)}
                        min={0} max={100} step={0.5} placeholder="%" disabled={globalAdj.remise_globale_montant > 0}
                      />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: 'var(--txt-3)' }}>%</span>
                    </div>
                    <div className="flex-1">
                      <input type="number" className="input text-xs text-right py-1 h-7 w-full"
                        value={globalAdj.remise_globale_montant || ''}
                        onChange={e => onUpdateGlobal('remise_globale_montant', e.target.value)}
                        min={0} step={10} placeholder="€"
                      />
                    </div>
                  </div>
                  {synth.montantRemiseGlobale > 0 && (
                    <p className="text-xs text-right font-medium mt-0.5" style={{ color: 'var(--orange)' }}>
                      − {fmtEur(synth.montantRemiseGlobale)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Colonne 2 — Détail des totaux */}
            <div className="px-6" style={{ borderRight: '1px solid var(--brd-sub)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--txt-3)' }}>
                Détail
              </p>
              <div className="space-y-0.5">
                {hasGlobalAdj && (
                  <>
                    <SynthRow label="Sous-total" val={fmtEur(synth.sousTotal)} muted />
                    {synth.montantMargeGlobale !== 0 && (
                      <SynthRow label={`+ Mg+Fg ${globalAdj.marge_globale_pct}%`} val={fmtEur(synth.montantMargeGlobale)} colored="blue" />
                    )}
                    {synth.montantAssurance !== 0 && (
                      <SynthRow label={`+ Assurance ${globalAdj.assurance_pct}%`} val={fmtEur(synth.montantAssurance)} colored="purple" />
                    )}
                    {synth.totalCharges > 0 && (
                      <SynthRow label="+ Charges soc. pat." val={fmtEur(synth.totalCharges)} colored="red" />
                    )}
                    {synth.montantRemiseGlobale !== 0 && (
                      <SynthRow label="− Remise" val={`-${fmtEur(synth.montantRemiseGlobale)}`} colored="orange" />
                    )}
                    <div style={{ borderTop: '1px solid var(--brd-sub)', margin: '4px 0' }} />
                  </>
                )}
                <SynthRow label="Total HT" val={fmtEur(synth.totalHTFinal)} big />
                <div className="flex items-center justify-between text-xs py-0.5">
                  <span style={{ color: 'var(--txt-3)' }}>TVA</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={0} max={100} step={0.5}
                      value={devis?.tva_rate ?? 20}
                      onChange={e => onUpdateDevis?.('tva_rate', e.target.value)}
                      className="w-12 text-right text-xs rounded px-1.5 py-0.5 outline-none"
                      style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)', color: 'var(--txt-2)' }}
                    />
                    <span style={{ color: 'var(--txt-3)' }}>%</span>
                    <span className="text-right font-medium w-20" style={{ color: 'var(--txt-3)' }}>{fmtEur(synth.tva)}</span>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--brd)', margin: '4px 0' }} />
                <SynthRow label="TOTAL TTC" val={fmtEur(synth.totalTTC)} big highlight />
              </div>
            </div>

            {/* Colonne 3 — Échéancier + Notes */}
            <div className="pl-6">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--txt-3)' }}>
                Échéancier
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--txt-3)' }}>
                    <span>Acompte</span>
                    <input
                      type="number" min={0} max={100} step={5}
                      value={devis?.acompte_pct ?? 30}
                      onChange={e => onUpdateDevis?.('acompte_pct', e.target.value)}
                      className="w-12 text-right text-xs rounded px-1.5 py-0.5 outline-none"
                      style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)', color: 'var(--blue)' }}
                    />
                    <span>%</span>
                  </div>
                  <span className="text-xs font-semibold" style={{ color: 'var(--blue)' }}>
                    {fmtEur(synth.acompte)} TTC
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs" style={{ color: 'var(--txt-3)' }}>Solde</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--txt-2)' }}>
                    {fmtEur(synth.solde)} TTC
                  </span>
                </div>
              </div>
              {devis?.notes && (
                <div className="mt-3 p-2.5 rounded-lg" style={{ background: 'rgba(255,206,0,.1)', border: '1px solid rgba(255,206,0,.25)' }}>
                  <p className="text-[10px] font-medium mb-0.5" style={{ color: 'var(--amber)' }}>Notes</p>
                  <p className="text-xs" style={{ color: 'var(--txt-2)' }}>{devis.notes}</p>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ── Barre principale — clic entier pour toggle ─────────────────────── */}
      <div
        className="flex items-center justify-between px-6 cursor-pointer select-none"
        style={{
          height: '52px',
          borderTop: open ? '1px solid rgba(255,255,255,.06)' : 'none',
        }}
        onClick={() => setOpen(p => !p)}
      >
        {/* Gauche — métriques principales */}
        <div className="flex items-center gap-8">
          <BarMetric label="Total HT" value={fmtEur(synth.totalHTFinal)} prominent />
          <BarMetric label="Total TTC" value={fmtEur(synth.totalTTC)} muted />
          <BarMetric label="Marge" value={fmtPct(synth.pctMargeFinale)} subvalue={fmtEur(synth.margeFinale)} color={margeColor} />
        </div>

        {/* Droite — KPIs secondaires + bouton */}
        <div className="flex items-center gap-6">
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,.08)' }} />
          <BarMetric label="Coût réel HT" value={fmtEur(synth.totalCoutReel)} muted />
          {synth.totalCharges > 0 && (
            <BarMetric label="Charges soc." value={fmtEur(synth.totalCharges)} color="var(--red)" muted />
          )}
          {synth.totalInterne > 0 && (
            <BarMetric label="Part interne" value={fmtPct(synth.pctInterne)} subvalue={fmtEur(synth.totalInterne)} color="var(--purple)" muted />
          )}
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,.08)' }} />
          <div className="flex items-center gap-1.5" style={{ color: 'var(--txt-3)' }}>
            <span className="text-[10px] font-semibold uppercase tracking-widest">Synthèse</span>
            {open
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronUp className="w-3.5 h-3.5" />
            }
          </div>
        </div>
      </div>

      </div>{/* fin bulle */}
    </>
  )
}

// Métrique dans la barre de synthèse
function BarMetric({ label, value, subvalue, prominent = false, muted = false, color }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--txt-3)' }}>
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span
          className="tabular-nums font-bold"
          style={{
            fontSize: prominent ? '15px' : muted ? '12px' : '13px',
            color: color || (prominent ? 'var(--txt)' : muted ? 'var(--txt-3)' : 'var(--txt-2)'),
          }}
        >
          {value}
        </span>
        {subvalue && (
          <span className="tabular-nums" style={{ fontSize: '10px', color: color || 'var(--txt-3)', opacity: 0.7 }}>
            {subvalue}
          </span>
        )}
      </span>
    </div>
  )
}

function KpiCard({ icon, label, value, sub, color }) {
  const bgMap = {
    blue:   'rgba(77,159,255,.1)',
    green:  'rgba(0,200,117,.1)',
    red:    'rgba(255,71,87,.1)',
    amber:  'rgba(255,206,0,.1)',
    purple: 'rgba(156,95,253,.1)',
  }
  const brdMap = {
    blue:   'rgba(77,159,255,.25)',
    green:  'rgba(0,200,117,.25)',
    red:    'rgba(255,71,87,.25)',
    amber:  'rgba(255,206,0,.25)',
    purple: 'rgba(156,95,253,.25)',
  }
  return (
    <div className="rounded-lg border p-2" style={{ background: bgMap[color] || bgMap.blue, borderColor: brdMap[color] || brdMap.blue }}>
      <div className="flex items-center gap-1 mb-0.5">
        {icon}
        <span className="text-[10px] font-medium" style={{ color: 'var(--txt-3)' }}>{label}</span>
      </div>
      <p className="text-xs font-bold truncate" style={{ color: 'var(--txt)' }}>{value}</p>
      {sub && <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>{sub}</p>}
    </div>
  )
}

function AdjRow({ icon, label, value, onChange, suffix, computed }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 flex-1 min-w-0">
        {icon}
        <span className="text-xs truncate" style={{ color: 'var(--txt-2)' }}>{label}</span>
      </div>
      <div className="relative w-16 shrink-0">
        <input
          type="number"
          className="input text-xs text-right pr-4 py-1 h-7 w-full"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          min={0} max={100} step={0.5}
          placeholder="0"
        />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: 'var(--txt-3)' }}>{suffix}</span>
      </div>
      {value > 0 && (
        <span className="text-xs w-20 text-right shrink-0" style={{ color: 'var(--txt-3)' }}>{computed}</span>
      )}
    </div>
  )
}

function SynthRow({ label, val, big, highlight, muted, colored }) {
  const colorMap = {
    blue: 'var(--blue)',
    purple: 'var(--purple)',
    orange: 'var(--orange)',
    green: 'var(--green)',
  }
  return (
    <div
      className="flex items-center justify-between px-2 py-1 rounded"
      style={highlight ? { background: 'rgba(255,255,255,.08)', border: '1px solid var(--brd)' } : {}}
    >
      <span className="text-xs" style={{ color: muted ? 'var(--txt-3)' : highlight ? 'var(--txt-2)' : 'var(--txt-2)', fontWeight: highlight ? 500 : 400 }}>{label}</span>
      <span
        style={{
          fontSize: big ? '0.875rem' : '0.75rem',
          fontWeight: big ? 700 : 500,
          color: highlight ? 'var(--txt)' : muted ? 'var(--txt-3)' : colored ? colorMap[colored] : 'var(--txt)',
        }}
      >
        {val}
      </span>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    brouillon: 'badge-gray', envoye: 'badge-blue',
    accepte: 'badge-green',  refuse: 'badge-red',
  }
  const labels = { brouillon:'Brouillon', envoye:'Envoyé', accepte:'Accepté', refuse:'Refusé' }
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{labels[status] || status}</span>
}

const STATUS_OPTIONS = [
  { key: 'brouillon', label: 'Brouillon', badgeClass: 'badge-gray'  },
  { key: 'envoye',    label: 'Envoyé',    badgeClass: 'badge-blue'  },
  { key: 'accepte',   label: 'Accepté',   badgeClass: 'badge-green' },
  { key: 'refuse',    label: 'Refusé',    badgeClass: 'badge-red'   },
]

function StatusSelect({ status, onChange }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const portalRef  = useRef(null)
  const current = STATUS_OPTIONS.find(o => o.key === status) || STATUS_OPTIONS[0]

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        portalRef.current  && !portalRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const rect = triggerRef.current?.getBoundingClientRect()

  return (
    <div ref={triggerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(p => !p)}
        className={`badge ${current.badgeClass}`}
        style={{ cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      >
        {current.label}
        <ChevronDown className="w-2.5 h-2.5" style={{ opacity: 0.6 }} />
      </button>

      {open && createPortal(
        <div
          ref={portalRef}
          style={{
            position: 'fixed',
            top:  rect ? rect.bottom + 6 : 0,
            left: rect ? rect.left       : 0,
            zIndex: 9999,
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            borderRadius: '8px',
            padding: '4px',
            boxShadow: '0 8px 32px rgba(0,0,0,.6)',
            minWidth: '130px',
          }}
        >
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => { onChange(opt.key); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                width: '100%', padding: '6px 8px', borderRadius: '5px',
                background: opt.key === status ? 'rgba(255,255,255,.06)' : 'transparent',
                cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.08)'}
              onMouseLeave={e => e.currentTarget.style.background = opt.key === status ? 'rgba(255,255,255,.06)' : 'transparent'}
            >
              <span className={`badge ${opt.badgeClass}`} style={{ pointerEvents: 'none' }}>{opt.label}</span>
              {opt.key === status && <Check className="w-3 h-3 ml-auto" style={{ color: 'var(--txt-3)' }} />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ─── Modale régime-first pour l'ajout d'une ligne ────────────────────────────
const REGIMES_LIST = [
  { key: 'Intermittent Technicien', label: 'Intermittent Technicien', color: 'var(--purple)', bg: 'rgba(156,95,253,.12)', desc: 'CDDU — Grille CCPA' },
  { key: 'Intermittent Artiste',    label: 'Intermittent Artiste',    color: 'var(--purple)', bg: 'rgba(156,95,253,.12)', desc: 'CDDU — Grille CCPA' },
  { key: 'Ext. Intermittent',       label: 'Ext. Intermittent',       color: 'var(--violet, #7c3aed)', bg: 'rgba(124,58,237,.10)', desc: 'Vendu en Externe · Recruté en intermittent · Coût = salaire brut' },
  { key: 'Externe',                 label: 'Externe',                 color: 'var(--blue)',   bg: 'rgba(0,122,255,.10)', desc: 'Prestataire externe' },
  { key: 'Interne',                 label: 'Interne',                 color: 'var(--green)',  bg: 'rgba(0,200,117,.10)', desc: 'Ressource interne' },
  { key: 'Technique',               label: 'Technique',               color: 'var(--amber)',  bg: 'rgba(255,174,0,.10)', desc: 'Matériel / équipement' },
  { key: 'Frais',                   label: 'Frais',                   color: 'var(--txt-2)',  bg: 'var(--bg-elev)',      desc: 'Frais divers' },
]

const TYPES_OEUVRE = [
  { key: 'Fiction',           label: 'Fiction' },
  { key: 'Flux',              label: 'Flux / Plateau' },
  { key: 'Hors_fiction_flux', label: 'Documentaire / Autres' },
]

const UNITES_MINIMAS = [
  { key: 'semaine_35h', label: 'Semaine 35h' },
  { key: 'semaine_39h', label: 'Semaine 39h' },
  { key: 'jour_7h',     label: 'Jour 7h' },
  { key: 'jour_8h',     label: 'Jour 8h' },
]

function AddLineModal({ catId, defaultRegime, prefilledPoste = null, prefilledIsSpec = false, prefilledProduit = null, onConfirm, onClose }) {
  const [step, setStep]              = useState(prefilledPoste ? 'intermittent' : prefilledProduit ? 'other' : 'regime')
  const [regime, setRegime]          = useState(defaultRegime)
  // Intermittents
  const [typeOeuvre, setTypeOeuvre]  = useState('Fiction')
  const [postes, setPostes]          = useState([])          // liste depuis minimas_convention
  const [posteFilter, setPosteFilter]= useState('')
  const [selectedPoste, setSelectedPoste] = useState(prefilledPoste)
  const [isSpec, setIsSpec]          = useState(prefilledIsSpec)
  const [unite, setUnite]            = useState('jour_7h')
  const [montantBrut, setMontantBrut]= useState(null)
  const [loadingPostes, setLoadingPostes] = useState(false)
  // Ligne libre (autres régimes)
  const [produit, setProduit]        = useState(prefilledProduit || '')
  const [description, setDescription]= useState('')
  const [qteSaisie, setQteSaisie]    = useState(1)
  const [uniteSaisie, setUniteSaisie]= useState('J')
  const [tarifSaisie, setTarifSaisie]= useState(0)

  const isIntermittent = regime === 'Intermittent Technicien' || regime === 'Intermittent Artiste'

  // Charge les postes depuis Supabase quand type_oeuvre change (intermittents)
  useEffect(() => {
    if (!isIntermittent || step !== 'intermittent') return
    setLoadingPostes(true)
    // Ne réinitialise PAS le poste si pré-sélectionné depuis la barre de recherche inline
    if (!prefilledPoste) setSelectedPoste(null)
    setMontantBrut(null)
    supabase
      .from('minimas_convention')
      .select('poste, is_specialise')
      .eq('type_oeuvre', typeOeuvre)
      .eq('unite', 'jour_7h')
      .order('poste')
      .then(({ data }) => {
        // Dédoublonne les postes (garde spécialisé + non-spécialisé comme variantes)
        const unique = []
        const seen = new Set()
        for (const r of (data || [])) {
          const k = `${r.poste}__${r.is_specialise}`
          if (!seen.has(k)) { seen.add(k); unique.push(r) }
        }
        setPostes(unique)
        setLoadingPostes(false)
      })
  }, [typeOeuvre, step, isIntermittent])

  // Charge le montant brut quand poste + unité changent
  useEffect(() => {
    if (!selectedPoste || !isIntermittent) return
    supabase
      .from('minimas_convention')
      .select('montant_brut')
      .eq('type_oeuvre', typeOeuvre)
      .eq('poste', selectedPoste)
      .eq('is_specialise', isSpec)
      .eq('unite', unite)
      .single()
      .then(({ data }) => setMontantBrut(data ? Number(data.montant_brut) : null))
  }, [selectedPoste, isSpec, unite, typeOeuvre, isIntermittent])

  function handleRegimeSelect(r) {
    setRegime(r)
    if (r === 'Intermittent Technicien' || r === 'Intermittent Artiste') {
      setStep('intermittent')
    } else {
      setStep('other')
    }
  }

  function handleConfirmIntermittent() {
    if (!selectedPoste || !montantBrut) return
    // Unité → format court pour le champ unite de la ligne
    const uniteMap = { semaine_35h: 'S', semaine_39h: 'S', jour_7h: 'J', jour_8h: 'J' }
    onConfirm({
      produit:     selectedPoste + (isSpec ? ' (spécialisé)' : ''),
      description: `${TYPES_OEUVRE.find(t=>t.key===typeOeuvre)?.label} — ${UNITES_MINIMAS.find(u=>u.key===unite)?.label}`,
      regime,
      quantite:    1,
      unite:       uniteMap[unite] || 'J',
      tarif_ht:    montantBrut,
      cout_ht:     null,
    })
  }

  function handleConfirmOther() {
    if (!produit) return
    onConfirm({
      produit,
      description,
      regime,
      quantite:  qteSaisie,
      unite:     uniteSaisie,
      tarif_ht:  tarifSaisie,
      cout_ht:   0,
    })
  }

  const filteredPostes = postes.filter(p =>
    !posteFilter || p.poste.toLowerCase().includes(posteFilter.toLowerCase())
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: step === 'intermittent' ? 560 : 420,
          maxHeight: '85vh',
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          boxShadow: '0 24px 80px rgba(0,0,0,.8)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--brd-sub)' }}>
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--txt)' }}>Ajouter une ligne</h3>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {step === 'regime' ? 'Choisissez le régime de la prestation'
               : step === 'intermittent' ? `${regime} — Grille conventionnelle CCPA`
               : `${regime} — Saisie libre`}
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--txt-3)' }}
            className="hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">

          {/* ── Étape 1 : Choix du régime ── */}
          {step === 'regime' && (
            <div className="grid grid-cols-2 gap-2">
              {REGIMES_LIST.map(r => (
                <button
                  key={r.key}
                  onClick={() => handleRegimeSelect(r.key)}
                  className="text-left px-4 py-3 rounded-xl transition-all"
                  style={{
                    background: regime === r.key ? r.bg : 'var(--bg-elev)',
                    border: `1px solid ${regime === r.key ? r.color : 'var(--brd-sub)'}`,
                  }}
                >
                  <p className="text-xs font-bold" style={{ color: r.color }}>{r.label}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>{r.desc}</p>
                </button>
              ))}
            </div>
          )}

          {/* ── Étape 2a : Intermittent — grille CCPA ── */}
          {step === 'intermittent' && (
            <div className="space-y-4">
              {/* Poste pré-sélectionné depuis la recherche */}
              {prefilledPoste && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(156,95,253,.1)', border: '1px solid rgba(156,95,253,.25)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--purple)' }}>Poste</span>
                  <span className="text-xs font-semibold flex-1" style={{ color: 'var(--txt)' }}>{selectedPoste}</span>
                  {isSpec && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(156,95,253,.15)', color: 'var(--purple)' }}>spécialisé</span>}
                </div>
              )}
              {/* Type d'œuvre */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--txt-3)' }}>
                  Type d'œuvre
                </label>
                <div className="flex gap-2">
                  {TYPES_OEUVRE.map(t => (
                    <button key={t.key} onClick={() => setTypeOeuvre(t.key)}
                      className="flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all"
                      style={{
                        background: typeOeuvre === t.key ? 'rgba(156,95,253,.15)' : 'var(--bg-elev)',
                        border: `1px solid ${typeOeuvre === t.key ? 'rgba(156,95,253,.4)' : 'var(--brd-sub)'}`,
                        color: typeOeuvre === t.key ? 'var(--purple)' : 'var(--txt-2)',
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recherche poste — masquée si poste pré-sélectionné depuis la recherche inline */}
              {!prefilledPoste && <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--txt-3)' }}>
                  Poste ({filteredPostes.length})
                </label>
                <input
                  className="input w-full text-xs mb-2"
                  placeholder="Rechercher un poste…"
                  value={posteFilter}
                  onChange={e => setPosteFilter(e.target.value)}
                  autoFocus
                />
                <div className="overflow-y-auto rounded-xl" style={{ maxHeight: 220, border: '1px solid var(--brd-sub)' }}>
                  {loadingPostes ? (
                    <div className="p-4 text-center text-xs" style={{ color: 'var(--txt-3)' }}>Chargement…</div>
                  ) : filteredPostes.length === 0 ? (
                    <div className="p-4 text-center text-xs" style={{ color: 'var(--txt-3)' }}>Aucun résultat</div>
                  ) : filteredPostes.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => { setSelectedPoste(p.poste); setIsSpec(p.is_specialise) }}
                      className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors"
                      style={{
                        background: selectedPoste === p.poste && isSpec === p.is_specialise ? 'rgba(156,95,253,.1)' : 'transparent',
                        borderBottom: i < filteredPostes.length-1 ? '1px solid var(--brd-sub)' : 'none',
                        color: selectedPoste === p.poste && isSpec === p.is_specialise ? 'var(--purple)' : 'var(--txt)',
                      }}
                    >
                      <span className="text-xs flex-1">{p.poste}</span>
                      {p.is_specialise && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(156,95,253,.12)', color: 'var(--purple)' }}>
                          spécialisé
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>}

              {/* Unité + montant */}
              {selectedPoste && (
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--txt-3)' }}>Unité</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {UNITES_MINIMAS.map(u => (
                        <button key={u.key} onClick={() => setUnite(u.key)}
                          className="py-1.5 px-2 rounded-lg text-xs font-medium transition-all"
                          style={{
                            background: unite === u.key ? 'rgba(156,95,253,.15)' : 'var(--bg-elev)',
                            border: `1px solid ${unite === u.key ? 'rgba(156,95,253,.4)' : 'var(--brd-sub)'}`,
                            color: unite === u.key ? 'var(--purple)' : 'var(--txt-3)',
                          }}>
                          {u.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {montantBrut != null && (
                    <div className="text-right shrink-0">
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--txt-3)' }}>Minima brut</p>
                      <p className="text-xl font-bold" style={{ color: 'var(--purple)' }}>
                        {montantBrut.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>tarif pré-rempli</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Étape 2b : Autres régimes — saisie libre ── */}
          {step === 'other' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--txt-3)' }}>Poste / Intitulé *</label>
                <input
                  className="input w-full text-sm"
                  placeholder="Ex : Location caméra, Transport…"
                  value={produit}
                  onChange={e => setProduit(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--txt-3)' }}>Description</label>
                <input
                  className="input w-full text-sm"
                  placeholder="Optionnel…"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--txt-3)' }}>Quantité</label>
                  <input type="number" className="input w-full text-right" min={0} step={0.5}
                    value={qteSaisie} onChange={e => setQteSaisie(parseFloat(e.target.value)||1)} />
                </div>
                <div className="w-24">
                  <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--txt-3)' }}>Unité</label>
                  <select className="input w-full text-sm" value={uniteSaisie} onChange={e => setUniteSaisie(e.target.value)}>
                    {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--txt-3)' }}>Tarif HT</label>
                  <input type="number" className="input w-full text-right" min={0} step={1}
                    value={tarifSaisie} onChange={e => setTarifSaisie(parseFloat(e.target.value)||0)} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer — boutons */}
        {step !== 'regime' && (
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderTop: '1px solid var(--brd-sub)' }}>
            <button onClick={() => setStep('regime')} className="btn-ghost btn-sm text-xs" style={{ color: 'var(--txt-3)' }}>
              ← Changer de régime
            </button>
            <button
              onClick={step === 'intermittent' ? handleConfirmIntermittent : handleConfirmOther}
              disabled={step === 'intermittent' ? !selectedPoste || !montantBrut : !produit}
              className="btn-primary btn-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter la ligne
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Barre de recherche inline par bloc ───────────────────────────────────────
// Le dropdown est rendu via un Portal dans document.body (position: fixed)
// pour échapper au overflow:auto du conteneur parent de la table.
function BlocSearchBar({ bdd, defaultRegime, accentColor, onAddDirect, onOpenIntermittent, onAddFreeForm }) {
  const [query, setQuery]             = useState('')
  const [open, setOpen]               = useState(false)
  const [minimasList, setMinimasList] = useState([])
  const [dropdownPos, setDropdownPos] = useState(null)
  const wrapperRef                    = useRef(null)
  const dropdownRef                   = useRef(null)

  // Résultats catalogue (filtre local, instantané)
  const catalogueResults = query.length >= 2
    ? bdd.filter(p =>
        p.produit?.toLowerCase().includes(query.toLowerCase()) ||
        p.description?.toLowerCase().includes(query.toLowerCase()) ||
        p.categorie?.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : []

  // Résultats minimas_convention (async, dédupliqués par poste)
  useEffect(() => {
    if (query.length < 2) { setMinimasList([]); return }
    let cancelled = false
    supabase
      .from('minimas_convention')
      .select('poste, filiere, is_specialise')
      .ilike('poste', `%${query}%`)
      .eq('unite', 'jour_7h')
      .order('poste')
      .limit(30)
      .then(({ data }) => {
        if (cancelled) return
        const seen = new Set()
        const unique = []
        for (const r of (data || [])) {
          const k = r.poste + (r.is_specialise ? '_spec' : '')
          if (!seen.has(k)) { seen.add(k); unique.push(r) }
        }
        setMinimasList(unique.slice(0, 8))
      })
    return () => { cancelled = true }
  }, [query])

  // Calcule la position du dropdown depuis le wrapper
  function calcPos() {
    if (wrapperRef.current) {
      const r = wrapperRef.current.getBoundingClientRect()
      setDropdownPos({ left: r.left, width: r.width, top: r.top })
    }
  }

  // Fermeture au clic extérieur (wrapper + portal dropdown)
  useEffect(() => {
    const handler = e => {
      if (!wrapperRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fermeture au scroll (le dropdown fixe ne suit pas le scroll de la table)
  useEffect(() => {
    if (!open) return
    const handler = () => setOpen(false)
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [open])

  function handleOpen() { calcPos(); setOpen(true) }

  function handleCatalogueSelect(p) {
    setQuery(''); setOpen(false)
    onAddDirect({
      produit:     p.produit,
      description: p.description || '',
      regime:      normalizeRegime(p.regime) || defaultRegime,
      unite:       p.unite || 'F',
      tarif_ht:    Number(p.tarif_defaut) || 0,
      cout_ht:     0,
      quantite:    1,
    })
  }

  function handleIntermittentSelect(item) {
    setQuery(''); setOpen(false)
    onOpenIntermittent(item)
  }

  function handleFreeForm() {
    const q = query
    setQuery(''); setOpen(false)
    onAddFreeForm(q || null)
  }

  const hasResults = catalogueResults.length > 0 || minimasList.length > 0

  // Dropdown rendu dans document.body via Portal
  const dropdown = open && (hasResults || query.length >= 1) && dropdownPos
    ? createPortal(
        <div
          ref={dropdownRef}
          style={{
            position:    'fixed',
            left:        dropdownPos.left,
            width:       dropdownPos.width,
            bottom:      window.innerHeight - dropdownPos.top + 4,
            zIndex:      9999,
            maxHeight:   '400px',
            overflowY:   'auto',
            overflowX:   'hidden',
            background:  'var(--bg-surf)',
            border:      '1px solid var(--brd)',
            borderRadius:'12px',
            boxShadow:   '0 12px 40px rgba(0,0,0,.75)',
          }}
        >
          {/* Section Convention collective CCPA */}
          {minimasList.length > 0 && (
            <>
              <div className="px-3 py-1 flex items-center gap-1.5 sticky top-0"
                style={{ background: 'var(--bg)', borderBottom: '1px solid var(--brd-sub)', zIndex: 1 }}>
                <Users className="w-3 h-3" style={{ color: 'var(--purple)' }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--purple)' }}>
                  Convention collective CCPA
                </span>
              </div>
              {minimasList.map((p, i) => (
                <button key={`${p.poste}_${p.is_specialise}`}
                  onMouseDown={e => { e.preventDefault(); handleIntermittentSelect(p) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-elev)]"
                  style={{ borderBottom: i < minimasList.length - 1 ? '1px solid var(--brd-sub)' : 'none' }}
                >
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
                    style={{ background: 'rgba(156,95,253,.12)', color: 'var(--purple)' }}>CC</span>
                  <span className="text-xs flex-1 truncate" style={{ color: 'var(--txt)' }}>{p.poste}</span>
                  {p.is_specialise && (
                    <span className="text-[10px] px-1 py-0.5 rounded shrink-0"
                      style={{ background: 'rgba(156,95,253,.08)', color: 'var(--purple)' }}>spécialisé</span>
                  )}
                  {p.filiere && (
                    <span className="text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>{p.filiere}</span>
                  )}
                </button>
              ))}
            </>
          )}

          {/* Section Catalogue */}
          {catalogueResults.length > 0 && (
            <>
              <div className="px-3 py-1 flex items-center gap-1.5 sticky top-0"
                style={{ background: 'var(--bg)', borderBottom: '1px solid var(--brd-sub)', zIndex: 1 }}>
                <Database className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                  Catalogue
                </span>
              </div>
              {catalogueResults.map(p => (
                <button key={p.id}
                  onMouseDown={e => { e.preventDefault(); handleCatalogueSelect(p) }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-elev)]"
                  style={{ borderBottom: '1px solid var(--brd-sub)' }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--txt)' }}>{p.produit}</p>
                    {(p.description || p.categorie) && (
                      <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
                        {[p.categorie, p.description].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  {p.tarif_defaut && (
                    <span className="text-xs font-semibold ml-2 shrink-0" style={{ color: 'var(--blue)' }}>
                      {Number(p.tarif_defaut).toLocaleString('fr-FR')} €/{p.unite || 'F'}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}

          {/* Ligne libre — toujours disponible, collée en bas */}
          <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg-surf)' }}>
            <button
              onMouseDown={e => { e.preventDefault(); handleFreeForm() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elev)]"
              style={{ borderTop: hasResults ? '1px solid var(--brd)' : 'none' }}
            >
              <Plus className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
              <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
                {query ? `Ajouter "${query}" comme ligne libre…` : 'Ligne libre…'}
              </span>
            </button>
          </div>
        </div>,
        document.body
      )
    : null

  const [dormant, setDormant] = useState(true)
  const inputRef = useRef(null)

  function activate() {
    setDormant(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleBlur() {
    if (!query) {
      setOpen(false)
      setDormant(true)
    }
  }

  if (dormant) {
    return (
      <div ref={wrapperRef} className="px-3 py-1">
        <button
          onClick={activate}
          className="flex items-center gap-1.5 text-xs transition-all rounded px-2 py-0.5"
          style={{ color: 'var(--txt-3)', opacity: 0.5 }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = accentColor }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--txt-3)' }}
        >
          <Plus className="w-3 h-3" />
          <span>Ajouter une ligne</span>
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="px-3 py-1">
      <div className="flex items-center gap-2 rounded-lg px-2.5 py-1" style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${accentColor}30` }}>
        <Search className="w-3 h-3 shrink-0" style={{ color: accentColor, opacity: 0.6 }} />
        <input
          ref={inputRef}
          className="flex-1 text-xs bg-transparent outline-none"
          style={{ color: 'var(--txt-2)', caretColor: accentColor }}
          placeholder="Rechercher un poste… ou Entrée pour ligne libre"
          value={query}
          onChange={e => { setQuery(e.target.value); calcPos(); setOpen(true) }}
          onFocus={handleOpen}
          onBlur={handleBlur}
          onKeyDown={e => {
            if (e.key === 'Escape') { setOpen(false); setQuery(''); setDormant(true) }
            if (e.key === 'Enter' && !hasResults) handleFreeForm()
          }}
        />
        {query && (
          <button onMouseDown={e => { e.preventDefault(); setQuery(''); setOpen(false) }}
            style={{ color: 'var(--txt-3)' }}>
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {dropdown}
    </div>
  )
}
