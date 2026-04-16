/**
 * MonthCalendar — Grille mensuelle 6×7 affichant les événements Captiv.
 *
 * Sans dépendance externe : rendu custom pour coller au design system (couleurs
 * issues des types d'événements, hauteur uniforme, overflow "+N autres").
 *
 * Props :
 *   - currentDate : Date de référence (n'importe quel jour du mois à afficher)
 *   - events       : tableau d'événements (shape EVENT_SELECT de lib/planning)
 *   - onEventClick : fn(event) → ouvre la modale détail
 *   - onDayClick   : fn(date)  → pré-remplit le jour dans le créateur
 *   - onPrev / onNext / onToday : navigation
 */
import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  WEEKDAYS_SHORT_FR,
  fmtMonthYear,
  fmtDateKey,
  getMonthGrid,
  groupEventsByDay,
  isSameDay,
  isSameMonth,
} from './dateUtils'
import { resolveEventColor } from '../../lib/planning'

const MAX_EVENTS_PER_CELL = 3

export default function MonthCalendar({
  currentDate,
  events,
  onEventClick,
  onDayClick,
  onPrev,
  onNext,
  onToday,
}) {
  const cells = useMemo(
    () => getMonthGrid(currentDate.getFullYear(), currentDate.getMonth()),
    [currentDate],
  )
  const byDay = useMemo(() => groupEventsByDay(events), [events])
  const today = useMemo(() => new Date(), [])

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {/* ── Header navigation ─────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <h2 className="text-base font-semibold capitalize" style={{ color: 'var(--txt)' }}>
          {fmtMonthYear(currentDate)}
        </h2>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToday}
            className="px-3 py-1.5 text-xs rounded-lg font-medium transition"
            style={{
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
              background: 'var(--bg-elev)',
            }}
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={onPrev}
            aria-label="Mois précédent"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition"
            style={{
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
              background: 'var(--bg-elev)',
            }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Mois suivant"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition"
            style={{
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
              background: 'var(--bg-elev)',
            }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Bandeau jours de la semaine ───────────────────────────────────── */}
      <div
        className="grid grid-cols-7 text-[11px] font-medium uppercase tracking-wide"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        {WEEKDAYS_SHORT_FR.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center"
            style={{ color: 'var(--txt-3)' }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* ── Grille 6×7 ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 grid-rows-6 flex-1">
        {cells.map((day, idx) => {
          const key = fmtDateKey(day)
          const dayEvents = byDay.get(key) || []
          const inMonth = isSameMonth(day, currentDate)
          const isToday = isSameDay(day, today)
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          const isLastCol = (idx + 1) % 7 === 0
          const isLastRow = idx >= 35

          const visible = dayEvents.slice(0, MAX_EVENTS_PER_CELL)
          const overflow = Math.max(0, dayEvents.length - MAX_EVENTS_PER_CELL)

          return (
            <div
              key={key + idx}
              onClick={() => onDayClick && onDayClick(day)}
              className="min-h-[110px] p-1.5 flex flex-col gap-1 cursor-pointer transition"
              style={{
                background: inMonth
                  ? isWeekend ? 'var(--bg-elev)' : 'var(--bg-surf)'
                  : 'var(--bg-elev)',
                opacity: inMonth ? 1 : 0.55,
                borderRight: isLastCol ? 'none' : '1px solid var(--brd-sub)',
                borderBottom: isLastRow ? 'none' : '1px solid var(--brd-sub)',
              }}
            >
              {/* N° du jour */}
              <div className="flex items-center justify-between">
                <span
                  className="inline-flex items-center justify-center text-xs font-medium"
                  style={{
                    color: isToday ? '#fff' : inMonth ? 'var(--txt-2)' : 'var(--txt-3)',
                    background: isToday ? 'var(--blue)' : 'transparent',
                    minWidth: '22px',
                    height: '22px',
                    borderRadius: '999px',
                    padding: isToday ? '0 6px' : '0',
                  }}
                >
                  {day.getDate()}
                </span>
              </div>

              {/* Événements */}
              <div className="flex flex-col gap-[2px] overflow-hidden">
                {visible.map((ev) => {
                  const color = resolveEventColor(ev, 'var(--blue)')
                  const startD = new Date(ev.starts_at)
                  const timeLabel =
                    !ev.all_day && isSameDay(startD, day)
                      ? `${String(startD.getHours()).padStart(2, '0')}:${String(
                          startD.getMinutes(),
                        ).padStart(2, '0')} `
                      : ''
                  return (
                    <button
                      key={ev.id + key}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEventClick && onEventClick(ev)
                      }}
                      className="text-left text-[11px] px-1.5 py-[2px] rounded truncate transition"
                      style={{
                        background: `${color}22`,
                        color,
                        borderLeft: `3px solid ${color}`,
                      }}
                      title={ev.title}
                    >
                      <span className="font-medium opacity-80">{timeLabel}</span>
                      <span>{ev.title}</span>
                    </button>
                  )
                })}
                {overflow > 0 && (
                  <span
                    className="text-[10px] px-1.5"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    +{overflow} autre{overflow > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
