// ════════════════════════════════════════════════════════════════════════════
// FormatSelect — dropdown des ratios de format livrable
// ════════════════════════════════════════════════════════════════════════════
//
// Dropdown affichant les presets `LIVRABLE_FORMATS` (16:9, 9:16, 1:1, 4:5,
// 5:4, 4:3) + un choix "Autre…" qui bascule sur un input texte libre.
// Une fois saisi, le format reste libre — ce composant le ré-affichera dans
// la cellule mais ne le remettra pas dans la liste des presets.
//
// Pattern popover : utilise `PopoverFloat` pour échapper aux ancêtres
// `overflow-x-auto` (table desktop).
//
// Props :
//   - value      : string|null (format actuel — peut être un preset ou texte libre)
//   - onChange   : (next: string|null) => Promise|void
//   - canEdit    : booléen
//   - size       : 'xs' | 'sm' (défaut 'sm')
//   - placeholder: string affiché si vide & canEdit (défaut '—')
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { LIVRABLE_FORMATS } from '../../../lib/livrablesHelpers'
import PopoverFloat from './PopoverFloat'

export default function FormatSelect({
  value,
  onChange,
  canEdit = true,
  size = 'sm',
  placeholder = '—',
}) {
  const [open, setOpen] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [customValue, setCustomValue] = useState(value || '')
  const anchorRef = useRef(null)

  const isPreset = value && LIVRABLE_FORMATS.includes(value)
  const display = value || placeholder

  const close = useCallback(() => {
    setOpen(false)
    setCustomMode(false)
  }, [])

  const handlePick = useCallback(
    async (next) => {
      close()
      if (next === value) return
      try {
        await onChange?.(next)
      } catch {
        /* l'appelant notifie */
      }
    },
    [close, onChange, value],
  )

  const handleCustomCommit = useCallback(async () => {
    const next = (customValue || '').trim()
    close()
    if (next === (value || '')) return
    try {
      await onChange?.(next || null)
    } catch {
      /* idem */
    }
  }, [close, customValue, onChange, value])

  const txtSize = size === 'xs' ? 'text-[11px]' : 'text-xs'
  const padY = size === 'xs' ? 'py-0.5' : 'py-1'

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        onClick={() => {
          if (!canEdit) return
          if (open) {
            close()
          } else {
            setCustomValue(value && !isPreset ? value : '')
            setCustomMode(false)
            setOpen(true)
          }
        }}
        disabled={!canEdit}
        className={`w-full flex items-center justify-between gap-1 ${txtSize} ${padY} rounded text-left`}
        style={{
          color: value ? 'var(--txt-2)' : 'var(--txt-3)',
          cursor: canEdit ? 'pointer' : 'default',
        }}
        title={canEdit ? 'Choisir un format' : value || ''}
      >
        <span className="truncate">{display}</span>
        {canEdit && (
          <ChevronDown
            className="w-3 h-3 shrink-0 opacity-60"
            aria-hidden="true"
          />
        )}
      </button>

      <PopoverFloat
        anchorRef={anchorRef}
        open={open}
        onClose={close}
        align="left"
      >
        <div
          className="rounded-lg shadow-lg overflow-hidden"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            minWidth: '120px',
          }}
        >
          {!customMode ? (
            <>
              {LIVRABLE_FORMATS.map((f) => (
                <Row
                  key={f}
                  label={f}
                  active={f === value}
                  onClick={() => handlePick(f)}
                />
              ))}
              <div style={{ borderTop: '1px solid var(--brd-sub)' }}>
                <Row
                  label="Autre…"
                  active={Boolean(value && !isPreset)}
                  onClick={() => setCustomMode(true)}
                />
                {value && (
                  <Row
                    label="Effacer"
                    danger
                    onClick={() => handlePick(null)}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="p-2">
              <input
                type="text"
                autoFocus
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCustomCommit()
                  } else if (e.key === 'Escape') {
                    close()
                  }
                }}
                onBlur={handleCustomCommit}
                placeholder="Ex : 21:9"
                className="w-full text-xs px-2 py-1 rounded bg-transparent focus:outline-none"
                style={{
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                  minWidth: '100px',
                }}
              />
            </div>
          )}
        </div>
      </PopoverFloat>
    </>
  )
}

function Row({ label, active = false, danger = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
      style={{
        background: active ? 'var(--bg-hov)' : 'transparent',
        color: danger ? 'var(--red)' : 'var(--txt)',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      <span className="flex-1">{label}</span>
      {active && (
        <Check
          className="w-3 h-3 shrink-0"
          style={{ color: 'var(--txt-3)' }}
        />
      )}
    </button>
  )
}
