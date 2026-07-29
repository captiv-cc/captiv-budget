// ════════════════════════════════════════════════════════════════════════════
// TrajetModal — création / édition d'un trajet à étapes (Logistique V1, P2)
// ════════════════════════════════════════════════════════════════════════════
//
// Un trajet = un déplacement (aller / retour / autre) daté, composé de N
// étapes ordonnées : « Train 12339 · 10h42 · Gare de Lyon → Mtp St-Roch »
// puis « Minibus · 14h30 · St-Roch → Zénith (conducteur : Samuel) ».
// Le coût est global au trajet, optionnel, et n'apparaît JAMAIS sur les
// partages (décision Hugo). Ouvert depuis la grille (chip ou +) et depuis
// la fiche personne.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bus,
  Car,
  Loader2,
  Plane,
  Plus,
  Train,
  TramFront,
  Trash2,
  X,
} from 'lucide-react'
import { createTrajet, updateTrajet, deleteTrajet } from '../../lib/logistique'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

const MODES = [
  { value: 'train', label: 'Train', icon: Train },
  { value: 'minibus', label: 'Minibus', icon: Bus },
  { value: 'voiture', label: 'Voiture', icon: Car },
  { value: 'avion', label: 'Avion', icon: Plane },
  { value: 'autre', label: 'Autre', icon: TramFront },
]

const SENS_OPTIONS = [
  { value: 'aller', label: 'Aller' },
  { value: 'retour', label: 'Retour' },
  { value: 'autre', label: 'Autre' },
]

const EMPTY_ETAPE = { mode: 'train', heure: '', depart: '', arrivee: '', note: '' }

export default function TrajetModal({
  projectId,
  membre,          // row membre (nom affiché)
  membreName = '',
  trajet = null,   // null = création
  defaultDate = null,
  defaultSens = 'aller',
  onSaved,         // (trajet) => void — reload côté appelant
  onDeleted,       // () => void
  onClose,
}) {
  const [sens, setSens] = useState(trajet?.sens || defaultSens)
  const [dateTrajet, setDateTrajet] = useState(trajet?.date_trajet || defaultDate || '')
  const [etapes, setEtapes] = useState(() =>
    Array.isArray(trajet?.etapes) && trajet.etapes.length
      ? trajet.etapes.map((e) => ({ ...EMPTY_ETAPE, ...e }))
      : [{ ...EMPTY_ETAPE }],
  )
  const [cout, setCout] = useState(trajet?.cout ?? '')
  const [notes, setNotes] = useState(trajet?.notes || '')
  const [saving, setSaving] = useState(false)

  // Esc ferme
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !saving) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  function patchEtape(idx, patch) {
    setEtapes((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)))
  }
  function moveEtape(idx, dir) {
    setEtapes((prev) => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }
  function removeEtape(idx) {
    setEtapes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev))
  }

  async function handleSave() {
    if (saving) return
    // Étapes vides (aucun champ rempli) filtrées au save.
    const cleanEtapes = etapes.filter(
      (e) => e.heure.trim() || e.depart.trim() || e.arrivee.trim() || e.note.trim(),
    )
    setSaving(true)
    try {
      const payload = {
        sens,
        date_trajet: dateTrajet || null,
        etapes: cleanEtapes,
        cout: cout === '' ? null : Number(cout),
        notes: notes.trim() || null,
      }
      let saved
      if (trajet?.id) {
        saved = await updateTrajet(trajet.id, payload)
      } else {
        saved = await createTrajet({
          projectId,
          membreId: membre.id,
          sens: payload.sens,
          dateTrajet: payload.date_trajet,
          etapes: payload.etapes,
          cout: payload.cout,
          notes: payload.notes,
        })
      }
      notify.success(trajet?.id ? 'Trajet mis à jour' : 'Trajet créé')
      onSaved?.(saved)
      onClose?.()
    } catch (err) {
      notify.error('Trajet : ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!trajet?.id) return
    const ok = await confirm({
      title: 'Supprimer ce trajet ?',
      message: 'Les étapes et le coût associés seront supprimés. Action irréversible.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      await deleteTrajet(trajet.id)
      notify.success('Trajet supprimé')
      onDeleted?.()
      onClose?.()
    } catch (err) {
      notify.error('Suppression : ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={() => !saving && onClose?.()}
      />
      <div
        className="relative w-full max-w-lg rounded-xl flex flex-col"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          maxHeight: 'calc(100vh - 32px)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-5 py-3.5 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            {trajet?.id ? 'Modifier le trajet' : 'Nouveau trajet'}
          </h2>
          <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
            · {membreName}
          </span>
          <button
            type="button"
            onClick={() => !saving && onClose?.()}
            className="ml-auto p-1"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Sens + date + coût */}
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                Sens
              </span>
              <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--brd)' }}>
                {SENS_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setSens(o.value)}
                    className="text-xs font-semibold px-2.5 py-1.5"
                    style={{
                      background: sens === o.value ? 'var(--blue-bg)' : 'var(--bg)',
                      color: sens === o.value ? 'var(--blue)' : 'var(--txt-2)',
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                Date
              </span>
              <input
                type="date"
                value={dateTrajet || ''}
                onChange={(e) => setDateTrajet(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-md outline-none"
                style={inputStyle}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--txt-3)' }}
                title="Interne : jamais visible sur les partages"
              >
                Coût (€, interne)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cout}
                onChange={(e) => setCout(e.target.value)}
                placeholder="—"
                className="text-xs px-2 py-1.5 rounded-md outline-none w-[110px]"
                style={inputStyle}
              />
            </label>
          </div>

          {/* Étapes */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--txt-3)' }}>
              Étapes (dans l&apos;ordre du voyage)
            </p>
            <div className="flex flex-col gap-2">
              {etapes.map((e, idx) => (
                <div
                  key={idx}
                  className="rounded-lg p-2.5 flex flex-col gap-2"
                  style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold tabular-nums" style={{ color: 'var(--txt-3)' }}>
                      {idx + 1}.
                    </span>
                    <select
                      value={e.mode}
                      onChange={(ev) => patchEtape(idx, { mode: ev.target.value })}
                      className="text-xs px-1.5 py-1 rounded-md outline-none"
                      style={inputStyle}
                    >
                      {MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      value={e.heure}
                      onChange={(ev) => patchEtape(idx, { heure: ev.target.value })}
                      className="text-xs px-1.5 py-1 rounded-md outline-none"
                      style={inputStyle}
                      title="Heure de départ de l'étape"
                    />
                    <span className="ml-auto flex items-center gap-0.5">
                      <IconBtn title="Monter" disabled={idx === 0} onClick={() => moveEtape(idx, -1)}>
                        <ArrowUp className="w-3 h-3" />
                      </IconBtn>
                      <IconBtn
                        title="Descendre"
                        disabled={idx === etapes.length - 1}
                        onClick={() => moveEtape(idx, 1)}
                      >
                        <ArrowDown className="w-3 h-3" />
                      </IconBtn>
                      <IconBtn
                        title="Supprimer l'étape"
                        disabled={etapes.length === 1}
                        onClick={() => removeEtape(idx)}
                        danger
                      >
                        <Trash2 className="w-3 h-3" />
                      </IconBtn>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={e.depart}
                      onChange={(ev) => patchEtape(idx, { depart: ev.target.value })}
                      placeholder="Départ (ex. Gare de Lyon)"
                      className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md outline-none"
                      style={inputStyle}
                    />
                    <span style={{ color: 'var(--txt-3)' }}>→</span>
                    <input
                      type="text"
                      value={e.arrivee}
                      onChange={(ev) => patchEtape(idx, { arrivee: ev.target.value })}
                      placeholder="Arrivée (ex. Mtp St-Roch)"
                      className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md outline-none"
                      style={inputStyle}
                    />
                  </div>
                  <input
                    type="text"
                    value={e.note}
                    onChange={(ev) => patchEtape(idx, { note: ev.target.value })}
                    placeholder="Note (n° de train, conducteur, point de RDV…)"
                    className="text-xs px-2 py-1.5 rounded-md outline-none"
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setEtapes((prev) => [...prev, { ...EMPTY_ETAPE, mode: 'minibus' }])}
              className="mt-2 flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt-2)',
                border: '1px dashed var(--brd)',
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter une étape
            </button>
          </div>

          {/* Notes */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
              Notes du trajet
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Ex. billets échangeables, arriver 20 min avant…"
              className="text-xs px-2 py-1.5 rounded-md outline-none resize-y"
              style={{ ...inputStyle, fontFamily: 'inherit' }}
            />
          </label>
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          {trajet?.id && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-2 rounded-lg"
              style={{ color: 'var(--red, #ef4444)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Supprimer
            </button>
          )}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => !saving && onClose?.()}
              className="text-xs font-semibold px-3 py-2 rounded-lg"
              style={{ color: 'var(--txt-2)' }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-40"
              style={{ background: 'var(--blue)', color: '#fff' }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {trajet?.id ? 'Enregistrer' : 'Créer le trajet'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled = false, danger = false }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="p-1 rounded transition-all disabled:opacity-25"
      style={{ color: danger ? 'var(--red, #ef4444)' : 'var(--txt-3)' }}
    >
      {children}
    </button>
  )
}
