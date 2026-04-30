/**
 * MonthCalendar — Grille mensuelle 6×7 affichant les événements Captiv.
 *
 * Sans dépendance externe : rendu custom pour coller au design system (couleurs
 * issues des types d'événements, hauteur uniforme, overflow "+N autres").
 *
 * PL-5 : drag & drop d'une chip d'un jour vers un autre (heure préservée).
 * PL-5 (polish) : les événements multi-jours sont rendus comme UNE barre
 * continue par semaine traversée, plutôt que 3 pastilles distinctes.
 *
 * Props :
 *   - currentDate : Date de référence (n'importe quel jour du mois à afficher)
 *   - events      : tableau d'événements (shape EVENT_SELECT de lib/planning)
 *   - conflicts   : Map<eventKey, Array<conflict>> (PL-3, optionnel)
 *   - onEventClick: fn(event) → ouvre la modale détail
 *   - onDayClick  : fn(date)  → pré-remplit le jour dans le créateur
 *   - onEventMove : fn(event, newStart, newEnd) → drop après drag
 *   - onPrev / onNext / onToday : navigation
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  WEEKDAYS_SHORT_FR,
  fmtMonthYear,
  fmtDateKey,
  getMonthGrid,
  isSameDay,
  isSameMonth,
} from './dateUtils'
import { resolveEventColor, layoutMonthBars } from '../../lib/planning'
import { useBreakpoint } from '../../hooks/useBreakpoint'

const DRAG_THRESHOLD_PX = 4

// Dimensions adaptatives par breakpoint.
// Mobile (UI review v2, avril 2026) : on est passé 1 → 3 lanes (trop tassé,
// texte à 10px illisible) puis on recule à 2 lanes plus confortables. Chaque
// chip fait 20px de haut au lieu de 15 → on gagne ~33% d'espace texte et on
// peut passer à text-[11px] avec padding décent. Le "+N" pill absorbe le 3e
// event et au-delà → l'info n'est jamais perdue, juste d'un tap de distance.
const DIMENSIONS = {
  mobile:  { maxLanes: 2, minH: 80,  laneH: 20, laneTop: 24 },
  tablet:  { maxLanes: 2, minH: 90,  laneH: 18, laneTop: 26 },
  desktop: { maxLanes: 3, minH: 110, laneH: 20, laneTop: 28 },
}

// Initiales des jours pour la variante mobile compacte (1 caractère).
const WEEKDAYS_INITIAL_FR = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

export default function MonthCalendar({
  currentDate,
  events,
  conflicts,
  onEventClick,
  onDayClick,
  onEventMove,
  onPrev,
  onNext,
  onToday,
}) {
  const bp = useBreakpoint()
  const dims = DIMENSIONS[bp.is]
  const MAX_LANES_PER_ROW = dims.maxLanes
  const LANE_HEIGHT_PX = dims.laneH
  const LANES_TOP_OFFSET_PX = dims.laneTop

  const cells = useMemo(
    () => getMonthGrid(currentDate.getFullYear(), currentDate.getMonth()),
    [currentDate],
  )
  const rows = useMemo(
    () => layoutMonthBars(cells, events, MAX_LANES_PER_ROW),
    [cells, events, MAX_LANES_PER_ROW],
  )
  const today = useMemo(() => new Date(), [])

  // ─── Drag state ────────────────────────────────────────────────────────────
  // drag = null | {
  //   event, originX, originY, committed, hoverDay (Date|null)
  // }
  const gridRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)

  // Helper qui maintient la ref ET le state synchronisés.
  function writeDrag(next) {
    dragRef.current = next
    setDrag(next)
  }

  useEffect(() => {
    if (!drag) return undefined

    function findDayFromPoint(clientX, clientY) {
      // On cherche la cellule jour sous le pointeur (data-day = YYYY-MM-DD)
      const el = document.elementFromPoint(clientX, clientY)
      if (!el) return null
      const cell = el.closest('[data-day]')
      if (!cell) return null
      const key = cell.getAttribute('data-day')
      if (!key) return null
      const [y, m, d] = key.split('-').map(Number)
      return new Date(y, m - 1, d)
    }

    function onPointerMove(e) {
      const cur = dragRef.current
      if (!cur) return
      const dx = e.clientX - cur.originX
      const dy = e.clientY - cur.originY
      const committed = cur.committed || Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX
      const hoverDay = committed ? findDayFromPoint(e.clientX, e.clientY) : null
      writeDrag({ ...cur, dx, dy, committed, hoverDay })
    }

    function onPointerUp() {
      const cur = dragRef.current
      if (!cur) {
        writeDrag(null)
        return
      }
      if (!cur.committed || !cur.hoverDay) {
        writeDrag(null)
        return
      }
      const ev = cur.event
      const start = new Date(ev.starts_at)
      const end = new Date(ev.ends_at)
      // Différence de jours entre start courant et hoverDay (ancré sur 00:00 local)
      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
      const dropDay = new Date(cur.hoverDay.getFullYear(), cur.hoverDay.getMonth(), cur.hoverDay.getDate())
      const dayDelta = Math.round((dropDay.getTime() - startDay.getTime()) / (24 * 3600 * 1000))
      if (dayDelta === 0) {
        writeDrag(null)
        return
      }
      // Drag effectif : on bloque le click qui va suivre
      suppressClickRef.current = true
      const newStart = addDays(start, dayDelta)
      const newEnd = addDays(end, dayDelta)
      onEventMove && onEventMove(ev, newStart, newEnd)
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
  }, [drag !== null, onEventMove])

  function startDrag(e, ev) {
    writeDrag({
      event: ev,
      originX: e.clientX,
      originY: e.clientY,
      dx: 0,
      dy: 0,
      committed: false,
      hoverDay: null,
    })
  }

  const isCommittedDrag = Boolean(drag && drag.committed)

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden h-full"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {/* ── Header navigation ─────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 gap-2"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <h2
          className="text-sm sm:text-base font-semibold capitalize truncate"
          style={{ color: 'var(--txt)' }}
        >
          {fmtMonthYear(currentDate)}
        </h2>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToday}
            className="px-2 sm:px-3 py-1.5 text-xs rounded-lg font-medium transition"
            style={{
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
              background: 'var(--bg-elev)',
            }}
            title="Aujourd'hui"
            aria-label="Aujourd'hui"
          >
            {bp.isMobile ? 'Auj.' : 'Aujourd\u2019hui'}
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
        className="grid grid-cols-7 text-[10px] sm:text-[11px] font-medium uppercase tracking-wide"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        {(bp.isMobile ? WEEKDAYS_INITIAL_FR : WEEKDAYS_SHORT_FR).map((w, i) => (
          <div
            key={`wd-${i}`}
            className="px-1 sm:px-2 py-1.5 sm:py-2 text-center"
            style={{ color: 'var(--txt-3)' }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* ── 6 lignes semaine (chaque ligne = background cells + overlay bars) ── */}
      <div
        ref={gridRef}
        className="flex-1 flex flex-col"
        style={{ userSelect: isCommittedDrag ? 'none' : 'auto' }}
      >
        {rows.map((row) => {
          const isLastRow = row.rowIdx === 5
          const rowCells = cells.slice(row.rowIdx * 7, row.rowIdx * 7 + 7)
          return (
            <div
              key={`row-${row.rowIdx}`}
              className="relative grid grid-cols-7 flex-1"
              style={{ minHeight: `${dims.minH}px` }}
            >
              {/* ── Background : 7 cases du jour ───────────────────────── */}
              {rowCells.map((day, colIdx) => {
                const key = fmtDateKey(day)
                const inMonth = isSameMonth(day, currentDate)
                const isToday = isSameDay(day, today)
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                const isLastCol = colIdx === 6
                const isHoverTarget = isCommittedDrag && drag.hoverDay && isSameDay(drag.hoverDay, day)
                const overflow = row.overflowByCol[colIdx] || 0

                return (
                  <div
                    key={key}
                    data-day={key}
                    onClick={() => {
                      if (isCommittedDrag) return
                      onDayClick && onDayClick(day)
                    }}
                    className="p-1 sm:p-1.5 flex flex-col cursor-pointer transition"
                    style={{
                      background: isHoverTarget
                        ? 'var(--blue-bg)'
                        : inMonth
                          ? isWeekend ? 'var(--bg-elev)' : 'var(--bg-surf)'
                          : 'var(--bg-elev)',
                      opacity: inMonth ? 1 : 0.55,
                      borderRight: isLastCol ? 'none' : '1px solid var(--brd-sub)',
                      borderBottom: isLastRow ? 'none' : '1px solid var(--brd-sub)',
                      outline: isHoverTarget ? '2px solid var(--blue)' : 'none',
                      outlineOffset: isHoverTarget ? '-2px' : '0',
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

                    {/* Spacer : réserve l'espace pour les barres de la lane */}
                    <div
                      className="flex-1"
                      style={{ minHeight: `${LANE_HEIGHT_PX * MAX_LANES_PER_ROW}px` }}
                    />

                    {/* Overflow — pastille "+N" contrastée en bas-droite de
                        la cellule. Clic sur la cellule (onDayClick) ouvre le
                        créateur/la modale jour → l'utilisateur peut voir les
                        events cachés dans une vue dédiée. Pattern Google
                        Calendar : le "+N more" est toujours visible et sert
                        d'ancre de survol/clic. */}
                    {overflow > 0 && (
                      <span
                        aria-label={`${overflow} événement${overflow > 1 ? 's' : ''} de plus`}
                        title={`+${overflow} événement${overflow > 1 ? 's' : ''} masqué${overflow > 1 ? 's' : ''}`}
                        className="self-end mt-auto inline-flex items-center justify-center text-[9px] sm:text-[10px] font-semibold rounded-full px-1.5 leading-none"
                        style={{
                          background: 'var(--bg-elev)',
                          color: 'var(--txt-2)',
                          border: '1px solid var(--brd-sub)',
                          height: '16px',
                          minWidth: '20px',
                        }}
                      >
                        +{overflow}
                      </span>
                    )}
                  </div>
                )
              })}

              {/* ── Overlay : barres multi-jours ───────────────────────── */}
              {/* Le conteneur reste pointer-events:none en permanence pour ne
                  PAS intercepter les clics dans les zones vides (→ onDayClick).
                  Les <button> de barre activent individuellement pointer-events
                  (sauf pendant un drag committed : on laisse passer pour que
                  elementFromPoint atteigne les cellules cible). */}
              <div
                className="absolute inset-0"
                style={{ pointerEvents: 'none' }}
              >
                {row.bars.map((bar) => {
                  const color = resolveEventColor(bar.event, 'var(--blue)')
                  const leftPct = (bar.startCol / 7) * 100
                  const widthPct = ((bar.endCol - bar.startCol + 1) / 7) * 100
                  const topPx = LANES_TOP_OFFSET_PX + bar.laneIndex * LANE_HEIGHT_PX
                  const ev = bar.event
                  const startD = new Date(ev.starts_at)
                  // Heure affichée seulement au début réel de l'événement
                  // (segment qui ne continue pas à gauche) ET en desktop/tablet.
                  // Sur mobile, on masque l'heure pour libérer la place du
                  // titre (pattern Google Calendar mobile — l'heure reste
                  // accessible dans la modale de détail au tap).
                  const showTime = !ev.all_day && !bar.continuesLeft && !bp.isMobile
                  const timeLabel = showTime
                    ? `${String(startD.getHours()).padStart(2, '0')}:${String(startD.getMinutes()).padStart(2, '0')} `
                    : ''
                  const isDragging = drag && drag.event && eventKey(drag.event) === eventKey(ev) && drag.committed
                  const evConflicts = conflicts?.get(eventKey(ev)) || null
                  const hasConflict = Array.isArray(evConflicts) && evConflicts.length > 0
                  // LIV-22f — Préfixe livrable pour les events miroir d'étapes
                  // (ex: "🔗 A1 · MASTER — Pré-derush"). On masque le préfixe
                  // sur les segments qui continuent à gauche (continuesLeft)
                  // pour ne pas le répéter sur chaque ligne semaine.
                  const livMeta = ev.livrable_etape_meta || null
                  const baseTitle = ev.title
                  const titleWithPrefix =
                    livMeta && !bar.continuesLeft
                      ? `🔗 ${livMeta.livrable_label} — ${baseTitle}`
                      : baseTitle
                  const title = bar.continuesLeft
                    ? `… ${titleWithPrefix}`
                    : titleWithPrefix

                  // Rayons : pas d'arrondis côté coupure, sinon 4px
                  const radiusLeft = bar.continuesLeft ? '0' : '4px'
                  const radiusRight = bar.continuesRight ? '0' : '4px'

                  // LIV-22f — Visuel dégradé pour les events miroir : opacité
                  // 0.65 + bordure gauche pointillée (au lieu de pleine).
                  const isLivrableEtape = Boolean(livMeta)
                  const baseOpacity = isLivrableEtape ? 0.65 : 1
                  const borderStyle = bar.continuesLeft
                    ? '0 solid'
                    : isLivrableEtape
                      ? `2px dashed ${color}`
                      : `2px solid ${color}`

                  return (
                    <button
                      key={`${eventKey(ev)}-r${row.rowIdx}-c${bar.startCol}`}
                      type="button"
                      onPointerDown={(e) => {
                        if (e.button !== 0) return
                        e.stopPropagation()
                        startDrag(e, ev)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isCommittedDrag) return
                        onEventClick && onEventClick(ev)
                      }}
                      className="absolute text-left text-[11px] font-semibold px-1.5 py-[1px] truncate transition"
                      style={{
                        left: `calc(${leftPct}% + 3px)`,
                        width: `calc(${widthPct}% - 6px)`,
                        top: `${topPx}px`,
                        height: `${LANE_HEIGHT_PX - 2}px`,
                        lineHeight: `${LANE_HEIGHT_PX - 4}px`,
                        // Chip "Google-style" contrasté : fond teinté ~33%
                        // opacité (hex `55`) pour bien sortir du fond sombre.
                        // Mobile : pas de bordure gauche → +2px de titre.
                        // Desktop/tablet : bordure 2px conservée pour marquer
                        // le début d'un event (sauf s'il vient de la semaine
                        // précédente via bar.continuesLeft).
                        background: `${color}55`,
                        color,
                        borderLeft: bp.isMobile ? 'none' : borderStyle,
                        borderTopLeftRadius: radiusLeft,
                        borderBottomLeftRadius: radiusLeft,
                        borderTopRightRadius: radiusRight,
                        borderBottomRightRadius: radiusRight,
                        opacity: isDragging ? 0.4 : baseOpacity,
                        cursor: isDragging ? 'grabbing' : 'grab',
                        // Ré-active le clic sur la barre elle-même (le conteneur est none).
                        // Désactivé pendant un drag committed pour que
                        // elementFromPoint trouve la cellule dessous.
                        pointerEvents: isCommittedDrag ? 'none' : 'auto',
                      }}
                      title={
                        hasConflict
                          ? `${title}\n⚠ ${evConflicts.length} conflit${evConflicts.length > 1 ? 's' : ''} équipe`
                          : title
                      }
                    >
                      {showTime && (
                        <span className="font-medium opacity-80 pointer-events-none">{timeLabel}</span>
                      )}
                      <span className="pointer-events-none">{title}</span>
                      {hasConflict && !bar.continuesLeft && (
                        <span
                          aria-label="Conflit équipe"
                          className="absolute top-[2px] right-[3px] w-1.5 h-1.5 rounded-full pointer-events-none"
                          style={{ background: 'var(--red)', boxShadow: '0 0 0 1.5px var(--bg-surf)' }}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Ajoute `n` jours à une date sans muter l'originale. */
function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

/** Identifiant compound pour distinguer les occurrences d'une même série récurrente. */
function eventKey(ev) {
  if (!ev) return ''
  return ev._occurrence_key ? `${ev.id}|${ev._occurrence_key}` : String(ev.id)
}
