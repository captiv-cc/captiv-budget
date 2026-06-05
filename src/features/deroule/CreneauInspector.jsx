// ════════════════════════════════════════════════════════════════════════════
// CreneauInspector — Side panel d'édition d'un créneau du déroulé
// ════════════════════════════════════════════════════════════════════════════
//
// Ouvert sur clic d'un bloc dans la timeline ou d'une ligne dans la liste.
// Slide depuis la droite, ne couvre PAS la timeline.
//
// Trois modes :
//   - 'view'   : si !canEdit, ou par défaut quand on ouvre un créneau existant
//   - 'edit'   : champs éditables (toggle via bouton "Modifier")
//   - 'create' : création (passé creneauDraft sans .id), bouton "Créer" en bas
//
// Round 1+2+3 UI/UX :
//   - Header : border-top accentué par la couleur du type + densité réduite
//   - Sections réordonnées : Titre → Type → Horaires (+ durée + Lane) → Équipe → Lieu → Notes
//   - Durée affichée dynamiquement entre Début et Fin
//   - Validation live (heure_fin <= heure_debut → bordure rouge inline)
//   - Lendemain caché derrière un picto +1j compact (toggle visible)
//   - Raccourcis clavier : Esc ferme, Cmd/Ctrl+Enter enregistre
//   - MembrePicker : présents triés en haut, hors présence dans une section
//     collapsible
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Trash2, Save, Plus, ChevronRight, ChevronDown } from 'lucide-react'
import {
  CRENEAU_TYPES,
  CRENEAU_TYPE_COLORS,
  CRENEAU_STATUTS,
  MAX_MIN,
  effectiveCouleurCreneau,
  timeToMinutes,
  formatMinTimeInput,
  formatMinHHMM,
} from '../../lib/deroule'
import RichEditor, { isDocEmpty, docsEqual } from '../../components/rich-editor'
import { useYjsCollab } from '../../hooks/useYjsCollab'
import { usePopoverPosition } from '../../hooks/usePopoverPosition'

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
 * @param {Array}       membresPresents  TOUS les membres du projet (avec flag
 *                                       present_ce_jour)
 * @param {boolean}     canEdit
 * @param {DOMRect|null} anchorRect rect du bloc/ligne cliqué (popover anchored).
 *                                  Si null, le popover se centre à l'écran
 *                                  (fallback). POP-1.
 * @param {Function}    onClose
 * @param {Function}    onSave      (fields) => Promise — pour update (save
 *                                  explicite, FERME le drawer + toast)
 * @param {Function}    onAutoSaveNotes (notes) => Promise — FEST-2.7 :
 *                                  save SILENCIEUX et debounced pour les
 *                                  notes collab. Ne ferme PAS le drawer.
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
  anchorRect = null,
  onClose,
  onSave,
  onAutoSaveNotes,
  onCreate,
  onDelete,
  onSetMembres,
}) {
  const [draft, setDraft] = useState(() => initDraft(creneau))
  const [memberIds, setMemberIds] = useState(() => creneau?.member_ids || [])
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(isCreate || !creneau?.id)

  // Ne réinitialise le draft que si on change réellement de créneau
  // (changement d'ID), pas à chaque update Realtime du même créneau —
  // sinon l'auto-save notes déclenche un re-fetch → nouvelle référence
  // d'objet → draft écrasé pendant qu'on saisit dans titre/horaires.
  useEffect(() => {
    setDraft(initDraft(creneau))
    setMemberIds(creneau?.member_ids || [])
    setEditing(isCreate || !creneau?.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creneau?.id, isCreate])

  // ─── Collab Y.js sur les notes (FEST-2.5) ────────────────────────────────
  // Active la collab uniquement si on a un creneau.id (créneau persisté) ET
  // qu'on est en mode édition. En mode view ou create, on lit/écrit creneau.notes
  // directement sans channel Realtime (économise une connexion).
  const collabEnabled = Boolean(creneau?.id) && editing && canEdit
  const {
    doc: yjsDoc,
    awareness: yjsAwareness,
    myUserMeta,
    peers: editingPeers,
  } = useYjsCollab({
    docId: creneau?.id || null,
    scope: 'deroule-creneau',
    enabled: collabEnabled,
  })

  // Auto-save debounced des notes (3s d'inactivité). Distinct du Save
  // explicite des autres champs — les notes collab ont leur propre cycle
  // de vie temps réel.
  const notesSaveTimerRef = useRef(null)
  const lastSavedNotesRef = useRef(null)
  const debouncedSaveNotes = (newNotesJson) => {
    if (!creneau?.id || !canEdit) return
    if (notesSaveTimerRef.current) clearTimeout(notesSaveTimerRef.current)
    notesSaveTimerRef.current = setTimeout(async () => {
      // Stocker NULL si doc vide pour économiser place + cohérence existant.
      const toSave = isDocEmpty(newNotesJson) ? null : newNotesJson
      if (docsEqual(toSave, lastSavedNotesRef.current)) return
      lastSavedNotesRef.current = toSave
      try {
        // Utilise onAutoSaveNotes (silencieux) si dispo, sinon fallback
        // onSave (peut fermer le drawer — fallback pour compat).
        if (typeof onAutoSaveNotes === 'function') {
          await onAutoSaveNotes(toSave)
        } else {
          await onSave?.({ notes: toSave })
        }
      } catch (e) {
        console.warn('[CreneauInspector] notes save error', e)
      }
    }, 3000)
  }
  // Flush au démontage (changement de créneau, fermeture inspecteur).
  useEffect(() => {
    return () => {
      if (notesSaveTimerRef.current) clearTimeout(notesSaveTimerRef.current)
    }
  }, [creneau?.id])

  // Couleur d'accent dérivée du type courant (impacte le header en temps réel)
  const accentColor = useMemo(
    () => effectiveCouleurCreneau({ ...creneau, ...draft }),
    [creneau, draft],
  )

  // Validation live des horaires
  const dureeMin = (draft?.heure_fin_min ?? 0) - (draft?.heure_debut_min ?? 0)
  const horaireInvalide = dureeMin <= 0
  const horaireOver = (draft?.heure_fin_min ?? 0) > MAX_MIN

  // ─── Raccourcis clavier (Esc, Cmd/Ctrl+Enter) ────────────────────────────
  // Stable callback pour le handler global. handleSaveRef pointe toujours
  // vers la dernière version pour ne pas figer une closure stale.
  const handleSaveRef = useRef(null)
  const handleCloseRef = useRef(null)

  useEffect(() => {
    if (!creneau) return undefined
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleCloseRef.current?.()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (editing) handleSaveRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [creneau, editing])

  // ─── POP-1 : Positionnement anchored auto-flip ───────────────────────────
  // (Doit être déclaré AVANT l'early return `if (!creneau) return null` pour
  // respecter rules-of-hooks — le hook se gardera lui-même de calculer si
  // anchorRect est null.)
  const isMobile =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  const { popoverRef, position, ready } = usePopoverPosition({
    anchorRect,
    preferredSide: 'right',
    gap: 14,
  })

  // Click-outside-to-close : écoute mousedown hors du popover.
  useEffect(() => {
    if (!creneau || isMobile) return undefined
    function onDocMouseDown(e) {
      if (popoverRef.current?.contains(e.target)) return
      onClose?.()
    }
    // Délai pour ne pas se déclencher au mousedown initial qui a ouvert le panel
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onDocMouseDown)
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onDocMouseDown)
    }
  }, [creneau, isMobile, onClose, popoverRef])

  if (!creneau) return null

  function patch(fields) {
    setDraft((d) => ({ ...d, ...fields }))
  }

  async function handleSave() {
    if (!canEdit) return
    if (saving) return
    if (horaireInvalide) return
    if (horaireOver) return
    setSaving(true)
    try {
      if (isCreate) {
        const fields = {
          ...draft,
          member_ids: memberIds,
        }
        await onCreate?.(fields)
      } else {
        // En édition d'un créneau persisté, les notes ont leur propre cycle
        // (auto-save collab debounced via debouncedSaveNotes). Les retirer
        // ici évite d'écraser une modif Y.js récente non encore snapshotée.
        const draftStructured = { ...draft }
        delete draftStructured.notes
        await onSave?.(draftStructured)
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
  handleSaveRef.current = handleSave
  handleCloseRef.current = onClose

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

  // Calcul du style position
  // Mobile : bottom sheet style (full width, slide depuis le bas)
  // Desktop avec anchorRect : popover anchored
  // Desktop sans anchorRect : centré (fallback)
  let panelStyle = {}
  if (isMobile) {
    panelStyle = {
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      maxHeight: '90vh',
      borderRadius: '12px 12px 0 0',
    }
  } else if (anchorRect) {
    panelStyle = {
      position: 'fixed',
      top: position.top,
      left: position.left,
      width: 420,
      maxHeight: 'calc(100vh - 16px)',
      borderRadius: 8,
      opacity: ready ? 1 : 0,
      transition: 'opacity 120ms ease',
    }
  } else {
    panelStyle = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 420,
      maxHeight: 'calc(100vh - 32px)',
      borderRadius: 8,
    }
  }

  return (
    <>
      {/* Mobile : backdrop léger pour fermeture au tap (uniquement mobile) */}
      {isMobile && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        />
      )}

      {/* Panel anchored popover (desktop) ou bottom sheet (mobile) */}
      <div
        ref={popoverRef}
        className="z-50 flex flex-col"
        style={{
          ...panelStyle,
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          borderTop: `3px solid ${accentColor}`,
          boxShadow: '0 12px 32px rgba(0,0,0,0.22)',
          overflow: 'hidden',
        }}
      >
        {/* Flèche pointant vers le bloc (desktop avec anchor uniquement) */}
        {!isMobile && anchorRect && (
          <PopoverArrow
            side={position.side}
            offset={position.arrowOffset}
            accentColor={accentColor}
          />
        )}

        {/* Header compact (sans la barre verticale, l'accent est sur le top) */}
        <div
          className="flex items-center justify-between gap-2 px-4 py-2.5"
          style={{
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: `${accentColor}22`,
                  color: accentColor,
                }}
              >
                {TYPE_LABELS[draft.type] || draft.type}
              </span>
              {!isCreate && draft.statut !== 'planifie' && (
                <span
                  className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
                  style={{
                    background: 'var(--bg-surf)',
                    color: 'var(--txt-2)',
                    border: '1px solid var(--brd-sub)',
                  }}
                >
                  {STATUT_LABELS[draft.statut]}
                </span>
              )}
            </div>
            <div className="text-sm font-semibold truncate mt-0.5" style={{ color: 'var(--txt)' }}>
              {isCreate ? 'Nouveau créneau' : (draft.titre || creneau.titre || '(sans titre)')}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              {formatMinHHMM(draft.heure_debut_min)} – {formatMinHHMM(draft.heure_fin_min)}
              {dureeMin > 0 && (
                <span style={{ marginLeft: 6, color: 'var(--txt-3)' }}>
                  · {formatDuree(dureeMin)}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--txt-3)', background: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            title="Fermer (Échap)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — formulaire */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Titre — proéminent */}
          <Field label="Titre">
            {editing ? (
              <input
                type="text"
                value={draft.titre}
                onChange={(e) => patch({ titre: e.target.value })}
                placeholder="Ex: Installation caméras"
                autoFocus={isCreate}
                className="w-full px-2 py-1.5 rounded outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                  fontSize: 15,
                  fontWeight: 500,
                }}
              />
            ) : (
              <div style={{ color: 'var(--txt)', fontSize: 15, fontWeight: 500 }}>
                {draft.titre || '(sans titre)'}
              </div>
            )}
          </Field>

          {/* Type — chips colorés (ré-ordonné AVANT horaires car dicte la couleur) */}
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

          {/* Horaires + Lane (groupés — décisions structurantes proches) */}
          <Field label="Horaires">
            {editing ? (
              <div className="space-y-2">
                <div className="flex items-stretch gap-2">
                  <TimeWithLendemain
                    value={draft.heure_debut_min}
                    onChange={(v) => patch({ heure_debut_min: v })}
                    disabled={!canEdit}
                  />
                  <div className="flex items-center text-xs" style={{ color: 'var(--txt-3)' }}>
                    →
                  </div>
                  <TimeWithLendemain
                    value={draft.heure_fin_min}
                    onChange={(v) => patch({ heure_fin_min: v })}
                    disabled={!canEdit}
                    invalid={horaireInvalide || horaireOver}
                  />
                </div>
                <div
                  className="text-[11px] flex items-center gap-2"
                  style={{
                    color: horaireInvalide || horaireOver
                      ? 'var(--red)'
                      : 'var(--txt-3)',
                  }}
                >
                  {horaireInvalide ? (
                    <span>L'heure de fin doit être après le début.</span>
                  ) : horaireOver ? (
                    <span>La fin ne peut pas dépasser 04:00 du lendemain.</span>
                  ) : (
                    <span>Durée : {formatDuree(dureeMin)}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--txt)' }}>
                {formatMinHHMM(draft.heure_debut_min)} – {formatMinHHMM(draft.heure_fin_min)}
                <span style={{ color: 'var(--txt-3)', marginLeft: 6 }}>
                  · {formatDuree(dureeMin)}
                </span>
              </div>
            )}
          </Field>

          {/* Lane (intégré juste après les horaires car c'est la 2e décision
              structurante) */}
          <Field label="Lane">
            {editing ? (
              <div className="space-y-1">
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
                <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--txt-2)' }}>
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
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--txt)' }}>
                {draft.multi_lane ? '↔ Multi-lane' : (currentLane?.libelle || '—')}
              </div>
            )}
          </Field>

          {/* Équipe assignée */}
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
                      {m
                        ? `${m.contact?.prenom || m.prenom || ''} ${m.contact?.nom || m.nom || ''}`.trim()
                        : '?'}
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

          {/* Statut (V3 — éditable seulement en update, pas en create) */}
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

          {/* Notes — RichEditor Tiptap (FEST-2.4) + collab Y.js si édition
              sur créneau persisté (FEST-2.5). Auto-save debounced 3s. */}
          <Field
            label={
              <span className="flex items-center gap-1.5">
                <span>Notes</span>
                {collabEnabled && editingPeers.length > 0 && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{
                      background: 'var(--bg-elev)',
                      color: 'var(--txt-2)',
                      border: '1px solid var(--brd)',
                    }}
                    title={editingPeers.map((p) => p.name).join(', ')}
                  >
                    {editingPeers.length === 1
                      ? `${editingPeers[0].name} édite aussi`
                      : `${editingPeers.length} personnes éditent`}
                  </span>
                )}
              </span>
            }
          >
            {editing ? (
              collabEnabled && yjsDoc ? (
                // Mode collab temps réel (créneau persisté + édition active)
                <RichEditor
                  collaboration={{
                    doc: yjsDoc,
                    awareness: yjsAwareness,
                    user: myUserMeta,
                    initialContent: creneau.notes,
                  }}
                  onChange={debouncedSaveNotes}
                  placeholder="Briefing technique, contraintes…"
                  minHeight={100}
                />
              ) : (
                // Mode local (création ou pas encore connecté)
                <RichEditor
                  value={draft.notes}
                  onChange={(json) =>
                    patch({ notes: isDocEmpty(json) ? null : json })
                  }
                  placeholder="Briefing technique, contraintes…"
                  minHeight={100}
                />
              )
            ) : (
              // Mode lecture : pas de collab, lecture seule du snapshot BDD
              <RichEditor value={creneau?.notes} readOnly minHeight={20} />
            )}
          </Field>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 px-4 py-2.5"
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
                disabled={saving || horaireInvalide || horaireOver}
                title={isCreate ? 'Créer (Cmd/Ctrl+Entrée)' : 'Enregistrer (Cmd/Ctrl+Entrée)'}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded transition-colors"
                style={{
                  color: 'white',
                  background: saving || horaireInvalide || horaireOver ? 'var(--brd)' : 'var(--blue)',
                  border: '1px solid transparent',
                  cursor: saving || horaireInvalide || horaireOver ? 'not-allowed' : 'pointer',
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

// ─── Field — wrapper label + content (densité réduite) ─────────────────────

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

// ─── TimeWithLendemain — input time compact + toggle "+1j" discret ─────────
//
// V0.5 supporte les heures > 23:59 (jusqu'à 04:00 J+1) pour les lives qui
// passent minuit. L'input HTML <input type="time"> ne gère pas natif les
// heures > 23:59 → on utilise un toggle "+1j" inline qui ajoute/retire 1440
// au heure_min.

function TimeWithLendemain({ value, onChange, disabled, invalid }) {
  const isLendemain = value >= 1440
  const inputValue = formatMinTimeInput(value)

  function handleTimeChange(timeStr) {
    const m = timeToMinutes(timeStr)
    if (Number.isFinite(m)) {
      onChange(m + (isLendemain ? 1440 : 0))
    }
  }

  function toggleLendemain() {
    if (disabled) return
    const base = value % 1440
    onChange(base + (isLendemain ? 0 : 1440))
  }

  return (
    <div
      className="flex items-stretch rounded overflow-hidden"
      style={{
        border: `1px solid ${invalid ? 'var(--red)' : 'var(--brd)'}`,
        background: 'var(--bg-elev)',
        flex: 1,
      }}
    >
      <input
        type="time"
        step="300"
        value={inputValue}
        onChange={(e) => handleTimeChange(e.target.value)}
        disabled={disabled}
        className="px-2 py-1.5 text-sm outline-none flex-1 min-w-0"
        style={{
          background: 'transparent',
          color: 'var(--txt)',
          border: 'none',
        }}
      />
      <button
        type="button"
        onClick={toggleLendemain}
        disabled={disabled}
        title={isLendemain ? 'Ce jour' : 'Lendemain (+1j)'}
        className="px-1.5 text-[10px] font-bold transition-colors"
        style={{
          background: isLendemain ? 'var(--blue)' : 'transparent',
          color: isLendemain ? 'white' : 'var(--txt-3)',
          borderLeft: '1px solid var(--brd-sub)',
          cursor: disabled ? 'default' : 'pointer',
          minWidth: 28,
        }}
      >
        +1j
      </button>
    </div>
  )
}

// ─── MembrePicker — présents en haut, hors présence collapsible ────────────

function MembrePicker({ membres, selected, onChange }) {
  const [search, setSearch] = useState('')
  const [showHorsPresence, setShowHorsPresence] = useState(false)

  // Sépare présents / hors présence (filtrés par search)
  const { presents, horsPresence } = useMemo(() => {
    const lower = search.toLowerCase()
    const allFiltered = (membres || []).filter((m) => {
      if (!search) return true
      const fn = `${m.contact?.prenom || m.prenom || ''} ${m.contact?.nom || m.nom || ''}`.toLowerCase()
      return fn.includes(lower)
    })
    return {
      presents: allFiltered.filter((m) => m.present_ce_jour !== false),
      horsPresence: allFiltered.filter((m) => m.present_ce_jour === false),
    }
  }, [membres, search])

  // Quand l'utilisateur tape une recherche, on déplie automatiquement la
  // section "Hors présence" pour qu'il voie les résultats matching dedans
  // (sinon il devrait cliquer le chevron à chaque fois pour comprendre
  // pourquoi sa recherche "ne donne rien").
  const effectiveShowHorsPresence = showHorsPresence || search.trim().length > 0

  function toggle(id) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id))
    else onChange([...selected, id])
  }

  // Helpers de sélection rapide
  const allIds = (membres || []).map((m) => m.id)
  const presentsIds = (membres || [])
    .filter((m) => m.present_ce_jour !== false)
    .map((m) => m.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id))
  const allPresentsSelected =
    presentsIds.length > 0 && presentsIds.every((id) => selected.includes(id))

  function toggleAll() {
    onChange(allSelected ? [] : allIds)
  }
  function selectAllPresents() {
    if (allPresentsSelected) {
      onChange(selected.filter((id) => !presentsIds.includes(id)))
    } else {
      const next = new Set(selected)
      for (const id of presentsIds) next.add(id)
      onChange([...next])
    }
  }

  return (
    <div
      className="rounded"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        maxHeight: 260,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header : actions rapides + compteur */}
      <div
        className="flex items-center gap-1 px-2 py-1.5"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <button
          type="button"
          onClick={toggleAll}
          disabled={allIds.length === 0}
          className="px-1.5 py-0.5 text-[10px] rounded transition-colors"
          style={{
            background: allSelected ? 'var(--blue)' : 'var(--bg-surf)',
            color: allSelected ? 'white' : 'var(--txt-2)',
            border: `1px solid ${allSelected ? 'var(--blue)' : 'var(--brd-sub)'}`,
          }}
        >
          {allSelected ? 'Aucun' : 'Tous'}
        </button>
        <button
          type="button"
          onClick={selectAllPresents}
          disabled={presentsIds.length === 0}
          className="px-1.5 py-0.5 text-[10px] rounded transition-colors"
          style={{
            background: allPresentsSelected ? 'var(--blue)' : 'var(--bg-surf)',
            color: allPresentsSelected ? 'white' : 'var(--txt-2)',
            border: `1px solid ${allPresentsSelected ? 'var(--blue)' : 'var(--brd-sub)'}`,
          }}
          title="Sélectionne uniquement les membres présents ce jour selon la techlist"
        >
          Tous présents ({presentsIds.length})
        </button>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {selected.length}/{allIds.length}
        </span>
      </div>

      {/* Search */}
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

      <div className="overflow-y-auto" style={{ flex: 1, maxHeight: 200 }}>
        {/* Présents — toujours visibles */}
        {presents.length === 0 && horsPresence.length === 0 && (
          <div className="px-2 py-2 text-xs" style={{ color: 'var(--txt-3)' }}>
            Aucun membre dans le projet
          </div>
        )}
        {presents.length === 0 && horsPresence.length > 0 && (
          <div className="px-2 py-2 text-xs" style={{ color: 'var(--txt-3)' }}>
            Aucun membre présent ce jour
          </div>
        )}
        {presents.map((m) => (
          <MembreRow
            key={m.id}
            membre={m}
            checked={selected.includes(m.id)}
            onToggle={() => toggle(m.id)}
            isPresent
          />
        ))}

        {/* Hors présence — section collapsible */}
        {horsPresence.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowHorsPresence((v) => !v)}
              className="w-full flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider font-bold transition-colors"
              style={{
                background: 'var(--bg-surf)',
                color: 'var(--txt-3)',
                borderTop: '1px solid var(--brd-sub)',
                borderBottom: effectiveShowHorsPresence ? '1px solid var(--brd-sub)' : 'none',
              }}
              title={
                search.trim()
                  ? 'Auto-déplié pendant la recherche'
                  : 'Membres non présents ce jour selon la techlist'
              }
            >
              {effectiveShowHorsPresence ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              Hors présence ({horsPresence.length})
            </button>
            {effectiveShowHorsPresence &&
              horsPresence.map((m) => (
                <MembreRow
                  key={m.id}
                  membre={m}
                  checked={selected.includes(m.id)}
                  onToggle={() => toggle(m.id)}
                  isPresent={false}
                />
              ))}
          </>
        )}
      </div>
    </div>
  )
}

function MembreRow({ membre: m, checked, onToggle, isPresent }) {
  const fn =
    `${m.contact?.prenom || m.prenom || ''} ${m.contact?.nom || m.nom || ''}`.trim() || '—'
  return (
    <label
      className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer transition-colors"
      style={{
        background: checked ? 'var(--bg-hov)' : 'transparent',
        color: 'var(--txt)',
        opacity: isPresent ? 1 : 0.7,
      }}
      title={isPresent ? '' : 'Non présent ce jour selon la techlist'}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="truncate">{fn}</span>
      {m.specialite && (
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          · {m.specialite}
        </span>
      )}
    </label>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuree(min) {
  if (typeof min !== 'number' || min <= 0) return '—'
  const h = Math.floor(min / 60)
  const m = Math.floor(min % 60)
  if (h === 0) return `${m} min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

// ─── PopoverArrow — Flèche pointant du popover vers le bloc ancré ──────────
// (POP-1) Petite flèche CSS positionnée au bord du popover qui pointe vers
// le centre du bloc cliqué. La couleur reprend l'accent du créneau pour
// renforcer le lien visuel.
function PopoverArrow({ side, offset, accentColor }) {
  // Taille de la flèche (côté du carré rotaté à 45deg)
  const SIZE = 10
  const halfSize = SIZE / 2

  // Position du carré (rotaté 45°) selon le côté
  // Le carré dépasse le bord du popover de halfSize, le reste est masqué par
  // un border-top color.
  let pos = {}
  if (side === 'right') {
    pos = {
      left: -halfSize,
      top: offset - halfSize,
      borderLeft: `1px solid var(--brd)`,
      borderBottom: `1px solid var(--brd)`,
    }
  } else if (side === 'left') {
    pos = {
      right: -halfSize,
      top: offset - halfSize,
      borderRight: `1px solid var(--brd)`,
      borderTop: `1px solid var(--brd)`,
    }
  } else if (side === 'bottom') {
    pos = {
      top: -halfSize,
      left: offset - halfSize,
      borderTop: `1px solid var(--brd)`,
      borderLeft: `1px solid var(--brd)`,
      background: accentColor, // côté top : la bande accent traverse
    }
  } else if (side === 'top') {
    pos = {
      bottom: -halfSize,
      left: offset - halfSize,
      borderRight: `1px solid var(--brd)`,
      borderBottom: `1px solid var(--brd)`,
    }
  }

  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: SIZE,
        height: SIZE,
        background: pos.background || 'var(--bg-surf)',
        transform: 'rotate(45deg)',
        pointerEvents: 'none',
        zIndex: 1,
        ...pos,
      }}
    />
  )
}

// ─── initDraft — défauts pour création ou copie depuis creneau existant ────
// V0.5 : draft stocke heure_debut_min / heure_fin_min en INTEGER minutes.

function initDraft(creneau) {
  if (!creneau) return null
  return {
    titre: creneau.titre || '',
    heure_debut_min:
      typeof creneau.heure_debut_min === 'number' ? creneau.heure_debut_min : 540, // 09:00
    heure_fin_min:
      typeof creneau.heure_fin_min === 'number' ? creneau.heure_fin_min : 600, // 10:00
    lane_id: creneau.lane_id || null,
    multi_lane: creneau.multi_lane || false,
    type: creneau.type || 'autre',
    couleur: creneau.couleur || null,
    lieu_text: creneau.lieu_text || null,
    statut: creneau.statut || 'planifie',
    notes: creneau.notes || null,
  }
}
