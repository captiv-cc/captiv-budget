/**
 * TimelineCalendar — Vue temporelle multi-jours (semaine ou jour).
 *
 * Rend une grille horaire avec une colonne par jour. Les événements non-all-day
 * sont positionnés absolument selon start/end ; les événements all-day sont
 * empilés dans un bandeau horizontal en haut.
 *
 * PL-5 : drag & drop (déplacement) + resize (bord inférieur) des événements timed.
 *
 * Props :
 *   - days         : Date[] (chacune à 00:00 local) — colonnes à afficher
 *   - events       : événements bruts
 *   - conflicts    : Map<eventKey, Array<conflict>> (PL-3, optionnel)
 *   - headerLabel  : string affiché à gauche du header (ex. "Semaine du …")
 *   - onEventClick : fn(event)
 *   - onSlotClick  : fn(date)                          — clic sur case vide
 *   - onDayClick   : fn(date)                          — clic sur en-tête jour
 *                    (vue Semaine). Si fourni, l'en-tête devient un bouton
 *                    (typique : bascule vers la vue Jour — cf. PlanningTab).
 *   - onEventMove  : fn(event, newStart, newEnd)       — drop après move
 *   - onEventResize: fn(event, newEnd)                 — drop après resize
 *   - onPrev / onNext / onToday : navigation
 *   - startHour    : 1ère heure affichée (défaut 6)
 *   - endHour      : dernière heure affichée (défaut 22)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  WEEKDAYS_SHORT_FR,
  fmtDateKey,
  groupEventsByDay,
  isSameDay,
  timeToTop,
} from './dateUtils'
import { resolveEventColor } from '../../lib/planning'
import { useBreakpoint } from '../../hooks/useBreakpoint'

// Dimensions responsive par breakpoint (cf. useBreakpoint).
// Objectifs :
//   - mobile  : grille dense, gouttière minimale, colonnes peuvent scroll-x
//   - tablet  : intermédiaire confortable
//   - desktop : pleine confortabilité actuelle
const DIMENSIONS = {
  mobile:  { hourHeight: 40, timeGutter: 40, dayMinWidthPx: 92 },
  tablet:  { hourHeight: 44, timeGutter: 48, dayMinWidthPx: 0 },
  desktop: { hourHeight: 48, timeGutter: 56, dayMinWidthPx: 0 },
}

const SNAP_MINUTES = 15      // granularité drag/resize
const DRAG_THRESHOLD_PX = 4  // mouvement mini avant de considérer un drag
const RESIZE_HANDLE_PX = 6   // hauteur de la zone "resize" en bas de l'event

export default function TimelineCalendar({
  days,
  events,
  conflicts,
  headerLabel,
  onEventClick,
  onSlotClick,
  onDayClick,
  onEventMove,
  onEventResize,
  onPrev,
  onNext,
  onToday,
  startHour = 6,
  endHour = 22,
}) {
  const today = useMemo(() => new Date(), [])
  const byDay = useMemo(() => groupEventsByDay(events), [events])
  const bp = useBreakpoint()
  const dims = DIMENSIONS[bp.is]
  const HOUR_HEIGHT = dims.hourHeight
  const TIME_GUTTER = dims.timeGutter

  // Vue Semaine sur mobile : on autorise un scroll horizontal avec largeur
  // minimale par colonne-jour, pour que les événements restent lisibles.
  // Vue Jour (days.length === 1) : pleine largeur, pas de scroll-x.
  const needsHScroll = bp.isMobile && days.length > 1 && dims.dayMinWidthPx > 0
  const gridMinWidth = needsHScroll ? TIME_GUTTER + days.length * dims.dayMinWidthPx : 0

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

  // ─── Drag state ────────────────────────────────────────────────────────────
  // drag = null | {
  //   event, mode ('move'|'resize'),
  //   originX, originY,
  //   dx, dy,                    // px depuis origine
  //   dayDelta, minuteDelta,     // snapé
  //   committed,                 // true si on a dépassé le seuil
  //   columnWidthPx,             // largeur d'une colonne-jour (pour convertir dx→jours)
  // }
  const gridRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  // Flag partagé pour supprimer le click natif qui suit un drop committed.
  const suppressClickRef = useRef(false)

  // Helper qui maintient la ref ET le state synchronisés — évite le lag de
  // rendu React (la ref doit refléter l'état courant même avant rerender).
  function writeDrag(next) {
    dragRef.current = next
    setDrag(next)
  }

  useEffect(() => {
    if (!drag) return undefined

    function onPointerMove(e) {
      const cur = dragRef.current
      if (!cur) return
      const dx = e.clientX - cur.originX
      const dy = e.clientY - cur.originY
      const committed = cur.committed || Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX

      // Conversion en delta jours/minutes (snap)
      let dayDelta = 0
      if (cur.mode === 'move' && cur.columnWidthPx > 0) {
        dayDelta = Math.round(dx / cur.columnWidthPx)
      }
      const minutesRaw = (dy / HOUR_HEIGHT) * 60
      const minuteDelta = Math.round(minutesRaw / SNAP_MINUTES) * SNAP_MINUTES

      writeDrag({ ...cur, dx, dy, dayDelta, minuteDelta, committed })
    }

    function onPointerUp() {
      const cur = dragRef.current
      if (!cur) {
        writeDrag(null)
        return
      }
      if (!cur.committed) {
        // Mouvement négligeable → on laisse le click natif passer (géré par onClick du bouton)
        writeDrag(null)
        return
      }
      // Drag effectif : on bloque le click qui va suivre pour ne pas ouvrir la modale
      suppressClickRef.current = true
      const ev = cur.event
      const start = new Date(ev.starts_at)
      const end = new Date(ev.ends_at)
      if (cur.mode === 'move') {
        const newStart = shiftDate(start, cur.dayDelta, cur.minuteDelta)
        const newEnd = shiftDate(end, cur.dayDelta, cur.minuteDelta)
        if (newStart.getTime() !== start.getTime() || newEnd.getTime() !== end.getTime()) {
          onEventMove && onEventMove(ev, newStart, newEnd)
        }
      } else if (cur.mode === 'resize') {
        // Minimum 15 minutes de durée, même si on tire vers le haut
        const minEnd = new Date(start.getTime() + SNAP_MINUTES * 60 * 1000)
        let newEnd = shiftDate(end, 0, cur.minuteDelta)
        if (newEnd.getTime() < minEnd.getTime()) newEnd = minEnd
        if (newEnd.getTime() !== end.getTime()) {
          onEventResize && onEventResize(ev, newEnd)
        }
      }
      writeDrag(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, onEventMove, onEventResize])

  function startDrag(e, ev, mode) {
    // Calcule la largeur d'une colonne-jour en lisant la grille
    let columnWidthPx = 0
    if (gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect()
      columnWidthPx = Math.max(0, (rect.width - TIME_GUTTER) / Math.max(1, days.length))
    }
    writeDrag({
      event: ev,
      mode,
      originX: e.clientX,
      originY: e.clientY,
      dx: 0,
      dy: 0,
      dayDelta: 0,
      minuteDelta: 0,
      committed: false,
      columnWidthPx,
    })
  }

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {/* ── Header navigation ─────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 gap-2"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <h2
          className="text-sm sm:text-base font-semibold truncate"
          style={{ color: 'var(--txt)' }}
          title={headerLabel}
        >
          {headerLabel}
        </h2>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToday}
            className="px-2 sm:px-3 py-1.5 text-xs rounded-lg font-medium"
            style={{
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
              background: 'var(--bg-elev)',
            }}
            title="Aujourd'hui"
          >
            <span className="sm:hidden">Auj.</span>
            <span className="hidden sm:inline">Aujourd&apos;hui</span>
          </button>
          <button
            type="button"
            onClick={onPrev}
            aria-label="Précédent"
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--txt-2)', border: '1px solid var(--brd)', background: 'var(--bg-elev)' }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Suivant"
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--txt-2)', border: '1px solid var(--brd)', background: 'var(--bg-elev)' }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Conteneur scroll horizontal (mobile semaine) ──────────────────── */}
      <div
        className={needsHScroll ? 'overflow-x-auto' : ''}
        style={needsHScroll ? { WebkitOverflowScrolling: 'touch' } : undefined}
      >
        <div style={gridMinWidth > 0 ? { minWidth: `${gridMinWidth}px` } : undefined}>

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
          className="px-1 sm:px-2 py-2 text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--txt-3)', borderRight: '1px solid var(--brd-sub)' }}
        >
          {maxAllDay > 0 ? (bp.isMobile ? 'J.' : 'Journée') : ''}
        </div>

        {columns.map((col, idx) => {
          const isToday = isSameDay(col.day, today)
          const dow = (col.day.getDay() + 6) % 7 // 0 = lundi
          const dowLabel = bp.isMobile
            ? WEEKDAYS_SHORT_FR[dow].charAt(0)
            : WEEKDAYS_SHORT_FR[dow]
          // Si onDayClick est fourni (vue Semaine), on rend l'en-tête de jour
          // cliquable (pattern zoom → Jour, typique mobile). L'élément devient
          // un button accessible avec cursor-pointer et affordance hover.
          const DayHeader = onDayClick ? 'button' : 'div'
          const dayHeaderProps = onDayClick
            ? {
                type: 'button',
                onClick: () => onDayClick(col.day),
                title: `Ouvrir le jour ${col.day.getDate()} en vue Jour`,
                className:
                  'w-full flex items-center justify-center gap-1 sm:gap-1.5 rounded-md py-0.5 transition hover:bg-[var(--bg-hov)]',
              }
            : {
                className: 'flex items-center justify-center gap-1 sm:gap-1.5',
              }
          return (
            <div
              key={col.key}
              className="px-1 sm:px-2 py-2 text-center flex flex-col gap-1"
              style={{
                borderRight: idx === columns.length - 1 ? 'none' : '1px solid var(--brd-sub)',
                background: isToday ? 'var(--blue-bg)' : 'transparent',
              }}
            >
              <DayHeader {...dayHeaderProps}>
                <span
                  className="text-[10px] uppercase font-medium tracking-wide"
                  style={{ color: isToday ? 'var(--blue)' : 'var(--txt-3)' }}
                >
                  {dowLabel}
                </span>
                <span
                  className="text-xs sm:text-sm font-semibold"
                  style={{ color: isToday ? 'var(--blue)' : 'var(--txt)' }}
                >
                  {col.day.getDate()}
                </span>
              </DayHeader>

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
                        className="text-left text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-[2px] rounded truncate"
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

      {/* ── Grille horaire scrollable (scroll-y) ──────────────────────────── */}
      <div
        className="overflow-y-auto"
        style={{ maxHeight: `calc(100vh - ${(bp.isMobile ? 260 : 300) + allDayStripHeight}px)` }}
      >
        <div
          ref={gridRef}
          className="grid relative"
          style={{
            gridTemplateColumns: `${TIME_GUTTER}px repeat(${days.length}, 1fr)`,
            minHeight: `${totalHeight}px`,
            userSelect: drag ? 'none' : 'auto',
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
                className="absolute left-0 right-0 text-[10px] px-1 sm:px-1.5"
                style={{
                  top: `${i * HOUR_HEIGHT}px`,
                  color: 'var(--txt-3)',
                  transform: 'translateY(-6px)',
                }}
              >
                {bp.isMobile
                  ? String(h).padStart(2, '0') + 'h'
                  : String(h).padStart(2, '0') + ':00'}
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
                conflicts={conflicts}
                isToday={isToday}
                isLastCol={idx === columns.length - 1}
                hours={hours}
                startHour={startHour}
                endHour={endHour}
                hourHeight={HOUR_HEIGHT}
                compact={bp.isMobile}
                onEventClick={onEventClick}
                onSlotClick={onSlotClick}
                drag={drag}
                onStartDrag={startDrag}
                suppressClickRef={suppressClickRef}
              />
            )
          })}
        </div>
      </div>

        </div>
      </div>
    </div>
  )
}

/* ─── Colonne d'un jour ────────────────────────────────────────────────────── */
function DayColumn({
  day,
  events,
  conflicts,
  isToday,
  isLastCol,
  hours,
  startHour,
  endHour,
  hourHeight,
  compact,
  onEventClick,
  onSlotClick,
  drag,
  onStartDrag,
  suppressClickRef,
}) {
  const totalHeight = (endHour - startHour) * hourHeight

  // Groupement simple pour gestion du chevauchement : on calcule des "clusters"
  // d'événements qui se chevauchent pour les afficher côte-à-côte.
  const laidOut = useMemo(() => layoutEvents(events), [events])

  function handleGridClick(e) {
    // Si un drag vient de se terminer, on consomme le flag et on ignore le click.
    if (suppressClickRef && suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    // Calcule l'heure cliquée à partir de la position Y
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const minutesFromStart = Math.round((y / hourHeight) * 60 / 30) * 30 // arrondi 30min
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
            top: `${i * hourHeight}px`,
            borderTop: i === 0 ? 'none' : '1px solid var(--brd-sub)',
            height: `${hourHeight}px`,
          }}
        />
      ))}

      {/* Événements */}
      {laidOut.map((item) => {
        const ev = item.event
        const start = new Date(ev.starts_at)
        const end = new Date(ev.ends_at)
        const top = timeToTop(day, start, hourHeight, startHour, endHour)
        const bottom = timeToTop(day, end, hourHeight, startHour, endHour)
        const height = Math.max(20, bottom - top)
        const color = resolveEventColor(ev, 'var(--blue)')

        const widthPct = 100 / item.lanes
        const leftPct = item.lane * widthPct

        // Si cet event est en cours de drag, on applique un offset visuel
        const isDragging = drag && drag.event && eventKey(drag.event) === eventKey(ev) && drag.committed
        let visualOffsetY = 0
        let visualOffsetX = 0
        let visualExtraHeight = 0
        if (isDragging) {
          if (drag.mode === 'move') {
            visualOffsetY = (drag.minuteDelta / 60) * hourHeight
            visualOffsetX = drag.dayDelta * drag.columnWidthPx
          } else if (drag.mode === 'resize') {
            visualExtraHeight = (drag.minuteDelta / 60) * hourHeight
          }
        }

        const evConflicts = conflicts?.get(eventKey(ev)) || null
        const hasConflict = Array.isArray(evConflicts) && evConflicts.length > 0
        return (
          <button
            key={ev.id + fmtDateKey(day)}
            type="button"
            onPointerDown={(e) => {
              // Seul le clic gauche démarre un drag
              if (e.button !== 0) return
              // On évite de démarrer un drag si on clique sur la zone resize
              const rect = e.currentTarget.getBoundingClientRect()
              const isOnResizeHandle = e.clientY > rect.bottom - RESIZE_HANDLE_PX
              e.stopPropagation()
              onStartDrag(e, ev, isOnResizeHandle ? 'resize' : 'move')
            }}
            onClick={(e) => {
              e.stopPropagation()
              // On ignore le clic si un drag committed vient de se terminer
              if (suppressClickRef && suppressClickRef.current) {
                suppressClickRef.current = false
                return
              }
              onEventClick && onEventClick(ev)
            }}
            className="absolute text-left rounded overflow-hidden transition"
            style={{
              top: `${top + visualOffsetY}px`,
              height: `${Math.max(20, height + visualExtraHeight)}px`,
              left: `calc(${leftPct}% + 2px + ${visualOffsetX}px)`,
              width: `calc(${widthPct}% - 4px)`,
              background: `${color}22`,
              color,
              borderLeft: `3px solid ${color}`,
              padding: '2px 6px',
              opacity: isDragging ? 0.85 : 1,
              boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.2)' : 'none',
              zIndex: isDragging ? 10 : 1,
              cursor: drag && drag.event && eventKey(drag.event) === eventKey(ev)
                ? (drag.mode === 'resize' ? 'ns-resize' : 'grabbing')
                : 'grab',
            }}
            title={
              hasConflict
                ? `${ev.title} — ${fmtTime(start)}-${fmtTime(end)}\n⚠ ${evConflicts.length} conflit${evConflicts.length > 1 ? 's' : ''} équipe`
                : `${ev.title} — ${fmtTime(start)}-${fmtTime(end)}`
            }
          >
            <div
              className={
                compact
                  ? 'text-[10px] font-medium truncate pointer-events-none leading-tight'
                  : 'text-[11px] font-medium truncate pointer-events-none'
              }
            >
              {ev.title}
            </div>
            {height > (compact ? 26 : 30) && (
              <div className="text-[10px] opacity-70 truncate pointer-events-none">
                {fmtTime(start)} – {fmtTime(end)}
              </div>
            )}

            {hasConflict && (
              <span
                aria-label="Conflit équipe"
                className="absolute top-[4px] right-[4px] w-2 h-2 rounded-full pointer-events-none"
                style={{ background: 'var(--red)', boxShadow: '0 0 0 1.5px var(--bg-surf)' }}
              />
            )}

            {/* Poignée de resize (bas) — purement visuelle, capturée par onPointerDown */}
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: `${RESIZE_HANDLE_PX}px`,
                cursor: 'ns-resize',
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

function fmtTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Identifiant compound pour distinguer les occurrences d'une même série récurrente. */
function eventKey(ev) {
  if (!ev) return ''
  return ev._occurrence_key ? `${ev.id}|${ev._occurrence_key}` : String(ev.id)
}

/** Décale une date de `days` jours et `minutes` minutes (valeurs signées). */
function shiftDate(date, days, minutes) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  d.setMinutes(d.getMinutes() + minutes)
  return d
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
