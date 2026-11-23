// ════════════════════════════════════════════════════════════════════════════
// DayPicker — Picker de date custom (remplace input[type=date] natif)
// ════════════════════════════════════════════════════════════════════════════
//
// Bouton affichant la date sélectionnée + popover calendrier mensuel custom
// au click. Cohérent avec le thème DESK (var(--bg-surf), var(--brd), etc.).
//
// Props :
//   - value (ISO YYYY-MM-DD)
//   - onChange(isoDate)
//   - markedDates : Array<string> — dates avec un événement (chips/dots)
//   - placeholder : texte du bouton quand aucune date n'est posée (sans lui,
//     un champ vide n'était qu'une icône dans une boîte minuscule)
//   - block       : le bouton prend toute la largeur du parent (mode champ)
//   - clearable   : ajoute « Effacer » quand une date est posée
//
// Le calendrier passe par PopoverFloat (portal + position: fixed) : dans une
// modale scrollable, un popover en position absolue se fait couper au pied
// du conteneur.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import PopoverFloat from '../features/livrables/components/PopoverFloat'

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function pad2(n) {
  return String(n).padStart(2, '0')
}
function isoFromParts(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`
}
function parseIso(iso) {
  if (!iso) return new Date()
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}
function isoFromDate(d) {
  return isoFromParts(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatPretty(iso) {
  if (!iso) return ''
  const d = parseIso(iso)
  const days = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
  return `${days[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}`
}

export default function DayPicker({
  value,
  onChange,
  markedDates = [],
  placeholder = 'Choisir une date',
  block = false,
  clearable = false,
}) {
  const [open, setOpen] = useState(false)
  // Mois affiché dans le calendrier (peut différer de la value sélectionnée)
  const [viewMonth, setViewMonth] = useState(() => {
    const d = parseIso(value)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const buttonRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])

  const todayIso = isoFromDate(new Date())
  const markedSet = useMemo(() => new Set(markedDates), [markedDates])

  // Sync view month quand value change depuis l'extérieur
  useEffect(() => {
    if (!value) return
    const d = parseIso(value)
    setViewMonth({ year: d.getFullYear(), month: d.getMonth() })
  }, [value])

  // Esc ferme le calendrier, pas la modale qui l'héberge (celles-ci écoutent
  // sur `window`, en aval de `document` dans la phase de bouillonnement).
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const shiftMonth = (delta) => {
    setViewMonth((vm) => {
      const d = new Date(vm.year, vm.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  // Construit la grille du mois affiché : 7 colonnes × 6 lignes max.
  // Lundi = 1er jour de la semaine (FR).
  const grid = useMemo(() => {
    const firstDayOfMonth = new Date(viewMonth.year, viewMonth.month, 1)
    // Jour de la semaine en convention FR (lun=0, dim=6)
    const dayOfWeekJsToFr = (jsDay) => (jsDay + 6) % 7
    const startOffset = dayOfWeekJsToFr(firstDayOfMonth.getDay())
    const lastDayOfMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate()
    const cells = []
    // Days du mois précédent (grisés)
    const lastDayPrevMonth = new Date(viewMonth.year, viewMonth.month, 0).getDate()
    for (let i = startOffset - 1; i >= 0; i -= 1) {
      const day = lastDayPrevMonth - i
      const date = new Date(viewMonth.year, viewMonth.month - 1, day)
      cells.push({
        day,
        iso: isoFromDate(date),
        currentMonth: false,
      })
    }
    // Days du mois affiché
    for (let day = 1; day <= lastDayOfMonth; day += 1) {
      cells.push({
        day,
        iso: isoFromParts(viewMonth.year, viewMonth.month, day),
        currentMonth: true,
      })
    }
    // Days du mois suivant pour compléter à 42 cells (6 lignes × 7)
    let nextDay = 1
    while (cells.length < 42) {
      const date = new Date(viewMonth.year, viewMonth.month + 1, nextDay)
      cells.push({
        day: nextDay,
        iso: isoFromDate(date),
        currentMonth: false,
      })
      nextDay += 1
    }
    return cells
  }, [viewMonth])

  return (
    <span
      style={
        block
          ? { position: 'relative', display: 'flex', width: '100%' }
          : { position: 'relative', display: 'inline-block' }
      }
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 text-sm rounded outline-none transition-colors"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt)',
          border: '1px solid var(--brd)',
          minWidth: 120,
          ...(block ? { width: '100%' } : null),
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--brd-sub)')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--brd)')}
      >
        <Calendar size={13} style={{ color: 'var(--txt-3)', flexShrink: 0 }} />
        <span
          style={{
            color: value ? 'inherit' : 'var(--txt-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {value ? formatPretty(value) : placeholder}
        </span>
      </button>

      <PopoverFloat anchorRef={buttonRef} open={open} onClose={close} offsetY={6}>
        <div
          style={{
            width: 260,
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            borderRadius: 8,
            boxShadow: '0 12px 24px rgba(0,0,0,0.25)',
            padding: 8,
            animation: 'day-picker-fade-in 120ms ease-out',
          }}
        >
          {/* Header mois */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 6px 8px',
            }}
          >
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              style={{
                padding: 3,
                background: 'transparent',
                border: 'none',
                color: 'var(--txt-2)',
                cursor: 'pointer',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)' }}>
              {MONTHS[viewMonth.month]} {viewMonth.year}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              style={{
                padding: 3,
                background: 'transparent',
                border: 'none',
                color: 'var(--txt-2)',
                cursor: 'pointer',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Weekday labels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {WEEKDAYS.map((w, i) => (
              <div
                key={i}
                style={{
                  textAlign: 'center',
                  fontSize: 10,
                  color: 'var(--txt-3)',
                  fontWeight: 500,
                  padding: '2px 0',
                }}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Grille des jours */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {grid.map((cell) => {
              const isSelected = cell.iso === value
              const isToday = cell.iso === todayIso
              const isMarked = markedSet.has(cell.iso)
              const baseColor = cell.currentMonth ? 'var(--txt)' : 'var(--txt-3)'
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => {
                    onChange?.(cell.iso)
                    setOpen(false)
                  }}
                  style={{
                    position: 'relative',
                    padding: '6px 0',
                    fontSize: 12,
                    fontWeight: isSelected || isToday ? 500 : 400,
                    color: isSelected ? 'white' : baseColor,
                    background: isSelected
                      ? 'var(--blue, #3B82F6)'
                      : isToday
                      ? 'var(--bg-hov)'
                      : 'transparent',
                    border: isToday && !isSelected ? '1px solid var(--brd-sub)' : '1px solid transparent',
                    borderRadius: 4,
                    cursor: 'pointer',
                    opacity: cell.currentMonth ? 1 : 0.4,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'var(--bg-hov)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = isToday ? 'var(--bg-hov)' : 'transparent'
                    }
                  }}
                >
                  {cell.day}
                  {isMarked && !isSelected && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: 2,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 3,
                        height: 3,
                        borderRadius: '50%',
                        background: 'var(--blue, #3B82F6)',
                      }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* Footer "Aujourd'hui" (+ « Effacer » quand la date est optionnelle) */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              paddingTop: 6,
              marginTop: 6,
              borderTop: '1px solid var(--brd-sub)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                onChange?.(todayIso)
                setOpen(false)
              }}
              style={{
                flex: 1,
                padding: '5px 10px',
                fontSize: 11,
                color: 'var(--txt-2)',
                background: 'transparent',
                border: '1px solid var(--brd-sub)',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 500,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Aujourd&apos;hui
            </button>
            {clearable && value && (
              <button
                type="button"
                onClick={() => {
                  onChange?.(null)
                  setOpen(false)
                }}
                style={{
                  flex: 1,
                  padding: '5px 10px',
                  fontSize: 11,
                  color: 'var(--txt-3)',
                  background: 'transparent',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Effacer
              </button>
            )}
          </div>

          <style>{`
            @keyframes day-picker-fade-in {
              from { opacity: 0; transform: translateY(-4px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      </PopoverFloat>
    </span>
  )
}
