// ════════════════════════════════════════════════════════════════════════════
// LivrablesTab — Page "Livrables" d'un projet (LIV-5 → LIV-9)
// ════════════════════════════════════════════════════════════════════════════
//
// Point d'entrée de l'outil Livrables. Orchestre :
//   - le hook `useLivrables(projectId)` qui porte tout l'état
//   - les permissions via `useProjectPermissions` (gate read + edit)
//   - un header local (compteurs basiques + CTA "Nouveau bloc")
//   - la liste des blocs via `LivrableBlockList` (drag & drop + CRUD via LIV-6)
//   - le drawer details (LIV-8 versions + LIV-9 étapes) — un seul drawer
//     global avec tabs, ouvert pour le livrable courant
//     (`detailsDrawerLivrable`)
//   - empty state propre quand 0 bloc
//   - loading state
//
// LIV-5 a posé la plomberie. LIV-6 a extrait `LivrableBlockCard` + ajouté le
// CRUD blocs. LIV-7 a ajouté le rendu détaillé des livrables (table + cards).
// LIV-8 a ajouté le drawer historique des versions. LIV-9 ajoute l'onglet
// Étapes (pipeline + events miroir) au même drawer.
//
// Gating :
//   - `canRead` → on tombe sur un écran "accès restreint" si false
//   - `canEdit` → les CTA de mutation sont masqués si false (mode lecture)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  CheckSquare,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  Inbox,
  ArrowRight,
  Eraser,
  Trash2,
  List as ListIcon,
  GanttChart,
} from 'lucide-react'
import { useLivrables } from '../../hooks/useLivrables'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import { useAuth } from '../../contexts/AuthContext'
import { prompt } from '../../lib/confirm'
import { notify } from '../../lib/notify'
import {
  LIVRABLE_BLOCK_COLOR_PRESETS,
  filterLivrables,
  formatDateRelative,
  hasActiveFilter,
  listMonteurs,
} from '../../lib/livrablesHelpers'
import { listEventTypes } from '../../lib/planning'
import { listOrgProfiles, indexProfilesById } from '../../lib/profiles'
import { listProjectLots } from '../../lib/livrables'
import LivrableBlockList from '../../features/livrables/components/LivrableBlockList'
import LivrableDetailsDrawer from '../../features/livrables/components/LivrableDetailsDrawer'
import BulkActionBar from '../../features/livrables/components/BulkActionBar'
import LivrablesFilterBar from '../../features/livrables/components/LivrablesFilterBar'
import LivrablesTrashDrawer from '../../features/livrables/components/LivrablesTrashDrawer'
import LivrablePipelineView from '../../features/livrables/components/LivrablePipelineView'

const OUTIL_KEY = 'livrables'

export default function LivrablesTab() {
  const { id: projectId } = useParams()
  const { can } = useProjectPermissions(projectId)
  const canRead = can(OUTIL_KEY, 'read')
  const canEdit = can(OUTIL_KEY, 'edit')
  const { profile, org } = useAuth()
  const userId = profile?.id || null
  const orgId = org?.id || null

  const {
    loading,
    error,
    blocks,
    livrablesByBlock,
    versionsByLivrable,
    etapesByLivrable,
    compteurs,
    actions,
  } = useLivrables(canRead ? projectId : null)

  // ─── Event types pour l'onglet Étapes du drawer (LIV-9) ──────────────────
  // org-scoped via RLS, chargés une fois au mount. Si l'utilisateur édite la
  // liste depuis l'admin, on rechargera au prochain mount du tab — pas de
  // realtime ici (overkill).
  const [eventTypes, setEventTypes] = useState([])
  useEffect(() => {
    if (!canRead) return
    let cancelled = false
    listEventTypes()
      .then((types) => {
        if (!cancelled) setEventTypes(types || [])
      })
      .catch((err) => {
        // Pas bloquant — le drawer affichera "(aucun type)" et l'étape sera
        // créée sans type_id (event miroir hérite du défaut côté planning).
        notify.error('Chargement types événement : ' + (err?.message || err))
      })
    return () => {
      cancelled = true
    }
  }, [canRead])

  // ─── Profiles de l'org (LIV-15 — autocomplete monteur) ──────────────────
  // Chargés une fois quand l'orgId est connu. On garde la Map indexée pour
  // éviter de la recalculer à chaque render des lignes.
  const [profiles, setProfiles] = useState([])
  useEffect(() => {
    if (!canRead || !orgId) return
    let cancelled = false
    listOrgProfiles({ orgId })
      .then((list) => {
        if (!cancelled) setProfiles(list || [])
      })
      .catch((err) => {
        // Non-bloquant — l'input bascule sur texte libre seul.
        notify.error('Chargement profils : ' + (err?.message || err))
      })
    return () => {
      cancelled = true
    }
  }, [canRead, orgId])
  const profilesById = useMemo(() => indexProfilesById(profiles), [profiles])

  // ─── Lots du projet (LIV-19 — pointeur livrable.devis_lot_id) ────────────
  // Chargés une fois au mount du tab. Si Hugo crée un nouveau lot pendant
  // qu'il édite ses livrables, il faudra recharger via remount — overkill
  // pour V1.
  const [lots, setLots] = useState([])
  useEffect(() => {
    if (!canRead || !projectId) return
    let cancelled = false
    listProjectLots(projectId)
      .then((list) => {
        if (!cancelled) setLots(list || [])
      })
      .catch((err) => {
        notify.error('Chargement lots : ' + (err?.message || err))
      })
    return () => {
      cancelled = true
    }
  }, [canRead, projectId])

  // ─── LIV-15 — Filtres (state synchro URL params) ────────────────────────
  // Format URL : ?statut=brief,en_cours&monteur=p:abc,x:hugo&format=16:9,__none__
  //              &bloc=<uuid>,<uuid>&retard=1&mes=1
  // Persistant à travers reloads, partageable. Pas de stockage côté client.
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => {
    const splitSet = (val) => {
      if (!val) return new Set()
      return new Set(val.split(',').filter(Boolean))
    }
    return {
      statuts: splitSet(searchParams.get('statut')),
      monteurs: splitSet(searchParams.get('monteur')),
      formats: splitSet(searchParams.get('format')),
      blockIds: splitSet(searchParams.get('bloc')),
      enRetard: searchParams.get('retard') === '1',
      mesLivrables: searchParams.get('mes') === '1',
    }
  }, [searchParams])

  const handleFiltersChange = useCallback(
    (next) => {
      const params = new URLSearchParams(searchParams)
      // Sets → joined string ; vide → on retire la clé.
      const writeSet = (key, set) => {
        if (set && set.size > 0) {
          params.set(key, Array.from(set).join(','))
        } else {
          params.delete(key)
        }
      }
      writeSet('statut', next.statuts)
      writeSet('monteur', next.monteurs)
      writeSet('format', next.formats)
      writeSet('bloc', next.blockIds)
      if (next.enRetard) params.set('retard', '1')
      else params.delete('retard')
      if (next.mesLivrables) params.set('mes', '1')
      else params.delete('mes')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  // ─── LIV-16 — Quick filters depuis les compteurs du header ──────────────
  // Helpers pour reset complet ou appliquer un preset (statuts ou enRetard).
  // Le pattern : un click toggle l'état (activer si pas déjà actif, sinon
  // désactiver complètement le filtre correspondant).
  const handleClearAllFilters = useCallback(() => {
    handleFiltersChange({
      statuts: new Set(),
      monteurs: new Set(),
      formats: new Set(),
      blockIds: new Set(),
      enRetard: false,
      mesLivrables: false,
    })
  }, [handleFiltersChange])

  const handleToggleEnRetard = useCallback(() => {
    handleFiltersChange({ ...filters, enRetard: !filters.enRetard })
  }, [filters, handleFiltersChange])

  const handleTogglePresetStatuts = useCallback(
    (presetKeys) => {
      // Actif si filters.statuts === exactement ce preset
      const isActive =
        filters.statuts.size === presetKeys.length &&
        presetKeys.every((k) => filters.statuts.has(k))
      handleFiltersChange({
        ...filters,
        statuts: isActive ? new Set() : new Set(presetKeys),
      })
    },
    [filters, handleFiltersChange],
  )

  // Liste des monteurs distincts pour la barre de filtres.
  const allLivrablesFlat = useMemo(() => {
    if (!livrablesByBlock) return []
    const out = []
    for (const arr of livrablesByBlock.values()) out.push(...arr)
    return out
  }, [livrablesByBlock])
  const monteursList = useMemo(
    () => listMonteurs(allLivrablesFlat, profilesById),
    [allLivrablesFlat, profilesById],
  )

  // Application des filtres : on construit `filteredLivrablesByBlock` qui
  // remplace `livrablesByBlock` en aval. Si aucun filtre actif, on passe
  // directement la Map originale (pas de copie inutile).
  const filteredLivrablesByBlock = useMemo(() => {
    if (!livrablesByBlock || !hasActiveFilter(filters)) return livrablesByBlock
    const next = new Map()
    for (const [blockId, arr] of livrablesByBlock.entries()) {
      const filtered = filterLivrables(arr, filters, { userId })
      next.set(blockId, filtered)
    }
    return next
  }, [livrablesByBlock, filters, userId])

  // Compteurs basés sur la liste FILTRÉE (réactivité aux filtres pour
  // afficher "X actifs après filtre" — cohérent avec l'UX).
  // Hmm, mais compteurs header sont déjà calculés sur la liste complète via
  // useLivrables. On les laisse globaux pour ne pas perdre le repère "total
  // projet". Si tu veux qu'ils suivent les filtres, à arbitrer.

  // ─── LIV-14 — Bulk select (sélection multiple cross-blocs) ──────────────
  // Set des IDs livrables sélectionnés. Vidé à chaque changement de projet.
  // `lastClickedId` mémorise le dernier livrable cliqué pour la sélection
  // shift+click (range entre 2 cliques).
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [lastClickedId, setLastClickedId] = useState(null)

  // Reset à chaque changement de projet (sécurité — sinon ids fantôme).
  useEffect(() => {
    setSelectedIds(new Set())
    setLastClickedId(null)
  }, [projectId])

  // Construit la liste à plat de tous les livrables ordonnés (par bloc puis
  // sort_order intra-bloc). Utilisée pour le shift+click range.
  const flatLivrableIds = useMemo(() => {
    if (!blocks || !livrablesByBlock) return []
    const ids = []
    for (const block of blocks) {
      const blockLivrables = livrablesByBlock.get(block.id) || []
      for (const l of blockLivrables) ids.push(l.id)
    }
    return ids
  }, [blocks, livrablesByBlock])

  const handleToggleSelect = useCallback(
    (id, { shiftKey } = {}) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        // Range shift+click : on coche/décoche tous les ids entre lastClickedId
        // et id (inclusif), en prenant l'état cible = !next.has(id).
        if (shiftKey && lastClickedId && lastClickedId !== id) {
          const fromIdx = flatLivrableIds.indexOf(lastClickedId)
          const toIdx = flatLivrableIds.indexOf(id)
          if (fromIdx >= 0 && toIdx >= 0) {
            const [start, end] =
              fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
            const rangeIds = flatLivrableIds.slice(start, end + 1)
            // Coche tous (cohérent avec le pattern "shift étend la sélection")
            for (const rid of rangeIds) next.add(rid)
            return next
          }
        }
        // Toggle simple
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      setLastClickedId(id)
    },
    [flatLivrableIds, lastClickedId],
  )

  const handleSelectBlock = useCallback((blockLivrableIds, allSelected) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        // Tous → on décoche tous
        for (const id of blockLivrableIds) next.delete(id)
      } else {
        // Aucun ou partiel → on coche tous
        for (const id of blockLivrableIds) next.add(id)
      }
      return next
    })
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setLastClickedId(null)
  }, [])

  // ─── LIV-16 — Highlight & scroll vers un livrable (chip "Prochain") ─────
  // Le chip header click déclenche : scroll smooth vers la ligne concernée +
  // flash bg orange ~1.5 s pour identifier le livrable en contexte. Ne pas
  // ouvrir le drawer (ça masquerait le contexte qu'on veut justement montrer).
  const [highlightedLivrableId, setHighlightedLivrableId] = useState(null)
  const highlightTimerRef = useRef(null)
  const handleHighlightLivrable = useCallback((livrable) => {
    const id = livrable?.id
    if (!id) return
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    setHighlightedLivrableId(id)
    // Scroll après le prochain frame pour laisser React rendre le DOM si la
    // ligne vient d'être révélée (changement de filtre, expand bloc...).
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-livrable-id="${id}"]`)
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedLivrableId(null)
      highlightTimerRef.current = null
    }, 1800)
  }, [])
  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    },
    [],
  )
  const prochainId = compteurs?.prochain?.id || null

  // ─── LIV-20 — Drawer Corbeille ──────────────────────────────────────────
  const [trashOpen, setTrashOpen] = useState(false)

  // ─── LIV-22 — Toggle Liste / Pipeline ──────────────────────────────────
  const [viewMode, setViewMode] = useState('list') // 'list' | 'pipeline'

  // Liste à plat de toutes les étapes de tous les livrables (pour Pipeline).
  // etapesByLivrable est une Map<livrableId, etape[]> issue de useLivrables.
  const allEtapes = useMemo(() => {
    if (!etapesByLivrable) return []
    const out = []
    for (const arr of etapesByLivrable.values()) out.push(...arr)
    return out
  }, [etapesByLivrable])

  // ─── Drawer details (LIV-8 versions + LIV-9 étapes) ──────────────────────
  // On garde l'id du livrable ouvert (pas l'objet) pour rester sync avec les
  // updates realtime / optimistic — on ré-extrait l'objet depuis blocks.
  // `initialTab` permet d'ouvrir le drawer directement sur Versions ou Étapes.
  const [detailsDrawerLivrableId, setDetailsDrawerLivrableId] = useState(null)
  const [detailsDrawerInitialTab, setDetailsDrawerInitialTab] = useState('versions')
  const detailsDrawerLivrable = useMemo(() => {
    if (!detailsDrawerLivrableId) return null
    for (const block of blocks) {
      const arr = livrablesByBlock?.get(block.id) || []
      const found = arr.find((l) => l.id === detailsDrawerLivrableId)
      if (found) return found
    }
    return null
  }, [detailsDrawerLivrableId, blocks, livrablesByBlock])
  const handleOpenVersions = useCallback((livrable) => {
    if (!livrable?.id) return
    setDetailsDrawerInitialTab('versions')
    setDetailsDrawerLivrableId(livrable.id)
  }, [])
  const handleOpenEtapes = useCallback((livrable) => {
    if (!livrable?.id) return
    setDetailsDrawerInitialTab('etapes')
    setDetailsDrawerLivrableId(livrable.id)
  }, [])
  const handleCloseDetailsDrawer = useCallback(() => {
    setDetailsDrawerLivrableId(null)
  }, [])

  // ─── Accès refusé ─────────────────────────────────────────────────────────
  if (!canRead) {
    return <AccessDenied />
  }

  // ─── Loading spinner plein écran (premier chargement) ─────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div
          className="w-6 h-6 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  // ─── Erreur fatale (fetch bundle) ─────────────────────────────────────────
  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div
          className="rounded-lg p-4 text-sm"
          style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
        >
          Erreur de chargement : {String(error?.message || error)}
        </div>
      </div>
    )
  }

  // ─── Rendu principal ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-full">
      <LivrablesHeader
        compteurs={compteurs}
        canEdit={canEdit}
        onCreateBlock={() => handleCreateBlock({ actions, nextSortOrder: blocks.length })}
        onOpenTrash={() => setTrashOpen(true)}
        filters={filters}
        onClearAllFilters={handleClearAllFilters}
        onToggleEnRetard={handleToggleEnRetard}
        onTogglePresetStatuts={handleTogglePresetStatuts}
        onHighlightLivrable={handleHighlightLivrable}
      />

      {/* Barre de filtres (LIV-15) — visible si au moins 1 bloc */}
      {blocks.length > 0 && (
        <LivrablesFilterBar
          filters={filters}
          onFiltersChange={handleFiltersChange}
          blocks={blocks}
          monteurs={monteursList}
          canFilterMes={Boolean(userId)}
        />
      )}

      {/* Toggle Liste / Pipeline (LIV-22) — visible si au moins 1 bloc */}
      {blocks.length > 0 && (
        <div
          className="px-4 sm:px-6 py-2 flex items-center gap-1"
          style={{
            background: 'var(--bg-surf)',
            borderBottom: '1px solid var(--brd)',
          }}
        >
          <span
            className="text-[10px] uppercase tracking-wider mr-2"
            style={{ color: 'var(--txt-3)' }}
          >
            Vue
          </span>
          <ViewToggle
            active={viewMode === 'list'}
            icon={ListIcon}
            label="Liste"
            onClick={() => setViewMode('list')}
          />
          <ViewToggle
            active={viewMode === 'pipeline'}
            icon={GanttChart}
            label="Pipeline"
            onClick={() => setViewMode('pipeline')}
          />
        </div>
      )}

      <div className="p-4 sm:p-6 flex-1">
        {blocks.length === 0 ? (
          <EmptyState
            canEdit={canEdit}
            onCreateBlock={() => handleCreateBlock({ actions, nextSortOrder: 0 })}
          />
        ) : viewMode === 'pipeline' ? (
          <LivrablePipelineView
            livrables={allLivrablesFlat}
            etapes={allEtapes}
            blocks={blocks}
            mode="ensemble"
            onEtapeClick={(etape) => {
              // Click sur une barre → ouvre le drawer Versions du livrable parent,
              // sur l'onglet Étapes (réutilisation existant LIV-9)
              if (!etape?.livrable_id) return
              setDetailsDrawerInitialTab('etapes')
              setDetailsDrawerLivrableId(etape.livrable_id)
            }}
          />
        ) : (
          <LivrableBlockList
            blocks={blocks}
            livrablesByBlock={filteredLivrablesByBlock}
            versionsByLivrable={versionsByLivrable}
            etapesByLivrable={etapesByLivrable}
            actions={actions}
            canEdit={canEdit}
            onOpenVersions={handleOpenVersions}
            onOpenEtapes={handleOpenEtapes}
            selectedIds={selectedIds}
            onToggleSelect={canEdit ? handleToggleSelect : undefined}
            onSelectBlock={canEdit ? handleSelectBlock : undefined}
            profiles={profiles}
            profilesById={profilesById}
            lots={lots}
            prochainId={prochainId}
            highlightedLivrableId={highlightedLivrableId}
          />
        )}
      </div>

      {/* Bandeau d'actions bulk (LIV-14) — apparaît si 1+ sélectionné */}
      <BulkActionBar
        selectedIds={selectedIds}
        actions={actions}
        onClearSelection={handleClearSelection}
      />

      {/* Drawer details (LIV-8 versions + LIV-9 étapes) */}
      <LivrableDetailsDrawer
        livrable={detailsDrawerLivrable}
        versions={
          detailsDrawerLivrable
            ? versionsByLivrable?.get(detailsDrawerLivrable.id) || []
            : []
        }
        etapes={
          detailsDrawerLivrable
            ? etapesByLivrable?.get(detailsDrawerLivrable.id) || []
            : []
        }
        eventTypes={eventTypes}
        actions={actions}
        canEdit={canEdit}
        onClose={handleCloseDetailsDrawer}
        initialTab={detailsDrawerInitialTab}
      />

      {/* Drawer Corbeille (LIV-20) — accessible aux users en édition seulement */}
      {canEdit && (
        <LivrablesTrashDrawer
          open={trashOpen}
          onClose={() => setTrashOpen(false)}
          actions={actions}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Handlers
// ════════════════════════════════════════════════════════════════════════════

async function handleCreateBlock({ actions, nextSortOrder }) {
  const nom = await prompt({
    title: 'Nouveau bloc de livrables',
    message:
      'Le bloc regroupe des livrables qui partagent un thème (ex : MASTER, AFTERMOVIE, SNACK CONTENT, …). Tu pourras ajouter un préfixe de numérotation plus tard.',
    placeholder: 'AFTERMOVIE / RÉCAP',
    confirmLabel: 'Créer le bloc',
    required: true,
  })
  if (!nom) return
  try {
    // Couleur par défaut : premier preset qui tourne sur le nombre de blocs.
    const color = LIVRABLE_BLOCK_COLOR_PRESETS[nextSortOrder % LIVRABLE_BLOCK_COLOR_PRESETS.length]
    await actions.createBlock({
      nom: nom.trim(),
      couleur: color,
      sort_order: nextSortOrder,
    })
    notify.success('Bloc créé')
  } catch (err) {
    notify.error('Création impossible : ' + (err?.message || err))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Sous-composants
// ════════════════════════════════════════════════════════════════════════════

// Statuts considérés "actifs" — preset du chip "Actifs" du header (LIV-16).
// Doit rester aligné avec `LIVRABLE_STATUTS_ACTIFS` (livrablesHelpers.js).
const HEADER_ACTIFS_PRESET = ['brief', 'en_cours', 'a_valider', 'valide']
const HEADER_LIVRES_PRESET = ['livre']

function LivrablesHeader({
  compteurs,
  canEdit,
  onCreateBlock,
  onOpenTrash,
  filters,
  onClearAllFilters,
  onToggleEnRetard,
  onTogglePresetStatuts,
  onHighlightLivrable,
}) {
  // Détection des presets actifs (filtre statuts === preset exact).
  const statuts = filters?.statuts || new Set()
  const isActifsActive =
    statuts.size === HEADER_ACTIFS_PRESET.length &&
    HEADER_ACTIFS_PRESET.every((k) => statuts.has(k))
  const isLivresActive =
    statuts.size === HEADER_LIVRES_PRESET.length &&
    HEADER_LIVRES_PRESET.every((k) => statuts.has(k))
  const isRetardActive = Boolean(filters?.enRetard)

  // Le chip "Total" se comporte comme un eraser : il efface tous les filtres
  // mais n'affiche pas d'état actif (c'est une action, pas un filtre).
  const stats = [
    {
      key: 'total',
      label: 'Total',
      value: compteurs.total,
      icon: CheckSquare,
      color: 'var(--txt-2)',
      bg: 'var(--bg-2)',
      onClick: onClearAllFilters,
      active: false,
      eraser: hasActiveFilter(filters),
    },
    {
      key: 'actifs',
      label: 'Actifs',
      value: compteurs.actifs,
      icon: Clock,
      color: 'var(--blue)',
      bg: 'var(--blue-bg)',
      onClick: () => onTogglePresetStatuts(HEADER_ACTIFS_PRESET),
      active: isActifsActive,
    },
    {
      key: 'retard',
      label: 'En retard',
      value: compteurs.enRetard,
      icon: AlertTriangle,
      color: compteurs.enRetard > 0 ? 'var(--red)' : 'var(--txt-3)',
      bg: 'var(--red-bg)',
      onClick: onToggleEnRetard,
      active: isRetardActive,
    },
    {
      key: 'livres',
      label: 'Livrés',
      value: compteurs.livres,
      icon: CheckCircle2,
      color: 'var(--green)',
      bg: 'var(--green-bg)',
      onClick: () => onTogglePresetStatuts(HEADER_LIVRES_PRESET),
      active: isLivresActive,
    },
  ]
  return (
    <div
      className="px-4 sm:px-6 py-4 border-b flex flex-col sm:flex-row sm:items-center gap-3"
      style={{ borderColor: 'var(--brd)', background: 'var(--bg-surf)' }}
    >
      {/* Titre */}
      <div className="flex items-center gap-3 shrink-0">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--green-bg)' }}
        >
          <CheckSquare className="w-5 h-5" style={{ color: 'var(--green)' }} />
        </div>
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
            Livrables
          </h1>
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            Post-production — versions, retours, deadlines
          </p>
        </div>
      </div>

      {/* Compteurs cliquables (LIV-16) */}
      <div className="flex items-center gap-2 sm:gap-3 sm:ml-6 overflow-x-auto">
        {stats.map((s) => {
          const Icon = s.icon
          const ActiveIcon = s.eraser ? Eraser : Icon
          const isInteractive = Boolean(s.onClick)
          return (
            <button
              key={s.key}
              type="button"
              onClick={s.onClick || undefined}
              disabled={!isInteractive}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg shrink-0 transition-colors"
              style={{
                background: s.active ? s.bg : 'var(--bg-elev)',
                border: `1px solid ${s.active ? s.color : 'transparent'}`,
                cursor: isInteractive ? 'pointer' : 'default',
              }}
              title={
                s.eraser
                  ? 'Effacer tous les filtres'
                  : s.active
                    ? `Désactiver le filtre ${s.label}`
                    : `Filtrer : ${s.label}`
              }
            >
              <ActiveIcon
                className="w-3.5 h-3.5"
                style={{ color: s.active || s.eraser ? s.color : s.color }}
              />
              <span
                className="text-xs font-semibold tabular-nums"
                style={{ color: s.active ? s.color : 'var(--txt)' }}
              >
                {s.value}
              </span>
              <span
                className="text-[11px]"
                style={{ color: s.active ? s.color : 'var(--txt-3)' }}
              >
                {s.label}
              </span>
            </button>
          )
        })}

        {/* Chip "Prochain" — livrable le plus proche dans le futur (LIV-16) */}
        <ProchainChip prochain={compteurs.prochain} onOpen={onHighlightLivrable} />
      </div>

      {/* CTA */}
      <div className="flex-1" />
      {canEdit && onOpenTrash && (
        <button
          type="button"
          onClick={onOpenTrash}
          aria-label="Corbeille"
          title="Corbeille — éléments supprimés"
          className="p-2 rounded-lg transition-colors shrink-0"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hov)'
            e.currentTarget.style.color = 'var(--txt)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onCreateBlock}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
          style={{ background: 'var(--green)', color: '#fff' }}
        >
          <Plus className="w-4 h-4" />
          Nouveau bloc
        </button>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ProchainChip — chip "prochain livrable à venir" (LIV-16)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche `numero · dateRelative` du livrable non terminé le plus proche dans
// le futur. Click → ouvre le drawer Versions de ce livrable. Si aucun livrable
// à venir → chip grisé "Aucun à venir" non cliquable.
// ════════════════════════════════════════════════════════════════════════════

function ProchainChip({ prochain, onOpen }) {
  const isEmpty = !prochain
  // Label = numero + nom si dispo (ex "2 MASTER"), sinon fallback nom ou numero seul.
  // Le chip n'est utile que s'il identifie sans ambiguïté le livrable.
  const numero = prochain?.numero?.toString().trim() || ''
  const nom = prochain?.nom?.toString().trim() || ''
  const label = numero && nom ? `${numero} ${nom}` : (nom || numero || 'Livrable')
  const relative = isEmpty ? 'Aucun à venir' : formatDateRelative(prochain.date_livraison)
  return (
    <button
      type="button"
      onClick={isEmpty ? undefined : () => onOpen?.(prochain)}
      disabled={isEmpty}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg shrink-0 transition-colors"
      style={{
        background: isEmpty ? 'var(--bg-elev)' : 'var(--orange-bg)',
        border: `1px solid ${isEmpty ? 'transparent' : 'var(--orange)'}`,
        cursor: isEmpty ? 'default' : 'pointer',
        maxWidth: 260,
      }}
      title={isEmpty ? 'Aucun livrable à venir' : `Prochain : ${label} — ${relative}`}
    >
      <ArrowRight
        className="w-3.5 h-3.5 shrink-0"
        style={{ color: isEmpty ? 'var(--txt-3)' : 'var(--orange)' }}
      />
      <span className="flex flex-col items-start min-w-0">
        <span
          className="text-[10px] uppercase tracking-wider leading-none"
          style={{ color: isEmpty ? 'var(--txt-3)' : 'var(--orange)' }}
        >
          Prochain
        </span>
        <span
          className="text-xs font-semibold truncate max-w-[210px]"
          style={{ color: isEmpty ? 'var(--txt-3)' : 'var(--txt)' }}
        >
          {isEmpty ? relative : `${label} · ${relative}`}
        </span>
      </span>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ViewToggle — chip Liste / Pipeline (LIV-22)
// ════════════════════════════════════════════════════════════════════════════

function ViewToggle({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg shrink-0 transition-colors"
      style={{
        background: active ? 'var(--blue-bg)' : 'transparent',
        color: active ? 'var(--blue)' : 'var(--txt-2)',
        border: `1px solid ${active ? 'var(--blue)' : 'var(--brd-sub)'}`,
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  )
}

function EmptyState({ canEdit, onCreateBlock }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: 'var(--green-bg)' }}
      >
        <Inbox className="w-7 h-7" style={{ color: 'var(--green)' }} />
      </div>
      <h2
        className="text-base font-semibold mb-1"
        style={{ color: 'var(--txt)' }}
      >
        Aucun bloc de livrables
      </h2>
      <p
        className="text-sm mb-5 max-w-md"
        style={{ color: 'var(--txt-3)' }}
      >
        Les livrables sont regroupés par blocs thématiques (ex : AFTERMOVIE,
        SNACK CONTENT). Crée ton premier bloc pour commencer.
      </p>
      {canEdit ? (
        <button
          type="button"
          onClick={onCreateBlock}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
          style={{ background: 'var(--green)', color: '#fff' }}
        >
          <Plus className="w-4 h-4" />
          Créer un bloc
        </button>
      ) : (
        <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
          Tu es en lecture seule sur cet outil.
        </p>
      )}
    </div>
  )
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: 'var(--bg-2)' }}
      >
        <Lock className="w-7 h-7" style={{ color: 'var(--txt-3)' }} />
      </div>
      <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--txt)' }}>
        Accès restreint
      </h2>
      <p className="text-sm max-w-md" style={{ color: 'var(--txt-3)' }}>
        Tu n&apos;as pas les permissions pour consulter les livrables de ce projet.
        Demande l&apos;accès à un administrateur.
      </p>
    </div>
  )
}
