// ════════════════════════════════════════════════════════════════════════════
// DateRangesInput — saisie d'une période structurée multi-ranges (PROJ-PERIODES)
// ════════════════════════════════════════════════════════════════════════════
//
// UI compact pour saisir une période composée d'un ou plusieurs intervalles
// de dates (continus ou non). Utilisé dans ProjetTab pour les 5 périodes
// clés : prépa / tournage / envoi V1 / livraison master / deadline.
//
// Pattern :
//   ┌─────────────────────────────────────────────────────────────────┐
//   │  [12-14/05  ✕]  [17/05  ✕]  [+ Ajouter]                          │
//   │  Total : 4 jours                                                  │
//   └─────────────────────────────────────────────────────────────────┘
//
// Au click sur "+ Ajouter" : 2 inputs date (début + fin optionnel) inline,
// validation au blur ou Enter.
//
// Props :
//   - value     : { ranges: [{start, end}] } (peut être null/empty)
//   - onChange  : (newPeriode) => void
//   - color     : couleur d'accent CSS var (--green, --blue, --orange…)
//   - bg        : couleur de fond CSS var pour les pills (--green-bg…)
//   - canEdit   : si false, lecture seule
//   - placeholder : texte affiché si vide en lecture (ex: "Aucune date")
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { Plus, X, Calendar } from 'lucide-react'
import {
  countDays,
  formatRangeFr,
  hasAnyRange,
  emptyPeriode,
} from '../../../lib/projectPeriodes'

export default function DateRangesInput({
  value,
  onChange,
  color = 'var(--blue)',
  bg = 'var(--blue-bg)',
  canEdit = true,
  placeholder = 'Aucune date',
}) {
  const periode = value && Array.isArray(value.ranges) ? value : emptyPeriode()
  const [adding, setAdding] = useState(false)

  const handleAdd = (range) => {
    if (!range?.start) return
    const next = {
      ranges: [
        ...periode.ranges.filter((r) => r?.start && r?.end),
        { start: range.start, end: range.end || range.start },
      ].sort((a, b) => (a.start < b.start ? -1 : 1)),
    }
    onChange?.(next)
    setAdding(false)
  }

  const handleRemove = (idx) => {
    const next = {
      ranges: periode.ranges.filter((_, i) => i !== idx),
    }
    onChange?.(next)
  }

  const days = countDays(periode)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {hasAnyRange(periode) ? (
          periode.ranges
            .filter((r) => r?.start && r?.end)
            .map((range, idx) => (
              <RangePill
                key={`${range.start}-${range.end}-${idx}`}
                range={range}
                color={color}
                bg={bg}
                canEdit={canEdit}
                onRemove={() => handleRemove(idx)}
              />
            ))
        ) : (
          !canEdit && (
            <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
              {placeholder}
            </span>
          )
        )}
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border border-dashed transition-colors"
            style={{
              borderColor: 'var(--brd)',
              color: 'var(--txt-3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = color
              e.currentTarget.style.color = color
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--brd)'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <Plus className="w-3 h-3" />
            {hasAnyRange(periode) ? 'Ajouter' : 'Ajouter une période'}
          </button>
        )}
      </div>
      {adding && canEdit && (
        <AddRangeForm
          color={color}
          onCancel={() => setAdding(false)}
          onSubmit={handleAdd}
        />
      )}
      {hasAnyRange(periode) && (
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {days} jour{days > 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

// ─── Pill : 1 range avec bouton remove ───────────────────────────────────────

function RangePill({ range, color, bg, canEdit, onRemove }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full"
      style={{
        background: bg,
        color,
        border: `1px solid ${color}`,
      }}
    >
      <Calendar className="w-3 h-3" />
      {formatRangeFr(range)}
      {canEdit && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Retirer cette période"
          className="ml-0.5 -mr-1 p-0.5 rounded-full hover:bg-black/10 transition-colors"
          style={{ color }}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  )
}

// ─── Form d'ajout : 2 inputs date inline ─────────────────────────────────────

function AddRangeForm({ color, onCancel, onSubmit }) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const startRef = useRef(null)

  useEffect(() => {
    startRef.current?.focus()
  }, [])

  const submit = () => {
    if (!start) {
      onCancel()
      return
    }
    // Si end vide ou < start, on prend start (1 jour).
    const finalEnd = !end || end < start ? start : end
    onSubmit({ start, end: finalEnd })
  }

  return (
    <div
      className="flex items-center gap-2 p-2 rounded"
      style={{
        background: 'var(--bg-elev)',
        border: `1px solid ${color}`,
      }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
          Du
        </span>
        <input
          ref={startRef}
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
          className="bg-transparent focus:outline-none text-xs"
          style={{ color: 'var(--txt)' }}
        />
      </div>
      <span style={{ color: 'var(--txt-3)' }}>→</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
          Au (optionnel)
        </span>
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
          className="bg-transparent focus:outline-none text-xs"
          style={{ color: 'var(--txt)' }}
        />
      </div>
      <div className="flex items-center gap-1 ml-auto">
        <button
          type="button"
          onClick={submit}
          disabled={!start}
          className="text-xs font-semibold px-2 py-1 rounded transition-colors disabled:opacity-40"
          style={{ background: color, color: 'white' }}
        >
          OK
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Annuler"
          className="p-1 rounded hover:bg-black/10 transition-colors"
          style={{ color: 'var(--txt-3)' }}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
