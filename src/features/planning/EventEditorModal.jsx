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
 */
import { useEffect, useMemo, useState } from 'react'
import { X, Trash2, FileText, Users } from 'lucide-react'
import { notify } from '../../lib/notify'
import {
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
} from '../../lib/planning'
import { toDatetimeLocalValue, toDateInputValue } from './dateUtils'
import EventMembersPanel from './EventMembersPanel'

export default function EventEditorModal({
  event,
  initialDate,
  projectId,
  lots = [],
  eventTypes = [],
  locations = [],
  onClose,
  onSaved,
}) {
  const isNew = !event?.id

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
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Onglets Infos / Équipe (les membres ne sont accessibles qu'en édition)
  const [activeTab, setActiveTab] = useState('info')
  const [members, setMembers] = useState(event?.members || [])

  async function reloadMembers() {
    if (!event?.id) return
    try {
      const fresh = await getEvent(event.id)
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

    setSaving(true)
    try {
      const payload = {
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
        await createEvent({ project_id: projectId, ...payload })
        notify.success('Événement créé')
      } else {
        await updateEvent(event.id, payload)
        notify.success('Événement mis à jour')
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
      await deleteEvent(event.id)
      notify.success('Événement supprimé')
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-hidden rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <h3 className="text-base font-semibold" style={{ color: 'var(--txt)' }}>
            {isNew ? 'Nouvel événement' : "Modifier l'événement"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--txt-2)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        {!isNew && (
          <div
            className="flex items-center gap-1 px-5"
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
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {activeTab === 'members' && !isNew ? (
            <EventMembersPanel
              eventId={event.id}
              projectId={projectId}
              members={members}
              onMutated={reloadMembers}
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
          </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          {/* Supprimer (édition seulement) */}
          <div>
            {!isNew && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2"
                style={{
                  color: confirmDelete ? '#fff' : 'var(--red)',
                  background: confirmDelete ? 'var(--red)' : 'transparent',
                  border: '1px solid var(--red)',
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {confirmDelete ? 'Confirmer la suppression' : 'Supprimer'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium"
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
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--blue)', color: '#fff' }}
            >
              {saving ? 'Enregistrement…' : isNew ? 'Créer' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers internes ────────────────────────────────────────────────────────
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
