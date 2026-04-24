// ════════════════════════════════════════════════════════════════════════════
// LivrablesTab — Page "Livrables" d'un projet (LIV-5 → LIV-6)
// ════════════════════════════════════════════════════════════════════════════
//
// Point d'entrée de l'outil Livrables. Orchestre :
//   - le hook `useLivrables(projectId)` qui porte tout l'état
//   - les permissions via `useProjectPermissions` (gate read + edit)
//   - un header local (compteurs basiques + CTA "Nouveau bloc")
//   - la liste des blocs via `LivrableBlockList` (drag & drop + CRUD via LIV-6)
//   - empty state propre quand 0 bloc
//   - loading state
//
// LIV-5 a posé la plomberie. LIV-6 a extrait `LivrableBlockCard` + ajouté le
// CRUD blocs (rename inline, couleur, préfixe, delete + undo, drag & drop).
// Le rendu détaillé des livrables (tableau, inline edit) arrive à LIV-7.
//
// Gating :
//   - `canRead` → on tombe sur un écran "accès restreint" si false
//   - `canEdit` → les CTA de mutation sont masqués si false (mode lecture)
// ════════════════════════════════════════════════════════════════════════════

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
import LivrableBlockList from '../../features/livrables/components/LivrableBlockList'

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
    compteurs,
    actions,
  } = useLivrables(canRead ? projectId : null)

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
            actions={actions}
            canEdit={canEdit}
          />
        )}
      </div>
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
