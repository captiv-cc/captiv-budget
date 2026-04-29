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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  CheckSquare,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  Inbox,
} from 'lucide-react'
import { useLivrables } from '../../hooks/useLivrables'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import { prompt } from '../../lib/confirm'
import { notify } from '../../lib/notify'
import { LIVRABLE_BLOCK_COLOR_PRESETS } from '../../lib/livrablesHelpers'
import { listEventTypes } from '../../lib/planning'
import LivrableBlockList from '../../features/livrables/components/LivrableBlockList'
import LivrableDetailsDrawer from '../../features/livrables/components/LivrableDetailsDrawer'
import BulkActionBar from '../../features/livrables/components/BulkActionBar'

const OUTIL_KEY = 'livrables'

export default function LivrablesTab() {
  const { id: projectId } = useParams()
  const { can } = useProjectPermissions(projectId)
  const canRead = can(OUTIL_KEY, 'read')
  const canEdit = can(OUTIL_KEY, 'edit')

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
      />

      <div className="p-4 sm:p-6 flex-1">
        {blocks.length === 0 ? (
          <EmptyState
            canEdit={canEdit}
            onCreateBlock={() => handleCreateBlock({ actions, nextSortOrder: 0 })}
          />
        ) : (
          <LivrableBlockList
            blocks={blocks}
            livrablesByBlock={livrablesByBlock}
            versionsByLivrable={versionsByLivrable}
            etapesByLivrable={etapesByLivrable}
            actions={actions}
            canEdit={canEdit}
            onOpenVersions={handleOpenVersions}
            onOpenEtapes={handleOpenEtapes}
            selectedIds={selectedIds}
            onToggleSelect={canEdit ? handleToggleSelect : undefined}
            onSelectBlock={canEdit ? handleSelectBlock : undefined}
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

function LivrablesHeader({ compteurs, canEdit, onCreateBlock }) {
  const stats = [
    { key: 'total', label: 'Total', value: compteurs.total, icon: CheckSquare, color: 'var(--txt-2)' },
    { key: 'actifs', label: 'Actifs', value: compteurs.actifs, icon: Clock, color: 'var(--blue)' },
    {
      key: 'retard',
      label: 'En retard',
      value: compteurs.enRetard,
      icon: AlertTriangle,
      color: compteurs.enRetard > 0 ? 'var(--red)' : 'var(--txt-3)',
    },
    { key: 'livres', label: 'Livrés', value: compteurs.livres, icon: CheckCircle2, color: 'var(--green)' },
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

      {/* Compteurs */}
      <div className="flex items-center gap-2 sm:gap-3 sm:ml-6 overflow-x-auto">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <div
              key={s.key}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg shrink-0"
              style={{ background: 'var(--bg-elev)' }}
              title={s.label}
            >
              <Icon className="w-3.5 h-3.5" style={{ color: s.color }} />
              <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--txt)' }}>
                {s.value}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                {s.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* CTA */}
      <div className="flex-1" />
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
