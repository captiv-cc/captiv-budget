// ════════════════════════════════════════════════════════════════════════════
// LivrablesTrashDrawer — Corbeille livrables (LIV-20)
// ════════════════════════════════════════════════════════════════════════════
//
// Drawer side-right qui liste les éléments soft-deleted dans les 30 derniers
// jours d'un projet, en 4 sections : Blocs / Livrables / Versions / Étapes.
// Chaque ligne a 2 actions :
//   - Restaurer (deleted_at = null)
//   - Supprimer définitivement (DELETE — confirm avant)
//
// Pas de "Tout restaurer" (cf. choix UX LIV-20). Pas de versions/étapes des
// livrables non chargés en RAM — on requête via `actions.fetchTrash`.
//
// Props :
//   - open      : bool
//   - onClose   : () => void
//   - actions   : objet actions du hook useLivrables
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Box,
  CheckSquare,
  History,
  ListTodo,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { confirm } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'

// Format date courte (JJ/MM HH:mm) pour l'horodatage de suppression.
function fmtDeletedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${mi}`
}

// Format relatif compact ("il y a 3 j", "il y a 2 sem.") cohérent avec
// le widget LIV-17 — sans dépendre de formatDateRelative qui est plus complet.
function fmtRelative(iso, now = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Math.round((now.getTime() - d.getTime()) / 86400000)
  if (diff <= 0) return "Aujourd'hui"
  if (diff === 1) return 'Hier'
  if (diff < 7) return `il y a ${diff} j`
  return `il y a ${Math.round(diff / 7)} sem.`
}

export default function LivrablesTrashDrawer({ open, onClose, actions }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [trash, setTrash] = useState({
    blocks: [],
    livrables: [],
    versions: [],
    etapes: [],
  })

  const reload = useCallback(async () => {
    if (!actions?.fetchTrash) return
    setLoading(true)
    setError(null)
    try {
      const data = await actions.fetchTrash()
      setTrash(data || { blocks: [], livrables: [], versions: [], etapes: [] })
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [actions])

  useEffect(() => {
    if (open) reload()
  }, [open, reload])

  // ─── Handlers : restore + purge ─────────────────────────────────────────
  const handleRestore = useCallback(
    async (kind, id) => {
      try {
        switch (kind) {
          case 'block':
            await actions.restoreBlock(id)
            break
          case 'livrable':
            await actions.restoreLivrable(id)
            break
          case 'version':
            await actions.restoreVersion(id)
            break
          case 'etape':
            await actions.restoreEtape(id)
            break
          default:
            return
        }
        notify.success('Restauré')
        reload()
      } catch (err) {
        notify.error('Erreur restauration : ' + (err?.message || err))
      }
    },
    [actions, reload],
  )

  const handlePurge = useCallback(
    async (kind, id, label) => {
      const ok = await confirm({
        title: 'Supprimer définitivement ?',
        message: `« ${label} » sera supprimé définitivement et ne pourra plus être restauré.`,
        confirmLabel: 'Supprimer définitivement',
        danger: true,
      })
      if (!ok) return
      try {
        switch (kind) {
          case 'block':
            await actions.purgeBlock(id)
            break
          case 'livrable':
            await actions.purgeLivrable(id)
            break
          case 'version':
            await actions.purgeVersion(id)
            break
          case 'etape':
            await actions.purgeEtape(id)
            break
          default:
            return
        }
        notify.success('Supprimé définitivement')
        reload()
      } catch (err) {
        notify.error('Erreur suppression : ' + (err?.message || err))
      }
    },
    [actions, reload],
  )

  if (!open) return null

  const totalCount =
    trash.blocks.length +
    trash.livrables.length +
    trash.versions.length +
    trash.etapes.length
  const hasContent = totalCount > 0

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className="fixed top-0 right-0 h-full w-full sm:w-[480px] z-50 flex flex-col shadow-2xl"
        style={{ background: 'var(--bg-surf)', borderLeft: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--brd)' }}
        >
          <Trash2 className="w-5 h-5" style={{ color: 'var(--txt-2)' }} />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
              Corbeille
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              Éléments supprimés depuis 30 jours
              {hasContent && (
                <span className="ml-1 font-mono">
                  ({totalCount})
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded transition-colors"
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
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div
                className="w-5 h-5 border-2 rounded-full animate-spin"
                style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }}
              />
            </div>
          ) : error ? (
            <div className="p-5">
              <div
                className="flex items-start gap-2 p-3 rounded-lg text-xs"
                style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Erreur de chargement : {String(error?.message || error)}</span>
              </div>
            </div>
          ) : !hasContent ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6">
              <Trash2 className="w-10 h-10 mb-3" style={{ color: 'var(--txt-3)' }} />
              <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
                Corbeille vide
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
                Rien n&apos;a été supprimé dans les 30 derniers jours.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              <TrashSection
                title="Blocs"
                icon={Box}
                items={trash.blocks}
                renderLabel={(b) => b.nom || 'Sans nom'}
                onRestore={(it) => handleRestore('block', it.id)}
                onPurge={(it) => handlePurge('block', it.id, it.nom || 'Bloc')}
              />
              <TrashSection
                title="Livrables"
                icon={CheckSquare}
                items={trash.livrables}
                renderLabel={(l) =>
                  [l.numero, l.nom].filter(Boolean).join(' · ') || 'Sans nom'
                }
                onRestore={(it) => handleRestore('livrable', it.id)}
                onPurge={(it) =>
                  handlePurge(
                    'livrable',
                    it.id,
                    [it.numero, it.nom].filter(Boolean).join(' · ') || 'Livrable',
                  )
                }
              />
              <TrashSection
                title="Versions"
                icon={History}
                items={trash.versions}
                renderLabel={(v) =>
                  v.numero_label || v.statut_validation || 'Version'
                }
                onRestore={(it) => handleRestore('version', it.id)}
                onPurge={(it) =>
                  handlePurge('version', it.id, it.numero_label || 'Version')
                }
              />
              <TrashSection
                title="Étapes"
                icon={ListTodo}
                items={trash.etapes}
                renderLabel={(e) => e.kind || 'Étape'}
                onRestore={(it) => handleRestore('etape', it.id)}
                onPurge={(it) => handlePurge('etape', it.id, it.kind || 'Étape')}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TrashSection — section avec titre + liste d'items
// ════════════════════════════════════════════════════════════════════════════

function TrashSection({ title, icon: Icon, items, renderLabel, onRestore, onPurge }) {
  if (!items || items.length === 0) return null
  return (
    <div style={{ borderBottom: '1px solid var(--brd-sub)' }}>
      <div
        className="flex items-center gap-2 px-5 py-3"
        style={{ background: 'var(--bg-elev)' }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
        <span
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--txt-2)' }}
        >
          {title}
        </span>
        <span
          className="text-[10px] font-mono ml-auto px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-2)', color: 'var(--txt-3)' }}
        >
          {items.length}
        </span>
      </div>
      <div>
        {items.map((it, idx) => (
          <TrashRow
            key={`${it.id}-${idx}`}
            label={renderLabel(it)}
            deletedAt={it.deleted_at}
            onRestore={() => onRestore(it)}
            onPurge={() => onPurge(it)}
            first={idx === 0}
          />
        ))}
      </div>
    </div>
  )
}

function TrashRow({ label, deletedAt, onRestore, onPurge, first }) {
  return (
    <div
      className="flex items-center gap-3 px-5 py-2.5 group"
      style={{ borderTop: first ? 'none' : '1px solid var(--brd-sub)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs truncate" style={{ color: 'var(--txt)' }}>
          {label}
        </p>
        <p
          className="text-[10px]"
          style={{ color: 'var(--txt-3)' }}
          title={fmtDeletedAt(deletedAt)}
        >
          {fmtRelative(deletedAt)}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onRestore}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors"
          style={{ color: 'var(--green)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--green-bg)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
          title="Restaurer"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Restaurer</span>
        </button>
        <button
          type="button"
          onClick={onPurge}
          className="p-1.5 rounded transition-colors"
          style={{ color: 'var(--red)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--red-bg)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
          title="Supprimer définitivement"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
