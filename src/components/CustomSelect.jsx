// ════════════════════════════════════════════════════════════════════════════
// CustomSelect — Dropdown custom DESK (remplace <select> natif OS moche)
// ════════════════════════════════════════════════════════════════════════════
//
// Usage minimal :
//   <CustomSelect
//     value={statut}
//     options={[{ value: 'planifie', label: 'Planifié' }, …]}
//     onChange={(v) => …}
//     renderTrigger={(label) => <span className="cp-status-badge">{label}</span>}
//   />
//
// Comportement :
//   - Click sur trigger → ouvre popover sous trigger (auto-flip si bord d'écran)
//   - Click sur option → onChange + ferme
//   - Click outside / Esc → ferme
//   - Keyboard : ↑↓ pour naviguer, Enter pour valider
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react'
import { Check } from 'lucide-react'

export default function CustomSelect({
  value,
  options,
  onChange,
  renderTrigger,
  align = 'left',
  triggerClassName = '',
  triggerStyle = {},
  minWidth = 140,
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  const currentLabel = options.find((o) => o.value === value)?.label || ''

  useEffect(() => {
    if (!open) {
      setHighlight(-1)
      return undefined
    }
    function onDocMouseDown(e) {
      if (popoverRef.current?.contains(e.target)) return
      if (triggerRef.current?.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => Math.min(options.length - 1, h + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => Math.max(0, h - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (highlight >= 0 && highlight < options.length) {
          onChange?.(options[highlight].value)
          setOpen(false)
        }
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, options, highlight, onChange])

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={triggerClassName}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          font: 'inherit',
          color: 'inherit',
          ...triggerStyle,
        }}
      >
        {renderTrigger ? renderTrigger(currentLabel) : currentLabel}
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            [align === 'right' ? 'right' : 'left']: 0,
            zIndex: 100,
            minWidth,
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
            padding: 4,
            // Cap la hauteur pour éviter qu'une longue liste (types V2 :
            // 14 core + custom) sorte du viewport et que le dernier item
            // (souvent "+ Ajouter un type") soit caché. Scroll vertical
            // si nécessaire.
            maxHeight: 'min(420px, 60vh)',
            overflowY: 'auto',
            animation: 'custom-select-fade-in 100ms ease-out',
          }}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value
            const isHighlight = idx === highlight
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlight(idx)}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange?.(opt.value)
                  setOpen(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 12,
                  textAlign: 'left',
                  color: 'var(--txt)',
                  background: isHighlight ? 'var(--bg-elev)' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: isSelected ? 500 : 400,
                }}
              >
                <span
                  style={{
                    width: 12,
                    display: 'inline-flex',
                    color: 'var(--blue, #3B82F6)',
                  }}
                >
                  {isSelected && <Check size={12} strokeWidth={3} />}
                </span>
                <span>{opt.label}</span>
              </button>
            )
          })}
          <style>{`
            @keyframes custom-select-fade-in {
              from { opacity: 0; transform: translateY(-3px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}
    </span>
  )
}
