/**
 * PlanningTab — Onglet planning d'un projet (PL-2, vue calendrier mensuelle).
 *
 * Charge les événements du projet pour une fenêtre 6 semaines (grille affichée)
 * + les types d'événement et les lieux de l'org pour les listes déroulantes de
 * la modale d'édition.
 *
 * Les vues semaine / jour, drag & drop, récurrence et call sheets arriveront
 * dans les chantiers PL-3 et suivants.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Calendar as CalendarIcon } from 'lucide-react'
import { notify } from '../../lib/notify'
import { useProjet } from '../ProjetLayout'
import MonthCalendar from '../../features/planning/MonthCalendar'
import EventEditorModal from '../../features/planning/EventEditorModal'
import {
  listEventsByProject,
  listEventTypes,
  listLocations,
} from '../../lib/planning'
import {
  addMonths,
  endOfMonth,
  startOfMonth,
  startOfWeekMonday,
} from '../../features/planning/dateUtils'

export default function PlanningTab() {
  const { project, projectId, lots = [] } = useProjet() || {}

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [events, setEvents] = useState([])
  const [eventTypes, setEventTypes] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)

  // Modale édition
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [editorInitialDate, setEditorInitialDate] = useState(null)

  // ── Fenêtre de chargement : couvre la grille 6 semaines (lun. au dim.) ────
  const windowRange = useMemo(() => {
    const gridStart = startOfWeekMonday(startOfMonth(currentDate))
    const gridEnd = new Date(gridStart)
    gridEnd.setDate(gridEnd.getDate() + 42) // 6 semaines
    return {
      from: gridStart.toISOString(),
      to: gridEnd.toISOString(),
    }
  }, [currentDate])

  // ── Chargement des types d'événements & lieux (une seule fois) ───────────
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

  // ── Chargement des événements sur la fenêtre courante ─────────────────────
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

  // ── Handlers UI ───────────────────────────────────────────────────────────
  function goPrevMonth() { setCurrentDate((d) => addMonths(d, -1)) }
  function goNextMonth() { setCurrentDate((d) => addMonths(d, +1)) }
  function goToday() { setCurrentDate(new Date()) }

  function handleEventClick(ev) {
    setEditingEvent(ev)
    setEditorInitialDate(null)
    setEditorOpen(true)
  }

  function handleDayClick(date) {
    setEditingEvent(null)
    setEditorInitialDate(date)
    setEditorOpen(true)
  }

  function handleNewEvent() {
    setEditingEvent(null)
    // Pré-remplit à aujourd'hui si on est sur le mois courant, sinon au 1er du mois affiché.
    const today = new Date()
    const onCurrentMonth =
      today.getMonth() === currentDate.getMonth() &&
      today.getFullYear() === currentDate.getFullYear()
    const initDate = onCurrentMonth ? today : startOfMonth(currentDate)
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

  // ── Rendu ─────────────────────────────────────────────────────────────────
  if (!project) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--txt-3)' }}>
        Projet introuvable.
      </div>
    )
  }

  const noTypes = !loading && eventTypes.length === 0
  const viewMonthLabel = endOfMonth(currentDate)

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
        <MonthCalendar
          currentDate={currentDate}
          events={events}
          onEventClick={handleEventClick}
          onDayClick={handleDayClick}
          onPrev={goPrevMonth}
          onNext={goNextMonth}
          onToday={goToday}
        />

        {loading && (
          <div
            className="absolute top-3 right-3 text-[11px] px-2 py-1 rounded"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-3)',
              border: '1px solid var(--brd)',
            }}
            aria-label={`Chargement ${viewMonthLabel.getMonth() + 1}/${viewMonthLabel.getFullYear()}`}
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
          lots={lots}
          eventTypes={eventTypes}
          locations={locations}
          onClose={closeEditor}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
