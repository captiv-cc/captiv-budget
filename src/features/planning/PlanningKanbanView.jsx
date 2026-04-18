/**
 * PlanningKanbanView — vue board par colonnes (PL-3.5 étape 4).
 *
 * Pattern Notion/Trello : chaque colonne représente une valeur de
 * `config.groupBy` (type, lot, location). Chaque carte = un événement.
 * Drag & drop d'une carte d'une colonne à l'autre → mutation du champ
 * correspondant via `onMoveCard(event, groupBy, nextKey)`.
 *
 * Colonnes supportées au drop :
 *   - groupBy === 'type'     → mute events.type_id     (`__null__` refusé : le type est NOT NULL côté DB)
 *   - groupBy === 'lot'      → mute events.lot_id      (`__null__` = retirer du lot)
 *   - groupBy === 'location' → mute events.location_id (`__null__` = retirer du lieu)
 *
 * Les groupBy 'member' / 'status' ne sont pas droppables (ils n'ont pas de
 * champ scalaire simple à muter : ils passent par event_members). Un
 * fallback explicatif est affiché à la place du board.
 *
 * Props :
 *   - events       : Array<Event>  (déjà filtrés par le parent)
 *   - groupBy      : string | null
 *   - eventTypes   : Array<EventType>
 *   - lots         : Array<Lot>
 *   - locations    : Array<Location>
 *   - conflicts    : Map<eventKey, conflicts>
 *   - onEventClick : (event) => void
 *   - onMoveCard   : (event, groupBy, nextKey) => void|Promise
 *   - onOpenConfig : () => void  (optionnel, CTA vers le drawer)
 */
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Users as UsersIcon,
  Clock,
  MapPin,
  LayoutGrid,
  Settings as SettingsIcon,
} from 'lucide-react'
import {
  groupEventsByConfig,
  sortEventsByField,
  eventKey,
  EVENT_MEMBER_STATUS,
  GROUP_BY_FIELD_MAP,
} from '../../lib/planning'
import { useBreakpoint } from '../../hooks/useBreakpoint'

// Largeur de colonne Kanban par breakpoint. Les valeurs intermédiaires (tablet)
// cherchent le compromis lisibilité/densité ; le scroll horizontal est le mode
// principal de navigation sur mobile (avec scroll-snap sur les colonnes).
const COLUMN_WIDTH = { mobile: 260, tablet: 280, desktop: 300 }

// ── Helpers de formatage ────────────────────────────────────────────────────

function fmtShortTime(iso, allDay) {
  if (!iso) return ''
  const d = new Date(iso)
  if (allDay) {
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  }
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

function dominantStatus(members = []) {
  if (!members.length) return null
  const ranks = { confirmed: 4, tentative: 3, pending: 2, declined: 1 }
  let best = null
  let bestRank = -1
  for (const m of members) {
    const r = ranks[m.status] || 0
    if (r > bestRank) { best = m.status; bestRank = r }
  }
  return best
}

// ── Labels de colonnes ──────────────────────────────────────────────────────

function labelForColumn(groupBy, key, { typeMap, lotMap, locationMap }) {
  if (key === '__null__') {
    if (groupBy === 'lot') return 'Sans lot'
    if (groupBy === 'location') return 'Sans lieu'
    if (groupBy === 'type') return 'Sans type'
    if (groupBy === 'member') return 'Sans équipe'
    if (groupBy === 'status') return 'Sans statut'
    return '— Sans valeur —'
  }
  if (groupBy === 'type') return typeMap[key]?.label || 'Type inconnu'
  if (groupBy === 'lot') return lotMap[key]?.title || 'Lot inconnu'
  if (groupBy === 'location') return locationMap[key]?.name || 'Lieu inconnu'
  if (groupBy === 'status') return EVENT_MEMBER_STATUS[key]?.label || String(key)
  if (groupBy === 'member') {
    if (String(key).startsWith('p:')) return `Profil · ${String(key).slice(2, 10)}…`
    if (String(key).startsWith('c:')) return `Intervenant · ${String(key).slice(2, 10)}…`
    return String(key)
  }
  return String(key)
}

function colorForColumn(groupBy, key, { typeMap }) {
  if (groupBy === 'type' && key !== '__null__') {
    return typeMap[key]?.color || null
  }
  if (groupBy === 'status' && key !== '__null__') {
    return EVENT_MEMBER_STATUS[key]?.color || null
  }
  return null
}

// ── Composant principal ────────────────────────────────────────────────────

export default function PlanningKanbanView({
  events = [],
  groupBy = null,
  eventTypes = [],
  lots = [],
  locations = [],
  conflicts,
  onEventClick,
  onMoveCard,
  onOpenConfig,
}) {
  const [dragKey, setDragKey] = useState(null)          // eventKey de la carte en cours de drag
  const [dragOverCol, setDragOverCol] = useState(null)  // groupKey de la colonne survolée
  const bp = useBreakpoint()
  const columnWidth = COLUMN_WIDTH[bp.is]

  // Index de lookup pour résolution des relations
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

  const droppable = Boolean(groupBy && GROUP_BY_FIELD_MAP[groupBy])

  // Colonnes triées : libellé alpha, avec les "Sans valeur" en fin
  const columns = useMemo(() => {
    if (!groupBy) return []
    const map = groupEventsByConfig(events, { groupBy })
    const out = []
    for (const [key, list] of map.entries()) {
      out.push({
        key,
        label: labelForColumn(groupBy, key, { typeMap, lotMap, locationMap }),
        color: colorForColumn(groupBy, key, { typeMap }),
        events: sortEventsByField(list, { field: 'starts_at', direction: 'asc' }, { typeMap, lotMap, locationMap }),
      })
    }
    out.sort((a, b) => {
      if (a.key === '__null__') return 1
      if (b.key === '__null__') return -1
      return a.label.localeCompare(b.label)
    })
    return out
  }, [events, groupBy, typeMap, lotMap, locationMap])

  // ── Empty states ──────────────────────────────────────────────────────────
  if (!groupBy) {
    return (
      <EmptyState
        icon={<LayoutGrid className="w-6 h-6" style={{ color: 'var(--txt-3)' }} />}
        title="Configure le Kanban"
        description="Choisis un groupement (par type, lot ou lieu) pour générer les colonnes du board."
        ctaLabel="Ouvrir la configuration"
        onCta={onOpenConfig}
      />
    )
  }

  if (!droppable) {
    return (
      <EmptyState
        icon={<LayoutGrid className="w-6 h-6" style={{ color: 'var(--txt-3)' }} />}
        title="Groupement non déplaçable"
        description={`Le groupement actuel (${
          groupBy === 'member' ? 'membre convoqué' :
          groupBy === 'status' ? 'statut de convocation' : groupBy
        }) ne peut pas être modifié par drag & drop depuis le Kanban. Passe en « type », « lot » ou « lieu » pour activer le déplacement des cartes, ou utilise la vue Tableau pour consulter ce regroupement.`}
        ctaLabel="Ouvrir la configuration"
        onCta={onOpenConfig}
      />
    )
  }

  // ── Drag & drop handlers ──────────────────────────────────────────────────
  function handleDragStart(e, ev, fromColKey) {
    const key = eventKey(ev)
    setDragKey(key)
    try {
      e.dataTransfer.setData('text/plain', `${key}|${fromColKey}`)
      e.dataTransfer.effectAllowed = 'move'
    } catch {
      // noop — Safari peut throw sur certains types
    }
  }

  function handleDragEnd() {
    setDragKey(null)
    setDragOverCol(null)
  }

  function handleDragOver(e, colKey) {
    if (!dragKey) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverCol !== colKey) setDragOverCol(colKey)
  }

  function handleDragLeave(colKey) {
    if (dragOverCol === colKey) setDragOverCol(null)
  }

  function handleDrop(e, toColKey) {
    e.preventDefault()
    const payload = e.dataTransfer.getData('text/plain') || ''
    const [, fromColKey] = payload.split('|')
    const movedKey = dragKey
    setDragKey(null)
    setDragOverCol(null)
    if (!movedKey || !onMoveCard) return
    if (fromColKey === toColKey) return

    // On retrouve l'event via sa key (peut être 'uuid' ou 'uuid|occKey')
    const moved = events.find((ev) => eventKey(ev) === movedKey)
    if (!moved) return

    // Le type_id est NOT NULL en DB → on refuse le drop vers 'Sans type'
    if (groupBy === 'type' && toColKey === '__null__') {
      return
    }
    onMoveCard(moved, groupBy, toColKey)
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="h-full overflow-x-auto overflow-y-hidden rounded-xl"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        // Scroll-snap mobile : les colonnes se caleront sur le début du scroller
        // pour retrouver le "flick → colonne suivante" familier.
        scrollSnapType: bp.isMobile ? 'x mandatory' : 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div className="h-full flex items-stretch gap-2 sm:gap-3 p-2 sm:p-3 min-w-max">
        {columns.length === 0 ? (
          <div
            className="flex-1 flex items-center justify-center text-sm"
            style={{ color: 'var(--txt-3)' }}
          >
            Aucun événement ne correspond aux filtres de cette vue.
          </div>
        ) : columns.map((col) => {
          const isOver = dragOverCol === col.key && dragKey
          const rejectsDrop = groupBy === 'type' && col.key === '__null__'
          return (
            <div
              key={col.key}
              className="flex flex-col rounded-lg shrink-0 transition"
              style={{
                width: columnWidth,
                maxHeight: '100%',
                background: isOver ? 'var(--bg-elev)' : 'transparent',
                border: `1px dashed ${isOver ? 'var(--blue)' : 'transparent'}`,
                scrollSnapAlign: bp.isMobile ? 'start' : 'none',
              }}
              onDragOver={(e) => !rejectsDrop && handleDragOver(e, col.key)}
              onDragLeave={() => handleDragLeave(col.key)}
              onDrop={(e) => !rejectsDrop && handleDrop(e, col.key)}
            >
              {/* Header */}
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded-t-lg"
                style={{
                  background: 'var(--bg-elev)',
                  borderBottom: '1px solid var(--brd)',
                }}
              >
                {col.color && (
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: col.color }}
                    aria-hidden
                  />
                )}
                <span
                  className="text-xs font-medium truncate"
                  style={{ color: 'var(--txt)' }}
                  title={col.label}
                >
                  {col.label}
                </span>
                <span
                  className="ml-auto text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--bg-surf)', color: 'var(--txt-3)' }}
                >
                  {col.events.length}
                </span>
              </div>

              {/* Cartes */}
              <div
                className="flex-1 overflow-y-auto p-2 flex flex-col gap-2"
                style={{ minHeight: 60 }}
              >
                {col.events.length === 0 ? (
                  <div
                    className="text-[11px] italic text-center py-4"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    {rejectsDrop
                      ? 'Le type est obligatoire'
                      : 'Déposer une carte ici'}
                  </div>
                ) : col.events.map((ev) => (
                  <KanbanCard
                    key={eventKey(ev)}
                    event={ev}
                    colKey={col.key}
                    dragging={dragKey === eventKey(ev)}
                    typeMap={typeMap}
                    lotMap={lotMap}
                    locationMap={locationMap}
                    conflicts={conflicts}
                    onEventClick={onEventClick}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Carte événement ────────────────────────────────────────────────────────

function KanbanCard({
  event,
  colKey,
  dragging,
  typeMap,
  lotMap,
  locationMap,
  conflicts,
  onEventClick,
  onDragStart,
  onDragEnd,
}) {
  const type = event.type_id ? typeMap[event.type_id] : null
  const lot = event.lot_id ? lotMap[event.lot_id] : null
  const location = event.location_id ? locationMap[event.location_id] : null
  const members = (event.members || []).filter((m) => m.status !== 'declined')
  const status = dominantStatus(event.members || [])
  const statusMeta = status ? EVENT_MEMBER_STATUS[status] : null
  const hasConflict = conflicts && conflicts.get(eventKey(event))?.length > 0
  const color = event.color_override || type?.color || 'var(--txt-3)'

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => onDragStart(e, event, colKey)}
      onDragEnd={onDragEnd}
      onClick={() => onEventClick?.(event)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEventClick?.(event)
        }
      }}
      className="rounded-md p-2 cursor-grab active:cursor-grabbing transition hover:shadow-sm"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        borderLeft: `3px solid ${color}`,
        opacity: dragging ? 0.4 : 1,
      }}
    >
      <div className="flex items-start gap-1.5">
        <span
          className="text-xs font-medium leading-snug flex-1 min-w-0"
          style={{ color: 'var(--txt)' }}
        >
          {event.title || 'Sans titre'}
        </span>
        {hasConflict && (
          <AlertTriangle
            className="w-3 h-3 shrink-0 mt-0.5"
            style={{ color: 'var(--red)' }}
            aria-label="Conflit équipe"
          />
        )}
      </div>

      <div
        className="mt-1.5 flex items-center gap-1 text-[10px]"
        style={{ color: 'var(--txt-3)' }}
      >
        <Clock className="w-2.5 h-2.5" />
        <span className="truncate">{fmtShortTime(event.starts_at, event.all_day)}</span>
      </div>

      {(lot || location) && (
        <div
          className="mt-1 flex items-center gap-2 text-[10px]"
          style={{ color: 'var(--txt-3)' }}
        >
          {lot && (
            <span className="truncate" title={lot.title}>
              {lot.title}
            </span>
          )}
          {location && (
            <span className="inline-flex items-center gap-0.5 truncate" title={location.name}>
              <MapPin className="w-2.5 h-2.5" />
              {location.name}
            </span>
          )}
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between">
        {type ? (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px]"
            style={{ background: `${type.color}22`, color: type.color }}
          >
            {type.label}
          </span>
        ) : <span />}
        {members.length > 0 && (
          <span
            className="inline-flex items-center gap-0.5 text-[10px]"
            style={{ color: 'var(--txt-3)' }}
          >
            <UsersIcon className="w-2.5 h-2.5" />
            {members.length}
            {statusMeta && (
              <span
                className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: statusMeta.color }}
                title={statusMeta.label}
                aria-label={`Statut dominant: ${statusMeta.label}`}
              />
            )}
          </span>
        )}
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
