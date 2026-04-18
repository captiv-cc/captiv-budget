/**
 * PlanningTableView — vue tableau des événements (PL-3.5 étape 3).
 *
 * Rend les événements (filtrés par filterEventsByConfig au niveau du parent)
 * sous forme de tableau triable, avec support du groupement via
 * `groupEventsByConfig`. Les bandeaux de groupe affichent un libellé lisible
 * (nom du type/lot/lieu/membre) + compteur.
 *
 * Interactions :
 *   - Click sur une ligne → ouvre l'éditeur via onEventClick
 *   - Click sur un en-tête de colonne → bascule le tri (asc/desc/reset)
 *   - Double-click sur une cellule → édition rapide (pas encore implémenté)
 *
 * Props :
 *   - events             : Array<Event>  (déjà filtrés par le parent)
 *   - groupBy            : string | null
 *   - sortBy             : { field, direction } | null
 *   - onSortChange       : (nextSortBy) => void   — parent persiste si DB view
 *   - eventTypes         : Array<EventType>
 *   - lots               : Array<Lot>
 *   - locations          : Array<Location>
 *   - onEventClick       : (event) => void
 *   - conflicts          : Map<eventKey, conflicts>
 */
import { useMemo } from 'react'
import {
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Calendar as CalendarIcon,
  Users as UsersIcon,
} from 'lucide-react'
import {
  SORTABLE_EVENT_FIELDS,
  sortEventsByField,
  groupEventsByConfig,
  formatDuration,
  eventKey,
  EVENT_MEMBER_STATUS,
} from '../../lib/planning'
import { fmtDateLongFR } from './dateUtils'

// ── Helpers de formatage ────────────────────────────────────────────────────

function fmtDateTime(iso, allDay) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (allDay) return fmtDateLongFR(d)
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

// ── Composant principal ────────────────────────────────────────────────────

export default function PlanningTableView({
  events = [],
  groupBy = null,
  sortBy = null,
  onSortChange,
  eventTypes = [],
  lots = [],
  locations = [],
  onEventClick,
  conflicts,
}) {
  // Index de lookup pour résolution des relations (évite les .find() N×N)
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

  // Groupes (ou un seul bucket si pas de groupement)
  const groups = useMemo(() => {
    const map = groupEventsByConfig(events, { groupBy })
    // Tri stable des events DANS chaque groupe
    const out = []
    for (const [key, list] of map.entries()) {
      out.push({ key, events: sortEventsByField(list, sortBy, { typeMap, lotMap, locationMap }) })
    }
    // Tri des groupes par libellé pour stabilité
    out.sort((a, b) => {
      const la = labelForGroup(groupBy, a.key, { typeMap, lotMap, locationMap })
      const lb = labelForGroup(groupBy, b.key, { typeMap, lotMap, locationMap })
      return la.localeCompare(lb)
    })
    return out
  }, [events, groupBy, sortBy, typeMap, lotMap, locationMap])

  function handleHeaderClick(field) {
    if (!onSortChange) return
    if (sortBy?.field !== field) {
      onSortChange({ field, direction: 'asc' })
      return
    }
    // Cycle : asc → desc → reset
    if (sortBy.direction === 'asc') onSortChange({ field, direction: 'desc' })
    else onSortChange(null)
  }

  const headers = SORTABLE_EVENT_FIELDS

  return (
    <div
      className="h-full overflow-auto rounded-xl"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* min-w-[880px] : force le scroll-x sur mobile plutôt que d'écraser les
          8 colonnes de métadonnées. Sur desktop la table s'étend à 100%. */}
      <table
        className="w-full text-sm min-w-[880px]"
        style={{ borderCollapse: 'separate', borderSpacing: 0 }}
      >
        <thead
          className="sticky top-0 z-10"
          style={{ background: 'var(--bg-elev)', borderBottom: '1px solid var(--brd)' }}
        >
          <tr>
            {headers.map((h) => {
              const active = sortBy?.field === h.key
              return (
                <th
                  key={h.key}
                  scope="col"
                  className="px-2 sm:px-3 py-2 text-left text-[11px] uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
                  style={{
                    color: active ? 'var(--txt)' : 'var(--txt-3)',
                    borderBottom: '1px solid var(--brd)',
                  }}
                  onClick={() => handleHeaderClick(h.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {h.label}
                    {active && (sortBy.direction === 'desc'
                      ? <ArrowDown className="w-3 h-3" />
                      : <ArrowUp   className="w-3 h-3" />)}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {groups.length === 0 || groups.every((g) => g.events.length === 0) ? (
            <tr>
              <td
                colSpan={headers.length}
                className="px-4 py-10 text-center text-sm"
                style={{ color: 'var(--txt-3)' }}
              >
                Aucun événement ne correspond aux filtres de cette vue.
              </td>
            </tr>
          ) : (
            groups.map((g) => (
              <GroupSection
                key={g.key}
                groupBy={groupBy}
                groupKey={g.key}
                events={g.events}
                typeMap={typeMap}
                lotMap={lotMap}
                locationMap={locationMap}
                conflicts={conflicts}
                onEventClick={onEventClick}
                colCount={headers.length}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Rendu d'un groupe (bandeau + lignes) ───────────────────────────────────

function GroupSection({
  groupBy,
  groupKey,
  events,
  typeMap,
  lotMap,
  locationMap,
  conflicts,
  onEventClick,
  colCount,
}) {
  const showHeader = groupBy && groupKey !== '__all__'
  const label = labelForGroup(groupBy, groupKey, { typeMap, lotMap, locationMap })
  return (
    <>
      {showHeader && (
        <tr>
          <td
            colSpan={colCount}
            className="px-3 py-1.5 text-[11px] font-medium sticky"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-3)',
              borderTop: '1px solid var(--brd)',
              borderBottom: '1px solid var(--brd)',
            }}
          >
            <span className="uppercase tracking-wide">{label}</span>
            <span className="ml-2 opacity-70">· {events.length}</span>
          </td>
        </tr>
      )}
      {events.map((ev) => (
        <EventRow
          key={eventKey(ev)}
          event={ev}
          typeMap={typeMap}
          lotMap={lotMap}
          locationMap={locationMap}
          conflicts={conflicts}
          onEventClick={onEventClick}
        />
      ))}
    </>
  )
}

// ── Rendu d'une ligne d'événement ──────────────────────────────────────────

function EventRow({
  event,
  typeMap,
  lotMap,
  locationMap,
  conflicts,
  onEventClick,
}) {
  const type = event.type_id ? typeMap[event.type_id] : null
  const lot = event.lot_id ? lotMap[event.lot_id] : null
  const location = event.location_id ? locationMap[event.location_id] : null
  const durMs = new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()
  const members = (event.members || []).filter((m) => m.status !== 'declined')
  const status = dominantStatus(event.members || [])
  const statusMeta = status ? EVENT_MEMBER_STATUS[status] : null
  const hasConflict = conflicts && conflicts.get(eventKey(event))?.length > 0
  const color = event.color_override || type?.color || 'var(--txt-3)'

  return (
    <tr
      className="cursor-pointer transition"
      style={{ borderBottom: '1px solid var(--brd)' }}
      onClick={() => onEventClick?.(event)}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <td className="px-2 sm:px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-1.5 h-5 rounded-sm"
            style={{ background: color }}
            aria-hidden
          />
          <span className="font-medium truncate" style={{ color: 'var(--txt)' }}>
            {event.title || 'Sans titre'}
          </span>
          {hasConflict && (
            <AlertTriangle
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: 'var(--red)' }}
              aria-label="Conflit équipe"
            />
          )}
        </div>
      </td>

      <td className="px-2 sm:px-3 py-2" style={{ color: 'var(--txt-2)' }}>
        {type ? (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-[11px]"
            style={{ background: `${type.color}22`, color: type.color }}
          >
            {type.label}
          </span>
        ) : <em style={{ color: 'var(--txt-3)' }}>—</em>}
      </td>

      <td className="px-2 sm:px-3 py-2 whitespace-nowrap" style={{ color: 'var(--txt-2)' }}>
        <span className="inline-flex items-center gap-1">
          <CalendarIcon className="w-3 h-3 opacity-60" />
          {fmtDateTime(event.starts_at, event.all_day)}
        </span>
      </td>

      <td className="px-2 sm:px-3 py-2 whitespace-nowrap" style={{ color: 'var(--txt-2)' }}>
        {fmtDateTime(event.ends_at, event.all_day)}
      </td>

      <td className="px-2 sm:px-3 py-2 whitespace-nowrap" style={{ color: 'var(--txt-2)' }}>
        {formatDuration(durMs)}
      </td>

      <td className="px-2 sm:px-3 py-2" style={{ color: 'var(--txt-2)' }}>
        {lot ? lot.title : <em style={{ color: 'var(--txt-3)' }}>—</em>}
      </td>

      <td className="px-2 sm:px-3 py-2" style={{ color: 'var(--txt-2)' }}>
        {location ? location.name : <em style={{ color: 'var(--txt-3)' }}>—</em>}
      </td>

      <td className="px-2 sm:px-3 py-2" style={{ color: 'var(--txt-2)' }}>
        <span className="inline-flex items-center gap-1">
          <UsersIcon className="w-3 h-3 opacity-60" />
          {members.length}
          {statusMeta && (
            <span
              className="ml-1 inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: statusMeta.color }}
              aria-label={`Statut dominant: ${statusMeta.label}`}
              title={statusMeta.label}
            />
          )}
        </span>
      </td>
    </tr>
  )
}

// ── Labels de groupe ───────────────────────────────────────────────────────

function labelForGroup(groupBy, key, { typeMap, lotMap, locationMap }) {
  if (!groupBy || key === '__all__') return ''
  if (key === '__null__') return '— Sans valeur —'
  if (groupBy === 'type') return typeMap[key]?.label || 'Type inconnu'
  if (groupBy === 'lot') return lotMap[key]?.title || 'Lot inconnu'
  if (groupBy === 'location') return locationMap[key]?.name || 'Lieu inconnu'
  if (groupBy === 'status') return EVENT_MEMBER_STATUS[key]?.label || String(key)
  if (groupBy === 'member') {
    // key = 'p:<uuid>' ou 'c:<uuid>' — on laisse l'uuid brut ; le mapping
    // vers un nom lisible nécessitera un profiles/crew map passé en prop
    // quand la Swimlanes view sera livrée.
    if (key.startsWith('p:')) return `Profil · ${key.slice(2).slice(0, 8)}…`
    if (key.startsWith('c:')) return `Intervenant · ${key.slice(2).slice(0, 8)}…`
    return String(key)
  }
  return String(key)
}
