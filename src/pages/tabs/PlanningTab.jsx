/**
 * PlanningTab — Onglet planning d'un projet.
 *
 * PL-2 : vue mensuelle.
 * PL-3 : vues semaine / jour, gestion des membres convoqués (dans la modale),
 *        filtre par lot.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Calendar as CalendarIcon } from 'lucide-react'
import { notify } from '../../lib/notify'
import { useProjet } from '../ProjetLayout'
import MonthCalendar from '../../features/planning/MonthCalendar'
import TimelineCalendar from '../../features/planning/TimelineCalendar'
import EventEditorModal from '../../features/planning/EventEditorModal'
import LotScopeSelector from '../../components/LotScopeSelector'
import {
  listEventsByProject,
  listEventTypes,
  listLocations,
} from '../../lib/planning'
import {
  addDays,
  addMonths,
  daysToIsoRange,
  fmtDateLongFR,
  fmtWeekRangeFR,
  getConsecutiveDays,
  getWeekDays,
  startOfDay,
  startOfMonth,
  startOfWeekMonday,
} from '../../features/planning/dateUtils'

const VIEW_LABELS = { month: 'Mois', week: 'Semaine', day: 'Jour' }

export default function PlanningTab() {
  const { project, projectId, lots = [] } = useProjet() || {}

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [viewMode, setViewMode] = useState('month') // 'month' | 'week' | 'day'
  const [lotScope, setLotScope] = useState('__all__')
  const [events, setEvents] = useState([])
  const [eventTypes, setEventTypes] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)

  // Modale édition
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [editorInitialDate, setEditorInitialDate] = useState(null)

  // ── Lots actifs (pour le sélecteur de scope et le form) ──────────────────
  const activeLots = useMemo(
    () => (lots || []).filter((l) => !l.archived),
    [lots],
  )

  // ── Fenêtre de chargement selon la vue ───────────────────────────────────
  const windowRange = useMemo(() => {
    if (viewMode === 'month') {
      const gridStart = startOfWeekMonday(startOfMonth(currentDate))
      const gridEnd = new Date(gridStart)
      gridEnd.setDate(gridEnd.getDate() + 42)
      return { from: gridStart.toISOString(), to: gridEnd.toISOString() }
    }
    if (viewMode === 'week') {
      const days = getWeekDays(currentDate)
      return daysToIsoRange(days)
    }
    // day
    const days = getConsecutiveDays(currentDate, 1)
    return daysToIsoRange(days)
  }, [currentDate, viewMode])

  // ── Chargement des types d'événements & lieux (une fois) ─────────────────
  useEffect(() => {
    ;(async () => {
      try {
        const [types, locs] = await Promise.all([
          listEventTypes({ includeArchived: false }),
          listLocations({ includeArchived: false }),
        ])
        setEventTypes(types)
        setLocations(locs)
      } catch (e) {
        console.error('[Planning] load types/locations:', e)
        notify.error('Erreur de chargement des types / lieux')
      }
    })()
  }, [])

  // ── Chargement des événements sur la fenêtre courante ────────────────────
  const loadEvents = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await listEventsByProject(projectId, windowRange)
      setEvents(data)
    } catch (e) {
      console.error('[Planning] load events:', e)
      notify.error('Erreur de chargement des événements')
    } finally {
      setLoading(false)
    }
  }, [projectId, windowRange])

  useEffect(() => { loadEvents() }, [loadEvents])

  // ── Filtrage par lot côté client ─────────────────────────────────────────
  const visibleEvents = useMemo(() => {
    if (lotScope === '__all__') return events
    return events.filter((ev) => ev.lot_id === lotScope)
  }, [events, lotScope])

  // ── Navigation adaptée à la vue courante ─────────────────────────────────
  function goPrev() {
    setCurrentDate((d) => {
      if (viewMode === 'month') return addMonths(d, -1)
      if (viewMode === 'week')  return addDays(d, -7)
      return addDays(d, -1)
    })
  }
  function goNext() {
    setCurrentDate((d) => {
      if (viewMode === 'month') return addMonths(d, +1)
      if (viewMode === 'week')  return addDays(d, +7)
      return addDays(d, +1)
    })
  }
  function goToday() { setCurrentDate(new Date()) }

  // ── Handlers ouverture éditeur ───────────────────────────────────────────
  function handleEventClick(ev) {
    setEditingEvent(ev)
    setEditorInitialDate(null)
    setEditorOpen(true)
  }
  function handleDayOrSlotClick(date) {
    setEditingEvent(null)
    setEditorInitialDate(date)
    setEditorOpen(true)
  }
  function handleNewEvent() {
    setEditingEvent(null)
    const today = new Date()
    // Pré-remplit au jour courant visible (ou today s'il est dans la plage).
    let initDate
    if (viewMode === 'month') {
      const sameMonth =
        today.getMonth() === currentDate.getMonth() &&
        today.getFullYear() === currentDate.getFullYear()
      initDate = sameMonth ? today : startOfMonth(currentDate)
    } else if (viewMode === 'week') {
      const weekDays = getWeekDays(currentDate)
      const todayInWeek = weekDays.find((d) => d.toDateString() === today.toDateString())
      initDate = todayInWeek || weekDays[0]
    } else {
      initDate = startOfDay(currentDate)
      initDate.setHours(9, 0, 0, 0)
    }
    setEditorInitialDate(initDate)
    setEditorOpen(true)
  }

  function closeEditor() {
    setEditorOpen(false)
    setEditingEvent(null)
    setEditorInitialDate(null)
  }
  async function handleSaved() {
    closeEditor()
    await loadEvents()
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  if (!project) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--txt-3)' }}>
        Projet introuvable.
      </div>
    )
  }

  const noTypes = !loading && eventTypes.length === 0
  const timelineDays = viewMode === 'week'
    ? getWeekDays(currentDate)
    : viewMode === 'day'
      ? getConsecutiveDays(currentDate, 1)
      : []
  const timelineLabel = viewMode === 'week'
    ? fmtWeekRangeFR(currentDate)
    : viewMode === 'day'
      ? fmtDateLongFR(currentDate)
      : ''

  // Adapte le sélecteur de scope au contrat attendu par LotScopeSelector
  const lotsForSelector = activeLots.map((l) => ({ id: l.id, title: l.title || 'Lot' }))

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <CalendarIcon className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Planning
            </h1>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Vue calendrier des événements du projet
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View switcher */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-lg"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
          >
            {['month', 'week', 'day'].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className="px-3 py-1.5 rounded text-xs font-medium transition"
                style={{
                  background: viewMode === mode ? 'var(--bg-surf)' : 'transparent',
                  color: viewMode === mode ? 'var(--txt)' : 'var(--txt-3)',
                }}
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleNewEvent}
            disabled={noTypes}
            className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--blue)', color: '#fff' }}
            title={noTypes ? "Ajoute d'abord des types dans Paramètres" : 'Nouvel événement'}
          >
            <Plus className="w-4 h-4" />
            Nouvel événement
          </button>
        </div>
      </div>

      {/* Scope lots (masqué si moins de 2 lots actifs) */}
      {lotsForSelector.length >= 2 && (
        <LotScopeSelector
          lotsWithRef={lotsForSelector}
          scope={lotScope}
          onChange={setLotScope}
        />
      )}

      {noTypes && (
        <div
          className="rounded-xl px-4 py-3 text-xs"
          style={{
            background: 'var(--orange-bg)',
            color: 'var(--orange)',
            border: '1px solid var(--orange)',
          }}
        >
          Aucun type d&apos;événement disponible. Rends-toi dans
          <strong> Paramètres → Types d&apos;événements </strong>
          pour créer ou réactiver au moins un type.
        </div>
      )}

      {/* Calendrier */}
      <div className="flex-1 min-h-0 relative">
        {viewMode === 'month' && (
          <MonthCalendar
            currentDate={currentDate}
            events={visibleEvents}
            onEventClick={handleEventClick}
            onDayClick={handleDayOrSlotClick}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
          />
        )}

        {(viewMode === 'week' || viewMode === 'day') && (
          <TimelineCalendar
            days={timelineDays}
            events={visibleEvents}
            headerLabel={timelineLabel}
            onEventClick={handleEventClick}
            onSlotClick={handleDayOrSlotClick}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
          />
        )}

        {loading && (
          <div
            className="absolute top-3 right-3 text-[11px] px-2 py-1 rounded"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-3)',
              border: '1px solid var(--brd)',
            }}
          >
            Chargement…
          </div>
        )}
      </div>

      {/* Modale édition */}
      {editorOpen && (
        <EventEditorModal
          event={editingEvent}
          initialDate={editorInitialDate}
          projectId={projectId}
          lots={activeLots}
          eventTypes={eventTypes}
          locations={locations}
          onClose={closeEditor}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
