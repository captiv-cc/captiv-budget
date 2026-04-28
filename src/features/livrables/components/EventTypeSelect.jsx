// ════════════════════════════════════════════════════════════════════════════
// EventTypeSelect — pill cliquable + popover des event_types de l'org (LIV-9)
// ════════════════════════════════════════════════════════════════════════════
//
// Pendant pour les étapes du `LivrableStatutPill` / `VersionStatutPill` mais
// peuplé dynamiquement avec les `event_types` de l'org (org-scoped via RLS).
//
// Pourquoi un composant custom plutôt qu'un <select> natif :
// le rendu cross-browser du `<select>` avec background custom + chevron SVG
// est buggé (le dropdown ouvert empile les options avec mon styling pastel
// et duplique le chevron par option). Pattern custom = plus propre et
// cohérent avec les autres pills du feature livrables.
//
// Le popover utilise `PopoverFloat` (createPortal + position: fixed) pour
// échapper aux `overflow:auto` éventuels.
//
// Props :
//   - value       : id du type courant (uuid) ou null/'' pour aucun
//   - onChange    : (nextId | null) => Promise|void
//   - eventTypes  : Array<event_type> — { id, label, color, ... }
//   - canEdit     : booléen
//   - size        : 'xs' | 'sm' (défaut 'xs' — utilisé en pill compact)
//   - align       : 'left' | 'right' (défaut 'right')
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import PopoverFloat from './PopoverFloat'

const FALLBACK_COLOR = '#94a3b8' // slate-400

export default function EventTypeSelect({
  value,
  onChange,
  eventTypes = [],
  canEdit = true,
  size = 'xs',
  align = 'right',
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)

  const current = useMemo(
    () => eventTypes.find((t) => t.id === value) || null,
    [eventTypes, value],
  )
  const color = current?.color || FALLBACK_COLOR
  const label = current?.label || 'Aucun type'
  const empty = eventTypes.length === 0

  const handlePick = useCallback(
    async (nextId) => {
      setOpen(false)
      const normalized = nextId || null
      if (normalized === (value || null)) return
      try {
        await onChange?.(normalized)
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
        onClick={() => canEdit && !empty && setOpen((o) => !o)}
        disabled={!canEdit || empty}
        className={`${padding} rounded-full font-medium whitespace-nowrap inline-flex items-center gap-1`}
        style={{
          background: current ? color + '22' : 'var(--bg-2)',
          color: current ? color : 'var(--txt-3)',
          cursor: canEdit && !empty ? 'pointer' : 'default',
          opacity: canEdit ? 1 : 0.85,
          maxWidth: '160px',
        }}
        title={empty ? 'Aucun type configuré' : (canEdit ? 'Choisir un type' : label)}
      >
        <span className="truncate">{label}</span>
        {canEdit && !empty && (
          <ChevronDown className="w-3 h-3 shrink-0 opacity-70" aria-hidden="true" />
        )}
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
            minWidth: '200px',
            maxHeight: '320px',
            overflowY: 'auto',
          }}
        >
          {/* Option "aucun type" */}
          <Option
            label="— Aucun type —"
            color={null}
            active={!value}
            onClick={() => handlePick(null)}
          />
          <div style={{ borderTop: '1px solid var(--brd-sub)' }} />
          {eventTypes.map((t) => (
            <Option
              key={t.id}
              label={t.label}
              color={t.color}
              active={t.id === value}
              onClick={() => handlePick(t.id)}
            />
          ))}
        </div>
      </PopoverFloat>
    </>
  )
}

function Option({ label, color, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
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
      {color ? (
        <span
          className="px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0"
          style={{ background: color + '22', color }}
        >
          {label}
        </span>
      ) : (
        <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
          {label}
        </span>
      )}
      {active && (
        <Check
          className="w-3.5 h-3.5 ml-auto shrink-0"
          style={{ color: 'var(--txt-3)' }}
        />
      )}
    </button>
  )
}
