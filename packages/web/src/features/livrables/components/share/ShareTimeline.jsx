// ════════════════════════════════════════════════════════════════════════════
// ShareTimeline — Mini-Gantt 3 niveaux pour la page de partage (LIV-24C-bis)
// ════════════════════════════════════════════════════════════════════════════
//
// Trois niveaux de détail (config.calendar_level du token) :
//   - 'hidden'     → composant ne s'affiche pas (return null)
//   - 'milestones' → bandes périodes en BG + marqueurs jalons (envois prévus,
//                    livraison master) sur UNE seule lane "Jalons" avec
//                    sub-rows pour éviter les chevauchements.
//   - 'phases'     → idem + une row par livrable avec les bandes de
//                    production agrégées par event_type (Dérush, Montage,
//                    Étalonnage, Son, Delivery, Feedback). Phases avec
//                    label + dates intégrées si la place le permet.
//
// Toutes les infos (dates, labels, livrables) sont visibles directement
// sur les pills — pas de tooltip natif (lent ~1s) à survoler.
//
// Props :
//   - blocks        : Array (pour préfixer numero livrable)
//   - livrables     : Array
//   - versions      : Array (date_envoi_prevu = jalons)
//   - etapes        : Array (uniquement utilisé si calendarLevel='phases')
//   - eventTypes    : Array (couleurs des phases)
//   - periodes      : { tournage, prepa, ... } (bandes BG si fournies)
//   - calendarLevel : 'hidden' | 'milestones' | 'phases'
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useRef, useEffect } from 'react'
import { Calendar as CalendarIcon, Send, Target } from 'lucide-react'

const MS_PER_DAY = 86_400_000
const LANE_LABEL_WIDTH = 150
const HEADER_HEIGHT = 36
const SUB_ROW_HEIGHT = 26      // hauteur d'une pill marqueur (icône + label + date)
const SUB_ROW_GAP = 4
const LANE_PADDING_Y = 8
const PADDING_DAYS = 3

// Largeur estimée d'un pill marqueur en pixels — utilisée pour le packing.
const ENVOI_PILL_WIDTH = 78    // [✈ V1] 18/04
const LIVRAISON_PILL_WIDTH = 110 // [🎯 Master] 22/04 · A2

// Couleurs par kind d'étape (fallback si event_type non renseigné).
const KIND_COLORS = {
  production: 'var(--blue)',
  da:         'var(--purple)',
  montage:    'var(--orange)',
  sound:      'var(--amber)',
  delivery:   'var(--green)',
  feedback:   'var(--red)',
  autre:      'var(--txt-3)',
}

export default function ShareTimeline({
  blocks = [],
  livrables = [],
  versions = [],
  etapes = [],
  eventTypes = [],
  periodes = null,
  calendarLevel = 'hidden',
}) {
  const scrollRef = useRef(null)
  const didAutoScrollRef = useRef(false)

  // ─── Window temporelle ────────────────────────────────────────────────
  const window = useMemo(() => {
    if (calendarLevel === 'hidden') return null

    const dates = []
    if (periodes && typeof periodes === 'object') {
      for (const p of Object.values(periodes)) {
        for (const range of p?.ranges || []) {
          if (range?.start) dates.push(parseISO(range.start))
          if (range?.end) dates.push(parseISO(range.end))
        }
      }
    }
    for (const l of livrables) {
      if (l.date_livraison) dates.push(parseISO(l.date_livraison))
    }
    for (const v of versions) {
      if (v.date_envoi_prevu) dates.push(parseISO(v.date_envoi_prevu))
      if (v.date_envoi) dates.push(parseISO(v.date_envoi))
    }
    if (calendarLevel === 'phases') {
      for (const e of etapes) {
        if (e.date_debut) dates.push(parseISO(e.date_debut))
        if (e.date_fin) dates.push(parseISO(e.date_fin))
      }
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    dates.push(today.getTime())

    const valid = dates.filter((d) => d != null && !Number.isNaN(d))
    if (valid.length === 0) return null

    const min = Math.min(...valid) - PADDING_DAYS * MS_PER_DAY
    const max = Math.max(...valid) + PADDING_DAYS * MS_PER_DAY
    const start = new Date(min)
    start.setHours(0, 0, 0, 0)
    const end = new Date(max)
    end.setHours(0, 0, 0, 0)
    const totalDays = Math.max(1, Math.round((end - start) / MS_PER_DAY) + 1)
    return { start, end, totalDays, today }
  }, [calendarLevel, periodes, livrables, versions, etapes])

  // ─── dayWidth : assez large pour afficher "JJ/MM" sur les lundis ──────
  // Min 18px (lisibilité), max 36px (pas trop étiré). Vise ~900-1100px total.
  const dayWidth = useMemo(() => {
    if (!window) return 24
    const target = 1000
    const w = Math.round(target / window.totalDays)
    return Math.max(18, Math.min(36, w))
  }, [window])

  const eventTypesById = useMemo(() => {
    const map = new Map()
    for (const et of eventTypes) map.set(et.id, et)
    return map
  }, [eventTypes])

  const livrablesById = useMemo(() => {
    const map = new Map()
    for (const l of livrables) map.set(l.id, l)
    return map
  }, [livrables])

  const versionsByLivrable = useMemo(() => {
    const map = new Map()
    for (const v of versions) {
      if (!v.date_envoi_prevu) continue
      if (!map.has(v.livrable_id)) map.set(v.livrable_id, [])
      map.get(v.livrable_id).push(v)
    }
    return map
  }, [versions])

  const phasesByLivrable = useMemo(() => {
    if (calendarLevel !== 'phases') return new Map()
    const map = new Map()
    for (const e of etapes) {
      if (!e.date_debut || !e.date_fin) continue
      if (!map.has(e.livrable_id)) map.set(e.livrable_id, [])
      const startMs = parseISO(e.date_debut)
      const endMs = parseISO(e.date_fin)
      if (startMs == null || endMs == null) continue
      const et = eventTypesById.get(e.event_type_id)
      const color = et?.color || KIND_COLORS[e.kind] || KIND_COLORS.autre
      const label = et?.label || (e.kind || 'Autre').toUpperCase()
      map.get(e.livrable_id).push({ start: startMs, end: endMs, color, label })
    }
    return map
  }, [calendarLevel, etapes, eventTypesById])

  // Auto-scroll vers aujourd'hui au mount.
  useEffect(() => {
    if (!window || didAutoScrollRef.current) return
    const el = scrollRef.current
    if (!el) return
    const todayOffset = Math.round((window.today.getTime() - window.start.getTime()) / MS_PER_DAY)
    const targetLeft = Math.max(
      0,
      LANE_LABEL_WIDTH + todayOffset * dayWidth - el.clientWidth / 2,
    )
    el.scrollLeft = targetLeft
    didAutoScrollRef.current = true
  }, [window, dayWidth])

  if (!window) return null

  const totalWidth = window.totalDays * dayWidth
  const todayOffset = Math.round((window.today.getTime() - window.start.getTime()) / MS_PER_DAY)

  // ─── Lane "Jalons" : packing en sub-rows ──────────────────────────────
  // On combine tous les marqueurs (envois + livraisons) avec leur position
  // pixel, leur largeur estimée, et on les répartit en sub-rows pour éviter
  // les chevauchements visuels.
  const milestonesMarkers = []
  for (const v of versions) {
    if (!v.date_envoi_prevu) continue
    const ms = parseISO(v.date_envoi_prevu)
    if (ms == null) continue
    const offset = Math.round((ms - window.start.getTime()) / MS_PER_DAY)
    if (offset < 0 || offset > window.totalDays) continue
    const livrable = livrablesById.get(v.livrable_id)
    milestonesMarkers.push({
      kind: 'envoi',
      id: `env-${v.id}`,
      offset,
      left: offset * dayWidth,
      width: ENVOI_PILL_WIDTH,
      version: v,
      livrable,
    })
  }
  for (const l of livrables) {
    if (!l.date_livraison) continue
    const ms = parseISO(l.date_livraison)
    if (ms == null) continue
    const offset = Math.round((ms - window.start.getTime()) / MS_PER_DAY)
    if (offset < 0 || offset > window.totalDays) continue
    milestonesMarkers.push({
      kind: 'livraison',
      id: `dl-${l.id}`,
      offset,
      left: offset * dayWidth,
      width: LIVRAISON_PILL_WIDTH,
      livrable: l,
    })
  }
  const milestonesPacked = packMarkers(milestonesMarkers)

  // ─── Lanes ────────────────────────────────────────────────────────────
  // - Mode 'milestones' : 1 seule lane "Jalons" qui synthétise tous les
  //   envois + livraisons (pas de détail par livrable).
  // - Mode 'phases' : 1 lane par livrable avec ses marqueurs + ses phases.
  //   Pas de lane "Jalons" en haut (redondante : tous les marqueurs sont
  //   déjà répartis dans les lanes livrable).
  const lanes = []
  if (calendarLevel === 'milestones') {
    lanes.push({
      key: 'milestones',
      label: 'Jalons',
      type: 'milestones',
      markers: milestonesPacked.markers,
      subRowsCount: milestonesPacked.subRowsCount,
    })
  }
  if (calendarLevel === 'phases') {
    for (const livrable of livrables) {
      const phases = phasesByLivrable.get(livrable.id) || []
      const livVersions = (versionsByLivrable.get(livrable.id) || []).filter((v) => v.date_envoi_prevu)
      if (phases.length === 0 && livVersions.length === 0 && !livrable.date_livraison) continue

      // Marqueurs envois + livraison du livrable, packés (compact, sans label
      // livrable car c'est la lane).
      const lanMarkers = []
      for (const v of livVersions) {
        const ms = parseISO(v.date_envoi_prevu)
        if (ms == null) continue
        const offset = Math.round((ms - window.start.getTime()) / MS_PER_DAY)
        if (offset < 0 || offset > window.totalDays) continue
        lanMarkers.push({
          kind: 'envoi',
          id: `env-${v.id}`,
          offset,
          left: offset * dayWidth,
          width: ENVOI_PILL_WIDTH,
          version: v,
          livrable,
        })
      }
      if (livrable.date_livraison) {
        const ms = parseISO(livrable.date_livraison)
        if (ms != null) {
          const offset = Math.round((ms - window.start.getTime()) / MS_PER_DAY)
          if (offset >= 0 && offset <= window.totalDays) {
            lanMarkers.push({
              kind: 'livraison',
              id: `dl-${livrable.id}`,
              offset,
              left: offset * dayWidth,
              width: LIVRAISON_PILL_WIDTH - 30, // pas de "· numero" ici
              livrable,
            })
          }
        }
      }
      const packed = packMarkers(lanMarkers)
      lanes.push({
        key: livrable.id,
        label: livrableLabel(livrable, blocks),
        type: 'livrable',
        livrable,
        phases,
        markers: packed.markers,
        subRowsCount: packed.subRowsCount,
      })
    }
  }

  // ─── Cellules header dates ────────────────────────────────────────────
  const headerCells = []
  for (let i = 0; i < window.totalDays; i++) {
    const d = new Date(window.start.getTime() + i * MS_PER_DAY)
    headerCells.push({ index: i, date: d })
  }

  return (
    <section
      className="rounded-2xl shadow-sm overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {/* Titre + niveau */}
      <div
        className="flex items-center gap-2 px-5 py-3"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <CalendarIcon className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />
        <h2
          className="text-[11px] uppercase tracking-wider font-semibold flex-1"
          style={{ color: 'var(--txt-3)' }}
        >
          Calendrier de production
        </h2>
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--txt-3)' }}
        >
          {calendarLevel === 'milestones' ? 'Jalons' : 'Jalons + phases'}
        </span>
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        <div style={{ minWidth: LANE_LABEL_WIDTH + totalWidth, position: 'relative' }}>
          <HeaderRow cells={headerCells} dayWidth={dayWidth} today={window.today} />

          <div style={{ position: 'relative' }}>
            {/* Bandes périodes en BG */}
            {periodes && Object.entries(periodes).map(([key, periode]) => (
              <PeriodeBands
                key={key}
                periodeKey={key}
                periode={periode}
                windowStart={window.start}
                totalDays={window.totalDays}
                dayWidth={dayWidth}
              />
            ))}

            {/* Today line */}
            {todayOffset >= 0 && todayOffset <= window.totalDays && (
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

            {/* Lanes */}
            {lanes.map((lane) => (
              <Lane
                key={lane.key}
                lane={lane}
                window={window}
                dayWidth={dayWidth}
              />
            ))}
          </div>
        </div>
      </div>

      <Legend periodes={periodes} />
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Packing : répartit les marqueurs en sub-rows pour éviter les chevauchements
// ════════════════════════════════════════════════════════════════════════════

function packMarkers(markers) {
  if (markers.length === 0) return { markers: [], subRowsCount: 1 }
  const sorted = [...markers].sort((a, b) => a.left - b.left)
  const subRows = [] // chaque entrée = right edge du dernier marker sur cette ligne
  const out = []
  for (const m of sorted) {
    const right = m.left + m.width
    let placed = false
    for (let i = 0; i < subRows.length; i++) {
      if (subRows[i] <= m.left) {
        subRows[i] = right
        out.push({ ...m, subRow: i })
        placed = true
        break
      }
    }
    if (!placed) {
      subRows.push(right)
      out.push({ ...m, subRow: subRows.length - 1 })
    }
  }
  return { markers: out, subRowsCount: Math.max(1, subRows.length) }
}

// ════════════════════════════════════════════════════════════════════════════
// HeaderRow — barre dates en haut
// ════════════════════════════════════════════════════════════════════════════

function HeaderRow({ cells, dayWidth, today }) {
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`
  return (
    <div
      className="sticky top-0 flex"
      style={{
        background: 'var(--bg-surf)',
        borderBottom: '1px solid var(--brd-sub)',
        height: HEADER_HEIGHT,
        zIndex: 10,
      }}
    >
      <div
        className="shrink-0 sticky left-0"
        style={{
          width: LANE_LABEL_WIDTH,
          background: 'var(--bg-surf)',
          borderRight: '1px solid var(--brd-sub)',
          zIndex: 11,
        }}
      />
      <div className="flex">
        {cells.map((cell) => {
          const cellKey = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
          const isToday = cellKey === todayKey
          const isMonday = cell.date.getDay() === 1
          const isFirstOfMonth = cell.date.getDate() === 1
          const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6
          // Affiche un libellé sur : 1er du mois, lundis, et aujourd'hui.
          const showLabel = isFirstOfMonth || isMonday || isToday
          return (
            <div
              key={cell.index}
              className="flex flex-col items-center justify-center shrink-0 relative"
              style={{
                width: dayWidth,
                background: isToday
                  ? 'var(--blue-bg)'
                  : isWeekend
                    ? 'var(--bg-elev)'
                    : 'transparent',
                borderRight: isFirstOfMonth ? '1px solid var(--brd-sub)' : 'none',
                fontSize: 10,
                color: 'var(--txt-3)',
              }}
            >
              {isToday && (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    fontSize: 8,
                    fontWeight: 700,
                    color: 'var(--blue)',
                    letterSpacing: 0.5,
                  }}
                >
                  AUJ.
                </span>
              )}
              {showLabel && (
                <span
                  style={{
                    fontWeight: isToday || isFirstOfMonth ? 700 : 500,
                    color: isToday ? 'var(--blue)' : isFirstOfMonth ? 'var(--txt)' : 'var(--txt-3)',
                    fontSize: 10,
                    whiteSpace: 'nowrap',
                    marginTop: isToday ? 8 : 0,
                  }}
                >
                  {String(cell.date.getDate()).padStart(2, '0')}/
                  {String(cell.date.getMonth() + 1).padStart(2, '0')}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PeriodeBands — bandes colorées en arrière-plan pour les périodes projet
// ════════════════════════════════════════════════════════════════════════════

const PERIODE_COLORS = {
  prepa:            'var(--blue-bg)',
  tournage:         'var(--green-bg)',
  envoi_v1:         'var(--purple-bg)',
  livraison_master: 'var(--orange-bg)',
  deadline:         'var(--red-bg)',
}

function PeriodeBands({ periodeKey, periode, windowStart, totalDays, dayWidth }) {
  const color = PERIODE_COLORS[periodeKey]
  if (!color) return null
  const ranges = (periode?.ranges || []).filter((r) => r?.start && r?.end)
  if (ranges.length === 0) return null

  return (
    <>
      {ranges.map((range, idx) => {
        const startMs = parseISO(range.start)
        const endMs = parseISO(range.end)
        if (startMs == null || endMs == null) return null
        const startOffset = Math.round((startMs - windowStart.getTime()) / MS_PER_DAY)
        const endOffset = Math.round((endMs - windowStart.getTime()) / MS_PER_DAY)
        if (endOffset < 0 || startOffset > totalDays) return null
        const clampedStart = Math.max(0, startOffset)
        const clampedEnd = Math.min(totalDays - 1, endOffset)
        const widthDays = clampedEnd - clampedStart + 1
        return (
          <div
            key={`${periodeKey}-${idx}`}
            className="pointer-events-none"
            style={{
              position: 'absolute',
              left: LANE_LABEL_WIDTH + clampedStart * dayWidth,
              top: 0,
              bottom: 0,
              width: widthDays * dayWidth,
              background: color,
              zIndex: 1,
            }}
          />
        )
      })}
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Lane — une ligne de la timeline
// ════════════════════════════════════════════════════════════════════════════

function Lane({ lane, window, dayWidth }) {
  const isMilestonesLane = lane.type === 'milestones'
  // Hauteur dynamique selon le nombre de sub-rows nécessaires.
  const subRows = Math.max(1, lane.subRowsCount || 1)
  const markersHeight = subRows * SUB_ROW_HEIGHT + Math.max(0, subRows - 1) * SUB_ROW_GAP
  // En mode livrable : on garde au moins la place pour 1 phase bar.
  const baseLaneHeight = isMilestonesLane ? markersHeight : Math.max(markersHeight, SUB_ROW_HEIGHT + 8)
  const laneHeight = baseLaneHeight + LANE_PADDING_Y * 2

  return (
    <div
      className="flex"
      style={{ minHeight: laneHeight, borderBottom: '1px solid var(--brd-sub)' }}
    >
      {/* Label sticky gauche */}
      <div
        className="sticky left-0 shrink-0 flex items-center px-3 text-xs"
        style={{
          width: LANE_LABEL_WIDTH,
          background: 'var(--bg-surf)',
          borderRight: '1px solid var(--brd-sub)',
          color: isMilestonesLane ? 'var(--txt-2)' : 'var(--txt)',
          fontWeight: isMilestonesLane ? 700 : 500,
          zIndex: 6,
        }}
        title={lane.label}
      >
        <span className="truncate">{lane.label}</span>
      </div>

      {/* Track */}
      <div
        className="relative shrink-0"
        style={{ width: window.totalDays * dayWidth, minHeight: laneHeight }}
      >
        {/* Phases bars (mode phases sur lane livrable) — derrière les marqueurs */}
        {!isMilestonesLane && (lane.phases || []).map((phase, idx) => (
          <PhaseBar
            key={idx}
            phase={phase}
            windowStart={window.start}
            totalDays={window.totalDays}
            dayWidth={dayWidth}
            laneHeight={baseLaneHeight}
          />
        ))}

        {/* Marqueurs (envois + livraisons) packés en sub-rows */}
        {(lane.markers || []).map((m) => (
          <Marker
            key={m.id}
            marker={m}
            isMilestonesLane={isMilestonesLane}
          />
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Marker — pill compact pour envoi prévu ou livraison master
// ════════════════════════════════════════════════════════════════════════════

function Marker({ marker, isMilestonesLane }) {
  const top = LANE_PADDING_Y + marker.subRow * (SUB_ROW_HEIGHT + SUB_ROW_GAP)
  const isEnvoi = marker.kind === 'envoi'
  const color = isEnvoi ? 'var(--purple)' : 'var(--orange)'
  const Icon = isEnvoi ? Send : Target
  const dateRaw = isEnvoi ? marker.version.date_envoi_prevu : marker.livrable.date_livraison
  const dateLabel = formatDateShort(dateRaw)

  // Label principal : "V1" pour envoi, "Deadline" pour livraison.
  const mainLabel = isEnvoi ? marker.version.numero_label : 'Deadline'
  // Label secondaire (lane Jalons uniquement) : numéro livrable pour
  // contextualiser. Sur lane livrable c'est redondant (label dans la sticky).
  const livrableNumero = (marker.livrable?.numero || '').trim()
  const showSecondary = isMilestonesLane && livrableNumero

  return (
    <div
      className="absolute flex items-center gap-1 px-1.5 rounded-md"
      style={{
        left: marker.left,
        top,
        height: SUB_ROW_HEIGHT,
        background: 'var(--bg-surf)',
        border: `1px solid ${color}`,
        zIndex: 4,
        whiteSpace: 'nowrap',
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
      }}
    >
      <span
        className="flex items-center justify-center rounded-full shrink-0"
        style={{
          width: 14,
          height: 14,
          background: 'var(--bg-surf)',
          border: `1.5px solid ${color}`,
        }}
      >
        <Icon size={8} style={{ color }} />
      </span>
      <span
        className="text-[10px] font-bold leading-none"
        style={{ color }}
      >
        {mainLabel}
      </span>
      {showSecondary && (
        <span
          className="text-[9px] leading-none"
          style={{ color: 'var(--txt-3)' }}
        >
          · {livrableNumero}
        </span>
      )}
      <span
        className="text-[9px] leading-none"
        style={{ color: 'var(--txt-2)', marginLeft: 2 }}
      >
        {dateLabel}
      </span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PhaseBar — rectangle d'une phase de production agrégée
// ════════════════════════════════════════════════════════════════════════════

function PhaseBar({ phase, windowStart, totalDays, dayWidth, laneHeight }) {
  const startOffset = Math.round((phase.start - windowStart.getTime()) / MS_PER_DAY)
  const endOffset = Math.round((phase.end - windowStart.getTime()) / MS_PER_DAY)
  if (endOffset < 0 || startOffset > totalDays) return null
  const clampedStart = Math.max(0, startOffset)
  const clampedEnd = Math.min(totalDays - 1, endOffset)
  const widthDays = clampedEnd - clampedStart + 1
  const w = widthDays * dayWidth - 2

  // Label : "Phase 14/04→19/04" (toujours avec dates).
  const startStr = formatDateShort(new Date(phase.start).toISOString().slice(0, 10))
  const endStr = formatDateShort(new Date(phase.end).toISOString().slice(0, 10))
  const fullLabel = startStr === endStr
    ? `${phase.label} · ${startStr}`
    : `${phase.label} · ${startStr}→${endStr}`

  return (
    <div
      className="absolute flex items-center px-2 rounded text-[10px] font-medium"
      style={{
        left: clampedStart * dayWidth + 1,
        top: LANE_PADDING_Y,
        width: w,
        height: laneHeight,
        background: phase.color,
        color: 'white',
        textShadow: '0 1px 1px rgba(0,0,0,0.3)',
        opacity: 0.92,
        zIndex: 2,
      }}
    >
      <span className="truncate" style={{ pointerEvents: 'none' }}>
        {w >= 90 ? fullLabel : w >= 40 ? phase.label : ''}
      </span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Légende
// ════════════════════════════════════════════════════════════════════════════

// Label affiché pour chaque clé de période (correspond aux bandes BG).
const PERIODE_LABELS = {
  prepa:            'Préparation',
  tournage:         'Tournage',
  envoi_v1:         'Envoi V1',
  livraison_master: 'Livraison master',
  deadline:         'Deadline projet',
}

function Legend({ periodes }) {
  // On filtre les périodes effectivement présentes (au moins un range valide)
  // pour ne lister que ce qui apparaît visuellement comme bande BG.
  const filledPeriodes = []
  if (periodes && typeof periodes === 'object') {
    for (const [key, periode] of Object.entries(periodes)) {
      if (PERIODE_COLORS[key] && (periode?.ranges || []).some((r) => r?.start && r?.end)) {
        filledPeriodes.push({ key, color: PERIODE_COLORS[key], label: PERIODE_LABELS[key] || key })
      }
    }
  }

  return (
    <div
      className="flex items-center gap-3 flex-wrap px-5 py-2.5 text-[10px]"
      style={{ borderTop: '1px solid var(--brd-sub)', color: 'var(--txt-3)' }}
    >
      <LegendDot color="var(--purple)" icon={Send} label="Envoi prévu" />
      <LegendDot color="var(--orange)" icon={Target} label="Deadline" />
      {filledPeriodes.length > 0 && (
        <>
          <span style={{ color: 'var(--brd)' }}>·</span>
          {filledPeriodes.map((p) => (
            <LegendBand key={p.key} color={p.color} label={p.label} />
          ))}
        </>
      )}
    </div>
  )
}

function LegendDot({ color, icon: Icon, label }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 12,
          height: 12,
          background: 'var(--bg-surf)',
          border: `1.5px solid ${color}`,
        }}
      >
        <Icon size={7} style={{ color }} />
      </span>
      {label}
    </span>
  )
}

function LegendBand({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block"
        style={{ width: 14, height: 10, borderRadius: 2, background: color }}
      />
      {label}
    </span>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

function formatDateShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return iso || ''
  return `${m[3]}/${m[2]}`
}

function livrableLabel(livrable, blocks = []) {
  const block = blocks.find((b) => b.id === livrable.block_id)
  const prefix = (block?.prefixe || '').trim()
  const numero = (livrable.numero || '').trim()
  const fullNumero =
    prefix && numero && !numero.startsWith(prefix) ? `${prefix}${numero}` : numero
  const nom = livrable.nom || 'Sans titre'
  return fullNumero ? `${fullNumero} · ${nom}` : nom
}
