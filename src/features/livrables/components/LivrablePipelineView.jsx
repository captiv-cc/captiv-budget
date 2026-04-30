// ════════════════════════════════════════════════════════════════════════════
// LivrablePipelineView — Vue Gantt / Pipeline LIV (LIV-22)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue 2D des étapes de livrables :
//   - Axe X horizontal = temps (1 colonne = 1 jour)
//   - Axe Y vertical   = lanes (livrables ou kinds selon view)
//   - Barres           = livrable_etapes positionnées de date_debut à date_fin
//
// Architecture :
//   - Helpers purs : src/lib/livrablesPipelineHelpers.js (LIV-22a)
//     · etapesToTimelineEvents → conversion vers shape ISO
//     · computeWindowFromEtapes → fenêtre [start, end, daysCount]
//     · groupEtapesByLivrable / groupEtapesByKind → lanes selon vue
//   - Ce composant : layout custom (pas le PlanningTimelineView qui est trop
//     spécialisé sur la shape events). Réutilise les algos purs.
//
// Vue B (mode='ensemble', défaut) :
//   - 1 lane par livrable (tri block_id puis sort_order)
//   - Toutes les étapes du livrable sur sa propre row (packing si overlap)
//   - Couleur des barres = kind de l'étape (LIVRABLE_ETAPE_KINDS)
//
// Vue A (mode='focus') :
//   - 1 lane par kind (production / DA / montage / son / delivery / feedback)
//   - Toutes les étapes filtrées sur 1 livrable (focusLivrableId)
//   - Couleur barres = kind (cohérent avec la lane)
//
// LIV-22b — V0 minimum visible : mode B, pas de drag, pas de zoom toggle,
// pas de mode A. Les autres sous-tickets (c/d/e) ajoutent les briques.
//
// Props :
//   - livrables       : Array (tableau plat, pour le mapping livrable_id → meta)
//   - etapes          : Array (livrable_etapes du projet, déjà filtrés)
//   - blocks          : Array (pour l'ordre des lanes via block.sort_order)
//   - mode            : 'ensemble' | 'focus' (LIV-22c — défaut 'ensemble')
//   - focusLivrableId : string | null (utilisé si mode='focus')
//   - zoom            : 'day' | 'week' | 'month' (défaut 'day' — LIV-22e)
//   - paddingDays     : number (défaut 7)
//   - onEtapeClick    : (etape) => void (LIV-22b → ouvre drawer LIV-9)
//   - className       : string optionnel
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'
import { LIVRABLE_ETAPE_KINDS } from '../../../lib/livrablesHelpers'
import {
  computeWindowFromEtapes,
  etapesToTimelineEvents,
  filterEtapesForLivrable,
  groupEtapesByKind,
  groupEtapesByLivrable,
} from '../../../lib/livrablesPipelineHelpers'

// ─── Constantes layout ─────────────────────────────────────────────────────

// Largeur d'une colonne jour selon le zoom. Pattern miroir du Planning Gantt.
const DAY_WIDTH_BY_ZOOM = {
  day: 32,
  week: 12,
  month: 4,
}
const LANE_LABEL_WIDTH = 200       // px sticky col gauche
const ROW_HEIGHT = 32              // px hauteur d'une sub-row de barre
const ROW_GAP = 4                  // px entre sub-rows
const LANE_PADDING_Y = 8           // px padding vertical d'une lane
const HEADER_HEIGHT = 56           // px barre dates en haut
const MS_PER_DAY = 24 * 3600 * 1000

// ─── Helpers de layout ─────────────────────────────────────────────────────

/**
 * Pack les events qui se chevauchent dans une lane sur des sub-rows.
 * Algo greedy : on trie par starts_at puis on alloue à la première sub-row
 * libre. Renvoie un Map<eventId, subRowIndex>.
 */
function packEventsIntoSubRows(events) {
  const sorted = events.slice().sort((a, b) => {
    const sa = new Date(a.starts_at).getTime()
    const sb = new Date(b.starts_at).getTime()
    return sa - sb
  })
  const subRows = [] // chaque entrée = endTime du dernier event dans cette sub-row
  const subRowByEventId = new Map()
  for (const ev of sorted) {
    const start = new Date(ev.starts_at).getTime()
    const end = new Date(ev.ends_at).getTime()
    let placed = false
    for (let i = 0; i < subRows.length; i++) {
      if (subRows[i] <= start) {
        subRows[i] = end
        subRowByEventId.set(ev.id, i)
        placed = true
        break
      }
    }
    if (!placed) {
      subRows.push(end)
      subRowByEventId.set(ev.id, subRows.length - 1)
    }
  }
  return { subRowByEventId, subRowsCount: subRows.length || 1 }
}

/**
 * Convertit une date (ISO ou Date) en offset jours depuis windowStart (00:00).
 */
function dayOffsetFrom(windowStart, dateOrIso) {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso
  return Math.round((d.getTime() - windowStart.getTime()) / MS_PER_DAY)
}

// ─── Composant principal ───────────────────────────────────────────────────

export default function LivrablePipelineView({
  livrables = [],
  etapes = [],
  blocks = [],
  mode = 'ensemble',
  focusLivrableId = null,
  zoom = 'day',
  paddingDays = 7,
  onEtapeClick,
  className = '',
}) {
  const dayWidth = DAY_WIDTH_BY_ZOOM[zoom] || DAY_WIDTH_BY_ZOOM.day

  // ─── Computation memo ──────────────────────────────────────────────────
  const { lanes, window } = useMemo(() => {
    const livrablesById = new Map(livrables.map((l) => [l.id, l]))
    const blockOrderById = new Map(blocks.map((b) => [b.id, b.sort_order ?? 0]))
    const allEvents = etapesToTimelineEvents(etapes, livrablesById)

    let lanesData
    let scopedEvents
    if (mode === 'focus' && focusLivrableId) {
      scopedEvents = filterEtapesForLivrable(allEvents, focusLivrableId)
      lanesData = groupEtapesByKind(scopedEvents)
    } else {
      scopedEvents = allEvents
      lanesData = groupEtapesByLivrable(scopedEvents, livrables, blockOrderById)
    }

    const win = computeWindowFromEtapes(
      // Pour la fenêtre, on prend les étapes brutes (pas les events ISO) →
      // computeWindowFromEtapes attend des étapes avec date_debut/date_fin.
      mode === 'focus' && focusLivrableId
        ? etapes.filter((e) => e.livrable_id === focusLivrableId)
        : etapes,
      { paddingDays },
    )

    // Pour chaque lane, packer les events en sub-rows et pré-calculer les
    // positions x/width pour chaque barre. Tout en mémo pour éviter les
    // recalculs au scroll.
    const enrichedLanes = lanesData.map((lane) => {
      const { subRowByEventId, subRowsCount } = packEventsIntoSubRows(lane.events)
      const bars = lane.events.map((ev) => {
        const startOffset = dayOffsetFrom(win.start, ev.starts_at)
        const endOffset = dayOffsetFrom(win.start, ev.ends_at)
        const widthDays = Math.max(1, endOffset - startOffset)
        const subRow = subRowByEventId.get(ev.id) ?? 0
        return {
          event: ev,
          startOffset,
          widthDays,
          subRow,
        }
      })
      return {
        ...lane,
        bars,
        subRowsCount,
      }
    })

    return { lanes: enrichedLanes, window: win }
  }, [livrables, etapes, blocks, mode, focusLivrableId, paddingDays])

  // ─── Empty state ────────────────────────────────────────────────────────
  if (!lanes.length) {
    return (
      <div
        className={`flex items-center justify-center h-64 text-sm ${className}`}
        style={{ color: 'var(--txt-3)' }}
      >
        {mode === 'focus' && focusLivrableId
          ? 'Aucune étape pour ce livrable.'
          : 'Aucune étape avec des dates dans ce projet.'}
      </div>
    )
  }

  // ─── Génération de la grille ────────────────────────────────────────────
  const totalDays = window.daysCount
  const totalWidth = totalDays * dayWidth
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayOffset = dayOffsetFrom(window.start, today)
  const showTodayLine = todayOffset >= 0 && todayOffset <= totalDays

  // Header : 1 colonne par jour (en zoom day) ou agrégé (week/month)
  const headerCells = []
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(window.start.getTime() + i * MS_PER_DAY)
    headerCells.push({ index: i, date: d })
  }

  return (
    <div
      className={`overflow-auto ${className}`}
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        borderRadius: 8,
      }}
    >
      <div style={{ minWidth: LANE_LABEL_WIDTH + totalWidth }}>
        {/* Header dates (sticky top) */}
        <PipelineHeader
          headerCells={headerCells}
          dayWidth={dayWidth}
          zoom={zoom}
        />

        {/* Body : lanes */}
        <div style={{ position: 'relative' }}>
          {/* Today line — verticale sur toute la hauteur du body */}
          {showTodayLine && (
            <div
              className="pointer-events-none"
              style={{
                position: 'absolute',
                left: LANE_LABEL_WIDTH + todayOffset * dayWidth,
                top: 0,
                bottom: 0,
                width: 1,
                background: 'var(--blue)',
                opacity: 0.6,
                zIndex: 5,
              }}
            />
          )}

          {lanes.map((lane) => (
            <PipelineLane
              key={lane.key}
              lane={lane}
              dayWidth={dayWidth}
              totalWidth={totalWidth}
              onEtapeClick={onEtapeClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PipelineHeader — barre dates en haut
// ════════════════════════════════════════════════════════════════════════════

function PipelineHeader({ headerCells, dayWidth, zoom }) {
  return (
    <div
      className="sticky top-0 z-10 flex"
      style={{
        background: 'var(--bg-elev)',
        borderBottom: '1px solid var(--brd)',
        height: HEADER_HEIGHT,
      }}
    >
      {/* Coin haut-gauche : empty */}
      <div
        className="shrink-0 sticky left-0 z-10"
        style={{
          width: LANE_LABEL_WIDTH,
          background: 'var(--bg-elev)',
          borderRight: '1px solid var(--brd-sub)',
        }}
      />
      {/* Cellules dates */}
      <div className="flex">
        {headerCells.map((cell) => (
          <HeaderCell
            key={cell.index}
            date={cell.date}
            width={dayWidth}
            zoom={zoom}
          />
        ))}
      </div>
    </div>
  )
}

function HeaderCell({ date, width, zoom }) {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dayShort = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'][date.getDay()]
  const isWeekend = date.getDay() === 0 || date.getDay() === 6
  const showLabel = zoom === 'day' || (zoom === 'week' && date.getDay() === 1)
  return (
    <div
      className="flex flex-col items-center justify-center shrink-0"
      style={{
        width,
        background: isWeekend ? 'var(--bg-2)' : 'transparent',
        borderRight: '1px solid var(--brd-sub)',
        fontSize: 10,
        color: 'var(--txt-3)',
        height: HEADER_HEIGHT,
      }}
    >
      {showLabel && (
        <>
          <span style={{ fontSize: 9 }}>{dayShort}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt-2)' }}>
            {dd}
          </span>
          <span>{mm}</span>
        </>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PipelineLane — 1 row par lane (livrable ou kind)
// ════════════════════════════════════════════════════════════════════════════

function PipelineLane({ lane, dayWidth, totalWidth, onEtapeClick }) {
  const laneHeight =
    lane.subRowsCount * ROW_HEIGHT +
    Math.max(0, lane.subRowsCount - 1) * ROW_GAP +
    LANE_PADDING_Y * 2

  return (
    <div
      className="flex"
      style={{
        borderBottom: '1px solid var(--brd-sub)',
        minHeight: laneHeight,
      }}
    >
      {/* Label sticky gauche */}
      <div
        className="sticky left-0 z-10 shrink-0 flex items-center px-3 text-xs"
        style={{
          width: LANE_LABEL_WIDTH,
          background: 'var(--bg-surf)',
          borderRight: '1px solid var(--brd-sub)',
          color: 'var(--txt)',
        }}
      >
        {lane.color && (
          <span
            className="inline-block w-2 h-2 rounded-full mr-2 shrink-0"
            style={{ background: lane.color }}
          />
        )}
        <span className="truncate" title={lane.label}>
          {lane.label}
        </span>
      </div>

      {/* Track : zone de barres */}
      <div
        className="relative shrink-0"
        style={{
          width: totalWidth,
          minHeight: laneHeight,
        }}
      >
        {lane.bars.map((bar) => (
          <PipelineBar
            key={bar.event.id}
            bar={bar}
            dayWidth={dayWidth}
            onClick={onEtapeClick}
          />
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PipelineBar — une barre représentant une étape
// ════════════════════════════════════════════════════════════════════════════

function PipelineBar({ bar, dayWidth, onClick }) {
  const { event, startOffset, widthDays, subRow } = bar
  const kind = event.kind || 'autre'
  const meta = LIVRABLE_ETAPE_KINDS[kind] || { label: kind, color: '#94a3b8' }
  const x = startOffset * dayWidth
  const w = widthDays * dayWidth - 2 // -2 px padding latéral
  const y = LANE_PADDING_Y + subRow * (ROW_HEIGHT + ROW_GAP)
  const handleClick = () => {
    onClick?.(event._etape)
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="absolute flex items-center px-2 rounded text-[11px] font-medium text-white truncate transition-shadow"
      style={{
        left: x + 1,
        top: y,
        width: w,
        height: ROW_HEIGHT,
        background: meta.color,
        border: '1px solid rgba(0,0,0,0.15)',
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        textShadow: '0 1px 1px rgba(0,0,0,0.3)',
      }}
      title={`${meta.label}${event.livrable_nom ? ' — ' + event.livrable_nom : ''}`}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.2)'
      }}
    >
      <span className="truncate">{meta.label}</span>
    </button>
  )
}
