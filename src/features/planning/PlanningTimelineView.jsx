/**
 * PlanningTimelineView — vue Gantt horizontale (PL-3.5 étape 5, v2).
 *
 * Modèle : un axe X temporel (1 colonne = 1 jour), des "lanes" verticales
 * qui regroupent les événements par `config.groupBy` (lot / type / location),
 * et du packing automatique pour empiler les events qui se chevauchent dans
 * une même lane sur plusieurs sub-rows.
 *
 * Palier 2 (v2) — ajouts :
 *   - Zoom temporel (jour / semaine / mois) → DAY_WIDTH dynamique.
 *   - Densité (confortable / compact) → ROW_HEIGHT dynamique.
 *   - Ligne verticale "aujourd'hui" persistante au-dessus des barres.
 *   - Milestones : les events de durée ≤ 1h s'affichent en losange.
 *   - Collapse/expand par lane (état local, non persisté).
 *   - Drag + resize des barres :
 *        · middle grab  → déplace en préservant la durée
 *        · handle gauche → décale starts_at uniquement
 *        · handle droit  → décale ends_at uniquement
 *        · snap au jour · Escape annule · clic sans bouger → onEventClick
 *
 * Interactions :
 *   - Click sur une barre       → ouvre l'éditeur (onEventClick)
 *   - Drag middle / handles      → onEventMove / onEventResize (parent gère
 *                                  le scope modal pour occurrences récurrentes)
 *   - Click sur la zone vide    → crée un event à cette date (onDayClick)
 *   - Boutons zoom / densité     → onConfigChange(patch)
 *   - Nav prev/next/today       → géré par le parent, cf. windowRange
 *
 * Props :
 *   - events         : Array<Event>  (déjà filtrés + expansés par le parent)
 *   - groupBy        : string | null (défaut 'lot' via defaultViewConfig)
 *   - windowStart    : Date — première date affichée (inclusive)
 *   - windowDays     : number — nombre de jours visibles (défaut 30)
 *   - zoomLevel      : 'day' | 'week' | 'month' (défaut 'day')
 *   - density        : 'comfortable' | 'compact' (défaut 'comfortable')
 *   - showTodayLine  : boolean (défaut true)
 *   - eventTypes     : Array<EventType>
 *   - lots           : Array<Lot>
 *   - locations      : Array<Location>
 *   - conflicts      : Map<eventKey, conflicts>
 *   - onEventClick   : (event) => void
 *   - onEventMove    : (event, newStart, newEnd) => void
 *   - onEventResize  : (event, newEnd) => void
 *   - onDayClick     : (date) => void
 *   - onPrev/onNext/onToday : navigation (facultative — barre rendue si présents)
 *   - headerLabel    : string — libellé affiché dans la barre de nav
 *   - onOpenConfig   : () => void — CTA vers drawer si groupBy null
 *   - onConfigChange : (patch) => void — persist zoom/density/showTodayLine
 */
import { useMemo, useRef, useEffect, useState, useCallback, useReducer } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightSmall,
  AlertTriangle,
  GanttChart,
  Settings as SettingsIcon,
  MapPin,
  Rows3,
  AlignJustify,
} from 'lucide-react'
import {
  layoutTimelineLanes,
  eventKey,
  EVENT_MEMBER_STATUS,
  TIMELINE_ZOOMS,
  TIMELINE_ZOOM_ORDER,
  TIMELINE_DENSITIES,
  isMilestone,
} from '../../lib/planning'
import {
  startOfDay,
  addDays,
  isSameDay,
  WEEKDAYS_SHORT_FR,
  MONTHS_FR,
} from './dateUtils'
import { useBreakpoint } from '../../hooks/useBreakpoint'

// ── Constantes de layout fixes ─────────────────────────────────────────────

// Largeur de la colonne sticky des labels de lane. Sur mobile on rogne cette
// gouttière pour libérer davantage de px horizontaux pour les barres.
const LANE_LABEL_WIDTH_BY_BP = { mobile: 120, tablet: 160, desktop: 180 }
const ROW_GAP = 4             // px vertical entre sub-rows
const LANE_PADDING_Y = 8      // px padding haut/bas dans chaque lane
const HANDLE_WIDTH_PX = 6     // px zone de resize aux extrémités d'une barre
const DRAG_THRESHOLD_PX = 4   // px à dépasser pour différencier drag et click
const MS_PER_DAY = 24 * 3600 * 1000
const MS_PER_HOUR = 60 * 60 * 1000

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtShortTime(iso, allDay) {
  if (!iso) return ''
  const d = new Date(iso)
  if (allDay) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function fmtWindowLabel(windowStart, windowDays) {
  const end = addDays(windowStart, windowDays - 1)
  const sameMonth = windowStart.getMonth() === end.getMonth()
    && windowStart.getFullYear() === end.getFullYear()
  if (sameMonth) {
    return `${windowStart.getDate()} – ${end.getDate()} ${MONTHS_FR[end.getMonth()]} ${end.getFullYear()}`
  }
  const a = `${windowStart.getDate()} ${MONTHS_FR[windowStart.getMonth()].slice(0, 3)}.`
  const b = `${end.getDate()} ${MONTHS_FR[end.getMonth()].slice(0, 3)}. ${end.getFullYear()}`
  return `${a} – ${b}`
}

/**
 * Calcule la position (left, width) d'un event pour la fenêtre donnée.
 * Les events qui débordent la fenêtre sont clampés aux bords (et marqués
 * overflowLeft / overflowRight pour un affichage visuel de coupure).
 */
function computeBarGeometry(event, windowStart, windowDays, dayWidth) {
  const winStart = windowStart.getTime()
  const winEnd = winStart + windowDays * MS_PER_DAY
  const evStart = new Date(event.starts_at).getTime()
  const evEnd = new Date(event.ends_at).getTime()

  const clampedStart = Math.max(evStart, winStart)
  const clampedEnd = Math.min(evEnd, winEnd)
  const startFraction = (clampedStart - winStart) / MS_PER_DAY
  const endFraction = (clampedEnd - winStart) / MS_PER_DAY

  const left = startFraction * dayWidth
  const width = Math.max(6, (endFraction - startFraction) * dayWidth)

  return {
    left,
    width,
    overflowLeft: evStart < winStart,
    overflowRight: evEnd > winEnd,
  }
}

/**
 * Filtre les events qui intersectent la fenêtre [windowStart, +windowDays).
 */
function filterEventsInWindow(events, windowStart, windowDays) {
  const winStart = windowStart.getTime()
  const winEnd = winStart + windowDays * MS_PER_DAY
  return (events || []).filter((ev) => {
    const evStart = new Date(ev.starts_at).getTime()
    const evEnd = new Date(ev.ends_at).getTime()
    return evEnd > winStart && evStart < winEnd
  })
}

/**
 * Résout un label lisible pour une lane (clé de groupement).
 * `memberMap` (Map ou objet) résout les identités `p:<uuid>` / `c:<uuid>`
 * en nom affiché ; sans, on retombe sur un stub UUID lisible.
 */
function labelForLane(groupBy, key, { typeMap, lotMap, locationMap, memberMap }) {
  if (!groupBy || key === '__all__') return 'Tous les événements'
  if (key === '__null__') {
    if (groupBy === 'lot') return 'Sans lot'
    if (groupBy === 'type') return 'Sans type'
    if (groupBy === 'location') return 'Sans lieu'
    if (groupBy === 'status') return 'Sans statut'
    if (groupBy === 'member') return 'Sans équipe'
    return '— Sans valeur —'
  }
  if (groupBy === 'lot') return lotMap[key]?.title || 'Lot inconnu'
  if (groupBy === 'type') return typeMap[key]?.label || 'Type inconnu'
  if (groupBy === 'location') return locationMap[key]?.name || 'Lieu inconnu'
  if (groupBy === 'status') return EVENT_MEMBER_STATUS[key]?.label || String(key)
  if (groupBy === 'member') {
    // memberMap peut être un Map ou un objet plain — on supporte les deux.
    const name = memberMap instanceof Map ? memberMap.get(key) : memberMap?.[key]
    if (name) return name
    if (String(key).startsWith('p:')) return `Profil · ${String(key).slice(2, 10)}…`
    if (String(key).startsWith('c:')) return `Intervenant · ${String(key).slice(2, 10)}…`
  }
  return String(key)
}

/**
 * Hash déterministe d'une string vers une teinte HSL [0..360). Utilisé pour
 * donner une couleur stable aux lanes membres en l'absence de couleur DB.
 */
function hueFromString(s) {
  const str = String(s || '')
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 360
}

function colorForLane(groupBy, key, { typeMap }) {
  if (groupBy === 'type' && key !== '__null__' && key !== '__all__') {
    return typeMap[key]?.color || null
  }
  if (groupBy === 'member' && key !== '__null__' && key !== '__all__') {
    // Saturation modérée + lightness adaptée au thème sombre.
    return `hsl(${hueFromString(key)}, 55%, 60%)`
  }
  return null
}

// ── Composant principal ────────────────────────────────────────────────────

export default function PlanningTimelineView({
  events = [],
  groupBy = 'lot',
  windowStart,
  windowDays = 30,
  zoomLevel = 'day',
  density = 'comfortable',
  showTodayLine = true,
  eventTypes = [],
  lots = [],
  locations = [],
  memberMap = null,
  conflicts,
  onEventClick,
  onEventMove,
  onEventResize,
  onDayClick,
  onPrev,
  onNext,
  onToday,
  onJumpToDate,
  headerLabel,
  onOpenConfig,
  onConfigChange,
}) {
  // Dimensions dérivées du zoom/densité. Valeur par défaut défensive si la
  // config reçoit une clé inconnue (évite un NaN dans les calculs de layout).
  const zoomDef = TIMELINE_ZOOMS[zoomLevel] || TIMELINE_ZOOMS.day
  const densityDef = TIMELINE_DENSITIES[density] || TIMELINE_DENSITIES.comfortable
  const dayWidth = zoomDef.dayWidth
  const rowHeight = densityDef.rowHeight
  const bp = useBreakpoint()
  const laneLabelWidth = LANE_LABEL_WIDTH_BY_BP[bp.is]

  // Auto-fit horizontal : on mesure la largeur du scroller pour bumper
  // `windowDays` à ce qui tient à l'écran. Évite d'avoir un grand fond vide
  // à droite quand la config demande peu de jours sur un large écran. On ne
  // réduit jamais sous `windowDays` configuré — seule une extension est
  // possible. Les events au-delà sont déjà chargés (parent fait ±6 mois).
  const [containerWidth, setContainerWidth] = useState(0)
  const fitWindowDays = useMemo(() => {
    if (containerWidth <= 0) return windowDays
    const capacity = Math.floor((containerWidth - laneLabelWidth) / dayWidth)
    return Math.max(windowDays, capacity)
  }, [containerWidth, windowDays, dayWidth, laneLabelWidth])

  // Fallback défensif : si pas de fenêtre, on se cale sur aujourd'hui
  const winStart = useMemo(() => startOfDay(windowStart || new Date()), [windowStart])

  // Maps de résolution des relations
  const typeMap = useMemo(() => {
    const m = {}
    for (const t of eventTypes) m[t.id] = t
    return m
  }, [eventTypes])
  const lotMap = useMemo(() => {
    const m = {}
    for (const l of lots) m[l.id] = l
    return m
  }, [lots])
  const locationMap = useMemo(() => {
    const m = {}
    for (const l of locations) m[l.id] = l
    return m
  }, [locations])

  // Liste de jours de la fenêtre (entêtes et grille)
  const days = useMemo(() => {
    const out = []
    for (let i = 0; i < fitWindowDays; i++) out.push(addDays(winStart, i))
    return out
  }, [winStart, fitWindowDays])

  // Events visibles dans la fenêtre (clamp) puis layout en lanes + sub-rows
  const lanes = useMemo(() => {
    const visible = filterEventsInWindow(events, winStart, fitWindowDays)
    const raw = layoutTimelineLanes(visible, { groupBy })
    const enriched = raw.map((lane) => ({
      ...lane,
      label: labelForLane(groupBy, lane.key, { typeMap, lotMap, locationMap, memberMap }),
      color: colorForLane(groupBy, lane.key, { typeMap }),
    }))
    enriched.sort((a, b) => {
      if (a.key === '__null__') return 1
      if (b.key === '__null__') return -1
      return a.label.localeCompare(b.label)
    })
    return enriched
  }, [events, winStart, fitWindowDays, groupBy, typeMap, lotMap, locationMap, memberMap])

  // ── État local : lanes repliées (par clé) ────────────────────────────────
  // Non persisté en config : c'est un choix de confort utilisateur local.
  const [collapsed, setCollapsed] = useState(() => new Set())
  const toggleCollapse = useCallback((key) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // ── Scroll ───────────────────────────────────────────────────────────────
  // Centre "aujourd'hui" au montage et à chaque changement de fenêtre.
  const scrollerRef = useRef(null)
  const lastDayWidthRef = useRef(dayWidth)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const today = startOfDay(new Date())
    const diffDays = Math.floor((today.getTime() - winStart.getTime()) / MS_PER_DAY)
    if (diffDays >= 0 && diffDays < fitWindowDays) {
      const target = Math.max(0, diffDays * dayWidth - el.clientWidth / 2 + dayWidth)
      el.scrollTo({ left: target, behavior: 'auto' })
    } else {
      el.scrollTo({ left: 0, behavior: 'auto' })
    }
    lastDayWidthRef.current = dayWidth
    // dayWidth exclu intentionnellement : on ne re-centre pas au zoom,
    // on préserve la position visible (cf. effet suivant).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart, fitWindowDays])

  // Quand le zoom change (dayWidth), préserve la position de scroll en la
  // proportionnant au nouveau ratio — l'utilisateur reste sur la même date.
  useEffect(() => {
    const el = scrollerRef.current
    const prev = lastDayWidthRef.current
    if (el && prev && prev !== dayWidth) {
      el.scrollLeft = el.scrollLeft * (dayWidth / prev)
    }
    lastDayWidthRef.current = dayWidth
  }, [dayWidth])

  // Mesure la largeur du scroller pour auto-fit (cf. fitWindowDays).
  // ResizeObserver couvre : resize fenêtre, ouverture/fermeture panneau,
  // toggle du sélecteur de scope, etc.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Drag & resize ────────────────────────────────────────────────────────
  //
  // On garde l'état du drag dans un ref (on ne veut pas re-render à chaque
  // mousemove via setState) et on déclenche des rerenders explicites via
  // un tick. Les handlers sont attachés à `window` pendant le drag pour
  // continuer à écouter même si le curseur sort de la vue (overflow).
  const dragRef = useRef(null)
  const [, forceRender] = useReducer((x) => x + 1, 0)

  const handleBarMouseDown = useCallback((ev, e, mode) => {
    if (e.button !== 0) return
    // Pas de drag/resize si aucun handler — se comporte comme un simple clic.
    if (mode === 'move' && !onEventMove) return
    if (mode === 'resize-start' && !onEventMove) return
    if (mode === 'resize-end' && !onEventResize && !onEventMove) return

    e.preventDefault()
    e.stopPropagation()

    const origStart = new Date(ev.starts_at).getTime()
    const origEnd = new Date(ev.ends_at).getTime()
    dragRef.current = {
      event: ev,
      mode,
      startX: e.clientX,
      origStart,
      origEnd,
      deltaDays: 0,
      fired: false,
    }
    // Cursor global + disable selection le temps du drag
    document.body.style.cursor =
      mode === 'move' ? 'grabbing' :
      mode === 'resize-start' ? 'w-resize' : 'e-resize'
    document.body.style.userSelect = 'none'
    forceRender()

    function commit() {
      const st = dragRef.current
      if (!st) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      cleanup()

      if (!st.fired) {
        // Simple clic — pas de mouvement significatif.
        onEventClick?.(st.event)
      } else if (st.deltaDays !== 0) {
        const deltaMs = st.deltaDays * MS_PER_DAY
        if (st.mode === 'move') {
          const ns = new Date(st.origStart + deltaMs)
          const ne = new Date(st.origEnd + deltaMs)
          onEventMove?.(st.event, ns, ne)
        } else if (st.mode === 'resize-start') {
          // Clamp : on ne peut pas inverser la barre (start >= end).
          const maxStart = st.origEnd - MS_PER_HOUR
          const nsMs = Math.min(st.origStart + deltaMs, maxStart)
          onEventMove?.(st.event, new Date(nsMs), new Date(st.origEnd))
        } else if (st.mode === 'resize-end') {
          const minEnd = st.origStart + MS_PER_HOUR
          const neMs = Math.max(st.origEnd + deltaMs, minEnd)
          if (onEventResize) onEventResize(st.event, new Date(neMs))
          else onEventMove?.(st.event, new Date(st.origStart), new Date(neMs))
        }
      }
      forceRender()
    }

    function onMove(me) {
      const st = dragRef.current
      if (!st) return
      const dx = me.clientX - st.startX
      if (!st.fired && Math.abs(dx) > DRAG_THRESHOLD_PX) st.fired = true
      st.deltaDays = Math.round(dx / dayWidth)
      forceRender()
    }
    function onUp() { commit() }
    function onKey(ke) {
      if (ke.key === 'Escape') {
        dragRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        cleanup()
        forceRender()
      }
    }
    function cleanup() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
  }, [dayWidth, onEventClick, onEventMove, onEventResize])

  const totalWidth = fitWindowDays * dayWidth

  // ── Empty state : pas de groupement choisi ───────────────────────────────
  if (!groupBy) {
    return (
      <EmptyState
        icon={<GanttChart className="w-6 h-6" style={{ color: 'var(--txt-3)' }} />}
        title="Configure la Timeline"
        description="Choisis un groupement (par lot, type ou lieu) pour générer les lanes de la timeline."
        ctaLabel="Ouvrir la configuration"
        onCta={onOpenConfig}
      />
    )
  }

  // Index today dans la fenêtre (pour la ligne verticale)
  const today = startOfDay(new Date())
  const todayDiff = Math.floor((today.getTime() - winStart.getTime()) / MS_PER_DAY)
  const todayInWindow = todayDiff >= 0 && todayDiff < fitWindowDays

  return (
    <div
      className="h-full flex flex-col rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {/* Barre de nav */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid var(--brd)' }}
      >
        {onPrev && (
          <button
            type="button"
            onClick={onPrev}
            aria-label="Période précédente"
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-elev)]"
            style={{ color: 'var(--txt-2)' }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {onToday && (
          <button
            type="button"
            onClick={onToday}
            className="px-2 py-1 rounded-lg text-[11px] font-medium hover:bg-[var(--bg-elev)]"
            style={{ color: 'var(--txt-2)' }}
          >
            Aujourd&apos;hui
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            aria-label="Période suivante"
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-elev)]"
            style={{ color: 'var(--txt-2)' }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
        <span className="ml-1 text-xs font-medium" style={{ color: 'var(--txt)' }}>
          {headerLabel || fmtWindowLabel(winStart, fitWindowDays)}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {/* Zoom segmented control */}
          <div
            className="flex items-center rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--brd)' }}
            role="group"
            aria-label="Zoom"
          >
            {TIMELINE_ZOOM_ORDER.map((zk) => {
              const active = zk === zoomLevel
              const letter = zk === 'day' ? 'J' : zk === 'week' ? 'S' : 'M'
              return (
                <button
                  key={zk}
                  type="button"
                  onClick={() => onConfigChange?.({ zoomLevel: zk })}
                  disabled={!onConfigChange}
                  className="w-7 h-7 flex items-center justify-center text-[11px] font-medium disabled:opacity-50"
                  style={{
                    background: active ? 'var(--blue-bg)' : 'transparent',
                    color: active ? 'var(--blue)' : 'var(--txt-2)',
                    borderRight: zk === 'day' || zk === 'week' ? '1px solid var(--brd)' : 'none',
                  }}
                  title={`Zoom ${TIMELINE_ZOOMS[zk].label.toLowerCase()}`}
                >
                  {letter}
                </button>
              )
            })}
          </div>

          {/* Density toggle */}
          <button
            type="button"
            onClick={() => onConfigChange?.({
              density: density === 'comfortable' ? 'compact' : 'comfortable',
            })}
            disabled={!onConfigChange}
            className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-50"
            style={{
              border: '1px solid var(--brd)',
              color: 'var(--txt-2)',
            }}
            title={density === 'comfortable' ? 'Passer en compact' : 'Passer en confortable'}
          >
            {density === 'comfortable'
              ? <Rows3 className="w-3.5 h-3.5" />
              : <AlignJustify className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Scrubber ±6 mois — vue d'ensemble + jump-to-date.
          On passe fitWindowDays pour que le rectangle bleu du scrubber
          colle visuellement à ce qui est vraiment affiché à l'écran. */}
      {onJumpToDate && (
        <Scrubber
          windowStart={winStart}
          windowDays={fitWindowDays}
          events={events}
          onJump={onJumpToDate}
        />
      )}

      {/* Zone scrollable */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-auto relative"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div
          className="relative"
          style={{
            width: laneLabelWidth + totalWidth,
            minHeight: '100%',
          }}
        >
          {/* Header jours — sticky top */}
          <TimelineHeader
            days={days}
            laneLabelWidth={laneLabelWidth}
            dayWidth={dayWidth}
            zoomLevel={zoomLevel}
          />

          {/* Lanes */}
          {lanes.length === 0 ? (
            <div
              className="flex items-center justify-center py-16 text-sm"
              style={{ color: 'var(--txt-3)' }}
            >
              Aucun événement dans la fenêtre
              <span className="mx-2 opacity-40">·</span>
              <button
                type="button"
                onClick={onToday}
                className="underline hover:no-underline"
                style={{ color: 'var(--txt-2)' }}
              >
                Revenir à aujourd&apos;hui
              </button>
            </div>
          ) : lanes.map((lane) => (
            <TimelineLane
              key={lane.key}
              lane={lane}
              days={days}
              winStart={winStart}
              windowDays={fitWindowDays}
              dayWidth={dayWidth}
              rowHeight={rowHeight}
              laneLabelWidth={laneLabelWidth}
              typeMap={typeMap}
              lotMap={lotMap}
              locationMap={locationMap}
              conflicts={conflicts}
              collapsed={collapsed.has(lane.key)}
              onToggleCollapse={() => toggleCollapse(lane.key)}
              onDayClick={onDayClick}
              onBarMouseDown={handleBarMouseDown}
              dragState={dragRef.current}
            />
          ))}

          {/* Ligne verticale "aujourd'hui" — couvre toute la hauteur de la
              zone scrollable, au-dessus des barres mais sous les libellés
              sticky (z-20 pour le header). */}
          {showTodayLine && todayInWindow && (
            <div
              className="absolute pointer-events-none z-10"
              style={{
                left: laneLabelWidth + todayDiff * dayWidth + dayWidth / 2,
                top: 0,
                bottom: 0,
                width: 1,
                background: 'var(--red)',
                boxShadow: '0 0 0 1px rgba(239,68,68,0.15)',
              }}
              aria-hidden
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Header jours (mois + jour / semaine / mois) ────────────────────────────

function TimelineHeader({ days, laneLabelWidth, dayWidth, zoomLevel }) {
  // Bande supérieure : spans de mois (identique aux 3 zooms)
  const monthSpans = useMemo(() => {
    const out = []
    let current = null
    for (const d of days) {
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (!current || current.key !== key) {
        if (current) out.push(current)
        current = {
          key,
          label: `${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`,
          count: 1,
        }
      } else {
        current.count++
      }
    }
    if (current) out.push(current)
    return out
  }, [days])

  const today = startOfDay(new Date())

  return (
    <div
      className="sticky top-0 z-20"
      style={{ background: 'var(--bg-elev)', borderBottom: '1px solid var(--brd)' }}
    >
      {/* Bande mois */}
      <div className="flex items-center" style={{ height: 24 }}>
        <div
          className="sticky left-0 z-10 shrink-0"
          style={{
            width: laneLabelWidth,
            height: 24,
            background: 'var(--bg-elev)',
            borderRight: '1px solid var(--brd)',
          }}
        />
        {monthSpans.map((m) => (
          <div
            key={m.key}
            className="text-[10px] uppercase tracking-wide font-medium flex items-center px-2 shrink-0"
            style={{
              width: m.count * dayWidth,
              color: 'var(--txt-3)',
              borderRight: '1px solid var(--brd)',
            }}
          >
            {m.label}
          </div>
        ))}
      </div>

      {/* Bande jours (varie selon le zoom) */}
      <div className="flex items-center" style={{ height: 28 }}>
        <div
          className="sticky left-0 z-10 shrink-0 flex items-center px-3 text-[10px] uppercase tracking-wide"
          style={{
            width: laneLabelWidth,
            height: 28,
            background: 'var(--bg-elev)',
            color: 'var(--txt-3)',
            borderRight: '1px solid var(--brd)',
          }}
        >
          Lanes
        </div>
        {days.map((d, i) => {
          const weekday = (d.getDay() + 6) % 7 // 0 = Lun
          const isWeekend = weekday >= 5
          const isMonday = weekday === 0
          const isToday = isSameDay(d, today)

          // Zoom 'month' : pas de texte par jour, on montre juste un léger
          // tick et, le lundi, un petit libellé de semaine.
          if (zoomLevel === 'month') {
            return (
              <div
                key={i}
                className="shrink-0 flex items-end justify-center"
                style={{
                  width: dayWidth,
                  height: 28,
                  background: isToday
                    ? 'var(--blue-bg)'
                    : isWeekend
                      ? 'rgba(0,0,0,0.03)'
                      : 'transparent',
                  borderRight: isMonday ? '1px solid var(--brd)' : 'none',
                }}
                title={d.toLocaleDateString('fr-FR')}
              >
                {isMonday && dayWidth * 7 >= 42 && (
                  <span
                    className="text-[9px] leading-none pb-1 whitespace-nowrap"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    {d.getDate()}/{d.getMonth() + 1}
                  </span>
                )}
              </div>
            )
          }

          // Zoom 'week' : on garde le numéro du jour, on masque la lettre.
          if (zoomLevel === 'week') {
            return (
              <div
                key={i}
                className="flex items-center justify-center shrink-0"
                style={{
                  width: dayWidth,
                  height: 28,
                  background: isToday
                    ? 'var(--blue-bg)'
                    : isWeekend
                      ? 'rgba(0,0,0,0.03)'
                      : 'transparent',
                  color: isToday ? 'var(--blue)' : 'var(--txt-2)',
                  borderRight: '1px solid var(--brd)',
                }}
                title={d.toLocaleDateString('fr-FR')}
              >
                <span className="text-[10px] leading-none font-medium">{d.getDate()}</span>
              </div>
            )
          }

          // Zoom 'day' : weekday + numéro (version complète).
          return (
            <div
              key={i}
              className="flex flex-col items-center justify-center shrink-0"
              style={{
                width: dayWidth,
                height: 28,
                background: isToday
                  ? 'var(--blue-bg)'
                  : isWeekend
                    ? 'rgba(0,0,0,0.03)'
                    : 'transparent',
                color: isToday ? 'var(--blue)' : 'var(--txt-3)',
                borderRight: '1px solid var(--brd)',
              }}
              title={d.toLocaleDateString('fr-FR')}
            >
              <span className="text-[9px] leading-none">
                {WEEKDAYS_SHORT_FR[weekday]}
              </span>
              <span
                className="text-[11px] leading-none font-medium mt-0.5"
                style={{ color: isToday ? 'var(--blue)' : 'var(--txt-2)' }}
              >
                {d.getDate()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Lane (une ligne de groupe + ses sub-rows) ──────────────────────────────

function TimelineLane({
  lane,
  days,
  winStart,
  windowDays,
  dayWidth,
  rowHeight,
  laneLabelWidth,
  typeMap,
  lotMap,
  locationMap,
  conflicts,
  collapsed,
  onToggleCollapse,
  onDayClick,
  onBarMouseDown,
  dragState,
}) {
  const rowCount = Math.max(1, lane.rows.length)
  const expandedHeight = LANE_PADDING_Y * 2 + rowCount * rowHeight + (rowCount - 1) * ROW_GAP
  const collapsedHeight = 32
  const height = collapsed ? collapsedHeight : expandedHeight
  const today = startOfDay(new Date())

  function handleGridClick(e) {
    if (!onDayClick || collapsed) return
    // Empêche la propagation depuis un clic sur une barre
    if (e.target.closest('[data-event-bar]')) return
    // Calcule la date correspondant à la position X
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const dayIdx = Math.floor(x / dayWidth)
    if (dayIdx < 0 || dayIdx >= windowDays) return
    const date = addDays(winStart, dayIdx)
    onDayClick(date)
  }

  return (
    <div
      className="flex"
      style={{ borderBottom: '1px solid var(--brd)', minHeight: height }}
    >
      {/* Label sticky left */}
      <div
        className="sticky left-0 z-10 shrink-0 flex items-center gap-1.5 px-2"
        style={{
          width: laneLabelWidth,
          background: 'var(--bg-surf)',
          borderRight: '1px solid var(--brd)',
        }}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--bg-elev)] shrink-0"
          style={{ color: 'var(--txt-3)' }}
          aria-label={collapsed ? 'Déplier la lane' : 'Replier la lane'}
          aria-expanded={!collapsed}
        >
          {collapsed
            ? <ChevronRightSmall className="w-3.5 h-3.5" />
            : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {lane.color && (
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ background: lane.color }}
            aria-hidden
          />
        )}
        <span
          className="text-xs font-medium truncate"
          style={{ color: 'var(--txt)' }}
          title={lane.label}
        >
          {lane.label}
        </span>
        <span
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded shrink-0"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
        >
          {lane.events.length}
        </span>
      </div>

      {/* Grille + barres (vide si collapsed) */}
      <div
        className="relative shrink-0 cursor-pointer"
        style={{ width: windowDays * dayWidth, height }}
        onClick={handleGridClick}
      >
        {/* Bandes verticales (jours, weekends, today) */}
        {days.map((d, i) => {
          const weekday = (d.getDay() + 6) % 7
          const isWeekend = weekday >= 5
          const isMonday = weekday === 0
          const isToday = isSameDay(d, today)
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0"
              style={{
                left: i * dayWidth,
                width: dayWidth,
                // Au zoom très serré (month), on n'affiche un séparateur que
                // le lundi pour réduire le bruit visuel.
                borderRight: dayWidth >= 14 || isMonday
                  ? '1px solid var(--brd)'
                  : 'none',
                background: isToday
                  ? 'rgba(59,130,246,0.06)'
                  : isWeekend && dayWidth >= 10
                    ? 'rgba(0,0,0,0.02)'
                    : 'transparent',
                pointerEvents: 'none',
              }}
            />
          )
        })}

        {/* Barres événements (ou milestones) — mode normal */}
        {!collapsed && lane.rows.map((row, rowIdx) => (
          row.map((ev) => (
            <EventBarOrMilestone
              key={eventKey(ev)}
              event={ev}
              rowIdx={rowIdx}
              winStart={winStart}
              windowDays={windowDays}
              dayWidth={dayWidth}
              rowHeight={rowHeight}
              typeMap={typeMap}
              lotMap={lotMap}
              locationMap={locationMap}
              conflicts={conflicts}
              onBarMouseDown={onBarMouseDown}
              dragState={dragState}
            />
          ))
        ))}

        {/* Marques condensées en mode replié : préserve la lecture spatiale
            de l'activité de la lane sans prendre de hauteur. */}
        {collapsed && lane.events.map((ev) => (
          <CondensedEventMark
            key={eventKey(ev)}
            event={ev}
            winStart={winStart}
            windowDays={windowDays}
            dayWidth={dayWidth}
            laneHeight={height}
            typeMap={typeMap}
          />
        ))}
      </div>
    </div>
  )
}

// ── Mini-marque d'event pour le mode lane repliée ──────────────────────────
//
// Rendu purement visuel (aucune interaction) : une bande de 4px ou un mini
// losange 6×6 pour les milestones, positionnés sur l'axe temporel global.
// Permet de garder les repères spatiaux quand la lane est réduite.

function CondensedEventMark({
  event,
  winStart,
  windowDays,
  dayWidth,
  laneHeight,
  typeMap,
}) {
  const winStartMs = winStart.getTime()
  const winEndMs = winStartMs + windowDays * MS_PER_DAY
  const evStartMs = new Date(event.starts_at).getTime()
  const evEndMs = new Date(event.ends_at).getTime()
  // Hors fenêtre → rien à rendre.
  if (evEndMs <= winStartMs || evStartMs >= winEndMs) return null

  const type = event.type_id ? typeMap[event.type_id] : null
  const color = event.color_override || type?.color || 'var(--txt-3)'

  if (isMilestone(event)) {
    const size = 6
    const fractionFromStart = (evStartMs - winStartMs) / MS_PER_DAY
    const centerX = fractionFromStart * dayWidth
    return (
      <div
        className="absolute pointer-events-none"
        style={{
          left: centerX - size / 2,
          top: (laneHeight - size) / 2,
          width: size,
          height: size,
          background: color,
          transform: 'rotate(45deg)',
          borderRadius: 1,
        }}
        aria-hidden
      />
    )
  }

  const { left, width } = computeBarGeometry(event, winStart, windowDays, dayWidth)
  const barHeight = 4
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left,
        width: Math.max(3, width),
        top: (laneHeight - barHeight) / 2,
        height: barHeight,
        background: color,
        borderRadius: 2,
        opacity: 0.85,
      }}
      aria-hidden
    />
  )
}

// ── Wrapper qui choisit entre EventBar et MilestoneDiamond ─────────────────

function EventBarOrMilestone(props) {
  if (isMilestone(props.event)) {
    return <MilestoneDiamond {...props} />
  }
  return <EventBar {...props} />
}

// ── Milestone (losange pour events de durée ≤ 1h) ──────────────────────────

function MilestoneDiamond({
  event,
  rowIdx,
  winStart,
  windowDays,
  dayWidth,
  rowHeight,
  typeMap,
  lotMap,
  locationMap,
  conflicts,
  onBarMouseDown,
  dragState,
}) {
  const winStartMs = winStart.getTime()
  const winEndMs = winStartMs + windowDays * MS_PER_DAY
  const evStartMs = new Date(event.starts_at).getTime()
  if (evStartMs < winStartMs || evStartMs >= winEndMs) return null

  const isBeingDragged = dragState && dragState.event === event
  const dragDelta = isBeingDragged ? dragState.deltaDays * dayWidth : 0
  // Les milestones n'ont pas de resize (durée nulle) — on ne gère que 'move'.
  const effectiveDelta = isBeingDragged && dragState.mode === 'move' ? dragDelta : 0

  const fractionFromStart = (evStartMs - winStartMs) / MS_PER_DAY
  const centerX = fractionFromStart * dayWidth + effectiveDelta

  const size = Math.min(18, rowHeight - 6)
  const top = LANE_PADDING_Y + rowIdx * (rowHeight + ROW_GAP) + (rowHeight - size) / 2

  const type = event.type_id ? typeMap[event.type_id] : null
  const color = event.color_override || type?.color || 'var(--txt-3)'
  const lot = event.lot_id ? lotMap[event.lot_id] : null
  const location = event.location_id ? locationMap[event.location_id] : null
  const hasConflict = conflicts && conflicts.get(eventKey(event))?.length > 0

  const tooltipLines = [
    event.title || 'Sans titre',
    `Jalon · ${fmtShortTime(event.starts_at, event.all_day)}`,
    lot && `Lot : ${lot.title}`,
    location && `Lieu : ${location.name}`,
    type && `Type : ${type.label}`,
  ].filter(Boolean)

  return (
    <button
      type="button"
      data-event-bar
      onMouseDown={(e) => onBarMouseDown?.(event, e, 'move')}
      title={tooltipLines.join('\n')}
      aria-label={`Jalon : ${event.title || 'Sans titre'}`}
      className="absolute focus:outline-none focus:ring-2 focus:ring-[var(--blue)] rounded-sm"
      style={{
        left: centerX - size / 2,
        top,
        width: size,
        height: size,
        background: color,
        transform: 'rotate(45deg)',
        opacity: isBeingDragged ? 0.7 : 1,
        cursor: isBeingDragged ? 'grabbing' : 'grab',
        boxShadow: hasConflict ? '0 0 0 1.5px var(--red)' : '0 0 0 1.5px var(--bg-surf)',
      }}
    />
  )
}

// ── Barre d'événement ──────────────────────────────────────────────────────

function EventBar({
  event,
  rowIdx,
  winStart,
  windowDays,
  dayWidth,
  rowHeight,
  typeMap,
  lotMap,
  locationMap,
  conflicts,
  onBarMouseDown,
  dragState,
}) {
  const geo = computeBarGeometry(event, winStart, windowDays, dayWidth)
  let { left, width } = geo
  const { overflowLeft, overflowRight } = geo

  const isBeingDragged = dragState && dragState.event === event
  if (isBeingDragged) {
    const deltaPx = dragState.deltaDays * dayWidth
    if (dragState.mode === 'move') {
      left += deltaPx
    } else if (dragState.mode === 'resize-start') {
      left += deltaPx
      width = Math.max(dayWidth / 2, width - deltaPx)
    } else if (dragState.mode === 'resize-end') {
      width = Math.max(dayWidth / 2, width + deltaPx)
    }
  }

  const type = event.type_id ? typeMap[event.type_id] : null
  const lot = event.lot_id ? lotMap[event.lot_id] : null
  const location = event.location_id ? locationMap[event.location_id] : null
  const color = event.color_override || type?.color || 'var(--txt-3)'
  const hasConflict = conflicts && conflicts.get(eventKey(event))?.length > 0

  const top = LANE_PADDING_Y + rowIdx * (rowHeight + ROW_GAP)

  // Tooltip multi-ligne via title (natif, pas de lib)
  const tooltipLines = [
    event.title || 'Sans titre',
    `${fmtShortTime(event.starts_at, event.all_day)} → ${fmtShortTime(event.ends_at, event.all_day)}`,
    lot && `Lot : ${lot.title}`,
    location && `Lieu : ${location.name}`,
    type && `Type : ${type.label}`,
  ].filter(Boolean)

  // Handles visibles uniquement si la barre est assez large, pour éviter
  // qu'elles mangent toute la zone cliquable sur un event court à zoom serré.
  const showHandles = width >= 3 * HANDLE_WIDTH_PX + 4

  return (
    <div
      data-event-bar
      title={tooltipLines.join('\n')}
      className="absolute rounded overflow-hidden group"
      style={{
        left,
        top,
        width,
        height: rowHeight,
        background: `${color}1A`, // ~10 % alpha
        border: `1px solid ${color}`,
        borderLeftWidth: overflowLeft ? 0 : 3,
        borderRightWidth: overflowRight ? 0 : 1,
        borderTopLeftRadius: overflowLeft ? 0 : 4,
        borderBottomLeftRadius: overflowLeft ? 0 : 4,
        borderTopRightRadius: overflowRight ? 0 : 4,
        borderBottomRightRadius: overflowRight ? 0 : 4,
        opacity: isBeingDragged ? 0.75 : 1,
        boxShadow: isBeingDragged
          ? '0 4px 12px rgba(0,0,0,0.2)'
          : 'none',
      }}
    >
      {/* Zone centrale : drag/move + click (via onMouseUp interne au handler global) */}
      <button
        type="button"
        onMouseDown={(e) => onBarMouseDown?.(event, e, 'move')}
        className="absolute inset-0 text-left focus:outline-none focus:ring-2 focus:ring-[var(--blue)] rounded"
        style={{
          cursor: isBeingDragged && dragState.mode === 'move' ? 'grabbing' : 'grab',
          paddingLeft: showHandles && !overflowLeft ? HANDLE_WIDTH_PX : 0,
          paddingRight: showHandles && !overflowRight ? HANDLE_WIDTH_PX : 0,
        }}
        aria-label={event.title || 'Événement'}
      >
        <span
          className="flex items-center gap-1 h-full px-1.5 text-[11px] font-medium truncate"
          style={{ color: 'var(--txt)' }}
        >
          {hasConflict && (
            <AlertTriangle
              className="w-2.5 h-2.5 shrink-0"
              style={{ color: 'var(--red)' }}
              aria-hidden
            />
          )}
          {location && width > 120 && (
            <MapPin className="w-2.5 h-2.5 shrink-0 opacity-70" aria-hidden />
          )}
          <span className="truncate">{event.title || 'Sans titre'}</span>
        </span>
      </button>

      {/* Handle gauche (resize-start) */}
      {showHandles && !overflowLeft && (
        <div
          onMouseDown={(e) => onBarMouseDown?.(event, e, 'resize-start')}
          className="absolute top-0 bottom-0 left-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            width: HANDLE_WIDTH_PX,
            cursor: 'w-resize',
            background: color,
          }}
          aria-label="Redimensionner début"
          role="separator"
        />
      )}

      {/* Handle droit (resize-end) */}
      {showHandles && !overflowRight && (
        <div
          onMouseDown={(e) => onBarMouseDown?.(event, e, 'resize-end')}
          className="absolute top-0 bottom-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            width: HANDLE_WIDTH_PX,
            cursor: 'e-resize',
            background: color,
          }}
          aria-label="Redimensionner fin"
          role="separator"
        />
      )}
    </div>
  )
}

// ── Scrubber (overview ±6 mois avec viewport draggable) ────────────────────
//
// Strip horizontal qui représente ±6 mois autour d'aujourd'hui (fixe, l'ancre
// ne bouge pas avec la navigation). Un rectangle bleu = fenêtre visible.
// Drag du rectangle → onJump(newWindowStart). Click hors rectangle → jump
// centré sur la position cliquée.
//
// Les events apparaissent en marques verticales grises pour donner une
// lecture rapide de l'activité sur toute la période chargée.

const SCRUBBER_RANGE_DAYS_BEFORE = 180
const SCRUBBER_RANGE_DAYS_AFTER = 180
const SCRUBBER_TOTAL_DAYS =
  SCRUBBER_RANGE_DAYS_BEFORE + SCRUBBER_RANGE_DAYS_AFTER

function Scrubber({ windowStart, windowDays, events, onJump }) {
  const containerRef = useRef(null)
  const [, forceRender] = useReducer((x) => x + 1, 0)

  // Ancre : aujourd'hui (stable le temps de la vie du composant).
  // On la fige au mount pour éviter que le scrubber tressaute quand
  // l'heure change.
  const anchorRef = useRef(null)
  if (!anchorRef.current) anchorRef.current = startOfDay(new Date())
  const rangeStart = useMemo(
    () => addDays(anchorRef.current, -SCRUBBER_RANGE_DAYS_BEFORE),
    [],
  )
  const rangeStartMs = rangeStart.getTime()

  // Calcule la position relative (0..1) d'un timestamp dans la plage.
  const fractionOf = useCallback(
    (ms) => (ms - rangeStartMs) / (SCRUBBER_TOTAL_DAYS * MS_PER_DAY),
    [rangeStartMs],
  )

  // Position courante du viewport
  const viewportStartMs = windowStart.getTime()
  const viewportLeftFrac = fractionOf(viewportStartMs)
  const viewportWidthFrac =
    (windowDays * MS_PER_DAY) / (SCRUBBER_TOTAL_DAYS * MS_PER_DAY)
  const todayLeftFrac = fractionOf(anchorRef.current.getTime())

  // Fonction commune pour commit une nouvelle windowStart (snap au jour +
  // clamp aux bornes du scrubber).
  const commitNewStart = useCallback((newStartMs) => {
    const clampedMs = Math.max(
      rangeStartMs,
      Math.min(
        rangeStartMs + (SCRUBBER_TOTAL_DAYS - windowDays) * MS_PER_DAY,
        newStartMs,
      ),
    )
    const dayOffset = Math.round((clampedMs - rangeStartMs) / MS_PER_DAY)
    const date = addDays(rangeStart, dayOffset)
    onJump?.(date)
  }, [rangeStartMs, rangeStart, windowDays, onJump])

  const dragRef = useRef(null)

  function handleMouseDown(e) {
    if (e.button !== 0) return
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickFrac = clickX / rect.width

    // Test : le clic tombe-t-il dans le viewport ?
    const onViewport =
      clickFrac >= viewportLeftFrac &&
      clickFrac <= viewportLeftFrac + viewportWidthFrac

    if (!onViewport) {
      // Jump : centre le viewport sur la position cliquée.
      const targetCenterMs = rangeStartMs + clickFrac * SCRUBBER_TOTAL_DAYS * MS_PER_DAY
      commitNewStart(targetCenterMs - (windowDays / 2) * MS_PER_DAY)
      return
    }

    // Drag : déplace le viewport en gardant sa largeur.
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      rectWidth: rect.width,
      origStartMs: viewportStartMs,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
    forceRender()

    function onMove(me) {
      const st = dragRef.current
      if (!st) return
      const dx = me.clientX - st.startX
      const dxMs = (dx / st.rectWidth) * SCRUBBER_TOTAL_DAYS * MS_PER_DAY
      commitNewStart(st.origStartMs + dxMs)
    }
    function onUp() {
      dragRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      forceRender()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Marques d'events — une fine ligne verticale par event.starts_at qui
  // tombe dans la plage ±6 mois. Limité à 300 events pour garder le rendu
  // léger (au-delà on a de toute façon un bloc visuel uniforme).
  const eventMarks = useMemo(() => {
    const rangeEndMs = rangeStartMs + SCRUBBER_TOTAL_DAYS * MS_PER_DAY
    const out = []
    for (const ev of events || []) {
      if (out.length >= 300) break
      const t = new Date(ev.starts_at).getTime()
      if (!Number.isFinite(t)) continue
      if (t < rangeStartMs || t > rangeEndMs) continue
      out.push({ key: eventKey(ev), frac: fractionOf(t) })
    }
    return out
  }, [events, rangeStartMs, fractionOf])

  // Libellés discrets (1 tous les ~2 mois) pour se repérer en un coup d'œil.
  const monthLabels = useMemo(() => {
    const labels = []
    // On marque le 1er de chaque mois pair (jan/mars/mai/juil/sept/nov)
    // dans la plage. Ça fait 6 à 7 labels pour un total de 12 mois.
    const first = new Date(rangeStart)
    first.setDate(1)
    for (let i = 0; i < 14; i++) {
      const d = new Date(first)
      d.setMonth(first.getMonth() + i)
      const t = d.getTime()
      if (t < rangeStartMs) continue
      if (t > rangeStartMs + SCRUBBER_TOTAL_DAYS * MS_PER_DAY) break
      if (d.getMonth() % 2 !== 0) continue
      labels.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        frac: fractionOf(t),
        label: MONTHS_FR[d.getMonth()].slice(0, 3),
      })
    }
    return labels
  }, [rangeStart, rangeStartMs, fractionOf])

  return (
    <div
      className="px-3 pt-1.5 pb-2 shrink-0"
      style={{ borderBottom: '1px solid var(--brd)', background: 'var(--bg-surf)' }}
    >
      {/* Strip */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        className="relative select-none"
        style={{
          height: 22,
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
        aria-label="Vue d'ensemble — glisser pour naviguer"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={SCRUBBER_TOTAL_DAYS}
        aria-valuenow={Math.round((viewportStartMs - rangeStartMs) / MS_PER_DAY)}
      >
        {/* Viewport (sous les marques pour que les events restent visibles
            même quand ils tombent dans la fenêtre active). */}
        <div
          className="absolute rounded"
          style={{
            left: `${Math.max(0, viewportLeftFrac) * 100}%`,
            width: `${Math.min(1 - Math.max(0, viewportLeftFrac), viewportWidthFrac) * 100}%`,
            top: -1,
            bottom: -1,
            background: 'rgba(59,130,246,0.18)',
            border: '1.5px solid var(--blue)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
          aria-hidden
        />

        {/* Libellés mois (discrets) */}
        {monthLabels.map((m) => (
          <span
            key={m.key}
            className="absolute pointer-events-none text-[8px] uppercase leading-none"
            style={{
              left: `${m.frac * 100}%`,
              top: '50%',
              transform: 'translate(2px, -50%)',
              color: 'var(--txt-3)',
              opacity: 0.7,
              zIndex: 2,
            }}
            aria-hidden
          >
            {m.label}
          </span>
        ))}

        {/* Marques d'events — z-index > viewport pour rester visibles quand
            elles tombent dans la fenêtre active (sinon la teinte bleue les
            masque). Opacité plus contrastée pour lisibilité sur les deux fonds. */}
        {eventMarks.map((m) => (
          <div
            key={m.key}
            className="absolute pointer-events-none"
            style={{
              left: `${m.frac * 100}%`,
              top: 3,
              bottom: 3,
              width: 2,
              background: 'var(--txt)',
              opacity: 0.55,
              borderRadius: 1,
              zIndex: 3,
            }}
            aria-hidden
          />
        ))}

        {/* Ligne "aujourd'hui" */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${todayLeftFrac * 100}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: 'var(--red)',
            zIndex: 4,
          }}
          aria-hidden
        />
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ icon, title, description, ctaLabel, onCta }) {
  return (
    <div
      className="h-full flex items-center justify-center p-8"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', borderRadius: 12 }}
    >
      <div className="max-w-md text-center flex flex-col items-center gap-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
        >
          {icon}
        </div>
        <h3 className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
          {title}
        </h3>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--txt-3)' }}>
          {description}
        </p>
        {ctaLabel && onCta && (
          <button
            type="button"
            onClick={onCta}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt)',
              border: '1px solid var(--brd)',
            }}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            {ctaLabel}
          </button>
        )}
      </div>
    </div>
  )
}
