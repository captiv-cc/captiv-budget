/**
 * EventEditorModal — Création / édition d'un événement.
 *
 * Scope PL-2 : champs cœur uniquement (titre, type, lot, dates, all-day,
 * lieu texte, description). Les membres sont gérés dans PL-3.
 *
 * Props :
 *   - event       : objet événement (null/undefined = création)
 *   - initialDate : Date pré-sélectionnée lors d'un clic sur un jour
 *   - projectId   : UUID du projet (obligatoire pour la création)
 *   - lots        : tableau des lots du projet (pour le sélecteur)
 *   - eventTypes  : tableau des types d'événement disponibles (non archivés)
 *   - locations   : tableau des lieux (optionnel — fallback texte libre)
 *   - onClose     : fn()
 *   - onSaved     : fn() — appelé après sauvegarde réussie
 *   - projectLink : { label: string, to: string } — optionnel. Affiche un
 *                   lien "Voir dans le projet →" sous le titre du modal.
 *                   Utilisé depuis le Planning global (PG-1) où l'user a
 *                   cliqué sur un event depuis une vue cross-projets et
 *                   veut pouvoir atterrir sur le planning du projet parent.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Trash2, FileText, Users, AlertTriangle, Pencil, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { notify } from '../../lib/notify'
import {
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
  addExdate,
  detachOccurrence,
  listEventsByProject,
  findConflictsForEvent,
} from '../../lib/planning'
import { toDatetimeLocalValue, toDateInputValue } from './dateUtils'
import { validateRrule, describeRrule, expandEvents } from '../../lib/rrule'
import EventMembersPanel from './EventMembersPanel'
import RecurrenceEditor from './RecurrenceEditor'

export default function EventEditorModal({
  event,
  initialDate,
  projectId,
  lots = [],
  eventTypes = [],
  locations = [],
  onClose,
  onSaved,
  projectLink = null,
}) {
  // Un "event" venant du planning peut être une occurrence virtuelle (métadonnées
  // _master_id / _occurrence_key / _is_occurrence / _recurring). On doit utiliser
  // _master_id pour les opérations CRUD côté base.
  const masterId = event?._master_id || event?.id || null
  const isNew = !masterId
  const isVirtualOccurrence = Boolean(event?._is_occurrence)
  const isRecurring = Boolean(event?._recurring || event?.rrule)
  const originalOccurrenceKey = event?._occurrence_key || null

  // Scope édition/suppression pour une série récurrente : 'this' | 'all'
  const [scope, setScope] = useState(isVirtualOccurrence ? 'this' : 'all')

  // Types disponibles (non archivés)
  const availableTypes = useMemo(
    () => eventTypes.filter((t) => !t.archived),
    [eventTypes],
  )

  // ── Initialisation des champs ─────────────────────────────────────────────
  const initStarts = event?.starts_at
    ? new Date(event.starts_at)
    : (initialDate ? withDefaultTime(initialDate, 9, 0) : withDefaultTime(new Date(), 9, 0))
  const initEnds = event?.ends_at
    ? new Date(event.ends_at)
    : addHours(initStarts, 1)

  const [title, setTitle] = useState(event?.title || '')
  const [typeId, setTypeId] = useState(event?.type_id || availableTypes[0]?.id || '')
  const [lotId, setLotId] = useState(event?.lot_id || '')
  const [allDay, setAllDay] = useState(Boolean(event?.all_day))
  const [startsAt, setStartsAt] = useState(initStarts)
  const [endsAt, setEndsAt] = useState(initEnds)
  const [locationId, setLocationId] = useState(event?.location_id || '')
  const [description, setDescription] = useState(event?.description || '')
  const [rrule, setRrule] = useState(event?.rrule || null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Onglets Infos / Équipe (les membres ne sont accessibles qu'en édition)
  const [activeTab, setActiveTab] = useState('info')
  const [members, setMembers] = useState(event?.members || [])

  // Mode vue/édition. On ouvre en "vue" pour un événement existant (lecture
  // rapide au tap), et directement en "édition" pour une création. Un bouton
  // "Modifier" bascule en édition ; "Annuler" en édition restaure les valeurs
  // initiales et revient en vue.
  const [mode, setMode] = useState(isNew ? 'edit' : 'view')

  // Snapshot des valeurs initiales — utilisé pour restaurer le formulaire
  // quand on annule l'édition sans enregistrer.
  const initialValuesRef = useRef({
    title: event?.title || '',
    typeId: event?.type_id || availableTypes[0]?.id || '',
    lotId: event?.lot_id || '',
    allDay: Boolean(event?.all_day),
    startsAt: initStarts,
    endsAt: initEnds,
    locationId: event?.location_id || '',
    description: event?.description || '',
    rrule: event?.rrule || null,
  })

  function enterEditMode() {
    setConfirmDelete(false)
    setMode('edit')
  }

  function cancelEdit() {
    // Sur une création, pas de mode vue à regagner → on ferme.
    if (isNew) {
      onClose()
      return
    }
    const iv = initialValuesRef.current
    setTitle(iv.title)
    setTypeId(iv.typeId)
    setLotId(iv.lotId)
    setAllDay(iv.allDay)
    setStartsAt(iv.startsAt)
    setEndsAt(iv.endsAt)
    setLocationId(iv.locationId)
    setDescription(iv.description)
    setRrule(iv.rrule)
    setScope(isVirtualOccurrence ? 'this' : 'all')
    setConfirmDelete(false)
    setMode('view')
  }

  // Lookups pour l'affichage read-only
  const selectedType = useMemo(
    () =>
      eventTypes.find((t) => t.id === typeId) ||
      availableTypes.find((t) => t.id === typeId) ||
      null,
    [eventTypes, availableTypes, typeId],
  )
  const selectedLot = useMemo(
    () => lots.find((l) => l.id === lotId) || null,
    [lots, lotId],
  )
  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === locationId) || null,
    [locations, locationId],
  )
  const rruleSummary = rrule ? describeRrule(rrule) : null

  // ── Détection de conflits équipe (PL-3) ──────────────────────────────────
  // On charge les autres événements du projet autour de la plage éditée pour
  // pouvoir répondre : "le membre X est-il déjà convoqué ailleurs en même temps ?"
  const [otherEvents, setOtherEvents] = useState([])

  async function reloadMembers() {
    if (!masterId) return
    try {
      const fresh = await getEvent(masterId)
      setMembers(fresh?.members || [])
    } catch (e) {
      console.error('[EventEditor] reload members:', e)
    }
  }

  // Ajuste automatiquement endsAt si startsAt repasse au-dessus
  useEffect(() => {
    if (endsAt < startsAt) {
      setEndsAt(addHours(startsAt, 1))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startsAt])

  // Durée par défaut si on change de type (uniquement à la création)
  useEffect(() => {
    if (!isNew) return
    const t = availableTypes.find((x) => x.id === typeId)
    if (!t) return
    if (t.default_all_day) {
      setAllDay(true)
    } else if (t.default_duration_min) {
      setEndsAt(addMinutes(startsAt, t.default_duration_min))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId])

  // Clés "jour" pour ne re-déclencher le fetch que lorsque le jour change
  // (éviter de re-fetcher à chaque tick des inputs datetime-local).
  const startDayKey = toDateInputValue(startsAt)
  const endDayKey = toDateInputValue(endsAt)

  // Charge les autres événements du projet pour la détection de conflits.
  // Fenêtre : ±30 jours autour de la plage éditée (couvre la plupart des cas,
  // y compris les récurrences hebdo).
  useEffect(() => {
    if (!projectId) return
    const s = new Date(startsAt)
    const e = new Date(endsAt)
    const from = new Date(s.getTime() - 30 * 24 * 3600 * 1000).toISOString()
    const to   = new Date(e.getTime() + 30 * 24 * 3600 * 1000).toISOString()
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listEventsByProject(projectId, { from, to })
        if (cancelled) return
        // Exclut l'événement en cours d'édition (on ne se compare pas à soi-même)
        const filtered = rows.filter((r) => !masterId || r.id !== masterId)
        const expanded = expandEvents(filtered, new Date(from), new Date(to))
        setOtherEvents(expanded)
      } catch (err) {
        console.error('[EventEditor] load other events for conflicts:', err)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, masterId, startDayKey, endDayKey])

  // Calcule les conflits de l'événement courant (state local) vs autres events.
  // Un conflit = chevauchement + identité-membre partagée.
  const draftConflicts = useMemo(() => {
    const draft = {
      id: masterId || '__draft__',
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      members,
    }
    return findConflictsForEvent(draft, otherEvents)
  }, [masterId, startsAt, endsAt, members, otherEvents])

  // Identités (p:uuid / c:uuid) du courant qui sont en conflit avec au moins
  // un autre événement → utilisé pour marquer chaque MemberRow en rouge.
  const conflictingIdentities = useMemo(() => {
    const s = new Set()
    for (const c of draftConflicts) {
      for (const id of c.sharedIdentities) s.add(id)
    }
    return s
  }, [draftConflicts])

  async function save() {
    if (!title.trim()) {
      notify.error('Le titre est obligatoire.')
      return
    }
    if (!typeId) {
      notify.error("Choisis un type d'événement.")
      return
    }
    if (endsAt < startsAt) {
      notify.error('La date de fin doit être postérieure à la date de début.')
      return
    }
    if (isNew && !projectId) {
      notify.error('Projet introuvable.')
      return
    }

    // Normalisation / validation de la rrule (nouvelle ou modifiée)
    let normalizedRrule = null
    if (rrule) {
      const v = validateRrule(rrule)
      if (!v.ok) {
        notify.error(v.error)
        return
      }
      normalizedRrule = v.value
    }

    setSaving(true)
    try {
      const corePayload = {
        title: title.trim(),
        type_id: typeId,
        lot_id: lotId || null,
        location_id: locationId || null,
        all_day: allDay,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        description: description.trim() || null,
      }

      if (isNew) {
        await createEvent({
          project_id: projectId,
          ...corePayload,
          rrule: normalizedRrule,
        })
        notify.success(
          normalizedRrule ? 'Série créée' : 'Événement créé',
        )
      } else if (isVirtualOccurrence && scope === 'this') {
        // Détache cette seule occurrence de la série et applique les modifs
        await detachOccurrence(
          { ...event, id: masterId },
          originalOccurrenceKey,
          corePayload,
        )
        notify.success('Occurrence modifiée')
      } else {
        // Master existant OU scope === 'all' : on met à jour la série entière
        //
        // Si on édite une occurrence virtuelle avec scope='all', on applique
        // le delta entre les dates chargées et les dates saisies aux dates
        // du master, pour préserver l'ancrage de la série.
        let startsOut = corePayload.starts_at
        let endsOut = corePayload.ends_at
        if (isVirtualOccurrence && event?._master_starts_at && event?._master_ends_at) {
          const loadedStart = new Date(event.starts_at).getTime()
          const loadedEnd = new Date(event.ends_at).getTime()
          const newStart = startsAt.getTime()
          const newEnd = endsAt.getTime()
          const deltaStart = newStart - loadedStart
          const deltaEnd = newEnd - loadedEnd
          startsOut = new Date(new Date(event._master_starts_at).getTime() + deltaStart).toISOString()
          endsOut = new Date(new Date(event._master_ends_at).getTime() + deltaEnd).toISOString()
        }
        await updateEvent(masterId, {
          ...corePayload,
          starts_at: startsOut,
          ends_at: endsOut,
          rrule: normalizedRrule,
        })
        notify.success(
          normalizedRrule
            ? (isRecurring ? 'Série mise à jour' : 'Événement transformé en série')
            : (isRecurring ? 'Série convertie en événement unique' : 'Événement mis à jour'),
        )
      }
      onSaved && onSaved()
    } catch (e) {
      console.error('[EventEditor] save error:', e)
      notify.error(e.message || "Erreur à l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setSaving(true)
    try {
      if (isVirtualOccurrence && scope === 'this') {
        await addExdate(masterId, originalOccurrenceKey)
        notify.success('Occurrence supprimée')
      } else {
        await deleteEvent(masterId)
        notify.success(
          isRecurring ? 'Série supprimée' : 'Événement supprimé',
        )
      }
      onSaved && onSaved()
    } catch (e) {
      console.error('[EventEditor] delete error:', e)
      notify.error(e.message || 'Erreur lors de la suppression')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl h-[100dvh] sm:h-auto sm:max-h-[90vh] overflow-hidden rounded-none sm:rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 sm:px-5 py-3 sm:py-4 gap-2"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold truncate pr-2" style={{ color: 'var(--txt)' }}>
              {isNew
                ? 'Nouvel événement'
                : mode === 'view'
                  ? "Détails de l'événement"
                  : "Modifier l'événement"}
            </h3>
            {/* Lien vers le planning du projet parent — rendu uniquement si la
                page appelante l'a fourni (typiquement PlanningGlobal). onClick
                ferme d'abord le modal pour éviter un double overlay si on
                navigue vers la même page. */}
            {projectLink?.to && (
              <Link
                to={projectLink.to}
                onClick={onClose}
                className="inline-flex items-center gap-1 text-[11px] mt-0.5 truncate hover:underline"
                style={{ color: 'var(--blue)' }}
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  Voir dans&nbsp;
                  {projectLink.label ? `« ${projectLink.label} »` : 'le projet'}
                </span>
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ color: 'var(--txt-2)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        {!isNew && (
          <div
            className="flex items-center gap-1 px-3 sm:px-5"
            style={{ borderBottom: '1px solid var(--brd-sub)' }}
          >
            <TabBtn
              active={activeTab === 'info'}
              onClick={() => setActiveTab('info')}
              icon={FileText}
              label="Infos"
            />
            <TabBtn
              active={activeTab === 'members'}
              onClick={() => setActiveTab('members')}
              icon={Users}
              label={`Équipe${members.length ? ` (${members.length})` : ''}`}
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 sm:py-4 flex flex-col gap-3 sm:gap-4">
          {/* Bandeau conflit (partagé entre onglets) */}
          {draftConflicts.length > 0 && (
            <ConflictBanner conflicts={draftConflicts} />
          )}

          {activeTab === 'members' && !isNew ? (
            <EventMembersPanel
              eventId={event.id}
              projectId={projectId}
              members={members}
              conflictingIdentities={conflictingIdentities}
              onMutated={reloadMembers}
            />
          ) : mode === 'view' ? (
            <ViewInfo
              title={title}
              type={selectedType}
              lot={selectedLot}
              allDay={allDay}
              startsAt={startsAt}
              endsAt={endsAt}
              location={selectedLocation}
              description={description}
              rruleSummary={rruleSummary}
              isRecurring={isRecurring}
              isVirtualOccurrence={isVirtualOccurrence}
            />
          ) : (
          <>
          {/* Titre */}
          <Field label="Titre *">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={inputStyle}
              placeholder="Ex. Tournage J1 — Extérieur parc"
              autoFocus
            />
          </Field>

          {/* Type */}
          <Field label="Type *">
            <select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={inputStyle}
            >
              {!availableTypes.length && <option value="">Aucun type disponible</option>}
              {availableTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Lot (optionnel) */}
          {lots.length > 0 && (
            <Field label="Lot (optionnel)">
              <select
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={inputStyle}
              >
                <option value="">— Aucun lot —</option>
                {lots
                  .filter((l) => !l.archived)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title || 'Lot'}
                    </option>
                  ))}
              </select>
            </Field>
          )}

          {/* All day */}
          <label
            className="flex items-center gap-2 text-sm cursor-pointer"
            style={{ color: 'var(--txt-2)' }}
          >
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="w-4 h-4"
            />
            Journée entière
          </label>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Début">
              {allDay ? (
                <input
                  type="date"
                  value={toDateInputValue(startsAt)}
                  onChange={(e) => setStartsAt(parseDateInput(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={inputStyle}
                />
              ) : (
                <input
                  type="datetime-local"
                  value={toDatetimeLocalValue(startsAt)}
                  onChange={(e) => setStartsAt(parseDatetimeLocal(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={inputStyle}
                />
              )}
            </Field>
            <Field label="Fin">
              {allDay ? (
                <input
                  type="date"
                  value={toDateInputValue(endsAt)}
                  onChange={(e) => setEndsAt(endOfDayValue(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={inputStyle}
                />
              ) : (
                <input
                  type="datetime-local"
                  value={toDatetimeLocalValue(endsAt)}
                  onChange={(e) => setEndsAt(parseDatetimeLocal(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={inputStyle}
                />
              )}
            </Field>
          </div>

          {/* Location (liste déroulante si disponible) */}
          {locations.length > 0 && (
            <Field label="Lieu (optionnel)">
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={inputStyle}
              >
                <option value="">— Aucun lieu —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* Description */}
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm resize-none"
              style={inputStyle}
              placeholder="Notes, brief, informations logistiques…"
            />
          </Field>

          {/* Récurrence — masquée lorsqu'on édite "cette seule occurrence" (elle sera détachée) */}
          {!(isVirtualOccurrence && scope === 'this') && (
            <div
              className="pt-2"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              <RecurrenceEditor
                value={rrule}
                onChange={setRrule}
                startDate={startsAt}
              />
              {rrule && (
                <div className="text-[11px] mt-2" style={{ color: 'var(--txt-3)' }}>
                  {describeRrule(rrule)}
                </div>
              )}
            </div>
          )}

          {/* Scope édition pour une occurrence virtuelle d'une série */}
          {isVirtualOccurrence && (
            <div
              className="rounded-lg p-3 flex flex-col gap-2"
              style={{ background: 'var(--orange-bg)', border: '1px solid var(--orange)' }}
            >
              <div className="text-[11px] font-medium" style={{ color: 'var(--orange)' }}>
                Cette occurrence fait partie d&apos;une série récurrente. Appliquer les modifications&nbsp;:
              </div>
              <div className="flex items-center gap-2">
                <ScopeBtn
                  active={scope === 'this'}
                  onClick={() => setScope('this')}
                  label="À cette occurrence seulement"
                />
                <ScopeBtn
                  active={scope === 'all'}
                  onClick={() => setScope('all')}
                  label="À toute la série"
                />
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {/* Footer — sticky sous iOS via safe-area-bottom, passe en colonne sur mobile */}
        <div
          className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2 px-3 sm:px-5 py-3 sm:py-4"
          style={{
            borderTop: '1px solid var(--brd-sub)',
            paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)',
          }}
        >
          {/* Supprimer (édition seulement) */}
          <div className="flex">
            {!isNew && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="w-full sm:w-auto justify-center px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2"
                style={{
                  color: confirmDelete ? '#fff' : 'var(--red)',
                  background: confirmDelete ? 'var(--red)' : 'transparent',
                  border: '1px solid var(--red)',
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {confirmDelete
                  ? (isVirtualOccurrence && scope === 'this'
                      ? "Confirmer la suppression de l'occurrence"
                      : isRecurring
                        ? 'Confirmer la suppression de la série'
                        : 'Confirmer la suppression')
                  : 'Supprimer'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {mode === 'view' ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium"
                  style={{
                    color: 'var(--txt-2)',
                    border: '1px solid var(--brd)',
                    background: 'var(--bg-elev)',
                  }}
                >
                  Fermer
                </button>
                <button
                  type="button"
                  onClick={enterEditMode}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                  style={{ background: 'var(--blue)', color: '#fff' }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Modifier
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium"
                  style={{
                    color: 'var(--txt-2)',
                    border: '1px solid var(--brd)',
                    background: 'var(--bg-elev)',
                  }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium"
                  style={{ background: 'var(--blue)', color: '#fff' }}
                >
                  {saving ? 'Enregistrement…' : isNew ? 'Créer' : 'Enregistrer'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers internes ────────────────────────────────────────────────────────

/**
 * Bandeau rouge d'alerte affiché en haut du modal quand l'édition courante
 * crée un ou plusieurs conflits d'équipe avec d'autres événements.
 */
function ConflictBanner({ conflicts }) {
  // Dédoublonne par (member identity, other event key) et compte les personnes.
  const identityLabels = new Map() // identity → name
  const otherTitles = new Set()
  for (const c of conflicts) {
    const m = (c.other.members || []).filter((mm) =>
      c.sharedIdentities.includes(
        mm.profile_id ? `p:${mm.profile_id}` : `c:${mm.crew_member_id}`,
      ),
    )
    for (const mm of m) {
      const name = mm.profile?.full_name || mm.crew?.person_name || 'Membre'
      const id = mm.profile_id ? `p:${mm.profile_id}` : `c:${mm.crew_member_id}`
      identityLabels.set(id, name)
    }
    otherTitles.add(c.other.title || 'Autre événement')
  }
  const n = identityLabels.size
  const names = Array.from(identityLabels.values()).slice(0, 3).join(', ')
  const more = n > 3 ? ` +${n - 3}` : ''

  return (
    <div
      className="rounded-lg p-3 flex items-start gap-2 text-[11px]"
      style={{
        background: 'var(--red-bg, rgba(239,68,68,0.12))',
        border: '1px solid var(--red)',
        color: 'var(--red)',
      }}
      role="alert"
    >
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <div>
        <div className="font-semibold">
          Conflit équipe détecté
        </div>
        <div className="opacity-90">
          {n} personne{n > 1 ? 's' : ''} déjà convoquée{n > 1 ? 's' : ''} sur un autre événement qui chevauche&nbsp;:
          {' '}{names}{more}
        </div>
      </div>
    </div>
  )
}

/**
 * ViewInfo — Rendu read-only des champs "Infos" quand le modal est ouvert en
 * mode vue (tap sur un événement existant). Affiche titre, type (chip
 * colorée), lot, plage de dates formatée, lieu, description et résumé de
 * récurrence — rien à éditer, bascule vers le mode édition via "Modifier".
 */
function ViewInfo({
  title,
  type,
  lot,
  allDay,
  startsAt,
  endsAt,
  location,
  description,
  rruleSummary,
  isRecurring,
  isVirtualOccurrence,
}) {
  return (
    <>
      {/* Titre */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--txt-3)' }}>
          Titre
        </label>
        <div className="text-base font-semibold" style={{ color: 'var(--txt)' }}>
          {title || <span style={{ color: 'var(--txt-3)' }}>Sans titre</span>}
        </div>
      </div>

      {/* Type + Lot */}
      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyField label="Type">
          {type ? (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium self-start"
              style={{
                background: type.color ? `${type.color}22` : 'var(--bg-elev)',
                color: type.color || 'var(--txt)',
                border: `1px solid ${type.color || 'var(--brd)'}`,
              }}
            >
              {type.color && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: type.color }}
                />
              )}
              {type.label}
            </span>
          ) : (
            <span className="text-sm" style={{ color: 'var(--txt-3)' }}>—</span>
          )}
        </ReadOnlyField>
        <ReadOnlyField label="Lot" value={lot?.title || '—'} />
      </div>

      {/* Plage de dates */}
      <ReadOnlyField label={allDay ? 'Journée entière' : 'Période'}>
        <div className="text-sm" style={{ color: 'var(--txt)' }}>
          {formatDateRange(startsAt, endsAt, allDay)}
        </div>
      </ReadOnlyField>

      {/* Lieu */}
      {location && <ReadOnlyField label="Lieu" value={location.name} />}

      {/* Description */}
      {description && (
        <ReadOnlyField label="Description">
          <div
            className="text-sm whitespace-pre-wrap"
            style={{ color: 'var(--txt-2)' }}
          >
            {description}
          </div>
        </ReadOnlyField>
      )}

      {/* Récurrence */}
      {rruleSummary && (
        <ReadOnlyField label={isVirtualOccurrence ? 'Série récurrente' : 'Récurrence'}>
          <div className="text-sm" style={{ color: 'var(--txt)' }}>
            {rruleSummary}
          </div>
        </ReadOnlyField>
      )}

      {/* Badge "Occurrence" si on consulte une occurrence virtuelle */}
      {isVirtualOccurrence && (
        <div
          className="text-[11px] rounded-lg px-3 py-2"
          style={{
            background: 'var(--orange-bg)',
            color: 'var(--orange)',
            border: '1px solid var(--orange)',
          }}
        >
          Vous consultez une occurrence de série. Cliquez sur « Modifier » pour
          choisir la portée des modifications (cette occurrence ou toute la série).
        </div>
      )}

      {/* Indicateur récurrence simple (non occurrence virtuelle) */}
      {isRecurring && !isVirtualOccurrence && !rruleSummary && (
        <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
          Événement récurrent
        </div>
      )}
    </>
  )
}

/**
 * ReadOnlyField — wrapper léger pour l'affichage read-only d'une valeur.
 * Si `children` est fourni, on l'affiche tel quel ; sinon on retombe sur
 * `value` avec un placeholder "—" stylé quand la valeur est vide.
 */
function ReadOnlyField({ label, value, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--txt-3)' }}>
        {label}
      </label>
      {children != null ? (
        children
      ) : (
        <div
          className="text-sm"
          style={{ color: value && value !== '—' ? 'var(--txt)' : 'var(--txt-3)' }}
        >
          {value || '—'}
        </div>
      )}
    </div>
  )
}

function TabBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition"
      style={{
        color: active ? 'var(--blue)' : 'var(--txt-3)',
        borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent',
        marginBottom: '-1px',
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function ScopeBtn({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 px-2 py-1.5 rounded text-[11px] font-medium transition"
      style={{
        background: active ? 'var(--orange)' : 'var(--bg-surf)',
        color: active ? '#fff' : 'var(--txt-2)',
        border: `1px solid ${active ? 'var(--orange)' : 'var(--brd)'}`,
      }}
    >
      {label}
    </button>
  )
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" style={{ color: 'var(--txt-3)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}

/**
 * Formate une plage de dates pour le mode vue.
 * - all-day même jour   : "mer. 18 juin 2026"
 * - all-day multi-jours : "mer. 18 juin 2026 → ven. 20 juin 2026"
 * - horaire même jour   : "mer. 18 juin 2026 · 09:00 → 12:00"
 * - horaire multi-jours : "mer. 18 juin 2026 09:00 → ven. 20 juin 2026 12:00"
 */
function formatDateRange(start, end, allDay) {
  const s = start instanceof Date ? start : new Date(start)
  const e = end instanceof Date ? end : new Date(end)
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate()
  const dateFmt = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const timeFmt = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  if (allDay) {
    return sameDay ? dateFmt.format(s) : `${dateFmt.format(s)} → ${dateFmt.format(e)}`
  }
  if (sameDay) {
    return `${dateFmt.format(s)} · ${timeFmt.format(s)} → ${timeFmt.format(e)}`
  }
  return `${dateFmt.format(s)} ${timeFmt.format(s)} → ${dateFmt.format(e)} ${timeFmt.format(e)}`
}

function withDefaultTime(d, hour, minute) {
  const x = new Date(d)
  x.setHours(hour, minute, 0, 0)
  return x
}

function addHours(d, h) {
  const x = new Date(d)
  x.setHours(x.getHours() + h)
  return x
}

function addMinutes(d, m) {
  const x = new Date(d)
  x.setMinutes(x.getMinutes() + m)
  return x
}

function parseDatetimeLocal(value) {
  // "YYYY-MM-DDTHH:MM" en heure locale
  if (!value) return new Date()
  return new Date(value)
}

function parseDateInput(value) {
  // Pour un all-day, le début est à 00:00 local
  if (!value) return new Date()
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

function endOfDayValue(value) {
  // Pour un all-day, on met la fin à 23:59 local
  if (!value) return new Date()
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 0, 0)
}
