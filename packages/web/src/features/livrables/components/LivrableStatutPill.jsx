// ════════════════════════════════════════════════════════════════════════════
// LivrableStatutPill — pill cliquable + popover de choix (LIV-7)
// ════════════════════════════════════════════════════════════════════════════
//
// Rend la pastille de statut d'un livrable (brief / en_cours / a_valider /
// valide / livre / archive) et, au click, un popover avec les 6 choix. On
// réutilise `LIVRABLE_STATUTS` de livrablesHelpers pour les libellés + couleurs.
//
// Le popover est rendu via `PopoverFloat` (createPortal + position: fixed)
// pour éviter d'être clippé par les ancêtres `overflow-x-auto` (table
// desktop des livrables, cf. fix polish LIV-7).
//
// Props :
//   - value     : clé statut ('brief' | 'en_cours' | ...)
//   - onChange  : (nextKey) => Promise|void
//   - canEdit   : booléen (pill non cliquable si false)
//   - size      : 'xs' | 'sm' (défaut 'sm')
//   - align     : 'left' | 'right' (défaut 'left')
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { LIVRABLE_STATUTS } from '../../../lib/livrablesHelpers'
import PopoverFloat from './PopoverFloat'

const STATUT_ORDER = ['brief', 'en_cours', 'a_valider', 'valide', 'livre', 'archive']

export default function LivrableStatutPill({
  value,
  onChange,
  canEdit = true,
  size = 'sm',
  align = 'left',
}) {
  const statut = LIVRABLE_STATUTS[value] || LIVRABLE_STATUTS.brief
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
        title={canEdit ? 'Changer le statut' : statut.label}
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
            minWidth: '160px',
          }}
        >
          {STATUT_ORDER.map((key) => {
            const s = LIVRABLE_STATUTS[key]
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
