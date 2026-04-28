// ════════════════════════════════════════════════════════════════════════════
// LivrableEtapeCard — carte d'une étape pipeline (LIV-9)
// ════════════════════════════════════════════════════════════════════════════
//
// Pendant pour les étapes du `VersionCard` (LIV-8). Inline edit tous les
// champs, sync vers l'event planning miroir géré côté lib (LIV-4).
//
// LIV-9 — l'étape est typée via `event_type_id` (référence event_types de
// l'org) au lieu d'un enum `kind` figé. Le dropdown affiche directement les
// types planning de l'org (Dérush, Étalonnage, VFX/compositing, types
// custom…). La couleur de bordure latérale reprend `eventType.color` pour
// scan visuel cohérent avec le bloc planning.
//
// Modes de date :
//   - Mode "1 jour"   : date_debut === date_fin → on n'affiche qu'un input
//                       "Date" + petit toggle ↔ pour passer en plage.
//   - Mode "Plage"    : date_debut < date_fin → on affiche 2 inputs
//                       (Début, Fin) + toggle pour repasser en 1 jour.
//
// Toggle planning (`is_event`) :
//   - Coché (défaut) : étape génère un event miroir dans le planning.
//   - Décoché        : étape conceptuelle, pas d'event (utile pour un brief
//                      DA ou une validation client qui ne doit pas occuper
//                      de bloc dans la timeline).
//
// Props :
//   - etape        : objet livrable_etapes
//   - eventTypes   : Array<event_type> de l'org (dropdown + couleur bordure)
//   - actions      : `useLivrables.actions`
//   - canEdit      : booléen
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Calendar, CalendarRange, Eye, EyeOff, Trash2 } from 'lucide-react'
import { confirm } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'
import EventTypeSelect from './EventTypeSelect'
import MonteurAvatar from './MonteurAvatar'

const FALLBACK_COLOR = '#94a3b8' // slate-400 — si event_type non résolu

export default function LivrableEtapeCard({
  etape,
  eventTypes = [],
  actions,
  canEdit = true,
}) {
  // États locaux (inline edit) — sync external via useEffect.
  const [nom, setNom] = useState(etape.nom || '')
  const [dateDebut, setDateDebut] = useState(etape.date_debut || '')
  const [dateFin, setDateFin] = useState(etape.date_fin || '')
  const [assignee, setAssignee] = useState(etape.assignee_external || '')
  const [notes, setNotes] = useState(etape.notes || '')

  useEffect(() => setNom(etape.nom || ''), [etape.nom])
  useEffect(() => setDateDebut(etape.date_debut || ''), [etape.date_debut])
  useEffect(() => setDateFin(etape.date_fin || ''), [etape.date_fin])
  useEffect(() => setAssignee(etape.assignee_external || ''), [etape.assignee_external])
  useEffect(() => setNotes(etape.notes || ''), [etape.notes])

  // Mode date : 1 jour si les deux dates sont identiques, plage sinon.
  const isOneDay = useMemo(
    () => Boolean(dateDebut) && dateDebut === dateFin,
    [dateDebut, dateFin],
  )
  const [rangeMode, setRangeMode] = useState(!isOneDay)
  // Si l'utilisateur a cliqué le toggle → on respecte son choix. Sinon on
  // suit la donnée (utile au sync realtime).
  useEffect(() => {
    setRangeMode(!isOneDay)
  }, [isOneDay])

  // Résolution event_type → couleur + label. Si event_type_id pointe sur un
  // type archivé/supprimé, on tombe sur le fallback gris.
  const eventType = useMemo(
    () => eventTypes.find((t) => t.id === etape.event_type_id) || null,
    [eventTypes, etape.event_type_id],
  )
  const typeColor = eventType?.color || FALLBACK_COLOR

  // ─── Save helper ─────────────────────────────────────────────────────────
  const saveField = useCallback(
    async (field, value, { nullIfEmpty = true } = {}) => {
      if (!canEdit) return
      const current = etape[field] ?? (nullIfEmpty ? null : '')
      const nextValue =
        nullIfEmpty && (value === '' || value == null) ? null : value
      if (nextValue === current) return
      try {
        await actions.updateEtape(etape.id, { [field]: nextValue })
      } catch (err) {
        notify.error('Erreur sauvegarde : ' + (err?.message || err))
      }
    },
    [actions, canEdit, etape],
  )

  // ─── Save dates en bloc (mode 1 jour ↔ plage) ────────────────────────────
  // En mode "1 jour", saisir date_debut suffit ; on aligne date_fin dessus.
  // En mode "plage", on commit les deux. Une étape n'a JAMAIS date_fin <
  // date_debut côté UI : si l'utilisateur saisit une date_fin antérieure,
  // on la clamp à date_debut (CHECK constraint côté DB).
  const saveDates = useCallback(
    async ({ debut, fin }) => {
      if (!canEdit) return
      const nextDebut = debut ?? dateDebut
      const nextFin = fin ?? dateFin
      if (!nextDebut) return // jamais vide (CHECK NOT NULL)
      // Clamp si fin < debut
      const finalFin = nextFin && nextFin < nextDebut ? nextDebut : nextFin || nextDebut
      const patch = {}
      if (nextDebut !== etape.date_debut) patch.date_debut = nextDebut
      if (finalFin !== etape.date_fin) patch.date_fin = finalFin
      if (!Object.keys(patch).length) return
      try {
        await actions.updateEtape(etape.id, patch)
      } catch (err) {
        notify.error('Erreur dates : ' + (err?.message || err))
      }
    },
    [actions, canEdit, dateDebut, dateFin, etape],
  )

  // ─── Toggle 1 jour ↔ plage ───────────────────────────────────────────────
  const handleToggleRange = useCallback(() => {
    if (!canEdit) return
    if (rangeMode) {
      // Repasser en "1 jour" : aligner date_fin sur date_debut.
      setRangeMode(false)
      setDateFin(dateDebut)
      saveDates({ fin: dateDebut })
    } else {
      // Passer en plage : on déclenche juste l'affichage du 2e champ.
      // L'utilisateur saisira sa date_fin ; tant qu'il n'a pas saisi,
      // date_fin reste = date_debut côté DB (= 1 jour effectif).
      setRangeMode(true)
    }
  }, [canEdit, dateDebut, rangeMode, saveDates])

  // ─── Toggle is_event ─────────────────────────────────────────────────────
  const handleToggleEvent = useCallback(async () => {
    if (!canEdit) return
    try {
      await actions.updateEtape(etape.id, { is_event: !etape.is_event })
    } catch (err) {
      notify.error('Erreur planning : ' + (err?.message || err))
    }
  }, [actions, canEdit, etape.id, etape.is_event])

  // ─── Change event_type_id (= type planning) ─────────────────────────────
  const handleTypeChange = useCallback(
    async (nextTypeId) => {
      if (!canEdit || nextTypeId === etape.event_type_id) return
      try {
        await actions.updateEtape(etape.id, { event_type_id: nextTypeId || null })
      } catch (err) {
        notify.error('Erreur type : ' + (err?.message || err))
      }
    },
    [actions, canEdit, etape.id, etape.event_type_id],
  )

  // ─── Suppression ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!canEdit) return
    const ok = await confirm({
      title: `Supprimer l'étape "${etape.nom || 'sans nom'}" ?`,
      message:
        'Suppression définitive (l\'event planning miroir sera retiré aussi). Pas de corbeille pour les étapes.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    try {
      await actions.deleteEtape(etape.id)
      notify.success('Étape supprimée')
    } catch (err) {
      notify.error('Erreur suppression : ' + (err?.message || err))
    }
  }, [actions, canEdit, etape.id, etape.nom])

  return (
    <article
      className="rounded-lg p-3 flex flex-col gap-2.5"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        borderLeft: `3px solid ${typeColor}`,
        opacity: etape.is_event ? 1 : 0.7,
      }}
    >
      {/* Ligne 1 : nom + kind dropdown + actions */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onBlur={() => saveField('nom', nom.trim(), { nullIfEmpty: false })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={!canEdit}
          placeholder="Nom de l'étape…"
          className="flex-1 min-w-0 bg-transparent focus:outline-none text-sm font-semibold"
          style={{ color: 'var(--txt)' }}
        />

        {/* Type dropdown (event_types de l'org — Dérush, Étalonnage, VFX…) */}
        <EventTypeSelect
          value={etape.event_type_id}
          onChange={handleTypeChange}
          eventTypes={eventTypes}
          canEdit={canEdit}
          size="xs"
          align="right"
        />

        {canEdit && (
          <>
            <button
              type="button"
              onClick={handleToggleEvent}
              aria-label={etape.is_event ? 'Cacher du planning' : 'Afficher dans le planning'}
              title={etape.is_event ? 'Affichée dans le planning' : 'Cachée du planning'}
              className="p-1 rounded shrink-0"
              style={{ color: etape.is_event ? 'var(--blue)' : 'var(--txt-3)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              {etape.is_event ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Supprimer l'étape"
              className="p-1 rounded shrink-0"
              style={{ color: 'var(--txt-3)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--red-bg)'
                e.currentTarget.style.color = 'var(--red)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--txt-3)'
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Ligne 2 : dates (mode 1 jour ↔ plage) */}
      <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--txt-3)' }}>
        {rangeMode ? (
          <CalendarRange className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <Calendar className="w-3.5 h-3.5 shrink-0" />
        )}

        <input
          type="date"
          value={dateDebut}
          onChange={(e) => setDateDebut(e.target.value)}
          onBlur={() => {
            // En mode "1 jour", on aligne date_fin = date_debut au commit.
            if (!rangeMode) {
              setDateFin(dateDebut)
              saveDates({ debut: dateDebut, fin: dateDebut })
            } else {
              saveDates({ debut: dateDebut })
            }
          }}
          disabled={!canEdit}
          className="bg-transparent focus:outline-none"
          style={{
            color: 'var(--txt-2)',
            cursor: canEdit ? 'text' : 'default',
          }}
        />

        {rangeMode && (
          <>
            <span style={{ color: 'var(--txt-3)' }}>→</span>
            <input
              type="date"
              value={dateFin}
              min={dateDebut || undefined}
              onChange={(e) => setDateFin(e.target.value)}
              onBlur={() => saveDates({ fin: dateFin })}
              disabled={!canEdit}
              className="bg-transparent focus:outline-none"
              style={{
                color: 'var(--txt-2)',
                cursor: canEdit ? 'text' : 'default',
              }}
            />
          </>
        )}

        {canEdit && (
          <button
            type="button"
            onClick={handleToggleRange}
            aria-label={rangeMode ? 'Étape sur 1 jour' : 'Étape sur plusieurs jours'}
            title={rangeMode ? 'Repasser en 1 jour' : 'Passer en plage'}
            className="p-1 rounded ml-1"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt-2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <ArrowRightLeft className="w-3 h-3" />
          </button>
        )}

        {!etape.is_event && (
          <span
            className="ml-auto text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: 'var(--bg-2)', color: 'var(--txt-3)' }}
            title="Étape non synchronisée avec le planning"
          >
            hors planning
          </span>
        )}
      </div>

      {/* Ligne 3 : responsable + notes */}
      <div className="flex items-center gap-1.5">
        <MonteurAvatar name={assignee} size="sm" />
        <input
          type="text"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          onBlur={() => saveField('assignee_external', assignee.trim())}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={!canEdit}
          placeholder="Responsable…"
          className="flex-1 min-w-0 bg-transparent focus:outline-none text-xs"
          style={{ color: 'var(--txt-2)' }}
        />
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => saveField('notes', notes.trim())}
        disabled={!canEdit}
        placeholder="Notes internes…"
        rows={2}
        className="w-full bg-transparent focus:outline-none text-xs resize-y rounded px-2 py-1.5"
        style={{
          color: 'var(--txt-2)',
          border: '1px solid var(--brd-sub)',
          background: 'var(--bg-elev)',
          minHeight: '40px',
        }}
      />
    </article>
  )
}
