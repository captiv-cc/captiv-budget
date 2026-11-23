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
// Usage « champ de formulaire » (pleine largeur, chevron, placeholder) :
//   <CustomSelect block placeholder="Choisir…" value={…} options={…} … />
//
// Comportement :
//   - Click sur trigger → ouvre popover sous le trigger
//   - Le popover passe par PopoverFloat (portal + position: fixed) : sans lui
//     une modale scrollable (overflow-y-auto) coupe la liste au ras de son
//     pied, et les derniers choix deviennent invisibles.
//   - Click sur option → onChange + ferme
//   - Click outside / Esc → ferme
//   - Keyboard : ↑↓ pour naviguer, Enter pour valider
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useState, useRef, useEffect } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import PopoverFloat from '../features/livrables/components/PopoverFloat'

export default function CustomSelect({
  value,
  options,
  onChange,
  renderTrigger,
  align = 'left',
  triggerClassName = '',
  triggerStyle = {},
  minWidth = 140,
  // Mode champ : le trigger occupe toute la largeur du parent et la liste
  // s'aligne dessus. Sans ça le span inline-flex se réduit à son contenu,
  // et un `w-full` sur le bouton ne sert à rien.
  block = false,
  placeholder = '',
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [triggerWidth, setTriggerWidth] = useState(null)
  const triggerRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])

  const currentLabel = options.find((o) => o.value === value)?.label || ''

  useEffect(() => {
    if (!open) {
      setHighlight(-1)
      return undefined
    }
    setTriggerWidth(triggerRef.current?.offsetWidth || null)
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        // Les modales écoutent Esc sur `window` : sans stopPropagation, fermer
        // la liste fermerait la modale entière et perdrait la saisie.
        e.stopPropagation()
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
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, options, highlight, onChange])

  return (
    <span
      style={
        block
          ? { position: 'relative', display: 'flex', width: '100%' }
          : { position: 'relative', display: 'inline-flex' }
      }
    >
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
          ...(block
            ? {
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }
            : null),
          ...triggerStyle,
        }}
      >
        {renderTrigger ? (
          renderTrigger(currentLabel)
        ) : block ? (
          <>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: currentLabel ? 'inherit' : 'var(--txt-3)',
              }}
            >
              {currentLabel || placeholder}
            </span>
            <ChevronDown size={14} style={{ color: 'var(--txt-3)', flexShrink: 0 }} />
          </>
        ) : (
          currentLabel
        )}
      </button>

      <PopoverFloat anchorRef={triggerRef} open={open} onClose={close} align={align}>
        <div
          role="listbox"
          style={{
            minWidth: block ? triggerWidth || minWidth : minWidth,
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
                {/* Dot couleur optionnel — utilisé par le type picker
                    (déroulé) pour donner un repère visuel à côté du libellé. */}
                {opt.color ? (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: opt.color,
                      flexShrink: 0,
                      display: 'inline-block',
                    }}
                  />
                ) : null}
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
      </PopoverFloat>
    </span>
  )
}
