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

import { useEffect, useMemo, useRef } from 'react'
import { Target } from 'lucide-react'
import { LIVRABLE_ETAPE_KINDS, isLivrableEnRetard } from '../../../lib/livrablesHelpers'
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
  eventTypes = [],
  mode = 'ensemble',
  focusLivrableId = null,
  zoom = 'day',
  paddingDays = 7,
  onEtapeClick,
  onLivrableClick,
  className = '',
}) {
  const dayWidth = DAY_WIDTH_BY_ZOOM[zoom] || DAY_WIDTH_BY_ZOOM.day
  const scrollRef = useRef(null)
  const didAutoScrollRef = useRef(false)

  // ─── Computation memo ──────────────────────────────────────────────────
  const { lanes, window } = useMemo(() => {
    const livrablesById = new Map(livrables.map((l) => [l.id, l]))
    const blockOrderById = new Map(blocks.map((b) => [b.id, b.sort_order ?? 0]))
    const blocksById = new Map(blocks.map((b) => [b.id, b]))
    const eventTypesById = new Map(eventTypes.map((t) => [t.id, t]))
    const allEvents = etapesToTimelineEvents(etapes, livrablesById, eventTypesById)

    let lanesData
    let scopedEvents
    let scopedLivrables
    if (mode === 'focus' && focusLivrableId) {
      scopedEvents = filterEtapesForLivrable(allEvents, focusLivrableId)
      scopedLivrables = livrables.filter((l) => l.id === focusLivrableId)
      lanesData = groupEtapesByKind(scopedEvents)
    } else {
      scopedEvents = allEvents
      scopedLivrables = livrables
      // includeEmpty: en mode 'ensemble', on affiche TOUS les livrables même
      // sans étape, pour visualiser ce qui reste à planifier.
      // blocksById : pour préfixer le numero (ex: "A1 · Teaser" au lieu de
      // "1 · Teaser") — sans header de bloc dans le Gantt, le préfixe lève
      // l'ambiguïté entre blocs.
      lanesData = groupEtapesByLivrable(scopedEvents, livrables, blockOrderById, {
        includeEmpty: true,
        blocksById,
      })
    }

    // Fenêtre : on englobe les étapes ET les `date_livraison` des livrables
    // ET aujourd'hui — pour qu'AUJ. soit toujours visible et que les
    // deadlines des livrables sans étape (MASTER, Cutdown, …) apparaissent
    // bien dans le Gantt.
    const extraDates = scopedLivrables
      .map((l) => l.date_livraison)
      .filter(Boolean)
    const scopedEtapesRaw =
      mode === 'focus' && focusLivrableId
        ? etapes.filter((e) => e.livrable_id === focusLivrableId)
        : etapes
    const win = computeWindowFromEtapes(scopedEtapesRaw, {
      paddingDays,
      extraDates,
      includeToday: true,
    })

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
  }, [livrables, etapes, blocks, eventTypes, mode, focusLivrableId, paddingDays])

  // ─── Génération de la grille ────────────────────────────────────────────
  const totalDays = window.daysCount
  const totalWidth = totalDays * dayWidth
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayOffset = dayOffsetFrom(window.start, today)
  const showTodayLine = todayOffset >= 0 && todayOffset <= totalDays
  const showPastOverlay = todayOffset > 0

  // ─── Auto-scroll vers aujourd'hui au mount ────────────────────────────
  useEffect(() => {
    if (didAutoScrollRef.current) return
    if (!showTodayLine) return
    const el = scrollRef.current
    if (!el) return
    // Centrer aujourd'hui dans la viewport horizontale, en laissant le label
    // sticky visible (LANE_LABEL_WIDTH).
    const targetLeft = Math.max(
      0,
      LANE_LABEL_WIDTH + todayOffset * dayWidth - el.clientWidth / 2,
    )
    el.scrollLeft = targetLeft
    didAutoScrollRef.current = true
  }, [showTodayLine, todayOffset, dayWidth])

  // ─── Empty state global ─────────────────────────────────────────────────
  if (!lanes.length) {
    return (
      <div
        className={`flex items-center justify-center h-64 text-sm ${className}`}
        style={{ color: 'var(--txt-3)' }}
      >
        {mode === 'focus' && focusLivrableId
          ? 'Aucune étape pour ce livrable.'
          : 'Aucun livrable dans ce projet.'}
      </div>
    )
  }

  // Header : 1 colonne par jour (en zoom day) ou agrégé (week/month)
  const headerCells = []
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(window.start.getTime() + i * MS_PER_DAY)
    headerCells.push({ index: i, date: d })
  }

  return (
    <div
      ref={scrollRef}
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
          today={today}
        />

        {/* Body : lanes */}
        <div style={{ position: 'relative' }}>
          {/* Overlay du passé — léger voile gris sur les jours < today */}
          {showPastOverlay && (
            <div
              className="pointer-events-none"
              style={{
                position: 'absolute',
                left: LANE_LABEL_WIDTH,
                top: 0,
                bottom: 0,
                width: todayOffset * dayWidth,
                background: 'var(--bg-2)',
                opacity: 0.35,
                zIndex: 1,
              }}
            />
          )}

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
              windowStart={window.start}
              totalDays={totalDays}
              onEtapeClick={onEtapeClick}
              onLivrableClick={onLivrableClick}
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

function PipelineHeader({ headerCells, dayWidth, zoom, today }) {
  const todayKey = today
    ? `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`
    : null
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
        {headerCells.map((cell) => {
          const cellKey = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
          return (
            <HeaderCell
              key={cell.index}
              date={cell.date}
              width={dayWidth}
              zoom={zoom}
              isToday={cellKey === todayKey}
            />
          )
        })}
      </div>
    </div>
  )
}

function HeaderCell({ date, width, zoom, isToday }) {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dayShort = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'][date.getDay()]
  const isWeekend = date.getDay() === 0 || date.getDay() === 6
  const showLabel = zoom === 'day' || (zoom === 'week' && date.getDay() === 1)
  return (
    <div
      className="flex flex-col items-center justify-center shrink-0 relative"
      style={{
        width,
        background: isToday
          ? 'var(--blue-bg)'
          : isWeekend
            ? 'var(--bg-2)'
            : 'transparent',
        borderRight: '1px solid var(--brd-sub)',
        fontSize: 10,
        color: 'var(--txt-3)',
        height: HEADER_HEIGHT,
      }}
    >
      {isToday && (
        <span
          className="absolute"
          style={{
            top: 2,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 8,
            fontWeight: 700,
            color: 'var(--blue)',
            letterSpacing: 0.4,
          }}
        >
          AUJ.
        </span>
      )}
      {showLabel && (
        <>
          <span style={{ fontSize: 9, marginTop: isToday ? 8 : 0 }}>{dayShort}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: isToday ? 'var(--blue)' : 'var(--txt-2)',
            }}
          >
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

function PipelineLane({
  lane,
  dayWidth,
  totalWidth,
  windowStart,
  totalDays,
  onEtapeClick,
  onLivrableClick,
}) {
  // Hauteur min : assez pour 1 sub-row même si lane vide.
  const effectiveSubRows = Math.max(1, lane.subRowsCount)
  const laneHeight =
    effectiveSubRows * ROW_HEIGHT +
    Math.max(0, effectiveSubRows - 1) * ROW_GAP +
    LANE_PADDING_Y * 2

  // Deadline (date_livraison) du livrable parent, si lane = livrable.
  const livrable = lane.livrable
  const deadlineInfo = computeDeadlineMarker(livrable, windowStart, totalDays)

  // Click sur label → drawer si livrable identifiable.
  const isClickableLabel = Boolean(livrable && onLivrableClick)
  const handleLabelClick = () => {
    if (isClickableLabel) onLivrableClick(livrable)
  }

  const isEmpty = lane.events.length === 0
  const enRetard = livrable ? isLivrableEnRetard(livrable) : false

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
          cursor: isClickableLabel ? 'pointer' : 'default',
        }}
        onClick={isClickableLabel ? handleLabelClick : undefined}
        onKeyDown={
          isClickableLabel
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleLabelClick()
                }
              }
            : undefined
        }
        role={isClickableLabel ? 'button' : undefined}
        tabIndex={isClickableLabel ? 0 : undefined}
        title={lane.label}
      >
        {lane.color && (
          <span
            className="inline-block w-2 h-2 rounded-full mr-2 shrink-0"
            style={{ background: lane.color }}
          />
        )}
        <span className="truncate flex-1">{lane.label}</span>
        {enRetard && (
          <span
            className="ml-1 px-1 rounded text-[9px] font-bold shrink-0"
            style={{
              background: 'var(--red-bg)',
              color: 'var(--red)',
              letterSpacing: 0.4,
            }}
            title="Date de livraison dépassée"
          >
            !
          </span>
        )}
      </div>

      {/* Track : zone de barres */}
      <div
        className="relative shrink-0"
        style={{
          width: totalWidth,
          minHeight: laneHeight,
        }}
      >
        {/* Marqueur deadline (livraison) — ligne verticale + icône Target.
            La ligne reste pointer-events-none (ne bloque pas les clics sur
            les barres), mais le cercle Target reçoit le hover pour afficher
            la date au survol. */}
        {deadlineInfo && (
          <>
            <div
              className="pointer-events-none"
              style={{
                position: 'absolute',
                left: deadlineInfo.offset * dayWidth,
                top: 0,
                bottom: 0,
                width: 2,
                background: deadlineInfo.color,
                opacity: 0.85,
                zIndex: 4,
              }}
            />
            <div
              className="absolute flex items-center justify-center rounded-full"
              style={{
                left: deadlineInfo.offset * dayWidth - 8,
                top: 2,
                width: 18,
                height: 18,
                background: 'var(--bg-surf)',
                border: `1.5px solid ${deadlineInfo.color}`,
                zIndex: 6,
              }}
              title={formatDeadlineTitle(livrable, deadlineInfo)}
            >
              <Target size={10} style={{ color: deadlineInfo.color }} />
            </div>
          </>
        )}

        {/* Empty state lane : message discret, sticky pour rester visible
            juste après le label sticky. Le label colle à outer-left=0 sur
            LANE_LABEL_WIDTH px, donc on ancre le texte à
            LANE_LABEL_WIDTH + 12 px du bord gauche du scroll container.
            Hors scroll, le texte est en flow normal dans la track et
            sticky le pousse jusqu'à 12 px du label ; après scroll, il
            reste fixe juste à droite du label. */}
        {isEmpty && (
          <div
            className="pointer-events-none flex items-center text-[11px] italic"
            style={{
              position: 'sticky',
              left: LANE_LABEL_WIDTH + 12,
              top: 0,
              width: 'max-content',
              height: laneHeight,
              color: 'var(--txt-3)',
              opacity: 0.7,
              zIndex: 2,
            }}
          >
            Aucune étape planifiée
          </div>
        )}

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

/**
 * Calcule la position du marqueur deadline (date_livraison) dans la lane :
 * offset en jours depuis windowStart + couleur (rouge si retard, orange sinon)
 * + flag enRetard. Renvoie null si la deadline est hors fenêtre ou s'il n'y
 * a pas de date. Le caller multipliera offset par dayWidth pour positionner
 * le marqueur.
 */
function computeDeadlineMarker(livrable, windowStart, totalDays) {
  if (!livrable?.date_livraison) return null
  const due = new Date(livrable.date_livraison + 'T00:00:00')
  if (Number.isNaN(due.getTime())) return null
  const offset = Math.round((due.getTime() - windowStart.getTime()) / MS_PER_DAY)
  if (offset < 0 || offset > totalDays) return null
  const enRetard = isLivrableEnRetard(livrable)
  return {
    offset,
    color: enRetard ? 'var(--red)' : 'var(--orange)',
    enRetard,
  }
}

/**
 * Formate le tooltip du marqueur deadline en français : "Livraison · JJ/MM/YYYY"
 * (+ "(en retard)" si pertinent).
 */
function formatDeadlineTitle(livrable, deadlineInfo) {
  const raw = livrable?.date_livraison
  if (!raw) return 'Livraison'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  const fr = m ? `${m[3]}/${m[2]}/${m[1]}` : raw
  return deadlineInfo?.enRetard
    ? `Livraison · ${fr} (en retard)`
    : `Livraison · ${fr}`
}

// ════════════════════════════════════════════════════════════════════════════
// PipelineBar — une barre représentant une étape
// ════════════════════════════════════════════════════════════════════════════

function PipelineBar({ bar, dayWidth, onClick }) {
  const { event, startOffset, widthDays, subRow } = bar
  // Label = nom de l'étape (ex: "Pré-derush", "Edit"), couleur = type d'event
  // (ex: rouge pour Dérush, vert pour Montage). Les deux sont indépendants :
  // le nom décrit CETTE étape précise, la couleur catégorise par activité.
  const meta = resolveBarMeta(event)
  const x = startOffset * dayWidth
  const w = widthDays * dayWidth - 2 // -2 px padding latéral
  const y = LANE_PADDING_Y + subRow * (ROW_HEIGHT + ROW_GAP)
  const handleClick = () => {
    onClick?.(event._etape)
  }
  // Tooltip = "Nom étape · Type — Livrable" pour disambiguïser au survol.
  const tooltipParts = [meta.label]
  if (meta.typeLabel && meta.typeLabel !== meta.label) {
    tooltipParts.push('· ' + meta.typeLabel)
  }
  if (event.livrable_nom) tooltipParts.push('— ' + event.livrable_nom)
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
      title={tooltipParts.join(' ')}
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

/**
 * Résout le label affiché + la couleur d'une barre.
 *
 * Label : nom de l'étape (`_etape.nom`) en priorité — c'est l'identité
 * unique que l'utilisateur a saisie ("Pré-derush", "Edit", "Etalo"). Si pas
 * de nom (étape sans nom, cas marginal), on tombe sur le label du type
 * d'event (Dérush, Montage…), puis sur le kind legacy, puis "Autre".
 *
 * Couleur : indépendante du label. Priorité event_type.color (configuré
 * via LIV-9) → kind legacy → gris fallback.
 *
 * Renvoie aussi `typeLabel` pour le tooltip (pour afficher "Nom · Type").
 */
function resolveBarMeta(event) {
  const et = event?.event_type
  const kindMeta = LIVRABLE_ETAPE_KINDS[event?.kind || 'autre'] || null
  const typeLabel = et?.label || kindMeta?.label || 'Autre'
  const color = et?.color || kindMeta?.color || '#94a3b8'
  const etapeNom = (event?._etape?.nom || '').toString().trim()
  const label = etapeNom || typeLabel
  return { label, color, typeLabel }
}
