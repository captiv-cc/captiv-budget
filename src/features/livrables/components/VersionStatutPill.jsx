// ════════════════════════════════════════════════════════════════════════════
// VersionStatutPill — pill cliquable + popover des 4 statuts version (LIV-8)
// ════════════════════════════════════════════════════════════════════════════
//
// Pendant de `LivrableStatutPill` mais pour le statut d'une version envoyée
// au client (`livrable_versions.statut_validation`). Les 4 statuts sont :
//   en_attente / retours_a_integrer / valide / rejete
//
// On réutilise `PopoverFloat` (createPortal + position:fixed) pour échapper à
// d'éventuels ancêtres `overflow:auto`.
//
// Props :
//   - value     : clé statut ('en_attente' | 'retours_a_integrer' | 'valide' | 'rejete')
//   - onChange  : (nextKey) => Promise|void
//   - canEdit   : booléen
//   - size      : 'xs' | 'sm' (défaut 'sm')
//   - align     : 'left' | 'right' (défaut 'left')
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { LIVRABLE_VERSION_STATUTS } from '../../../lib/livrablesHelpers'
import PopoverFloat from './PopoverFloat'

const STATUT_ORDER = ['en_attente', 'retours_a_integrer', 'valide', 'rejete']

export default function VersionStatutPill({
  value,
  onChange,
  canEdit = true,
  size = 'sm',
  align = 'left',
}) {
  const statut = LIVRABLE_VERSION_STATUTS[value] || LIVRABLE_VERSION_STATUTS.en_attente
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)

  const handlePick = useCallback(
    async (nextKey) => {
      setOpen(false)
      if (nextKey === value) return
      try {
        await onChange?.(nextKey)
      } catch {
        // l'appelant notifie
      }
    },
    [onChange, value],
  )

  const padding = size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => canEdit && setOpen((o) => !o)}
        disabled={!canEdit}
        className={`${padding} rounded-full font-medium whitespace-nowrap transition-opacity`}
        style={{
          background: statut.bg,
          color: statut.color,
          cursor: canEdit ? 'pointer' : 'default',
          opacity: canEdit ? 1 : 0.85,
        }}
        title={canEdit ? 'Changer le statut de la version' : statut.label}
      >
        {statut.label}
      </button>
      <PopoverFloat
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        align={align}
      >
        <div
          className="rounded-lg shadow-lg overflow-hidden"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            minWidth: '180px',
          }}
        >
          {STATUT_ORDER.map((key) => {
            const s = LIVRABLE_VERSION_STATUTS[key]
            const active = key === value
            return (
              <button
                key={key}
                type="button"
                onClick={() => handlePick(key)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{
                  background: active ? 'var(--bg-hov)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--bg-hov)'
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span
                  className="px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0"
                  style={{ background: s.bg, color: s.color }}
                >
                  {s.label}
                </span>
                {active && (
                  <Check
                    className="w-3.5 h-3.5 ml-auto shrink-0"
                    style={{ color: 'var(--txt-3)' }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </PopoverFloat>
    </>
  )
}
