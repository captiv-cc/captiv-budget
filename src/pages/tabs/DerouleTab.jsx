// ════════════════════════════════════════════════════════════════════════════
// DerouleTab — Page "Déroulé" d'un projet (CONDUITE V1 Phase B)
// ════════════════════════════════════════════════════════════════════════════
//
// Tab dédiée pour gérer le déroulé temporel d'une journée de tournage :
// qui fait quoi, à quelle heure, sur quelle équipe, à quel endroit.
//
// Cf. CHANTIER_DEROULE.md pour la roadmap complète. Phase B ajoute :
//   - Sélecteur jour (chips datés + bouton "+ Nouveau jour")
//   - Toggle Timeline / Liste (default Timeline desktop, Liste mobile)
//   - Vue Timeline avec multi-lanes + créneaux + now line
//   - Vue Liste compacte (lecture mobile-friendly)
//   - Side-panel inspecteur (création + édition + suppression)
//   - Bouton "Importer présences" depuis la techlist
//   - Empty state pédagogique si pas de déroulé pour ce jour
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  List as ListIcon,
  LayoutGrid,
  Download,
  Trash2,
  Lock,
  AlertCircle,
  Share2,
  Eye,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import ProjectPresenceBadge from '../../components/ProjectPresenceBadge'
import { useDeroule } from '../../hooks/useDeroule'
import useBreakpoint from '../../hooks/useBreakpoint'
// FIX V0 : on n'utilise plus membresPresentsJour pour filtrer le picker —
// décision Hugo "pas de contrainte dure". Le picker liste TOUS les membres
// du projet, avec un indicateur visuel sur ceux non présents ce jour.
// import { membresPresentsJour } from '../../lib/deroule'
import { findMembreOverlaps, enrichCreneauxWithImplicitMembers } from '../../lib/deroule'
import { notify } from '../../lib/notify'
import { confirm } from '../../lib/confirm'
import DerouleTimelineView from '../../features/deroule/DerouleTimelineView'
import DerouleListView from '../../features/deroule/DerouleListView'
import DerouleCadreurView from '../../features/deroule/DerouleCadreurView'
import CreneauInspector from '../../features/deroule/CreneauInspector'
import DerouleShareModal from '../../features/deroule/DerouleShareModal'

const OUTIL_KEY = 'deroule'

export default function DerouleTab() {
  const { id: projectId } = useParams()
  const { can } = useProjectPermissions(projectId)
  const canRead = can(OUTIL_KEY, 'read')
  const canEdit = can(OUTIL_KEY, 'edit')
  const breakpoint = useBreakpoint()
  const isMobile = breakpoint === 'sm' || breakpoint === 'md'

  // Date sélectionnée (ISO YYYY-MM-DD). Default : aujourd'hui.
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()))
  // Vue active : 'timeline' (desktop default) / 'liste' (mobile default) / 'cadreur' (festival)
  const [view, setView] = useState(isMobile ? 'liste' : 'timeline')
  // FEST-3 : cadreur sélectionné en mode vue='cadreur'. Persisté localement
  // entre changements de jour pour la même session.
  const [selectedCadreurId, setSelectedCadreurId] = useState(null)
  // Inspecteur ouvert sur quel créneau (null = fermé). POP-1 : on stocke
  // aussi le DOMRect du bloc cliqué pour le popover anchored.
  const [inspectedCreneau, setInspectedCreneau] = useState(null)
  const [inspectedAnchor, setInspectedAnchor] = useState(null)
  const [creatingDraft, setCreatingDraft] = useState(null)
  const [creatingAnchor, setCreatingAnchor] = useState(null)

  // Handler unifié pour ouvrir l'inspecteur depuis n'importe quelle vue.
  // L'event peut être un MouseEvent React (on extrait le rect de currentTarget)
  // ou directement un DOMRect (passé manuellement).
  function openInspector(creneau, eventOrRect) {
    // POP-1 : accepte un DOMRect direct (passé par CreneauBlock après
    // extraction immédiate au click) OU un événement React (pour les
    // vues List/Cadreur qui passent l'event tel quel). On vérifie par
    // typeof des propriétés top/left/width plutôt que ('top' in) qui
    // peut faillir avec les getters de prototype DOMRect dans certains
    // environnements.
    let rect = null
    if (eventOrRect && typeof eventOrRect === 'object') {
      if (
        typeof eventOrRect.top === 'number' &&
        typeof eventOrRect.left === 'number' &&
        typeof eventOrRect.width === 'number'
      ) {
        rect = eventOrRect
      } else if (eventOrRect.currentTarget?.getBoundingClientRect) {
        rect = eventOrRect.currentTarget.getBoundingClientRect()
      }
    }
    setInspectedAnchor(rect)
    setInspectedCreneau(creneau)
  }
  function closeInspector() {
    setInspectedCreneau(null)
    setInspectedAnchor(null)
  }
  // Modale de partage (Vague 2)
  const [shareOpen, setShareOpen] = useState(false)

  // Bascule auto vers liste sur mobile (sauf si on est explicitement en mode Cadreur)
  useEffect(() => {
    if (isMobile && view === 'timeline') setView('liste')
  }, [isMobile, view])

  const {
    loading,
    error,
    deroules,
    deroule,
    lanes,
    creneaux,
    creneauxByLane,
    creneauxMultiLane,
    createDeroule,
    // updateDeroule, // exposé par le hook, sera utilisé en Sprint 2 (notes session)
    deleteDeroule,
    addLane,
    updateLane,
    deleteLane,
    swapLaneOrder,
    createCreneau,
    updateCreneau,
    deleteCreneau,
    setCreneauMembres,
    importPresences,
  } = useDeroule(canRead ? projectId : null, selectedDate)

  // ─── Charger les membres techlist du projet (pour assignation + import) ──
  const [membres, setMembres] = useState([])
  useEffect(() => {
    if (!canRead || !projectId) return
    let cancelled = false
    supabase
      .from('projet_membres')
      .select(
        '*, contact:contacts(nom, prenom, email, telephone, specialite, ville)',
      )
      .eq('project_id', projectId)
      .is('parent_membre_id', null)
      .then(({ data }) => {
        if (cancelled) return
        setMembres(data || [])
      })
    return () => {
      cancelled = true
    }
  }, [canRead, projectId])

  // ─── Phase D — Détection des conflits d'assignation ─────────────────────
  // Pour chaque membre, on cherche les paires de créneaux qui se chevauchent
  // dans le temps. Si un membre est dans 2 créneaux qui overlappent, ces
  // créneaux sont marqués "en conflit" → la TimelineView/ListView les rend
  // avec un visuel d'alerte (bordure rouge + tooltip détaillé).
  const conflictsByCreneau = useMemo(() => {
    const map = new Map()
    if (!Array.isArray(creneaux) || creneaux.length === 0) return map
    if (!Array.isArray(membres) || membres.length === 0) return map
    // FEST-4 : enrichit les créneaux avec les membres implicites des lanes
    // type='personne'. Sans ça, un cadreur ayant 2 missions dans sa lane
    // perso qui se chevauchent ne serait pas détecté comme en conflit.
    const enriched = enrichCreneauxWithImplicitMembers(creneaux, lanes)
    for (const m of membres) {
      const pairs = findMembreOverlaps(m.id, enriched)
      for (const [a, b] of pairs) {
        const arrA = map.get(a.id) || []
        arrA.push({ creneau: b, membre: m })
        map.set(a.id, arrA)
        const arrB = map.get(b.id) || []
        arrB.push({ creneau: a, membre: m })
        map.set(b.id, arrB)
      }
    }
    return map
  }, [creneaux, membres, lanes])

  // ─── Tous les membres du projet, annotés "présent ce jour" ou non ────────
  // FIX V0 : on liste TOUS les membres (décision Hugo : pas de contrainte
  // dure), avec un flag `present_ce_jour` que le MembrePicker affiche en
  // indicateur visuel léger.
  const membresAvecPresence = useMemo(() => {
    if (!Array.isArray(membres)) return []
    return membres.map((m) => {
      const days = Array.isArray(m?.presence_days) ? m.presence_days : []
      return { ...m, present_ce_jour: days.includes(selectedDate) }
    })
  }, [membres, selectedDate])

  // ─── Handlers ────────────────────────────────────────────────────────────

  async function handleCreateDeroule() {
    if (!canEdit) return
    try {
      // V0.5 : minutes INTEGER (0 = 00:00, 1439 = 23:59, 1680 max = 04:00 J+1)
      await createDeroule({
        date_jour: selectedDate,
        titre: null,
        heure_debut_min: 0,
        heure_fin_min: 1439,
      })
      notify.success('Déroulé créé')
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  async function handleDeleteDeroule() {
    if (!canEdit || !deroule?.id) return
    const nbCreneaux = creneaux.length
    const nbLanes = lanes.length
    const detail = nbCreneaux > 0
      ? `${nbCreneaux} créneau${nbCreneaux > 1 ? 'x' : ''} et ${nbLanes} lane${nbLanes > 1 ? 's' : ''} seront définitivement supprimé${nbCreneaux > 1 ? 's' : ''}.`
      : `${nbLanes} lane${nbLanes > 1 ? 's' : ''} seront définitivement supprimé${nbLanes > 1 ? 's' : ''} (déroulé vide).`
    const ok = await confirm({
      title: `Supprimer le déroulé du ${formatDate(selectedDate)}`,
      message: `${detail} Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteDeroule(deroule.id)
      notify.success('Déroulé supprimé')
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  async function handleImportPresences() {
    if (!canEdit || !deroule?.id) return
    try {
      const created = await importPresences(membres)
      if (created.length === 0) {
        notify.info('Aucune présence à importer (pas d\'horaires définis sur la techlist).')
      } else {
        notify.success(`${created.length} créneau(x) Présence importé(s).`)
      }
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  // POP-1 : accept (creneau, event|rect) — l'event peut être un MouseEvent
  // React dont currentTarget est l'élément bloc. Si seul `creneau` est passé,
  // l'inspecteur s'ouvre centré (fallback ancien comportement).
  function handleSelectCreneau(creneau, eventOrRect) {
    setCreatingDraft(null)
    setCreatingAnchor(null)
    openInspector(creneau, eventOrRect)
  }

  function handleCreateCreneauAt(draft, eventOrRect) {
    if (!canEdit) return
    closeInspector()
    // Force lane Global par défaut si rien
    const globalLane = lanes.find((l) => l.sort_order === 0)
    setCreatingDraft({
      ...draft,
      lane_id: draft.lane_id || globalLane?.id || null,
      titre: '',
      type: 'autre',
      // V0.5 : si appelé depuis le bouton flottant mobile sans heures,
      // défauts 09:00 → 09:30 (540 → 570 minutes).
      heure_debut_min: draft.heure_debut_min ?? 540,
      heure_fin_min: draft.heure_fin_min ?? 570,
    })
    // Stocke aussi le rect de l'élément cliqué pour ancrer le popover
    // (sinon il sera centré).
    if (eventOrRect?.currentTarget?.getBoundingClientRect) {
      setCreatingAnchor(eventOrRect.currentTarget.getBoundingClientRect())
    } else if (typeof eventOrRect?.getBoundingClientRect === 'function') {
      setCreatingAnchor(eventOrRect)
    } else {
      setCreatingAnchor(null)
    }
  }

  async function handleSaveCreneau(fields) {
    await updateCreneau(inspectedCreneau.id, fields)
    closeInspector()
    notify.success('Créneau mis à jour')
  }

  // FEST-2.7 + POP-2.B : save silencieux générique. Ne ferme PAS le drawer
  // et n'émet PAS de toast — utilisé pour les notes (auto-save debounced)
  // ET les modifs inline hover-to-edit (titre, horaires, lane, lieu, statut).
  // Accepte n'importe quel sous-ensemble de champs du créneau.
  async function handleSavePartial(fields) {
    if (!inspectedCreneau?.id || !fields || typeof fields !== 'object') return
    try {
      await updateCreneau(inspectedCreneau.id, fields)
    } catch (e) {
      console.warn('[DerouleTab] partial save failed', e)
    }
  }
  // Alias historique (FEST-2.7) pour ne pas casser la prop existante.
  async function handleAutoSaveCreneauNotes(notes) {
    await handleSavePartial({ notes })
  }

  async function handleCreateCreneauSubmit(fields) {
    const created = await createCreneau(fields)
    if (created && fields.member_ids?.length > 0) {
      // Les member_ids sont déjà passés dans createCreneau — mais on s'assure
      // pas de double-insert (createCreneau gère déjà)
    }
    setCreatingDraft(null)
    setCreatingAnchor(null)
    notify.success('Créneau créé')
  }

  async function handleDeleteCreneau() {
    await deleteCreneau(inspectedCreneau.id)
    closeInspector()
    notify.success('Créneau supprimé', false)
  }

  async function handleSetCreneauMembres(membreIds) {
    await setCreneauMembres(inspectedCreneau.id, membreIds)
  }

  async function handleAddLane(payload) {
    // FEST-2 : le menu d'ajout passe désormais un payload typé
    // { type, libelle?, membre_id? }. Sans payload = ancien comportement
    // (lane générique type='equipe').
    try {
      await addLane(payload || null)
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  async function handleReorderLane(laneId, direction) {
    // FEST-2-bis : déplace une lane d'un cran à gauche ou à droite.
    // Le composant timeline calcule le voisin et appelle ce handler.
    // direction : 'left' ou 'right' — mais le calcul du voisin se fait
    // côté DerouleTimelineView qui a accès aux sortedLanes. On reçoit
    // donc directement le couple { laneId, neighborId }.
    if (!laneId || !direction) return
    try {
      await swapLaneOrder(laneId, direction)
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  async function handleDeleteLane(laneId) {
    if (!window.confirm('Supprimer cette lane ? Elle doit être vide.')) return
    try {
      await deleteLane(laneId)
    } catch (e) {
      notify.error('Erreur : ' + (e?.message || e))
    }
  }

  // ─── Garde permissions ───────────────────────────────────────────────────
  if (!canRead) {
    return (
      <div className="p-8 text-center">
        <Lock className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
          Vous n&apos;avez pas accès au déroulé de ce projet.
        </p>
      </div>
    )
  }

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <div
          className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  // ─── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--red)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
          Impossible de charger le déroulé.
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
          {error.message || 'Erreur inconnue'}
        </p>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <DaySelector
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          deroules={deroules}
          canEdit={canEdit}
        />
        <div className="flex items-center gap-2">
          {/* FEST-2.8 : avatars des autres admins sur la page Déroulé
              (via useProjectPresence générique PRES-1). N'affiche rien si
              on est seul. */}
          <ProjectPresenceBadge outilKey="deroule" projectId={projectId} />
          {/* FEST-3 : toggle visible aussi sur mobile pour accéder à la vue
              Cadreur. Sur mobile, les labels sont masqués (hidden sm:inline
              dans ToggleBtn) pour ne garder que les icônes. */}
          {deroule && <ViewToggle view={view} onChange={setView} />}
          {canEdit && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--txt-2)',
                background: 'transparent',
                border: '1px solid var(--brd)',
              }}
              title="Crée un lien public partageable du déroulé"
            >
              <Share2 className="w-3 h-3" />
              <span className="hidden sm:inline">Partager</span>
            </button>
          )}
          {deroule && canEdit && (
            <button
              type="button"
              onClick={handleImportPresences}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--txt-2)',
                background: 'transparent',
                border: '1px solid var(--brd)',
              }}
              title="Crée des créneaux Présence sur la lane Global pour chaque membre techlist présent ce jour"
            >
              <Download className="w-3 h-3" />
              <span className="hidden sm:inline">Importer présences</span>
            </button>
          )}
          {deroule && canEdit && (
            <button
              type="button"
              onClick={handleDeleteDeroule}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--red)',
                background: 'transparent',
                border: '1px solid var(--red-brd, rgba(226,75,74,0.3))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--red-bg)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
              title={`Supprimer le déroulé du ${formatDate(selectedDate)} et tous ses créneaux`}
            >
              <Trash2 className="w-3 h-3" />
              <span className="hidden sm:inline">Supprimer</span>
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {!deroule ? (
        <EmptyState
          selectedDate={selectedDate}
          canEdit={canEdit}
          onCreate={handleCreateDeroule}
        />
      ) : view === 'cadreur' ? (
        <DerouleCadreurView
          deroule={deroule}
          lanes={lanes}
          creneaux={creneaux}
          membres={membres}
          conflictsByCreneau={conflictsByCreneau}
          selectedMembreId={selectedCadreurId}
          setSelectedMembreId={setSelectedCadreurId}
          onSelectCreneau={handleSelectCreneau}
        />
      ) : view === 'timeline' && !isMobile ? (
        <DerouleTimelineView
          deroule={deroule}
          lanes={lanes}
          creneauxByLane={creneauxByLane}
          creneauxMultiLane={creneauxMultiLane}
          membres={membres}
          conflictsByCreneau={conflictsByCreneau}
          canEdit={canEdit}
          onSelectCreneau={handleSelectCreneau}
          onCreateCreneauAt={handleCreateCreneauAt}
          onAddLane={handleAddLane}
          onUpdateLane={updateLane}
          onDeleteLane={handleDeleteLane}
          onReorderLane={handleReorderLane}
          onMoveCreneau={updateCreneau}
        />
      ) : (
        <DerouleListView
          lanes={lanes}
          creneaux={creneaux}
          membres={membres}
          conflictsByCreneau={conflictsByCreneau}
          onSelectCreneau={handleSelectCreneau}
        />
      )}

      {/* Bouton flottant "+ créneau" pour mobile / liste */}
      {deroule && canEdit && (view === 'liste' || isMobile) && (
        <button
          type="button"
          onClick={() =>
            handleCreateCreneauAt({
              lane_id: lanes.find((l) => l.sort_order === 0)?.id || null,
              multi_lane: false,
              heure_debut_min: 540,    // 09:00
              heure_fin_min: 570,      // 09:30
            })
          }
          className="fixed bottom-6 right-6 flex items-center gap-1 px-3 py-2 text-sm rounded-full shadow-lg z-30"
          style={{
            background: 'var(--blue)',
            color: 'white',
          }}
        >
          <Plus className="w-4 h-4" />
          Créneau
        </button>
      )}

      {/* Inspecteur popover anchored (POP-1) */}
      {inspectedCreneau && (
        <CreneauInspector
          creneau={inspectedCreneau}
          anchorRect={inspectedAnchor}
          lanes={lanes}
          membresPresents={membresAvecPresence}
          canEdit={canEdit}
          onClose={closeInspector}
          onSave={handleSaveCreneau}
          onAutoSaveNotes={handleAutoSaveCreneauNotes}
          onSavePartial={handleSavePartial}
          onDelete={handleDeleteCreneau}
          onSetMembres={handleSetCreneauMembres}
        />
      )}
      {creatingDraft && (
        <CreneauInspector
          creneau={creatingDraft}
          anchorRect={creatingAnchor}
          isCreate
          lanes={lanes}
          membresPresents={membresAvecPresence}
          canEdit={canEdit}
          onClose={() => {
            setCreatingDraft(null)
            setCreatingAnchor(null)
          }}
          onCreate={handleCreateCreneauSubmit}
        />
      )}

      {/* Modale de partage (Vague 2) */}
      <DerouleShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        projectId={projectId}
      />
    </div>
  )
}

// ─── DaySelector — chips datés + bouton "Nouveau jour" ────────────────────

function DaySelector({ selectedDate, onSelectDate, deroules, canEdit: _canEdit }) {
  function shift(days) {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + days)
    onSelectDate(isoDate(d))
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="p-1 rounded transition-colors"
        style={{ color: 'var(--txt-2)', background: 'transparent' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <input
        type="date"
        value={selectedDate}
        onChange={(e) => onSelectDate(e.target.value)}
        className="px-2 py-1 text-sm rounded outline-none"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt)',
          border: '1px solid var(--brd)',
        }}
      />
      <button
        type="button"
        onClick={() => shift(1)}
        className="p-1 rounded transition-colors"
        style={{ color: 'var(--txt-2)', background: 'transparent' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      {/* Chips des jours déjà créés */}
      {deroules.length > 0 && (
        <div className="flex gap-1 ml-2 flex-wrap">
          {deroules.map((d) => {
            const active = d.date_jour === selectedDate
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelectDate(d.date_jour)}
                className="px-2 py-0.5 text-[11px] rounded transition-colors"
                style={{
                  background: active ? 'var(--blue)' : 'var(--bg-elev)',
                  color: active ? 'white' : 'var(--txt-2)',
                  border: `1px solid ${active ? 'var(--blue)' : 'var(--brd-sub)'}`,
                  fontWeight: active ? 500 : 400,
                }}
              >
                {formatDateChip(d.date_jour)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── ViewToggle ────────────────────────────────────────────────────────────

function ViewToggle({ view, onChange }) {
  // FEST-3 : ajout du mode "Cadreur" en plus de Timeline / Liste.
  // Les 3 sont des modes mutuellement exclusifs. Mobile : tous accessibles
  // via les mêmes pills (pas de masquage label sur mobile pour cette V1).
  return (
    <div
      className="flex rounded overflow-hidden"
      style={{ border: '1px solid var(--brd)' }}
    >
      <ToggleBtn
        active={view === 'timeline'}
        onClick={() => onChange('timeline')}
        icon={LayoutGrid}
        label="Timeline"
      />
      <ToggleBtn
        active={view === 'liste'}
        onClick={() => onChange('liste')}
        icon={ListIcon}
        label="Liste"
        leftBorder
      />
      <ToggleBtn
        active={view === 'cadreur'}
        onClick={() => onChange('cadreur')}
        icon={Eye}
        label="Cadreur"
        leftBorder
      />
    </div>
  )
}

function ToggleBtn({ active, onClick, icon: Icon, label, leftBorder }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 text-xs"
      style={{
        background: active ? 'var(--bg-elev)' : 'transparent',
        color: active ? 'var(--txt)' : 'var(--txt-3)',
        fontWeight: active ? 500 : 400,
        borderLeft: leftBorder ? '1px solid var(--brd)' : 'none',
        minHeight: 28,
      }}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

// ─── EmptyState ────────────────────────────────────────────────────────────

function EmptyState({ selectedDate, canEdit, onCreate }) {
  return (
    <div
      className="rounded-lg p-12 text-center"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      <Clock className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)', opacity: 0.4 }} />
      <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
        Aucun déroulé pour le {formatDate(selectedDate)}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
        Créez un déroulé pour planifier la journée heure par heure.
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-4 inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded transition-colors"
          style={{
            background: 'var(--blue)',
            color: 'white',
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          Créer le déroulé
        </button>
      )}
    </div>
  )
}

// ─── Helpers date ──────────────────────────────────────────────────────────

function isoDate(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function formatDateChip(iso) {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}
