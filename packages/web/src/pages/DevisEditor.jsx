import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { notify } from '../lib/notify'
import { REGIMES_SALARIES } from '../lib/cotisations'
import { exportDevisPDF } from '../lib/pdfExport'
import { BLOCS_CANONIQUES, getBlocInfo as _getBlocInfoByName } from '../lib/blocs'
import { EMPTY_LINE } from '../features/devis/constants'
import { useDevis } from '../features/devis/useDevis'
import { useProjectPresence } from '../hooks/useProjectPresence'
import PresenceAvatars from '../components/PresenceAvatars'
import DevisHistoryPanel from '../features/devis/components/DevisHistoryPanel'
import { fetchUnseenCount, markHistorySeen } from '../lib/devisHistorySeen'
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
  History,
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
  const { org, user } = useAuth()

  // ── Données + persistance (hook) ───────────────────────────────────────────
  const D = useDevis({ devisId, projectId, org })
  const {
    devis, project, client, categories, taux, bdd, globalAdj,
    saving, saved, dirty, loading, saveError,
    synth, hasAnyRemise,
    saveNow, updateGlobalAdj, updateDevisField,
    addCategory, addBlocCanonique, renameCategory,
    updateCategoryDansMarge, updateCategoryNotes, deleteCategory,
    insertLine, duplicateLine, deleteLine, updateLine, updateLineBatch, reorderLines,
  } = D

  // ── R3 : présence collaborative (avatars + qui édite quelle ligne) ──────────
  // Channel keyé par devisId (chaque version a sa présence propre).
  const { othersOnPage, othersEditingByRow, setMyEditingRowId } = useProjectPresence({
    projectId: devisId,
    channelSlug: 'devis-presence',
  })

  // ── État purement UI (reste dans le composant) ─────────────────────────────
  const [collapsed, setCollapsed] = useState({})
  const [addLineModal, setAddLineModal] = useState(null) // { catId, defaultRegime } | null
  const [showAnalyse, setShowAnalyse] = useState(false)
  const [showRemise, setShowRemise] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [pdfPreview, setPdfPreview] = useState(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [unseenHistory, setUnseenHistory] = useState(0)

  // ── Raccourci clavier : Cmd/Ctrl+S = sauvegarder ───────────────────────────
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveNow()
        return
      }
      // Cmd/Ctrl+Entrée → ajouter une ligne au bloc de la cellule active
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const catEl = document.activeElement?.closest?.('[data-cat-id]')
        const catId = catEl?.getAttribute('data-cat-id')
        if (catId) {
          e.preventDefault()
          addLineRef.current(catId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveNow])

  // ── Badge Historique : nb de modifs faites par D'AUTRES et non encore lues.
  // "Lu" = dernière ouverture du panneau, stockée côté serveur (devis_audit_seen)
  // → synchronisé entre appareils ; la pastille s'affiche dès l'arrivée si le
  // devis a été modifié pendant l'absence.
  const showHistoryRef = useRef(false)
  useEffect(() => {
    showHistoryRef.current = showHistory
    if (showHistory && devisId && user?.id) {
      setUnseenHistory(0)
      markHistorySeen(devisId, user.id)
    }
  }, [showHistory, devisId, user?.id])

  // À l'arrivée : compte les entrées non lues (serveur).
  useEffect(() => {
    if (!devisId || !user?.id) return undefined
    let alive = true
    fetchUnseenCount(devisId, user.id).then((n) => {
      if (alive) setUnseenHistory(n)
    })
    return () => {
      alive = false
    }
  }, [devisId, user?.id])

  // Incrément temps réel des modifs des autres tant que le panneau est fermé.
  useEffect(() => {
    if (!devisId) return undefined
    const ch = supabase
      .channel(`devis-audit-badge:${devisId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'devis_audit', filter: `devis_id=eq.${devisId}` },
        (payload) => {
          if (payload.new?.actor_id === user?.id) return // pas mes propres changements
          if (!showHistoryRef.current) setUnseenHistory((n) => n + 1)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [devisId, user?.id])

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

  // (autosave + doSave déplacés dans useDevis)
  // (sauvegarde, autosave, ajustements, handlers catégories → useDevis)

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

  // ── Gestion lignes ────────────────────────────────────────────────────────
  // Ouvre la modale régime-first (avec pré-remplissage optionnel)
  function addLine(catId, defaultRegime = null, prefilledProduit = null) {
    const cat = categories.find((c) => c.id === catId)
    const info = cat ? getBlocInfo(cat) : { defaultRegime: 'Frais' }
    const regime = defaultRegime || info.defaultRegime || EMPTY_LINE.regime
    setAddLineModal({ catId, defaultRegime: regime, prefilledProduit })
  }
  // Ref vers la dernière version d'addLine → le listener clavier reste stable.
  const addLineRef = useRef(addLine)
  addLineRef.current = addLine

  // Insère la ligne depuis la modale + ferme la modale
  function confirmAddLine(catId, lineData) {
    insertLine(catId, lineData)
    setAddLineModal(null)
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
  // allLines / hasAnyRemise / synth viennent désormais du hook useDevis.
  // Affiche la colonne Remise si au moins une ligne a une remise, OU si forcée.
  const remiseVisible = showRemise || hasAnyRemise

  if (loading)
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )

  // Map id→nom de bloc pour traduire les changements de catégorie dans l'historique
  const catNameById = new Map(categories.map((c) => [c.id, getBlocInfo(c).label || c.name]))

  // Clic sur une entrée d'historique → déplie le bloc, scroll vers la ligne, flash.
  function jumpToLine(lineId) {
    if (!lineId) return
    const cat = categories.find((c) => c.lines.some((l) => l.id === lineId))
    if (cat && collapsed[cat.id]) setCollapsed((p) => ({ ...p, [cat.id]: false }))
    // Double rAF : laisse React rendre la ligne si le bloc vient d'être déplié.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-line-key="${CSS.escape(String(lineId))}"]`)
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.remove('devis-line-flash')
        // reflow pour pouvoir rejouer l'animation si on re-clique la même ligne
        void el.offsetWidth
        el.classList.add('devis-line-flash')
        setTimeout(() => el.classList.remove('devis-line-flash'), 1800)
      }),
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
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

          {/* Droite : présence + statut save + boutons ───────────────────── */}
          <div className="flex items-center gap-2 shrink-0">
            <PresenceAvatars othersOnPage={othersOnPage} showLabel={false} />
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
              {dirty && !saving && !saved && !saveError && (
                <span className="flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: 'var(--orange)' }}
                  />
                  Non sauvegardé
                </span>
              )}
            </div>
            <button onClick={saveNow} className="btn-secondary btn-sm">
              <Save className="w-3.5 h-3.5" />
              Sauvegarder
            </button>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="btn-secondary btn-sm relative"
              title="Historique des changements"
              style={showHistory ? { color: 'var(--blue)', borderColor: 'var(--blue)' } : undefined}
            >
              <History className="w-3.5 h-3.5" />
              {unseenHistory > 0 && !showHistory && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full text-[9px] font-bold"
                  style={{ background: 'var(--blue)', color: '#fff' }}
                >
                  {unseenHistory > 9 ? '9+' : unseenHistory}
                </span>
              )}
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
                othersEditingByRow={othersEditingByRow}
                onEditRow={setMyEditingRowId}
              />
            ))}
          </tbody>
        </table>

        {/* État vide — aucun bloc encore */}
        {categories.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-12 px-4">
            <BarChart3 className="w-8 h-8 mb-3" style={{ color: 'var(--txt-3)', opacity: 0.5 }} />
            <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
              Ce devis est vide
            </p>
            <p className="text-xs mt-1 max-w-xs" style={{ color: 'var(--txt-3)' }}>
              Ajoutez un bloc ci-dessous (Régie, Matériel, Équipe…) pour commencer à
              chiffrer vos lignes.
            </p>
          </div>
        )}

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

      {/* ── Historique des changements (R4) ──────────────────────────────── */}
      <DevisHistoryPanel
        open={showHistory}
        onClose={() => setShowHistory(false)}
        devisId={devisId}
        catNameById={catNameById}
        onJumpToLine={jumpToLine}
      />
    </div>
  )
}
