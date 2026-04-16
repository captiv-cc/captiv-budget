/**
 * TimelineCalendar — Vue temporelle multi-jours (semaine ou jour).
 *
 * Rend une grille horaire avec une colonne par jour. Les événements non-all-day
 * sont positionnés absolument selon start/end ; les événements all-day sont
 * empilés dans un bandeau horizontal en haut.
 *
 * Props :
 *   - days         : Date[] (chacune à 00:00 local) — colonnes à afficher
 *   - events       : événements bruts
 *   - headerLabel  : string affiché à gauche du header (ex. "Semaine du …")
 *   - onEventClick : fn(event)
 *   - onSlotClick  : fn(date)  — appelé au clic sur une case vide (date à l'heure ronde)
 *   - onPrev / onNext / onToday : navigation
 *   - startHour    : 1ère heure affichée (défaut 6)
 *   - endHour      : dernière heure affichée (défaut 22)
 */
import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  WEEKDAYS_SHORT_FR,
  fmtDateKey,
  groupEventsByDay,
  isSameDay,
  timeToTop,
} from './dateUtils'
import { resolveEventColor } from '../../lib/planning'

const HOUR_HEIGHT = 48       // px par heure
const TIME_GUTTER = 56       // largeur de la colonne d'heures

export default function TimelineCalendar({
  days,
  events,
  headerLabel,
  onEventClick,
  onSlotClick,
  onPrev,
  onNext,
  onToday,
  startHour = 6,
  endHour = 22,
}) {
  const today = useMemo(() => new Date(), [])
  const byDay = useMemo(() => groupEventsByDay(events), [events])

  const hours = useMemo(() => {
    const arr = []
    for (let h = startHour; h <= endHour; h += 1) arr.push(h)
    return arr
  }, [startHour, endHour])

  const totalHeight = (endHour - startHour) * HOUR_HEIGHT

  // Sépare événements timed vs all-day par colonne
  const columns = days.map((day) => {
    const key = fmtDateKey(day)
    const all = byDay.get(key) || []
    const timed = []
    const allDay = []
    all.forEach((ev) => {
      if (ev.all_day) allDay.push(ev)
      else timed.push(ev)
    })
    return { day, key, timed, allDay }
  })

  // Pic du bandeau all-day : au moins 1 ligne, max 4 lignes visibles
  const maxAllDay = Math.min(4, columns.reduce((m, c) => Math.max(m, c.allDay.length), 0))
  const allDayStripHeight = maxAllDay > 0 ? 28 + maxAllDay * 22 : 0

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
        <h2 className="text-base font-semibold" style={{ color: 'var(--txt)' }}>
          {headerLabel}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToday}
            className="px-3 py-1.5 text-xs rounded-lg font-medium"
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
            aria-label="Précédent"
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--txt-2)', border: '1px solid var(--brd)', background: 'var(--bg-elev)' }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Suivant"
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--txt-2)', border: '1px solid var(--brd)', background: 'var(--bg-elev)' }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Bandeau entête jours + all-day ────────────────────────────────── */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${TIME_GUTTER}px repeat(${days.length}, 1fr)`,
          borderBottom: '1px solid var(--brd-sub)',
        }}
      >
        {/* Cellule vide coin supérieur gauche */}
        <div
          className="px-2 py-2 text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--txt-3)', borderRight: '1px solid var(--brd-sub)' }}
        >
          {maxAllDay > 0 ? 'Journée' : ''}
        </div>

        {columns.map((col, idx) => {
          const isToday = isSameDay(col.day, today)
          const dow = (col.day.getDay() + 6) % 7 // 0 = lundi
          return (
            <div
              key={col.key}
              className="px-2 py-2 text-center flex flex-col gap-1"
              style={{
                borderRight: idx === columns.length - 1 ? 'none' : '1px solid var(--brd-sub)',
                background: isToday ? 'var(--blue-bg)' : 'transparent',
              }}
            >
              <div className="flex items-center justify-center gap-1.5">
                <span
                  className="text-[10px] uppercase font-medium tracking-wide"
                  style={{ color: isToday ? 'var(--blue)' : 'var(--txt-3)' }}
                >
                  {WEEKDAYS_SHORT_FR[dow]}
                </span>
                <span
                  className="text-sm font-semibold"
                  style={{ color: isToday ? 'var(--blue)' : 'var(--txt)' }}
                >
                  {col.day.getDate()}
                </span>
              </div>

              {/* All-day events pour ce jour */}
              {maxAllDay > 0 && (
                <div className="flex flex-col gap-[2px]" style={{ minHeight: `${maxAllDay * 22}px` }}>
                  {col.allDay.slice(0, maxAllDay).map((ev) => {
                    const color = resolveEventColor(ev, 'var(--blue)')
                    return (
                      <button
                        key={ev.id + col.key}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onEventClick && onEventClick(ev)
                        }}
                        className="text-left text-[11px] px-1.5 py-[2px] rounded truncate"
                        style={{
                          background: `${color}22`,
                          color,
                          borderLeft: `3px solid ${color}`,
                        }}
                        title={ev.title}
                      >
                        {ev.title}
                      </button>
                    )
                  })}
                  {col.allDay.length > maxAllDay && (
                    <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                      +{col.allDay.length - maxAllDay}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Grille horaire scrollable ─────────────────────────────────────── */}
      <div
        className="overflow-y-auto"
        style={{ maxHeight: `calc(100vh - ${300 + allDayStripHeight}px)` }}
      >
        <div
          className="grid relative"
          style={{
            gridTemplateColumns: `${TIME_GUTTER}px repeat(${days.length}, 1fr)`,
            minHeight: `${totalHeight}px`,
          }}
        >
          {/* Colonne des heures */}
          <div
            className="relative"
            style={{
              borderRight: '1px solid var(--brd-sub)',
              height: `${totalHeight}px`,
            }}
          >
            {hours.map((h, i) => (
              <div
                key={h}
                className="absolute left-0 right-0 text-[10px] px-1.5"
                style={{
                  top: `${i * HOUR_HEIGHT}px`,
                  color: 'var(--txt-3)',
                  transform: 'translateY(-6px)',
                }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Colonnes des jours */}
          {columns.map((col, idx) => {
            const isToday = isSameDay(col.day, today)
            return (
              <DayColumn
                key={col.key}
                day={col.day}
                events={col.timed}
                isToday={isToday}
                isLastCol={idx === columns.length - 1}
                hours={hours}
                startHour={startHour}
                endHour={endHour}
                onEventClick={onEventClick}
                onSlotClick={onSlotClick}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ─── Colonne d'un jour ────────────────────────────────────────────────────── */
function DayColumn({
  day,
  events,
  isToday,
  isLastCol,
  hours,
  startHour,
  endHour,
  onEventClick,
  onSlotClick,
}) {
  const totalHeight = (endHour - startHour) * HOUR_HEIGHT

  // Groupement simple pour gestion du chevauchement : on calcule des "clusters"
  // d'événements qui se chevauchent pour les afficher côte-à-côte.
  const laidOut = useMemo(() => layoutEvents(events), [events])

  function handleGridClick(e) {
    // Calcule l'heure cliquée à partir de la position Y
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const minutesFromStart = Math.round((y / HOUR_HEIGHT) * 60 / 30) * 30 // arrondi 30min
    const h = startHour + Math.floor(minutesFromStart / 60)
    const m = minutesFromStart % 60
    const date = new Date(day)
    date.setHours(h, m, 0, 0)
    onSlotClick && onSlotClick(date)
  }

  return (
    <div
      className="relative"
      style={{
        borderRight: isLastCol ? 'none' : '1px solid var(--brd-sub)',
        background: isToday ? 'rgba(59,130,246,0.03)' : 'transparent',
        height: `${totalHeight}px`,
        cursor: 'pointer',
      }}
      onClick={handleGridClick}
    >
      {/* Lignes horaires */}
      {hours.map((h, i) => (
        <div
          key={h}
          className="absolute left-0 right-0"
          style={{
            top: `${i * HOUR_HEIGHT}px`,
            borderTop: i === 0 ? 'none' : '1px solid var(--brd-sub)',
            height: `${HOUR_HEIGHT}px`,
          }}
        />
      ))}

      {/* Événements */}
      {laidOut.map((item) => {
        const ev = item.event
        const start = new Date(ev.starts_at)
        const end = new Date(ev.ends_at)
        const top = timeToTop(day, start, HOUR_HEIGHT, startHour, endHour)
        const bottom = timeToTop(day, end, HOUR_HEIGHT, startHour, endHour)
        const height = Math.max(20, bottom - top)
        const color = resolveEventColor(ev, 'var(--blue)')

        const widthPct = 100 / item.lanes
        const leftPct = item.lane * widthPct

        return (
          <button
            key={ev.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEventClick && onEventClick(ev)
            }}
            className="absolute text-left rounded overflow-hidden transition"
            style={{
              top: `${top}px`,
              height: `${height}px`,
              left: `calc(${leftPct}% + 2px)`,
              width: `calc(${widthPct}% - 4px)`,
              background: `${color}22`,
              color,
              borderLeft: `3px solid ${color}`,
              padding: '2px 6px',
            }}
            title={`${ev.title} — ${fmtTime(start)}-${fmtTime(end)}`}
          >
            <div className="text-[11px] font-medium truncate">{ev.title}</div>
            {height > 30 && (
              <div className="text-[10px] opacity-70 truncate">
                {fmtTime(start)} – {fmtTime(end)}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

function fmtTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Positionnement simple des événements en "lanes" pour gérer les chevauchements.
 * Greedy : on parcourt par ordre de début, on place dans la 1ère lane libre.
 * Les events qui se chevauchent tous partagent la largeur de la colonne.
 */
function layoutEvents(events) {
  const sorted = [...events].sort(
    (a, b) => new Date(a.starts_at) - new Date(b.starts_at),
  )
  const placed = []
  const clusters = [] // groupes de events en chevauchement mutuel

  sorted.forEach((ev) => {
    const s = new Date(ev.starts_at)
    const e = new Date(ev.ends_at)
    // Cherche un cluster dont l'un des membres recouvre cet event
    let cluster = clusters.find((c) =>
      c.events.some((x) => {
        const xs = new Date(x.starts_at)
        const xe = new Date(x.ends_at)
        return s < xe && e > xs
      }),
    )
    if (!cluster) {
      cluster = { events: [] }
      clusters.push(cluster)
    }
    cluster.events.push(ev)
  })

  clusters.forEach((cluster) => {
    // Greedy : on attribue une lane à chaque event
    const lanes = [] // lanes[i] = end time du dernier event placé dans la lane i
    cluster.events.forEach((ev) => {
      const s = new Date(ev.starts_at)
      const e = new Date(ev.ends_at)
      const laneIdx = lanes.findIndex((endT) => endT <= s)
      let assigned
      if (laneIdx >= 0) {
        lanes[laneIdx] = e
        assigned = laneIdx
      } else {
        lanes.push(e)
        assigned = lanes.length - 1
      }
      placed.push({ event: ev, lane: assigned, lanesTotal: 0 })
    })
    // Après placement, la largeur doit correspondre au max de lanes utilisées
    const total = lanes.length
    placed
      .filter((p) => cluster.events.includes(p.event))
      .forEach((p) => {
        p.lanesTotal = total
      })
  })

  return placed.map((p) => ({ event: p.event, lane: p.lane, lanes: p.lanesTotal || 1 }))
}
