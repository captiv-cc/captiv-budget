// ════════════════════════════════════════════════════════════════════════════
// PlansTab — onglet Plans : sub-nav Plans éditables | Fichiers | Carte du site
// ════════════════════════════════════════════════════════════════════════════
//
// Réorganisation 2026-07-07 (décision Hugo) : le module porte TROIS métiers
// de même rang —
//   - Plans éditables : plans dessinés dans le canvas tldraw collaboratif
//     (PlansCanvasList + PlanEditor, tables plans_canvas*). Les archivés
//     sont un TOGGLE de cette vue, pas un sous-onglet.
//   - Fichiers : la bibliothèque de fichiers du projet (plans de salle,
//     dossiers techniques… — tables plans/plan_versions), avec viewer,
//     partage public et export ZIP. « Servir de fond » à un plan éditable
//     n'est qu'un usage parmi d'autres.
//   - Carte du site : géoréférencement satellite + points/zones (mobile).
//
// URL state :
//   ?vue=editables|fichiers|carte — sous-onglet actif. Compat : les anciens
//     ?vue=fonds|archives sont mappés. Sans ?vue, on atterrit sur le dernier
//     sous-onglet visité (localStorage par projet), sauf deep-link ?plan=
//     (viewer de fichiers) → fichiers.
//   ?canvas=<id> — ouvre l'éditeur canvas plein écran.
// ════════════════════════════════════════════════════════════════════════════

import { Suspense, lazy, useState } from 'react'
import { useSearchParams, useParams } from 'react-router-dom'
import { FileUp, PenTool, Archive, Loader2, Map as MapIcon } from 'lucide-react'
import PlansFondsView from './PlansFondsView'
import PlansCanvasList from '../../features/plans/canvas/PlansCanvasList'
import LieuCarteView from '../../features/lieux/LieuCarteView'
import usePlans from '../../hooks/usePlans'
import { useProjet } from '../ProjetLayout'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'

// tldraw pèse lourd : chargé uniquement à l'ouverture d'un plan éditable.
const PlanEditor = lazy(() => import('../../features/plans/canvas/PlanEditor'))

const OUTIL_KEY = 'plans'

const VUES = [
  { key: 'editables', label: 'Plans éditables', icon: PenTool },
  { key: 'fichiers', label: 'Fichiers', icon: FileUp },
  { key: 'carte', label: 'Carte du site', icon: MapIcon },
]

// Anciennes valeurs d'URL (liens sauvegardés, notifs…).
const LEGACY_VUES = { fonds: 'fichiers', archives: 'editables' }

const vueStorageKey = (projectId) => `plans-vue:${projectId}`

export default function PlansTab() {
  const { id: projectId } = useParams()
  const { org } = useAuth()
  const orgId = org?.id
  const { can } = useProjectPermissions(projectId)
  const canEdit = can(OUTIL_KEY, 'edit')

  const [searchParams, setSearchParams] = useSearchParams()
  const canvasId = searchParams.get('canvas')

  // Archivés (plans éditables) : toggle de la vue, plus un sous-onglet.
  // L'ancien ?vue=archives atterrit sur Éditables avec le toggle actif.
  const [showArchived, setShowArchived] = useState(
    () => searchParams.get('vue') === 'archives',
  )

  // Sous-onglet actif : URL (avec compat) > deep-link fichier > dernier
  // visité (localStorage) > éditables.
  const rawVue = searchParams.get('vue')
  const fromUrl = LEGACY_VUES[rawVue] || (VUES.some((v) => v.key === rawVue) ? rawVue : null)
  let stored = null
  try {
    stored = localStorage.getItem(vueStorageKey(projectId))
  } catch {
    /* noop */
  }
  const vue =
    fromUrl ||
    (searchParams.get('plan') ? 'fichiers' : null) ||
    (VUES.some((v) => v.key === stored) ? stored : 'editables')

  function setVue(next) {
    try {
      localStorage.setItem(vueStorageKey(projectId), next)
    } catch {
      /* noop */
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('vue', next)
        p.delete('canvas')
        return p
      },
      { replace: true },
    )
  }

  function openCanvas(id) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('canvas', id)
      return p
    })
  }

  function closeCanvas() {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete('canvas')
        return p
      },
      { replace: true },
    )
  }

  return (
    <>
      {/* Sub-nav */}
      <div className="px-4 sm:px-6 pt-4 flex items-center justify-between gap-2 flex-wrap">
        <div
          className="inline-flex items-center gap-0.5 p-0.5 rounded-lg"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
        >
          {VUES.map(({ key, label, icon: Icon }) => {
            const active = vue === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setVue(key)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
                style={{
                  background: active ? 'var(--bg-hov)' : 'transparent',
                  color: active ? 'var(--txt)' : 'var(--txt-3)',
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>

        {/* Archivés : état des plans éditables, pas un métier → toggle. */}
        {vue === 'editables' && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: showArchived ? 'var(--bg-hov)' : 'transparent',
              color: showArchived ? 'var(--txt)' : 'var(--txt-3)',
              border: '1px solid var(--brd)',
            }}
            title={showArchived ? 'Revenir aux plans actifs' : 'Voir les plans archivés'}
          >
            <Archive className="w-3.5 h-3.5" />
            {showArchived ? 'Retour aux actifs' : 'Archivés'}
          </button>
        )}
      </div>

      {vue === 'fichiers' ? (
        <PlansFondsView />
      ) : vue === 'carte' ? (
        <CarteDuSite projectId={projectId} orgId={orgId} canEdit={canEdit} />
      ) : (
        <div className="px-4 sm:px-6 py-4">
          <PlansCanvasList
            projectId={projectId}
            orgId={orgId}
            canEdit={canEdit}
            archived={showArchived}
            onOpen={openCanvas}
          />
        </div>
      )}

      {/* Éditeur canvas plein écran (chunk séparé) */}
      {canvasId && (
        <Suspense
          fallback={
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center gap-2 text-sm"
              style={{ background: 'var(--bg)', color: 'var(--txt-3)' }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Chargement de l’éditeur…
            </div>
          }
        >
          <PlanEditor canvasId={canvasId} onClose={closeCanvas} readOnly={!canEdit} />
        </Suspense>
      )}
    </>
  )
}

// ─── Carte du site : entrée de premier rang ─────────────────────────────────
// LieuCarteView a besoin du projet (centrage) et des FICHIERS (le plan calé
// sur le satellite est un fichier de la bibliothèque).
function CarteDuSite({ projectId, orgId, canEdit }) {
  const ctx = useProjet()
  const { plans, loading } = usePlans({ projectId, orgId })
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--txt-3)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Chargement de la carte…
      </div>
    )
  }
  return (
    <LieuCarteView projectId={projectId} project={ctx?.project} plans={plans} canEdit={canEdit} />
  )
}
