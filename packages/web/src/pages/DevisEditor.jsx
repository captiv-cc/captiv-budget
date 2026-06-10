import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { notify } from '../lib/notify'
import { confirm } from '../lib/confirm'
import { calcSynthese, REGIMES_SALARIES, CATS_HUMAINS, TAUX_DEFAUT } from '../lib/cotisations'
import { applyCategoryDansMarge } from '../lib/devisLines'
import { exportDevisPDF } from '../lib/pdfExport'
import { BLOCS_CANONIQUES, getBlocInfo as _getBlocInfoByName } from '../lib/blocs'
import { normalizeRegime, EMPTY_LINE, EMPTY_GLOBAL } from '../features/devis/constants'
import StatusSelect from '../features/devis/components/StatusSelect'
import SynthBar from '../features/devis/components/SynthBar'
import AddLineModal from '../features/devis/components/AddLineModal'
import CategoryBlock from '../features/devis/components/CategoryBlock'
import PdfPreviewModal from '../features/materiel/components/PdfPreviewModal'
import {
  Copy,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Save,
  Eye,
  RefreshCw,
  Check,
  Percent,
  BarChart3,
  X,
  Pencil,
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
  const withInfo = categories.map((cat) => ({ cat, info: getBlocInfo(cat) }))
  withInfo.sort(
    (a, b) => a.info.canonicalIdx - b.info.canonicalIdx || a.cat.sort_order - b.cat.sort_order,
  )
  let num = 1
  return withInfo.map(({ cat, info }) => ({ cat, info, num: info.isCanonical ? num++ : null }))
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function DevisEditor({ embedded = false }) {
  const { id: projectId, devisId } = useParams()
  const navigate = useNavigate()
  const { org } = useAuth()

  const [devis, setDevis] = useState(null)
  const [project, setProject] = useState(null)
  const [client, setClient] = useState(null)
  const [categories, setCategories] = useState([])
  const [collapsed, setCollapsed] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [taux, setTaux] = useState(TAUX_DEFAUT)
  const [bdd, setBdd] = useState([])
  const [globalAdj, setGlobalAdj] = useState(EMPTY_GLOBAL)
  const [saveError, setSaveError] = useState(null)
  // Modale ajout de ligne
  const [addLineModal, setAddLineModal] = useState(null) // { catId, defaultRegime } | null
  const [showAnalyse, setShowAnalyse] = useState(false) // toggle colonnes analyse
  const [showRemise, setShowRemise] = useState(false) // toggle colonne remise
  const [editingTitle, setEditingTitle] = useState(false) // toggle édition titre devis
  // Prévisualisation PDF : { url, filename, revoke } | null
  // Quand non-null, la modale <PdfPreviewModal /> s'ouvre et affiche le PDF
  // en <iframe>. L'utilisateur peut télécharger depuis la modale ou la fermer.
  const [pdfPreview, setPdfPreview] = useState(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const isSaving = useRef(false) // garde contre saves concurrentes
  const pendingSave = useRef(null) // dernier save en attente
  const insertingTempIds = useRef(new Set()) // évite double-INSERT
  const hasChanges = useRef(false) // true seulement après modif utilisateur

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      // Devis + categories + lines
      const { data: dv } = await supabase.from('devis').select('*').eq('id', devisId).single()
      setDevis(dv)
      setGlobalAdj({
        marge_globale_pct: Number(dv?.marge_globale_pct) || 0,
        assurance_pct: Number(dv?.assurance_pct) || 0,
        remise_globale_pct: Number(dv?.remise_globale_pct) || 0,
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

      const catsWithLines = (cats || []).map((cat) => ({
        ...cat,
        lines: (lines || [])
          .filter((l) => l.category_id === cat.id)
          .map((l) => ({ ...l, regime: normalizeRegime(l.regime) })),
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
      const { data: bddData } = await supabase.from('produits_bdd').select('*').order('categorie')
      setBdd(bddData || [])

      // Taux cotisations
      if (org?.id) {
        const { data: confData } = await supabase
          .from('cotisation_config')
          .select('*')
          .eq('org_id', org.id)
        if (confData?.length) {
          const t = { ...TAUX_DEFAUT }
          confData.forEach((c) => {
            t[c.key] = Number(c.value)
          })
          setTaux(t)
        }
      }
    } finally {
      hasChanges.current = false // reset : pas de save auto juste après le chargement
      setLoading(false)
    }
  }, [devisId, projectId, org?.id])

  // ── Chargement initial ────────────────────────────────────────────────────
  useEffect(() => {
    loadAll()
  }, [devisId, loadAll])

  // Nettoyage du Blob URL de preview PDF au démontage — évite les fuites
  // mémoire si l'utilisateur ferme l'onglet / change de devis sans fermer
  // la modale manuellement.
  useEffect(() => {
    return () => {
      if (pdfPreview?.revoke) {
        try {
          pdfPreview.revoke()
        } catch {
          /* no-op */
        }
      }
    }
  }, [pdfPreview])

  // ── Auto-save : useEffect avec dépendances ────────────────────────────────
  // Ne se déclenche QUE si l'utilisateur a fait une modification (hasChanges)
  useEffect(() => {
    if (!devis || loading || !hasChanges.current) return
    const snapCats = categories
    const snapAdj = globalAdj
    const snapDv = devis
    const timer = setTimeout(() => doSave(snapCats, snapDv, snapAdj), 1500)
    return () => clearTimeout(timer)
  }, [categories, globalAdj, devis?.title, devis?.status]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const errors = []

    try {
      for (const cat of cats) {
        for (const line of cat.lines) {
          const payload = {
            devis_id: devisId,
            category_id: cat.id,
            ref: line.ref,
            produit: line.produit,
            description: line.description,
            regime: line.regime,
            use_line: line.use_line,
            dans_marge: true, // géré au niveau catégorie
            nb: line.nb ?? 1,
            quantite: line.quantite,
            unite: line.unite,
            tarif_ht: line.tarif_ht,
            cout_ht: line.cout_ht ?? null,
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
              .from('devis_lines')
              .insert(payload)
              .select()
              .single()
            insertingTempIds.current.delete(line._tempId)
            if (error) {
              console.error('[doSave] INSERT ligne failed:', error, 'payload:', payload)
              errors.push(`INSERT: ${error.message}`)
            } else if (newLine) {
              setCategories((prev) =>
                prev.map((c) =>
                  c.id === cat.id
                    ? {
                        ...c,
                        lines: c.lines.map((l) =>
                          l._tempId === line._tempId ? { ...newLine } : l,
                        ),
                      }
                    : c,
                ),
              )
            }
          }
        }
      }

      const { error: devisErr } = await supabase
        .from('devis')
        .update({
          updated_at: new Date().toISOString(),
          status: dv.status,
          title: dv.title ?? null,
          marge_globale_pct: adj.marge_globale_pct,
          assurance_pct: adj.assurance_pct,
          remise_globale_pct: adj.remise_globale_pct,
          remise_globale_montant: adj.remise_globale_montant,
          tva_rate: dv.tva_rate != null ? Number(dv.tva_rate) : 20,
          acompte_pct: dv.acompte_pct != null ? Number(dv.acompte_pct) : 30,
        })
        .eq('id', devisId)
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
    hasChanges.current = true // force save même si hasChanges pas encore levé
    doSave(categories, devis, globalAdj)
  }

  // ── Mise à jour ajustements globaux ──────────────────────────────────────
  function updateGlobalAdj(field, value) {
    const num = parseFloat(value) || 0
    hasChanges.current = true
    setGlobalAdj((p) => ({ ...p, [field]: num }))
  }

  // Mise à jour d'un champ direct du devis (tva_rate, acompte_pct…)
  function updateDevisField(field, value) {
    hasChanges.current = true
    setDevis((p) => ({ ...p, [field]: value }))
  }

  // ── Gestion catégories ────────────────────────────────────────────────────
  async function addCategory(name) {
    const { data: cat } = await supabase
      .from('devis_categories')
      .insert({
        devis_id: devisId,
        name: name || 'NOUVELLE CATÉGORIE',
        sort_order: categories.length,
        dans_marge: true,
      })
      .select()
      .single()
    if (cat) setCategories((prev) => [...prev, { ...cat, lines: [] }])
  }

  // Ajoute un bloc canonique (revient à sa place d'origine dans l'ordre)
  async function addBlocCanonique(bloc) {
    const canonicalIdx = BLOCS_CANONIQUES.findIndex((b) => b.key === bloc.key)
    const { data: cat } = await supabase
      .from('devis_categories')
      .insert({
        devis_id: devisId,
        name: bloc.key,
        sort_order: canonicalIdx * 10,
        dans_marge: true,
      })
      .select()
      .single()
    if (cat) setCategories((prev) => [...prev, { ...cat, lines: [] }])
  }

  async function renameCategory(catId, name) {
    await supabase.from('devis_categories').update({ name }).eq('id', catId)
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, name } : c)))
  }

  async function updateCategoryDansMarge(catId, val) {
    await supabase.from('devis_categories').update({ dans_marge: val }).eq('id', catId)
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, dans_marge: val } : c)))
  }

  async function updateCategoryNotes(catId, notes) {
    await supabase.from('devis_categories').update({ notes }).eq('id', catId)
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, notes } : c)))
  }

  // ── Prévisualisation PDF ──────────────────────────────────────────────────
  // Génère le PDF en mémoire et ouvre la modale <PdfPreviewModal />. Depuis
  // la modale, l'utilisateur peut télécharger ou fermer. À la fermeture on
  // révoque le Blob URL (cf. closePdfPreview).
  async function openPdfPreview() {
    if (pdfLoading) return
    setPdfLoading(true)
    try {
      const handle = await exportDevisPDF(
        { ...devis, categories, globalAdj },
        project,
        client,
        org,
        taux,
      )
      // Si une préview était déjà ouverte (double-clic, etc.), on révoque.
      if (pdfPreview?.revoke) {
        try {
          pdfPreview.revoke()
        } catch {
          /* no-op */
        }
      }
      setPdfPreview(handle)
    } catch (err) {
      console.error('[DevisEditor] PDF export:', err)
      notify.error('Erreur export PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  function closePdfPreview() {
    if (pdfPreview?.revoke) {
      try {
        pdfPreview.revoke()
      } catch {
        /* no-op */
      }
    }
    setPdfPreview(null)
  }

  async function deleteCategory(catId) {
    const ok = await confirm({
      title: 'Supprimer le bloc',
      message: 'Cette catégorie et toutes ses lignes seront supprimées définitivement.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    await supabase.from('devis_lines').delete().eq('category_id', catId)
    await supabase.from('devis_categories').delete().eq('id', catId)
    setCategories((prev) => prev.filter((c) => c.id !== catId))
  }

  // ── Gestion lignes ────────────────────────────────────────────────────────
  // Ouvre la modale régime-first (avec pré-remplissage optionnel)
  function addLine(catId, defaultRegime = null, prefilledProduit = null) {
    setCategories((prev) => {
      const cat = prev.find((c) => c.id === catId)
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
    setCategories((prev) =>
      prev.map((c) => {
        if (c.id !== catId) return c
        const idx = c.lines.findIndex((l) => (lineId ? l.id === lineId : l._tempId === tempId))
        if (idx === -1) return c
        const original = c.lines[idx]
        const clone = { ...original, id: null, _tempId: tempNewId, sort_order: idx + 1 }
        const lines = [...c.lines]
        lines.splice(idx + 1, 0, clone)
        return { ...c, lines: lines.map((l, i) => ({ ...l, sort_order: i })) }
      }),
    )
  }

  // Insère une ligne directement (sans passer par la modale)
  function insertLine(catId, lineData) {
    const tempId = `tmp_${Date.now()}_${Math.random()}`
    hasChanges.current = true
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? {
              ...c,
              lines: [
                ...c.lines,
                { ...EMPTY_LINE, ...lineData, _tempId: tempId, sort_order: c.lines.length },
              ],
            }
          : c,
      ),
    )
  }

  // Insère la ligne depuis la modale + ferme la modale
  function confirmAddLine(catId, lineData) {
    insertLine(catId, lineData)
    setAddLineModal(null)
  }

  async function deleteLine(catId, lineId, tempId) {
    if (lineId) await supabase.from('devis_lines').delete().eq('id', lineId)
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? {
              ...c,
              lines: c.lines.filter((l) => (lineId ? l.id !== lineId : l._tempId !== tempId)),
            }
          : c,
      ),
    )
  }

  function updateLine(catId, lineId, tempId, field, value) {
    hasChanges.current = true
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? {
              ...c,
              lines: c.lines.map((l) => {
                if (!(lineId ? l.id === lineId : l._tempId === tempId)) return l
                const updated = { ...l, [field]: value }
                updated.is_crew = CATS_HUMAINS.includes(updated.regime)
                return updated
              }),
            }
          : c,
      ),
    )
  }

  function updateLineBatch(catId, lineId, tempId, updates) {
    hasChanges.current = true
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? {
              ...c,
              lines: c.lines.map((l) => {
                if (!(lineId ? l.id === lineId : l._tempId === tempId)) return l
                const updated = { ...l, ...updates }
                updated.is_crew = CATS_HUMAINS.includes(updated.regime)
                return updated
              }),
            }
          : c,
      ),
    )
  }

  // ── Réordonner les lignes d'un bloc (drag & drop) ────────────────────────
  function reorderLines(catId, fromIdx, toIdx) {
    if (fromIdx === toIdx) return
    hasChanges.current = true
    setCategories((prev) =>
      prev.map((c) => {
        if (c.id !== catId) return c
        const lines = [...c.lines]
        const [moved] = lines.splice(fromIdx, 1)
        lines.splice(toIdx, 0, moved)
        return { ...c, lines: lines.map((l, i) => ({ ...l, sort_order: i })) }
      }),
    )
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
        marge_globale_pct: globalAdj.marge_globale_pct,
        assurance_pct: globalAdj.assurance_pct,
        remise_globale_pct: globalAdj.remise_globale_pct,
        remise_globale_montant: globalAdj.remise_globale_montant,
      })
      .select()
      .single()

    if (!newDevis) return

    for (const cat of categories) {
      const { data: newCat } = await supabase
        .from('devis_categories')
        .insert({
          devis_id: newDevis.id,
          name: cat.name,
          sort_order: cat.sort_order,
          dans_marge: cat.dans_marge !== false,
        })
        .select()
        .single()

      if (newCat) {
        await supabase.from('devis_lines').insert(
          cat.lines.map((l) => ({
            devis_id: newDevis.id,
            category_id: newCat.id,
            ref: l.ref,
            produit: l.produit,
            description: l.description,
            regime: l.regime,
            use_line: l.use_line,
            dans_marge: true,
            nb: l.nb ?? 1,
            quantite: l.quantite,
            unite: l.unite,
            tarif_ht: l.tarif_ht,
            cout_ht: l.cout_ht ?? null,
            remise_pct: l.remise_pct,
            sort_order: l.sort_order,
            is_crew: REGIMES_SALARIES.includes(l.regime),
          })),
        )
      }
    }

    navigate(`/projets/${projectId}/devis/${newDevis.id}`)
  }

  // ── Calcul synthèse global ────────────────────────────────────────────────
  // Si une catégorie a dans_marge=false, ses lignes ne comptent pas dans la
  // marge globale. La normalisation est centralisée dans applyCategoryDansMarge
  // pour qu'éditeur ET ProjetLayout (header BUDGET) calculent la même chose.
  const flatLines = categories.flatMap((c) => c.lines.map((l) => ({ ...l, category_id: c.id })))
  const allLines = applyCategoryDansMarge(flatLines, categories)
  // Affiche la colonne Remise si au moins une ligne a une remise, OU si l'utilisateur l'a forcée
  const hasAnyRemise = categories.some((c) => c.lines.some((l) => l.remise_pct > 0))
  const remiseVisible = showRemise || hasAnyRemise

  const synth = calcSynthese(
    allLines,
    devis?.tva_rate || 20,
    devis?.acompte_pct || 30,
    taux,
    globalAdj,
  )

  if (loading)
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <header
        className="px-4 shrink-0"
        style={{ background: 'var(--bg-surf)', borderBottom: '1px solid var(--brd)' }}
      >
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
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.12)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.07)')}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Versions
              </Link>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold shrink-0" style={{ color: 'var(--blue)' }}>
                Devis V{devis?.version_number}
              </span>
              {editingTitle ? (
                <input
                  type="text"
                  autoFocus
                  defaultValue={devis?.title || ''}
                  placeholder="Nom du devis (optionnel)"
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    updateDevisField('title', v || null)
                    setEditingTitle(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditingTitle(false)
                  }}
                  className="text-xs px-1.5 py-0.5 rounded outline-none"
                  style={{
                    background: 'rgba(255,255,255,.06)',
                    border: '1px solid var(--brd)',
                    color: 'var(--txt)',
                    minWidth: '220px',
                  }}
                />
              ) : (
                <button
                  onClick={() => setEditingTitle(true)}
                  title={devis?.title ? 'Renommer le devis' : 'Ajouter un nom au devis'}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all group"
                  style={{ color: devis?.title ? 'var(--txt-2)' : 'var(--txt-3)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className="text-xs italic truncate max-w-[260px]">
                    {devis?.title || 'Sans nom'}
                  </span>
                  <Pencil className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                </button>
              )}
              <StatusSelect
                status={devis?.status}
                onChange={(v) => updateDevisField('status', v)}
              />
            </div>
          </div>

          {/* Droite : statut save + boutons ─────────────────────────────── */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="flex items-center gap-1.5 text-xs"
              style={{ width: '90px', justifyContent: 'flex-end' }}
            >
              {saving && (
                <>
                  <RefreshCw
                    className="w-3.5 h-3.5 animate-spin"
                    style={{ color: 'var(--txt-3)' }}
                  />
                  <span style={{ color: 'var(--txt-3)' }}>Sauvegarde…</span>
                </>
              )}
              {saved && !saving && (
                <>
                  <Check className="w-3.5 h-3.5" style={{ color: 'var(--green)' }} />
                  <span style={{ color: 'var(--green)' }}>Sauvegardé</span>
                </>
              )}
              {saveError && !saving && (
                <span
                  className="font-medium cursor-pointer"
                  style={{ color: 'var(--red)' }}
                  onClick={() => notify.error(`Erreur sauvegarde : ${saveError}`)}
                >
                  ⚠ Erreur save
                </span>
              )}
            </div>
            <button onClick={saveNow} className="btn-secondary btn-sm">
              <Save className="w-3.5 h-3.5" />
              Sauvegarder
            </button>
            <button onClick={dupliquerVersion} className="btn-secondary btn-sm">
              <Copy className="w-3.5 h-3.5" />
              Dupliquer V{(devis?.version_number || 0) + 1}
            </button>
            <button
              onClick={openPdfPreview}
              disabled={pdfLoading}
              className="btn-secondary btn-sm"
              title="Prévisualiser le devis en PDF"
            >
              {pdfLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              PDF
            </button>
            <button
              onClick={() => {
                const url = `${window.location.origin}/devis/public/${devis?.public_token}`
                navigator.clipboard.writeText(url)
                notify.success('Lien copié dans le presse-papier')
              }}
              className="btn-primary btn-sm"
            >
              <Eye className="w-3.5 h-3.5" />
              Lien client
            </button>
          </div>
        </div>
      </header>

      {/* ── Table principale — pleine largeur ────────────────────────────── */}
      <div className="flex-1 overflow-auto" style={{ paddingBottom: '80px' }}>
        <table
          className="devis-table w-full border-collapse"
          style={{ minWidth: showAnalyse ? '1310px' : '910px' }}
        >
          <thead className="sticky top-0 z-20">
            <tr>
              {/* Grip — collapse-all intégré */}
              <th className="w-8 text-center">
                {(() => {
                  const allCollapsed =
                    categories.length > 0 && categories.every((c) => collapsed[c.id])
                  return (
                    <button
                      onClick={() =>
                        allCollapsed
                          ? setCollapsed({})
                          : setCollapsed(Object.fromEntries(categories.map((c) => [c.id, true])))
                      }
                      title={allCollapsed ? 'Tout développer' : 'Tout réduire'}
                      className="flex items-center justify-center rounded transition-all"
                      style={{
                        width: '22px',
                        height: '18px',
                        color: 'var(--txt-2)',
                        background: 'rgba(255,255,255,.06)',
                        border: '1px solid rgba(255,255,255,.10)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,.11)'
                        e.currentTarget.style.color = 'var(--txt)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,.06)'
                        e.currentTarget.style.color = 'var(--txt-2)'
                      }}
                    >
                      {allCollapsed ? (
                        <ChevronRight className="w-2.5 h-2.5" />
                      ) : (
                        <ChevronDown className="w-2.5 h-2.5" />
                      )}
                    </button>
                  )
                })()}
              </th>
              <th className="w-6" title="Activer la ligne">
                ✓
              </th>
              <th className="w-72">Produit / Poste</th>
              <th className="w-56">Description</th>
              <th className="w-24">Cat.</th>
              <th className="w-10">Nb</th>
              <th className="w-20" title="Quantité × unité">
                Qté
              </th>
              <th className="w-24">Tarif HT</th>
              <th className="col-cout w-24" title="Coût d'achat unitaire (vide = égal au tarif)">
                Coût unit.
              </th>
              {remiseVisible && (
                <th className="w-16">
                  <button
                    onClick={() => setShowRemise((p) => !p)}
                    title={showRemise && !hasAnyRemise ? 'Masquer la colonne remise' : 'Remise'}
                    className="flex items-center gap-1 rounded transition-all"
                    style={{
                      padding: '1px 5px',
                      fontSize: '10px',
                      fontWeight: 600,
                      color: hasAnyRemise ? 'var(--txt-2)' : 'var(--txt-3)',
                      background:
                        showRemise && !hasAnyRemise ? 'rgba(255,255,255,.06)' : 'transparent',
                      border:
                        showRemise && !hasAnyRemise
                          ? '1px solid rgba(255,255,255,.10)'
                          : '1px solid transparent',
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
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.4')}
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
                  onClick={() => setShowAnalyse((p) => !p)}
                  title={showAnalyse ? "Masquer l'analyse" : "Afficher l'analyse"}
                  className="flex items-center gap-1 ml-auto rounded transition-all"
                  style={{
                    padding: '2px 6px',
                    fontSize: '10px',
                    fontWeight: 600,
                    letterSpacing: '.03em',
                    whiteSpace: 'nowrap',
                    ...(showAnalyse
                      ? {
                          color: 'var(--blue)',
                          background: 'rgba(77,159,255,.15)',
                          border: '1px solid rgba(77,159,255,.35)',
                        }
                      : {
                          color: 'var(--txt-2)',
                          background: 'rgba(255,255,255,.06)',
                          border: '1px solid rgba(255,255,255,.10)',
                        }),
                  }}
                  onMouseEnter={(e) => {
                    if (!showAnalyse) {
                      e.currentTarget.style.background = 'rgba(255,255,255,.11)'
                      e.currentTarget.style.color = 'var(--txt)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!showAnalyse) {
                      e.currentTarget.style.background = 'rgba(255,255,255,.06)'
                      e.currentTarget.style.color = 'var(--txt-2)'
                    }
                  }}
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
                collapsed={Boolean(collapsed[cat.id])}
                taux={taux}
                bdd={bdd}
                showAnalyse={showAnalyse}
                remiseVisible={remiseVisible}
                onToggle={() => setCollapsed((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
                onRename={(name) => renameCategory(cat.id, name)}
                onDelete={() => deleteCategory(cat.id)}
                onToggleDansMarge={(val) => updateCategoryDansMarge(cat.id, val)}
                onUpdateNotes={(notes) => updateCategoryNotes(cat.id, notes)}
                onAddLine={(defaultRegime, prefilledProduit) =>
                  addLine(cat.id, defaultRegime, prefilledProduit)
                }
                onAddLineDirect={(lineData) => insertLine(cat.id, lineData)}
                onOpenIntermittent={(item) =>
                  setAddLineModal({
                    catId: cat.id,
                    defaultRegime:
                      item.filiere === 'Artiste'
                        ? 'Intermittent Artiste'
                        : 'Intermittent Technicien',
                    prefilledPoste: item.poste,
                    prefilledIsSpec: item.is_specialise || false,
                  })
                }
                onUpdateLine={(lineId, tempId, field, val) =>
                  updateLine(cat.id, lineId, tempId, field, val)
                }
                onUpdateLineBatch={(lineId, tempId, updates) =>
                  updateLineBatch(cat.id, lineId, tempId, updates)
                }
                onDeleteLine={(lineId, tempId) => deleteLine(cat.id, lineId, tempId)}
                onDuplicateLine={(lineId, tempId) => duplicateLine(cat.id, lineId, tempId)}
                onReorderLines={(fromIdx, toIdx) => reorderLines(cat.id, fromIdx, toIdx)}
              />
            ))}
          </tbody>
        </table>

        {/* Ajouter bloc */}
        {(() => {
          const activeKeys = new Set(categories.map((c) => c.name))
          const inactiveBlocs = BLOCS_CANONIQUES.filter((b) => !activeKeys.has(b.key))
          return (
            <div
              className="p-4 flex flex-wrap items-center gap-2"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              <span className="text-xs font-medium" style={{ color: 'var(--txt-3)' }}>
                Ajouter un bloc :
              </span>
              {inactiveBlocs.map((bloc) => (
                <button
                  key={bloc.key}
                  onClick={() => addBlocCanonique(bloc)}
                  className="btn-secondary btn-sm text-xs flex items-center gap-1.5"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: bloc.color }}
                  />
                  + {bloc.label}
                </button>
              ))}
              {inactiveBlocs.length === 0 && (
                <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
                  Tous les blocs sont actifs
                </span>
              )}
              <button
                onClick={() => addCategory('')}
                className="btn-ghost btn-sm text-xs ml-2"
                style={{ color: 'var(--txt-3)' }}
              >
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

      {/* ── Prévisualisation PDF ─────────────────────────────────────────── */}
      <PdfPreviewModal
        open={Boolean(pdfPreview)}
        onClose={closePdfPreview}
        title={`Devis${devis?.version_number ? ` V${devis.version_number}` : ''}${project?.title ? ` — ${project.title}` : ''}`}
        url={pdfPreview?.url || null}
        filename={pdfPreview?.filename || 'devis.pdf'}
        onDownload={() => pdfPreview?.download?.()}
      />
    </div>
  )
}
