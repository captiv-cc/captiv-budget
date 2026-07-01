// ════════════════════════════════════════════════════════════════════════════
// DevisHistoryPanel — drawer "Historique des changements" (R4)
// ════════════════════════════════════════════════════════════════════════════
//
// Panneau latéral droit listant le journal d'audit du devis (qui a modifié
// quoi, quand). Données : useDevisHistory (chargement lazy + realtime).
// Rendu humain : lib/devisAuditFormat. Couleur d'acteur cohérente avec la
// présence (colorFromUserId).
// ════════════════════════════════════════════════════════════════════════════

import { X, History, ArrowRight } from 'lucide-react'
import { useDevisHistory } from '../useDevisHistory'
import { colorFromUserId } from '../../../hooks/useProjectPresence'
import { formatChanges, describeEntry, relativeTime } from '../../../lib/devisAuditFormat'

function initials(name) {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

export default function DevisHistoryPanel({ open, onClose, devisId, catNameById, onJumpToLine }) {
  const { entries, loading } = useDevisHistory({ devisId, enabled: open })
  if (!open) return null

  return (
    <aside
      className="absolute top-0 right-0 h-full z-30 flex flex-col"
      style={{
        width: 'min(380px, 90vw)',
        background: 'var(--bg-surf)',
        borderLeft: '1px solid var(--brd)',
        boxShadow: '-8px 0 24px rgba(0,0,0,.25)',
      }}
    >
      {/* En-tête */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--brd)' }}
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          <span className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
            Historique
          </span>
        </div>
        <button onClick={onClose} className="btn-ghost btn-sm" title="Fermer">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-xs" style={{ color: 'var(--txt-3)' }}>
            Chargement…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="p-4 text-xs" style={{ color: 'var(--txt-3)' }}>
            Aucune modification enregistrée pour l&apos;instant.
          </div>
        )}
        {entries.map((e) => {
          const color = colorFromUserId(e.actor_id)
          const diffs = e.op === 'UPDATE' ? formatChanges(e.changes, catNameById) : []
          // On ne peut sauter que vers une ligne existante (pas supprimée).
          const jumpable = e.entity === 'line' && e.entity_id && e.op !== 'DELETE' && onJumpToLine
          return (
            <div
              key={e.id}
              className={`px-4 py-2.5 flex gap-2.5${jumpable ? ' cursor-pointer hist-row' : ''}`}
              style={{ borderBottom: '1px solid var(--brd)' }}
              onClick={jumpable ? () => onJumpToLine(e.entity_id) : undefined}
              title={jumpable ? 'Aller à la ligne' : undefined}
            >
              {/* Avatar initiales coloré */}
              <span
                className="shrink-0 inline-flex items-center justify-center rounded-full text-[10px] font-bold"
                style={{ width: 24, height: 24, background: color + '22', color, marginTop: 1 }}
                title={e.actor_name || 'Utilisateur inconnu'}
              >
                {initials(e.actor_name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs leading-snug" style={{ color: 'var(--txt-2)' }}>
                  <span className="font-semibold" style={{ color: 'var(--txt)' }}>
                    {e.actor_name || 'Quelqu’un'}
                  </span>{' '}
                  {describeEntry(e)}
                </div>
                {/* Détail des champs modifiés */}
                {diffs.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {diffs.map((d, i) => (
                      <div
                        key={i}
                        className="text-[11px] flex items-center gap-1 flex-wrap"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        <span className="font-medium" style={{ color: 'var(--txt-2)' }}>
                          {d.label}
                        </span>
                        <span className="tabular-nums">{d.old}</span>
                        <ArrowRight className="w-3 h-3 shrink-0" style={{ opacity: 0.6 }} />
                        <span className="tabular-nums" style={{ color: 'var(--txt)' }}>
                          {d.new}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                  {relativeTime(e.created_at)}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
