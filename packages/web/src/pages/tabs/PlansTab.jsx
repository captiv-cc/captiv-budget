// ════════════════════════════════════════════════════════════════════════════
// PlansTab — onglet Plans : sub-nav Éditables | Fonds importés | Archivés
// ════════════════════════════════════════════════════════════════════════════
//
// Chantier PLAN (docs/CHANTIER_PLANS.md) : l'onglet devient le point d'entrée
// de deux mondes :
//   - Éditables : plans dessinés dans le canvas tldraw collaboratif
//     (PlansCanvasList + PlanEditor, tables plans_canvas*).
//   - Fonds importés : la bibliothèque de fichiers existante, inchangée
//     (PlansFondsView = ex-PlansTab, tables plans/plan_versions).
//   - Archivés : plans éditables archivés (restaurer / supprimer).
//
// URL state :
//   ?vue=editables|fonds|archives — sous-onglet actif (défaut : editables,
//     sauf si ?plan= présent → fonds, pour ne pas casser les deep-links du
//     viewer de fichiers existant).
//   ?canvas=<id> — ouvre l'éditeur canvas plein écran.
// ════════════════════════════════════════════════════════════════════════════

import { Suspense, lazy } from 'react'
import { useSearchParams, useParams } from 'react-router-dom'
import { FileUp, PenTool, Archive, Loader2 } from 'lucide-react'
import PlansFondsView from './PlansFondsView'
import PlansCanvasList from '../../features/plans/canvas/PlansCanvasList'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'

// tldraw pèse lourd : chargé uniquement à l'ouverture d'un plan éditable.
const PlanEditor = lazy(() => import('../../features/plans/canvas/PlanEditor'))

const OUTIL_KEY = 'plans'

const VUES = [
  { key: 'editables', label: 'Éditables', icon: PenTool },
  { key: 'fonds', label: 'Fonds importés', icon: FileUp },
  { key: 'archives', label: 'Archivés', icon: Archive },
]

export default function PlansTab() {
  const { id: projectId } = useParams()
  const { org } = useAuth()
  const orgId = org?.id
  const { can } = useProjectPermissions(projectId)
  const canEdit = can(OUTIL_KEY, 'edit')

  const [searchParams, setSearchParams] = useSearchParams()
  const canvasId = searchParams.get('canvas')

  // Deep-links viewer fichiers (?plan=) → sous-onglet fonds.
  const vue = searchParams.get('vue') || (searchParams.get('plan') ? 'fonds' : 'editables')

  function setVue(next) {
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
      <div className="px-4 sm:px-6 pt-4">
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
      </div>

      {vue === 'fonds' ? (
        <PlansFondsView />
      ) : (
        <div className="px-4 sm:px-6 py-4">
          <PlansCanvasList
            projectId={projectId}
            orgId={orgId}
            canEdit={canEdit}
            archived={vue === 'archives'}
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
          <PlanEditor canvasId={canvasId} onClose={closeCanvas} />
        </Suspense>
      )}
    </>
  )
}
