// ════════════════════════════════════════════════════════════════════════════
// CreneauInspector — Side panel d'édition d'un créneau du déroulé
// ════════════════════════════════════════════════════════════════════════════
//
// Ouvert sur clic d'un bloc dans la timeline ou d'une ligne dans la liste.
// Slide depuis la droite, ne couvre PAS la timeline (max-width 380px).
//
// Trois modes :
//   - 'view'   : si !canEdit, ou par défaut quand on ouvre un créneau existant
//   - 'edit'   : champs éditables (toggle via bouton "Modifier")
//   - 'create' : création (passé creneauDraft sans .id), bouton "Créer" en bas
//
// Champs gérés : titre, type, horaires, lane (ou multi-lane), équipe assignée,
// lieu, statut (V3), notes, supprimer.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { X, Trash2, Save, Plus } from 'lucide-react'
import {
  CRENEAU_TYPES,
  CRENEAU_TYPE_COLORS,
  CRENEAU_STATUTS,
  effectiveCouleurCreneau,
  timeToMinutes,
} from '../../lib/deroule'

const TYPE_LABELS = {
  install: 'Installation',
  repas: 'Repas',
  prise: 'Prise',
  pause: 'Pause',
  transport: 'Transport',
  brief: 'Briefing',
  live: 'Live',
  autre: 'Autre',
}

const STATUT_LABELS = {
  planifie: 'Planifié',
  en_cours: 'En cours',
  fait: 'Fait',
  annule: 'Annulé',
}

/**
 * @param {Object|null} creneau     créneau actuel (null = panel fermé)
 * @param {boolean}     isCreate    si true, mode création (creneau = draft sans id)
 * @param {Array}       lanes
 * @param {Array}       membresPresents  membres présents ce jour selon techlist
 * @param {boolean}     canEdit
 * @param {Function}    onClose
 * @param {Function}    onSave      (fields) => Promise — pour update
 * @param {Function}    onCreate    (fields) => Promise — pour create
 * @param {Function}    onDelete    () => Promise
 * @param {Function}    onSetMembres (membreIds) => Promise
 */
export default function CreneauInspector({
  creneau,
  isCreate = false,
  lanes,
  membresPresents,
  canEdit,
  onClose,
  onSave,
  onCreate,
  onDelete,
  onSetMembres,
}) {
  const [draft, setDraft] = useState(() => initDraft(creneau))
  const [memberIds, setMemberIds] = useState(() => creneau?.member_ids || [])
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(isCreate || !creneau?.id)

  useEffect(() => {
    setDraft(initDraft(creneau))
    setMemberIds(creneau?.member_ids || [])
    setEditing(isCreate || !creneau?.id)
  }, [creneau, isCreate])

  if (!creneau) return null

  function patch(fields) {
    setDraft((d) => ({ ...d, ...fields }))
  }

  async function handleSave() {
    if (!canEdit) return
    setSaving(true)
    try {
      // Validation horaires basique
      if (timeToMinutes(draft.heure_fin) <= timeToMinutes(draft.heure_debut)) {
        alert('L\'heure de fin doit être après l\'heure de début.')
        return
      }
      if (isCreate) {
        const fields = {
          ...draft,
          member_ids: memberIds,
        }
        await onCreate?.(fields)
      } else {
        await onSave?.(draft)
        // Persist member_ids séparément si modifié
        const currentSet = new Set(creneau?.member_ids || [])
        const newSet = new Set(memberIds)
        const changed =
          currentSet.size !== newSet.size ||
          [...currentSet].some((id) => !newSet.has(id))
        if (changed) await onSetMembres?.(memberIds)
        setEditing(false)
      }
    } catch (e) {
      console.error('[CreneauInspector] save error', e)
      alert('Erreur : ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!canEdit) return
    if (!window.confirm('Supprimer ce créneau ?')) return
    setSaving(true)
    try {
      await onDelete?.()
    } catch (e) {
      alert('Erreur : ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const currentLane = lanes.find((l) => l.id === draft.lane_id)
  const color = effectiveCouleurCreneau({ ...creneau, ...draft })

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{
          background: 'rgba(0,0,0,0.35)',
        }}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col"
        style={{
          width: 'min(420px, 100vw)',
          background: 'var(--bg-surf)',
          borderLeft: '1px solid var(--brd)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.15)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              style={{
                width: 4,
                height: 24,
                background: color,
                borderRadius: 2,
              }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
                {isCreate ? 'Nouveau créneau' : (draft.titre || creneau.titre || '(sans titre)')}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                {draft.heure_debut?.slice(0, 5)} – {draft.heure_fin?.slice(0, 5)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--txt-3)', background: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — formulaire */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Titre */}
          <Field label="Titre">
            {editing ? (
              <input
                type="text"
                value={draft.titre}
                onChange={(e) => patch({ titre: e.target.value })}
                placeholder="Ex: Installation caméras"
                className="w-full px-2 py-1.5 text-sm rounded outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                }}
              />
            ) : (
              <div className="text-sm" style={{ color: 'var(--txt)' }}>
                {draft.titre || '(sans titre)'}
              </div>
            )}
          </Field>

          {/* Horaires */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Début">
              {editing ? (
                <input
                  type="time"
                  step="300"
                  value={draft.heure_debut?.slice(0, 5)}
                  onChange={(e) => patch({ heure_debut: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm rounded outline-none"
                  style={{
                    background: 'var(--bg-elev)',
                    color: 'var(--txt)',
                    border: '1px solid var(--brd)',
                  }}
                />
              ) : (
                <div className="text-sm" style={{ color: 'var(--txt)' }}>
                  {draft.heure_debut?.slice(0, 5)}
                </div>
              )}
            </Field>
            <Field label="Fin">
              {editing ? (
                <input
                  type="time"
                  step="300"
                  value={draft.heure_fin?.slice(0, 5)}
                  onChange={(e) => patch({ heure_fin: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm rounded outline-none"
                  style={{
                    background: 'var(--bg-elev)',
                    color: 'var(--txt)',
                    border: '1px solid var(--brd)',
                  }}
                />
              ) : (
                <div className="text-sm" style={{ color: 'var(--txt)' }}>
                  {draft.heure_fin?.slice(0, 5)}
                </div>
              )}
            </Field>
          </div>

          {/* Lane / multi-lane */}
          <Field label="Lane">
            {editing ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt-2)' }}>
                  <input
                    type="checkbox"
                    checked={draft.multi_lane}
                    onChange={(e) =>
                      patch({
                        multi_lane: e.target.checked,
                        lane_id: e.target.checked ? null : (lanes[0]?.id || null),
                      })
                    }
                  />
                  Bloc multi-lane (couvre toutes les lanes)
                </label>
                {!draft.multi_lane && (
                  <select
                    value={draft.lane_id || ''}
                    onChange={(e) => patch({ lane_id: e.target.value || null })}
                    className="w-full px-2 py-1.5 text-sm rounded outline-none"
                    style={{
                      background: 'var(--bg-elev)',
                      color: 'var(--txt)',
                      border: '1px solid var(--brd)',
                    }}
                  >
                    {lanes.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.libelle}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--txt)' }}>
                {draft.multi_lane ? '↔ Multi-lane' : (currentLane?.libelle || '—')}
              </div>
            )}
          </Field>

          {/* Type */}
          <Field label="Type">
            {editing ? (
              <div className="flex flex-wrap gap-1">
                {CRENEAU_TYPES.map((t) => {
                  const c = CRENEAU_TYPE_COLORS[t]
                  const active = draft.type === t
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => patch({ type: t })}
                      className="px-2 py-1 text-[11px] rounded transition-colors"
                      style={{
                        background: active ? `${c}25` : 'var(--bg-elev)',
                        color: active ? c : 'var(--txt-2)',
                        border: `1px solid ${active ? c : 'var(--brd-sub)'}`,
                        fontWeight: active ? 500 : 400,
                      }}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--txt)' }}>
                {TYPE_LABELS[draft.type] || draft.type}
              </div>
            )}
          </Field>

          {/* Équipe */}
          <Field
            label={`Équipe assignée${memberIds.length ? ` (${memberIds.length})` : ''}`}
          >
            {editing ? (
              <MembrePicker
                membres={membresPresents}
                selected={memberIds}
                onChange={setMemberIds}
              />
            ) : (
              <div className="flex flex-wrap gap-1">
                {memberIds.length === 0 && (
                  <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                    Personne
                  </span>
                )}
                {memberIds.map((id) => {
                  const m = membresPresents.find((x) => x.id === id)
                  return (
                    <span
                      key={id}
                      className="px-1.5 py-0.5 rounded text-[11px]"
                      style={{
                        background: 'var(--bg-elev)',
                        color: 'var(--txt-2)',
                        border: '1px solid var(--brd-sub)',
                      }}
                    >
                      {m ? `${m.prenom || m.contact?.prenom || ''} ${m.nom || m.contact?.nom || ''}`.trim() : '?'}
                    </span>
                  )
                })}
              </div>
            )}
          </Field>

          {/* Lieu */}
          <Field label="Lieu">
            {editing ? (
              <input
                type="text"
                value={draft.lieu_text || ''}
                onChange={(e) => patch({ lieu_text: e.target.value || null })}
                placeholder="Ex: Plateau, Régie 2..."
                className="w-full px-2 py-1.5 text-sm rounded outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                }}
              />
            ) : (
              <div className="text-sm" style={{ color: 'var(--txt)' }}>
                {draft.lieu_text || '—'}
              </div>
            )}
          </Field>

          {/* Statut (V3) */}
          {!isCreate && (
            <Field label="Statut">
              {editing ? (
                <select
                  value={draft.statut}
                  onChange={(e) => patch({ statut: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm rounded outline-none"
                  style={{
                    background: 'var(--bg-elev)',
                    color: 'var(--txt)',
                    border: '1px solid var(--brd)',
                  }}
                >
                  {CRENEAU_STATUTS.map((s) => (
                    <option key={s} value={s}>
                      {STATUT_LABELS[s] || s}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm" style={{ color: 'var(--txt)' }}>
                  {STATUT_LABELS[draft.statut] || draft.statut}
                </div>
              )}
            </Field>
          )}

          {/* Notes */}
          <Field label="Notes">
            {editing ? (
              <textarea
                value={draft.notes || ''}
                onChange={(e) => patch({ notes: e.target.value || null })}
                rows={3}
                placeholder="Briefing technique, contraintes..."
                className="w-full px-2 py-1.5 text-sm rounded outline-none resize-y"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                }}
              />
            ) : (
              <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--txt)' }}>
                {draft.notes || '—'}
              </div>
            )}
          </Field>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 px-4 py-3"
          style={{
            borderTop: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          {!isCreate && canEdit && editing && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--red)',
                background: 'transparent',
                border: '1px solid var(--brd-sub)',
              }}
            >
              <Trash2 className="w-3 h-3" />
              Supprimer
            </button>
          )}
          <div className="flex-1" />
          {!isCreate && !editing && canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 text-xs rounded transition-colors"
              style={{
                color: 'var(--txt)',
                background: 'transparent',
                border: '1px solid var(--brd)',
              }}
            >
              Modifier
            </button>
          )}
          {editing && (
            <>
              {!isCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(initDraft(creneau))
                    setMemberIds(creneau?.member_ids || [])
                    setEditing(false)
                  }}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs rounded transition-colors"
                  style={{
                    color: 'var(--txt-2)',
                    background: 'transparent',
                    border: '1px solid var(--brd-sub)',
                  }}
                >
                  Annuler
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded transition-colors"
                style={{
                  color: 'white',
                  background: saving ? 'var(--brd)' : 'var(--blue)',
                  border: '1px solid transparent',
                }}
              >
                {isCreate ? (
                  <>
                    <Plus className="w-3 h-3" />
                    Créer
                  </>
                ) : (
                  <>
                    <Save className="w-3 h-3" />
                    Enregistrer
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Field — wrapper label + content ────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-wider font-bold mb-1"
        style={{ color: 'var(--txt-3)' }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

// ─── MembrePicker — multi-select compact filtré sur membres présents ───────

function MembrePicker({ membres, selected, onChange }) {
  const [search, setSearch] = useState('')
  const filtered = membres.filter((m) => {
    if (!search) return true
    const fn = `${m.prenom || m.contact?.prenom || ''} ${m.nom || m.contact?.nom || ''}`.toLowerCase()
    return fn.includes(search.toLowerCase())
  })

  function toggle(id) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id))
    else onChange([...selected, id])
  }

  return (
    <div
      className="rounded"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        maxHeight: 200,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher..."
        className="w-full px-2 py-1 text-xs outline-none"
        style={{
          background: 'transparent',
          color: 'var(--txt)',
          borderBottom: '1px solid var(--brd-sub)',
        }}
      />
      <div className="overflow-y-auto" style={{ flex: 1, maxHeight: 160 }}>
        {filtered.length === 0 && (
          <div className="px-2 py-2 text-xs" style={{ color: 'var(--txt-3)' }}>
            Aucun membre présent ce jour
          </div>
        )}
        {filtered.map((m) => {
          const checked = selected.includes(m.id)
          const fn = `${m.prenom || m.contact?.prenom || ''} ${m.nom || m.contact?.nom || ''}`.trim() || '—'
          return (
            <label
              key={m.id}
              className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer transition-colors"
              style={{
                background: checked ? 'var(--bg-hov)' : 'transparent',
                color: 'var(--txt)',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(m.id)}
              />
              <span className="truncate">{fn}</span>
              {m.specialite && (
                <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                  · {m.specialite}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ─── initDraft — défauts pour création ou copie depuis creneau existant ────

function initDraft(creneau) {
  if (!creneau) return null
  return {
    titre: creneau.titre || '',
    heure_debut: creneau.heure_debut || '09:00',
    heure_fin: creneau.heure_fin || '10:00',
    lane_id: creneau.lane_id || null,
    multi_lane: creneau.multi_lane || false,
    type: creneau.type || 'autre',
    couleur: creneau.couleur || null,
    lieu_text: creneau.lieu_text || null,
    statut: creneau.statut || 'planifie',
    notes: creneau.notes || null,
  }
}
