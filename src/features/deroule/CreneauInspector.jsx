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
import {
  X,
  Trash2,
  Plus,
  Clock,
  Layers,
  MapPin,
  Users,
  Flag,
  FileText,
  Edit3,
  Link as LinkIcon,
  Copy,
  Share2,
  Check,
  AlertTriangle,
  Info as InfoIcon,
} from 'lucide-react'
import {
  CRENEAU_TYPES,
  CRENEAU_STATUTS,
  MAX_MIN,
  effectiveCouleurCreneau,
  timeToMinutes,
  formatMinTimeInput,
  formatMinHHMM,
  ALERTE_COLORS,
} from '../../lib/deroule'
import RichEditor, { isDocEmpty, docsEqual } from '../../components/rich-editor'
import Tooltip from '../../components/Tooltip'
import CustomSelect from '../../components/CustomSelect'
import { confirm } from '../../lib/confirm'
import { useYjsCollab } from '../../hooks/useYjsCollab'
import { usePopoverPosition } from '../../hooks/usePopoverPosition'
import {
  ANCHOR_FIELDS,
  ANCHOR_FIELD_LABELS,
  proposeAnchorDefault,
  getLinkedChildren,
  getSourceCreneau,
  validateLinkTarget,
  applySourceUpdate,
} from '../../lib/derouleSoftLinks'
import './CreneauInspector.css'

const TYPE_LABELS = {
  install: 'Installation',
  repas: 'Repas',
  prise: 'Prise',
  pause: 'Pause',
  transport: 'Transport',
  brief: 'Briefing',
  live: 'Live',
  autre: 'Autre',
  indispo: 'Indispo', // FEST-5.2 : sommeil / repos cadreur
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
  allCreneaux = [],
  membresPresents,
  canEdit,
  anchorRect = null,
  onClose,
  onSave,
  onAutoSaveNotes,
  onSavePartial,
  onSavePartialForCreneau,
  onSetMembresForCreneau,
  onCreate,
  onDelete,
  onDuplicate,
  onSetMembres,
}) {
  const [draft, setDraft] = useState(() => initDraft(creneau))
  const [memberIds, setMemberIds] = useState(() => creneau?.member_ids || [])
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(isCreate || !creneau?.id)
  // POP-2.B : édition inline du titre dans le header + real-time save
  const [editingTitre, setEditingTitre] = useState(false)
  const [titreDraft, setTitreDraft] = useState(creneau?.titre || '')
  const titreInputRef = useRef(null)
  const titreDebounceRef = useRef(null)
  const titreLastSavedRef = useRef(creneau?.titre || '')
  // FEST-2.10 : modal de gestion du lien source/anchor
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  // FEST-2.11 : modal de propagation aux enfants liés
  const [propagationModalOpen, setPropagationModalOpen] = useState(false)
  // Détecter les enfants liés à ce créneau (pour afficher le bouton propager)
  const linkedChildren = useMemo(
    () => getLinkedChildren(allCreneaux, creneau?.id),
    [allCreneaux, creneau?.id],
  )
  useEffect(() => {
    if (editingTitre && titreInputRef.current) {
      titreInputRef.current.focus()
      titreInputRef.current.select()
    }
  }, [editingTitre])
  useEffect(() => {
    if (!editingTitre) {
      setTitreDraft(creneau?.titre || '')
      titreLastSavedRef.current = creneau?.titre || ''
    }
  }, [creneau?.titre, editingTitre])
  useEffect(() => {
    return () => {
      if (titreDebounceRef.current) clearTimeout(titreDebounceRef.current)
    }
  }, [])
  const scheduleTitreSave = (newDraft) => {
    if (titreDebounceRef.current) clearTimeout(titreDebounceRef.current)
    titreDebounceRef.current = setTimeout(() => {
      const trimmed = newDraft.trim()
      if (trimmed && trimmed !== (titreLastSavedRef.current || '').trim()) {
        titreLastSavedRef.current = trimmed
        // UX-5 : en mode création, patch le draft local au lieu de l'updateCreneau BDD
        if (isCreate) {
          setDraft((d) => ({ ...d, titre: trimmed }))
        } else {
          onSavePartial?.({ titre: trimmed })
        }
      }
    }, 500)
  }

  // Réinitialise complètement le draft à chaque changement de créneau (clic
  // sur un autre bloc). En cas de simple changement de valeur sur le même
  // créneau, sync le draft AVEC LA NOUVELLE VALEUR.
  // UX-3 fix Hugo : on resync MÊME en mode édition. Avec real-time save sur
  // les inline edits, il n'y a plus de "brouillon local non sauvé" à
  // protéger. Les inputs en cours de saisie (titre, lieu, horaires) ont
  // leurs propres lastSavedRef pour éviter les écrasements pendant la
  // frappe (debounce 500ms).
  const lastCreneauIdRef = useRef(null)
  useEffect(() => {
    const idChanged = lastCreneauIdRef.current !== creneau?.id
    if (idChanged) {
      setDraft(initDraft(creneau))
      setMemberIds(creneau?.member_ids || [])
      setEditing(isCreate || !creneau?.id)
      lastCreneauIdRef.current = creneau?.id
    } else {
      setDraft(initDraft(creneau))
      setMemberIds(creneau?.member_ids || [])
    }
  }, [creneau, isCreate])

  // ─── Collab Y.js sur les notes (FEST-2.5) ────────────────────────────────
  // Active la collab uniquement en mode édition (Hugo : "pour la vue 'view':
  // ne pas montrer le bloc modification des notes > seulement le texte
  // figé"). En mode compact, RichEditor en readOnly (texte rendu sans
  // toolbar). Le bouton "Modifier" passe en mode édition complet pour
  // activer Tiptap + collab Y.js sur les notes.
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
    // POP-2.C : on calcule le flip pour la largeur MAX (mode édition)
    // pour éviter que le popover saute de côté quand on clique Modifier.
    expandedWidth: 560,
  })

  // Click-outside-to-close : écoute mousedown hors du popover.
  // POP-2.C : désactivé en mode édition pour éviter de perdre des modifs.
  // FEST-2.10 : désactivé aussi quand la modal de lien est ouverte
  // (sinon clic sur le select natif ferme tout, la modal étant rendue
  // sibling du popover et non à l'intérieur).
  useEffect(() => {
    if (
      !creneau ||
      isMobile ||
      editing ||
      linkModalOpen ||
      propagationModalOpen
    )
      return undefined
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
  }, [creneau, isMobile, editing, linkModalOpen, propagationModalOpen, onClose, popoverRef])

  if (!creneau) return null

  function patch(fields) {
    setDraft((d) => ({ ...d, ...fields }))
  }

  // UX-5 : en mode création, les "save partials" inline ne touchent pas la BDD
  // (rien n'existe encore) → on patch le draft local. Le handleSave (bouton
  // "+ Créer") fera ensuite l'insert avec l'ensemble du draft.
  const effectiveOnSavePartial = isCreate ? patch : onSavePartial
  const effectiveOnSetMembres = isCreate ? undefined : onSetMembres

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
    const ok = await confirm({
      title: 'Supprimer ce créneau ?',
      message: 'Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
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

  // POP-2.C : largeur dynamique
  // - 420px en mode view (compact, lecture rapide)
  // - 560px en mode édition (formulaire long → plus d'air)
  // Transition CSS sur width pour expansion fluide. usePopoverPosition
  // recompute via ResizeObserver donc le flip auto reste cohérent.
  const popoverWidth = editing || isCreate ? 560 : 420

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
      width: popoverWidth,
      maxHeight: 'calc(100vh - 16px)',
      borderRadius: 8,
      opacity: ready ? 1 : 0,
      transition: 'opacity 120ms ease, width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    }
  } else {
    panelStyle = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: popoverWidth,
      maxHeight: 'calc(100vh - 32px)',
      borderRadius: 8,
      transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
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

      {/* Panel anchored popover (desktop) ou bottom sheet (mobile)
          POP-2.A : bande verticale colorée à gauche (au lieu d'une bordure
          top), animation d'entrée scale+opacity, shadow plus subtile. */}
      <div
        ref={popoverRef}
        className="z-50 flex flex-col creneau-popover-enter"
        style={{
          ...panelStyle,
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          borderLeft: `3px solid ${accentColor}`,
          boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
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

        {/* Header dense (POP-2.A) : badge type + titre + avatars peers + X */}
        <div
          className="flex items-center justify-between gap-2 px-3 py-2"
          style={{
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <div className="min-w-0 flex-1 flex items-center gap-2">
            {/* UX-3 : en mode édition, le badge type devient un select
                pour changer le type → impacte la couleur d'accent live.
                UX-5 : actif aussi en mode création (le type fait partie
                du draft local). */}
            {editing ? (
              <CustomSelect
                value={draft.type}
                options={CRENEAU_TYPES.map((t) => ({
                  value: t,
                  label: TYPE_LABELS[t] || t,
                }))}
                onChange={(v) => {
                  patch({ type: v })
                  if (!isCreate) onSavePartial?.({ type: v })
                }}
                renderTrigger={(label) => (
                  <span
                    className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{
                      background: `${accentColor}22`,
                      color: accentColor,
                      border: `1px solid ${accentColor}66`,
                    }}
                  >
                    {label}
                  </span>
                )}
                minWidth={130}
              />
            ) : (
              <span
                className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                style={{
                  background: `${accentColor}22`,
                  color: accentColor,
                }}
              >
                {TYPE_LABELS[draft.type] || draft.type}
              </span>
            )}
            {/* POP-2.B + UX-3 : titre éditable au click (mode view) OU
                directement actif en mode édition.
                UX-5 : en mode création, on rend aussi un input éditable
                (le titre fait partie du draft local). */}
            {(editingTitre || editing) ? (
              <input
                ref={titreInputRef}
                type="text"
                value={titreDraft}
                placeholder={isCreate ? 'Titre du créneau…' : undefined}
                autoFocus={isCreate}
                onChange={(e) => {
                  setTitreDraft(e.target.value)
                  scheduleTitreSave(e.target.value)
                }}
                onBlur={() => {
                  // Force le flush du debounce avant de quitter
                  if (titreDebounceRef.current) {
                    clearTimeout(titreDebounceRef.current)
                    titreDebounceRef.current = null
                  }
                  const trimmed = titreDraft.trim()
                  if (trimmed && trimmed !== (titreLastSavedRef.current || '').trim()) {
                    titreLastSavedRef.current = trimmed
                    if (isCreate) {
                      patch({ titre: trimmed })
                    } else {
                      onSavePartial?.({ titre: trimmed })
                    }
                  } else if (!trimmed && !isCreate) {
                    // Reset si vidé (sauf en création — on peut commencer vide)
                    setTitreDraft(creneau?.titre || '')
                  }
                  // En mode édition global, on garde l'input visible (pas de
                  // bascule view). Seul le mode hover-to-edit (editingTitre
                  // sans editing global) revient en display au blur.
                  if (!editing) setEditingTitre(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    if (titreDebounceRef.current) {
                      clearTimeout(titreDebounceRef.current)
                      titreDebounceRef.current = null
                    }
                    setTitreDraft(creneau?.titre || '')
                    setEditingTitre(false)
                  }
                }}
                className="text-sm font-semibold truncate min-w-0 flex-1"
                style={{
                  background: 'var(--bg)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  outline: 'none',
                }}
              />
            ) : (
              <span
                className="text-sm font-semibold truncate"
                style={{
                  color: 'var(--txt)',
                  cursor: !isCreate && !editing && canEdit ? 'pointer' : 'default',
                  borderRadius: 3,
                  padding: '0 2px',
                }}
                onClick={() => {
                  if (!isCreate && !editing && canEdit) setEditingTitre(true)
                }}
                title={!isCreate && !editing && canEdit ? 'Cliquer pour modifier' : ''}
              >
                {isCreate ? 'Nouveau créneau' : (draft.titre || creneau.titre || '(sans titre)')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Avatars présence collab (peers actuellement sur ce créneau) */}
            {editingPeers.length > 0 && (
              <span
                className="cp-peers-stack"
                title={editingPeers.map((p) => p.name).join(', ') + ' éditent aussi'}
              >
                {editingPeers.slice(0, 3).map((p) => (
                  <span
                    key={p.clientId}
                    className="cp-peer-avatar"
                    style={{ background: p.color }}
                  >
                    {(p.name || '?').charAt(0).toUpperCase()}
                  </span>
                ))}
                {editingPeers.length > 3 && (
                  <span
                    className="cp-peer-avatar"
                    style={{ background: 'var(--txt-3)' }}
                  >
                    +{editingPeers.length - 3}
                  </span>
                )}
              </span>
            )}
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
        </div>

        {/* Body — compact view (POP-2.A) pour view, édition ET création (UX-5).
            En création, les "save partials" inline patchent le draft local
            (via effectiveOnSavePartial). Le bouton "+ Créer" en footer
            committera l'ensemble du draft. */}
        <CompactView
          creneau={creneau}
          draft={draft}
          lanes={lanes}
          allCreneaux={allCreneaux}
          currentLane={currentLane}
          membreIds={memberIds}
          setMemberIds={setMemberIds}
          membresPresents={membresPresents}
          canEdit={canEdit}
          editMode={editing}
          isCreate={isCreate}
          onClose={onClose}
          collabEnabled={collabEnabled}
          yjsDoc={yjsDoc}
          yjsAwareness={yjsAwareness}
          myUserMeta={myUserMeta}
          onAutoSaveNotes={debouncedSaveNotes}
          onSavePartial={effectiveOnSavePartial}
          onSetMembres={effectiveOnSetMembres}
          onPatchDraft={patch}
          onOpenFullEdit={() => setEditing(true)}
          onOpenLinkModal={() => setLinkModalOpen(true)}
        />

        {/* Footer : quick action bar en mode view ET édition (UX-3). Le mode
            création garde son footer classique Annuler/Créer pour l'instant. */}
        {!isCreate ? (
          // UX-3 : Quick actions bar pour view ET édition (Modifier/Terminer
          // selon editing) + Lier + Propager + Dupliquer + Supprimer.
          <div className="cp-quick-actions">
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              disabled={!canEdit}
              className="cp-action-btn is-primary"
            >
              {editing ? (
                <>
                  <Check size={14} />
                  Terminer
                </>
              ) : (
                <>
                  <Edit3 size={14} />
                  Modifier
                </>
              )}
            </button>
            <Tooltip
              text={
                creneau?.source_creneau_id
                  ? 'Lié à un créneau source — cliquez pour gérer'
                  : 'Lier à un créneau existant'
              }
            >
              <button
                type="button"
                disabled={!canEdit}
                className={`cp-action-btn${creneau?.source_creneau_id ? ' is-linked' : ''}`}
                onClick={() => setLinkModalOpen(true)}
              >
                <LinkIcon size={14} />
              </button>
            </Tooltip>
            {/* FEST-2.11 : Propager — visible seulement si source d'autres */}
            {linkedChildren.length > 0 && (
              <Tooltip
                text={`Propager aux ${linkedChildren.length} créneau${linkedChildren.length > 1 ? 'x' : ''} lié${linkedChildren.length > 1 ? 's' : ''}`}
              >
                <button
                  type="button"
                  disabled={!canEdit}
                  className="cp-action-btn"
                  onClick={() => setPropagationModalOpen(true)}
                >
                  <Share2 size={14} />
                </button>
              </Tooltip>
            )}
            <Tooltip text="Dupliquer ce créneau">
              <button
                type="button"
                disabled={!canEdit}
                className="cp-action-btn"
                onClick={() => onDuplicate?.()}
              >
                <Copy size={14} />
              </button>
            </Tooltip>
            <Tooltip text="Supprimer">
              <button
                type="button"
                onClick={handleDelete}
                disabled={!canEdit || saving}
                className="cp-action-btn is-danger"
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </div>
        ) : (
          // UX-5 : footer création aligné sur le style quick-actions du
          // mode édition. Seul bouton "+ Créer" (pleine largeur via
          // is-primary qui applique flex:1). La fermeture se fait via X
          // dans le header ou Échap.
          <div className="cp-quick-actions">
            <button
              type="button"
              onClick={handleSave}
              disabled={!canEdit || saving || horaireInvalide || horaireOver}
              title="Créer (Cmd/Ctrl+Entrée)"
              className="cp-action-btn is-primary"
            >
              <Plus size={14} />
              Créer
            </button>
          </div>
        )}
      </div>

      {/* FEST-2.11 : modal de propagation aux enfants */}
      {propagationModalOpen && creneau && linkedChildren.length > 0 && (
        <PropagationModal
          source={creneau}
          linkedChildren={linkedChildren}
          onClose={() => setPropagationModalOpen(false)}
          onApply={(childPatches, childMembers) => {
            // Applique chaque patch via le handler dédié (un par enfant).
            for (const { childId, patch } of childPatches) {
              onSavePartialForCreneau?.(childId, patch)
            }
            for (const { childId, member_ids } of childMembers) {
              onSetMembresForCreneau?.(childId, member_ids)
            }
            setPropagationModalOpen(false)
          }}
        />
      )}

      {/* FEST-2.10 : modal de gestion du lien source */}
      {linkModalOpen && creneau && (
        <LinkCreneauModal
          creneau={creneau}
          allCreneaux={allCreneaux}
          onClose={() => setLinkModalOpen(false)}
          onSave={({ source_creneau_id, source_anchor, applyCopy }) => {
            // Si applyCopy=true (option par défaut au moment du lier),
            // on calcule les valeurs à copier depuis la source pour les
            // champs cochés dans l'anchor, et on les inclut dans le save.
            let payload = { source_creneau_id, source_anchor }
            if (applyCopy && source_creneau_id) {
              const src = allCreneaux.find((c) => c.id === source_creneau_id)
              if (src) {
                const patch = applySourceUpdate(src, creneau, source_anchor)
                // member_ids (cadreurs) demande un traitement séparé via
                // onSetMembres — pas exposé ici. On l'ignore pour V1,
                // l'utilisateur peut sync manuellement via le picker équipe.
                const { member_ids, ...structured } = patch
                if (member_ids) {
                  onSetMembres?.(member_ids)
                }
                payload = { ...structured, ...payload }
              }
            }
            onSavePartial?.(payload)
            setLinkModalOpen(false)
          }}
        />
      )}
    </>
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

// ─── CompactView (POP-2.A + 2.B) — vue lecture compacte hover-to-edit ────
// POP-2.B : chaque ligne est éditable au click. onSavePartial(fields)
// persiste silencieusement (pas de toast, pas de fermeture du popover).
function CompactView({
  creneau,
  draft,
  lanes,
  allCreneaux,
  currentLane,
  membreIds,
  setMemberIds,
  membresPresents,
  canEdit,
  editMode = false,
  isCreate = false,
  collabEnabled,
  yjsDoc,
  yjsAwareness,
  myUserMeta,
  onAutoSaveNotes,
  onSavePartial,
  onSetMembres,
  onPatchDraft,
  onOpenLinkModal,
}) {
  // UX-3 fix : popover équipe inline en mode édition
  const [equipePickerOpen, setEquipePickerOpen] = useState(false)
  // FEST-2.10 : détecter le statut du lien source
  const sourceCreneau = useMemo(
    () => getSourceCreneau(allCreneaux, creneau),
    [allCreneaux, creneau],
  )
  const linkedChildren = useMemo(
    () => getLinkedChildren(allCreneaux, creneau?.id),
    [allCreneaux, creneau?.id],
  )
  // ─── Lieu : fusion avec la lane si lane.type='lieu' ────────────────────
  // Hugo : "pour les lanes type 'lieu' (Scène Médiator), le lieu = nom de
  // la lane, info doublon".
  const laneIsLieu = currentLane?.type === 'lieu'
  const lieuValue = laneIsLieu
    ? (currentLane?.libelle || '—')
    : (draft.lieu_text || '')

  // ─── Équipe : liste compacte de noms ───────────────────────────────────
  const teamLabels = useMemo(() => {
    if (!Array.isArray(membreIds) || membreIds.length === 0) return []
    return membreIds
      .map((id) => {
        const m = membresPresents?.find((x) => x.id === id)
        if (!m) return null
        const prenom = m.contact?.prenom || m.prenom || ''
        const nom = m.contact?.nom || m.nom || ''
        return (prenom || nom)
          ? `${prenom}${nom ? ' ' + nom : ''}`.trim()
          : null
      })
      .filter(Boolean)
  }, [membreIds, membresPresents])

  // ─── Options pour les selects ───────────────────────────────────────────
  const laneOptions = useMemo(
    () =>
      (lanes || []).map((l) => ({
        value: l.id,
        label: l.libelle || '—',
      })),
    [lanes],
  )
  const statutOptions = useMemo(
    () =>
      CRENEAU_STATUTS.map((s) => ({
        value: s,
        label: STATUT_LABELS[s] || s,
      })),
    [],
  )

  // ─── Save handlers ─────────────────────────────────────────────────────
  // Tous appellent onSavePartial qui appelle updateCreneau sans fermer
  // ni notifier (silencieux). En cas d'échec, le hover-to-edit reste
  // utilisable (l'utilisateur peut réessayer).
  const saveField = (field, value) => onSavePartial?.({ [field]: value })

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ padding: '10px 14px' }}
    >
      {/* FEST-5.4 : ligne Alerte / point d'attention (toujours visible si
          alerte présente OU en mode édition). Édition inline du texte +
          toggle niveau info/important. */}
      <InlineAlerte
        alerteText={draft.alerte_text}
        alerteNiveau={draft.alerte_niveau}
        canEdit={canEdit}
        editMode={editMode || isCreate}
        onSave={(text, niveau) =>
          onSavePartial?.({
            alerte_text: text || null,
            alerte_niveau: text ? niveau || 'important' : null,
          })
        }
      />

      {/* Ligne Horaires (2 inputs heure inline) */}
      <InlineHoraires
        heureDebut={draft.heure_debut_min}
        heureFin={draft.heure_fin_min}
        canEdit={canEdit}
        onSave={(start, end) =>
          onSavePartial?.({ heure_debut_min: start, heure_fin_min: end })
        }
      />

      {/* Ligne Lane (si != type lieu) — select */}
      {!laneIsLieu && currentLane && (
        <InlineSelect
          icon={<Layers size={14} />}
          value={draft.lane_id}
          options={laneOptions}
          canEdit={canEdit}
          renderDisplay={() => currentLane.libelle || '—'}
          onSave={(v) => saveField('lane_id', v)}
        />
      )}

      {/* Ligne Lieu — si lane est de type lieu, le nom de la lane EST le lieu */}
      {laneIsLieu ? (
        // Lieu = nom de la lane (fusion). On peut éditer la LANE (qui change
        // le lieu implicite).
        <InlineSelect
          icon={<MapPin size={14} />}
          value={draft.lane_id}
          options={laneOptions}
          canEdit={canEdit}
          renderDisplay={() => lieuValue}
          onSave={(v) => saveField('lane_id', v)}
        />
      ) : (
        <InlineText
          icon={<MapPin size={14} />}
          value={draft.lieu_text || ''}
          placeholder="Ajouter un lieu"
          canEdit={canEdit}
          onSave={(v) => saveField('lieu_text', v || null)}
        />
      )}

      {/* Ligne Équipe : en editMode → ouvre picker inline (UX-3 fix).
          En view : juste affichage. */}
      <div style={{ position: 'relative' }}>
        <div
          className={`cp-line${editMode && canEdit ? ' is-clickable' : ''}`}
          onClick={() => editMode && canEdit && setEquipePickerOpen(true)}
          title={editMode && canEdit ? "Modifier l'équipe assignée" : ''}
          role={editMode && canEdit ? 'button' : undefined}
        >
          <span className="cp-line-icon"><Users size={14} /></span>
          {teamLabels.length > 0 ? (
            <span className="cp-team-chips">
              {teamLabels.slice(0, 4).map((label, i) => (
                <span key={i} className="cp-team-chip">{label}</span>
              ))}
              {teamLabels.length > 4 && (
                <span className="cp-team-chip">+{teamLabels.length - 4}</span>
              )}
            </span>
          ) : (
            <span className="cp-line-value is-placeholder">Aucun cadreur assigné</span>
          )}
        </div>
        {equipePickerOpen && (
          <EquipePickerPopover
            membresPresents={membresPresents}
            selectedIds={membreIds}
            onChange={(newIds) => {
              setMemberIds?.(newIds)
              onSetMembres?.(newIds)
            }}
            onClose={() => setEquipePickerOpen(false)}
          />
        )}
      </div>

      {/* Ligne Multi-lane (visible seulement en editMode) */}
      {/* Contrainte BDD : multi_lane=true ↔ lane_id=NULL. On gère l'inversion
          côté UI : si on coche, on nullifie lane_id ; si on décoche, on
          assigne par défaut la 1ère lane disponible (Global priorisée). */}
      {editMode && canEdit && (
        <div
          className="cp-line is-clickable"
          style={{ cursor: 'pointer' }}
          title="Couvre toutes les lanes (bloc transversal)"
          onClick={() => {
            const next = !draft.multi_lane
            if (next) {
              onSavePartial?.({ multi_lane: true, lane_id: null })
            } else {
              const defaultLane =
                lanes.find((l) => l.type === 'global') || lanes[0]
              if (defaultLane) {
                onSavePartial?.({ multi_lane: false, lane_id: defaultLane.id })
              }
            }
          }}
        >
          <span className="cp-line-icon" style={{ fontSize: 13 }}>↔</span>
          <span
            className="cp-line-value"
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <CustomCheckbox checked={Boolean(draft.multi_lane)} />
            <span>Bloc multi-lane (couvre toutes les lanes)</span>
          </span>
        </div>
      )}

      {/* Ligne Statut — select (caché en création UX-5 : pas pertinent
          avant insert, défaut 'planifie' au moment du create) */}
      {!isCreate && (
        <InlineSelect
          icon={<Flag size={14} />}
          value={draft.statut}
          options={statutOptions}
          canEdit={canEdit}
          renderDisplay={() => (
            <span className={`cp-status-badge is-${draft.statut}`}>
              {STATUT_LABELS[draft.statut] || draft.statut}
            </span>
          )}
          onSave={(v) => saveField('statut', v)}
        />
      )}

      {/* FEST-2.10 : ligne Lien source (si lié OU si source d'autres)
          UX-5 : pas affichée en création (créneau pas encore persisté → pas
          de lien possible). */}
      {!isCreate && (sourceCreneau || linkedChildren.length > 0) && (
        <div
          className={`cp-line${canEdit ? ' is-clickable' : ''}`}
          onClick={() => canEdit && onOpenLinkModal?.()}
          role={canEdit ? 'button' : undefined}
          title={canEdit ? 'Gérer le lien source' : ''}
        >
          <span className="cp-line-icon"><LinkIcon size={14} /></span>
          {sourceCreneau ? (
            <span className="cp-line-value">
              Lié à{' '}
              <strong style={{ color: 'var(--txt)' }}>
                {sourceCreneau.titre || '(sans titre)'}
              </strong>
              <span className="cp-line-extra" style={{ marginLeft: 6 }}>
                {formatMinHHMM(sourceCreneau.heure_debut_min)}
              </span>
            </span>
          ) : (
            <span className="cp-line-value">
              Source de{' '}
              <strong style={{ color: 'var(--txt)' }}>
                {linkedChildren.length} créneau{linkedChildren.length > 1 ? 'x' : ''}
              </strong>
            </span>
          )}
        </div>
      )}

      {/* Section Notes (toujours visible) */}
      <div className="cp-notes-section">
        <div className="cp-notes-header">
          <FileText size={11} />
          Notes
        </div>
        {collabEnabled && yjsDoc ? (
          <RichEditor
            collaboration={{
              doc: yjsDoc,
              awareness: yjsAwareness,
              user: myUserMeta,
              initialContent: creneau.notes,
            }}
            onChange={onAutoSaveNotes}
            placeholder="Briefing technique, contraintes…"
            minHeight={40}
          />
        ) : isCreate ? (
          // UX-5 : en création, éditeur local (pas encore de collab Y.js).
          // Le contenu est patché dans le draft via onPatchDraft et committé
          // au handleSave (bouton "+ Créer").
          <RichEditor
            value={draft.notes}
            onChange={(json) =>
              onPatchDraft?.({ notes: isDocEmpty(json) ? null : json })
            }
            placeholder="Briefing technique, contraintes…"
            minHeight={40}
          />
        ) : (
          <RichEditor value={creneau?.notes} readOnly minHeight={20} />
        )}
      </div>
    </div>
  )
}

// ─── InlineText (POP-2.B) — texte éditable au click ───────────────────────
// Hugo : real-time save debounced (500ms). Si on clique ailleurs avant
// le commit final, le save est déjà parti en arrière-plan.
function InlineText({ icon, value, placeholder, canEdit, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const inputRef = useRef(null)
  const debounceTimerRef = useRef(null)
  const lastSavedRef = useRef(value || '')

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  // Sync si value change depuis l'extérieur pendant qu'on n'édite pas
  useEffect(() => {
    if (!editing) {
      setDraft(value || '')
      lastSavedRef.current = value || ''
    }
  }, [value, editing])

  // Cleanup du timer au unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  // Debounced save à chaque keystroke (500ms après dernière frappe)
  const scheduleAutoSave = (newDraft) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      const trimmed = newDraft.trim()
      if (trimmed !== (lastSavedRef.current || '').trim()) {
        lastSavedRef.current = trimmed
        onSave?.(trimmed)
      }
    }, 500)
  }

  const commit = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    const trimmed = draft.trim()
    if (trimmed !== (lastSavedRef.current || '').trim()) {
      lastSavedRef.current = trimmed
      onSave?.(trimmed)
    }
    setEditing(false)
  }
  const cancel = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    setDraft(value || '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="cp-line" style={{ background: 'var(--bg-elev)' }}>
        <span className="cp-line-icon">{icon}</span>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            scheduleAutoSave(e.target.value)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          placeholder={placeholder}
          className="cp-line-value"
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--txt)',
            font: 'inherit',
            padding: 0,
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={`cp-line${canEdit ? ' is-clickable' : ''}`}
      onClick={() => canEdit && setEditing(true)}
      role={canEdit ? 'button' : undefined}
      title={canEdit ? 'Cliquer pour modifier' : ''}
    >
      <span className="cp-line-icon">{icon}</span>
      {value ? (
        <span className="cp-line-value">{value}</span>
      ) : (
        <span className="cp-line-value is-placeholder">{placeholder}</span>
      )}
    </div>
  )
}

// ─── InlineSelect (POP-2.B + UX-3 fix) — dropdown custom DESK ─────────────
// UX-3 fix Hugo : remplace le <select> natif OS (rendu moche, hors thème)
// par un CustomSelect stylé. Triggered au click, popover stylé avec hover,
// keyboard navigation, check indicator. Cohérent avec DayPicker et autres
// popovers DESK.
function InlineSelect({ icon, value, options, canEdit, renderDisplay, onSave }) {
  if (!canEdit) {
    return (
      <div className="cp-line">
        <span className="cp-line-icon">{icon}</span>
        <span className="cp-line-value">{renderDisplay()}</span>
      </div>
    )
  }
  return (
    <div className="cp-line is-clickable">
      <span className="cp-line-icon">{icon}</span>
      <CustomSelect
        value={value}
        options={options}
        onChange={(v) => onSave?.(v)}
        renderTrigger={() => (
          <span className="cp-line-value" style={{ display: 'inline-block' }}>
            {renderDisplay()}
          </span>
        )}
        triggerStyle={{ flex: 1 }}
        minWidth={180}
      />
    </div>
  )
}

// ─── InlineHoraires (POP-2.B) — 2 inputs time inline ──────────────────────
// Hugo : real-time save debounced 500ms après chaque changement (typage
// dans le segment heure/minute du time input).
function InlineHoraires({ heureDebut, heureFin, canEdit, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draftDebut, setDraftDebut] = useState(heureDebut)
  const [draftFin, setDraftFin] = useState(heureFin)
  const debutRef = useRef(null)
  const containerRef = useRef(null)
  const debounceTimerRef = useRef(null)
  const lastSavedRef = useRef({ debut: heureDebut, fin: heureFin })

  useEffect(() => {
    if (editing && debutRef.current) {
      debutRef.current.focus()
    }
  }, [editing])

  useEffect(() => {
    if (!editing) {
      setDraftDebut(heureDebut)
      setDraftFin(heureFin)
      lastSavedRef.current = { debut: heureDebut, fin: heureFin }
    }
  }, [heureDebut, heureFin, editing])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  const dureeMinDraft = (draftFin ?? 0) - (draftDebut ?? 0)
  const invalid = dureeMinDraft <= 0

  const scheduleAutoSave = (newDebut, newFin) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      if (newFin - newDebut <= 0) return // ne pas sauver des horaires invalides
      const last = lastSavedRef.current
      if (newDebut !== last.debut || newFin !== last.fin) {
        lastSavedRef.current = { debut: newDebut, fin: newFin }
        onSave?.(newDebut, newFin)
      }
    }, 500)
  }

  const commit = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (invalid) return
    const last = lastSavedRef.current
    if (draftDebut !== last.debut || draftFin !== last.fin) {
      lastSavedRef.current = { debut: draftDebut, fin: draftFin }
      onSave?.(draftDebut, draftFin)
    }
    setEditing(false)
  }
  const cancel = () => {
    setDraftDebut(heureDebut)
    setDraftFin(heureFin)
    setEditing(false)
  }

  // Hugo : on perdait l'édition au passage debut → fin (blur déclenchait
  // commit). Fix : on ne commit que si le focus quitte VRAIMENT le
  // container (relatedTarget pas dans containerRef).
  const handleBlur = (e) => {
    const nextFocus = e.relatedTarget
    if (containerRef.current && containerRef.current.contains(nextFocus)) {
      return // on tabule juste à l'autre input
    }
    commit()
  }

  if (editing) {
    return (
      <div className="cp-line" style={{ background: 'var(--bg-elev)' }}>
        <span className="cp-line-icon"><Clock size={14} /></span>
        <div
          ref={containerRef}
          style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
        >
          <input
            ref={debutRef}
            type="time"
            step={300}
            value={formatMinTimeInput(draftDebut % 1440)}
            onChange={(e) => {
              const m = timeToMinutes(e.target.value)
              if (Number.isFinite(m)) {
                const offset = draftDebut >= 1440 ? 1440 : 0
                const newDebut = m + offset
                setDraftDebut(newDebut)
                scheduleAutoSave(newDebut, draftFin)
              }
            }}
            onBlur={handleBlur}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: invalid ? 'var(--red)' : 'var(--txt)',
              font: 'inherit',
              padding: 0,
              minWidth: 65,
            }}
          />
          <span style={{ color: 'var(--txt-3)' }}>–</span>
          <input
            type="time"
            step={300}
            value={formatMinTimeInput(draftFin % 1440)}
            onChange={(e) => {
              const m = timeToMinutes(e.target.value)
              if (Number.isFinite(m)) {
                const offset = draftFin >= 1440 ? 1440 : 0
                const newFin = m + offset
                setDraftFin(newFin)
                scheduleAutoSave(draftDebut, newFin)
              }
            }}
            onBlur={handleBlur}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: invalid ? 'var(--red)' : 'var(--txt)',
              font: 'inherit',
              padding: 0,
              minWidth: 65,
            }}
          />
        </div>
        {!invalid && (
          <span className="cp-line-extra">{formatDuree(dureeMinDraft)}</span>
        )}
      </div>
    )
  }

  return (
    <div
      className={`cp-line${canEdit ? ' is-clickable' : ''}`}
      onClick={() => canEdit && setEditing(true)}
      role={canEdit ? 'button' : undefined}
      title={canEdit ? 'Cliquer pour modifier' : ''}
    >
      <span className="cp-line-icon"><Clock size={14} /></span>
      <span className="cp-line-value">
        {formatMinHHMM(heureDebut)} – {formatMinHHMM(heureFin)}
      </span>
      <span className="cp-line-extra">
        {formatDuree((heureFin ?? 0) - (heureDebut ?? 0))}
      </span>
    </div>
  )
}

// ─── InlineAlerte (FEST-5.4) — alerte / point d'attention ─────────────────
//
// Bandeau coloré (orange = important, bleu = info) au top du popover.
//   - Vide + non éditable      → ne rend rien
//   - Vide + éditable          → placeholder "+ Ajouter un point d'attention"
//   - Avec alerte (view ou edit) → bandeau coloré + texte éditable + toggle
//                                  niveau + bouton supprimer
//
// Save real-time debounced 500ms (cohérent avec les autres InlineX).
function InlineAlerte({ alerteText, alerteNiveau, canEdit, editMode, onSave }) {
  const hasText = Boolean(alerteText && alerteText.trim())
  const niveau = alerteNiveau || (hasText ? 'important' : 'important')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(alerteText || '')
  const [draftNiveau, setDraftNiveau] = useState(niveau)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const lastSavedTextRef = useRef(alerteText || '')

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  useEffect(() => {
    if (!editing) {
      setDraft(alerteText || '')
      lastSavedTextRef.current = alerteText || ''
    }
  }, [alerteText, editing])

  useEffect(() => {
    setDraftNiveau(niveau)
  }, [niveau])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function scheduleSave(text, lvl) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const trimmed = (text || '').trim()
      if (trimmed !== (lastSavedTextRef.current || '').trim()) {
        lastSavedTextRef.current = trimmed
        onSave?.(trimmed, lvl)
      }
    }, 500)
  }

  function commit() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const trimmed = draft.trim()
    if (trimmed !== (lastSavedTextRef.current || '').trim()) {
      lastSavedTextRef.current = trimmed
      onSave?.(trimmed, draftNiveau)
    }
    setEditing(false)
  }

  function cancel() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setDraft(alerteText || '')
    setEditing(false)
  }

  function toggleNiveau() {
    const next = draftNiveau === 'important' ? 'info' : 'important'
    setDraftNiveau(next)
    if (hasText) {
      // Save immédiat du nouveau niveau (pas besoin de debounce)
      onSave?.(alerteText, next)
    }
  }

  function handleDelete() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setDraft('')
    lastSavedTextRef.current = ''
    onSave?.(null, null)
    setEditing(false)
  }

  // Cas 1 : vide + non éditable → rien
  if (!hasText && (!editMode || !canEdit)) return null

  const color = ALERTE_COLORS[niveau] || ALERTE_COLORS.important
  const colorDraft = ALERTE_COLORS[draftNiveau] || color
  const Icon = (editing ? draftNiveau : niveau) === 'important' ? AlertTriangle : InfoIcon

  // Cas 2 : vide + éditable → placeholder
  if (!hasText && !editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true)
          setDraft('')
        }}
        className="cp-line is-clickable"
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          color: 'var(--txt-3)',
          fontSize: 12,
          padding: '6px 8px',
          marginBottom: 4,
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        <span className="cp-line-icon">
          <AlertTriangle size={14} />
        </span>
        <span className="cp-line-value">
          + Ajouter un point d&apos;attention
        </span>
      </button>
    )
  }

  // Cas 3 : avec alerte (view OU edit) — bandeau coloré
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 8px',
        background:
          (editing ? draftNiveau : niveau) === 'important'
            ? 'rgba(245,158,11,0.10)'
            : 'rgba(59,130,246,0.10)',
        border: `1px solid ${editing ? colorDraft : color}55`,
        borderRadius: 6,
        marginBottom: 6,
      }}
    >
      {/* Toggle niveau (cliquable si canEdit) */}
      <button
        type="button"
        onClick={() => canEdit && toggleNiveau()}
        disabled={!canEdit}
        title={
          canEdit
            ? `Niveau : ${(editing ? draftNiveau : niveau) === 'important' ? 'Important' : 'Info'} — clic pour basculer`
            : (editing ? draftNiveau : niveau) === 'important'
            ? 'Important'
            : 'Info'
        }
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          marginTop: 2,
          cursor: canEdit ? 'pointer' : 'default',
          color: editing ? colorDraft : color,
          flexShrink: 0,
        }}
      >
        <Icon size={14} />
      </button>

      {/* Texte — éditable au click si canEdit */}
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            scheduleSave(e.target.value, draftNiveau)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          placeholder="Ex : Show décalé · 3 premiers titres"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 12,
            color: 'var(--txt)',
            padding: 0,
          }}
        />
      ) : (
        <span
          onClick={() => canEdit && editMode && setEditing(true)}
          style={{
            flex: 1,
            fontSize: 12,
            color: 'var(--txt)',
            cursor: canEdit && editMode ? 'text' : 'default',
            lineHeight: 1.4,
          }}
        >
          {alerteText}
        </span>
      )}

      {/* Bouton supprimer (visible si canEdit et alerte présente) */}
      {canEdit && (editMode || editing) && hasText && (
        <button
          type="button"
          onClick={handleDelete}
          title="Supprimer cette alerte"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            marginTop: 2,
            cursor: 'pointer',
            color: 'var(--txt-3)',
            flexShrink: 0,
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

// ─── CustomCheckbox — Checkbox stylée DESK (cohérent thème, plus joli) ────
function CustomCheckbox({ checked }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: 4,
        background: checked ? 'var(--blue, #3B82F6)' : 'transparent',
        border: `1.5px solid ${checked ? 'var(--blue, #3B82F6)' : 'var(--brd)'}`,
        transition: 'background 0.12s, border-color 0.12s',
        flexShrink: 0,
      }}
    >
      {checked && (
        <Check
          size={11}
          strokeWidth={3}
          style={{ color: 'white' }}
        />
      )}
    </span>
  )
}

// ─── EquipePickerPopover (UX-3 fix) — picker équipe inline en editMode ────
// Sub-popover affiché sous la ligne Équipe au click. Permet de gérer les
// cadreurs assignés sans avoir à passer par l'ancien form long. Réutilise
// la logique présents/hors présence + recherche du MembrePicker original.
function EquipePickerPopover({ membresPresents, selectedIds, onChange, onClose }) {
  const [search, setSearch] = useState('')
  const [showHors, setShowHors] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    function onDocMouseDown(e) {
      if (wrapperRef.current?.contains(e.target)) return
      onClose?.()
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onDocMouseDown)
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onDocMouseDown)
    }
  }, [onClose])

  const { presents, horsPresence } = useMemo(() => {
    const lower = search.toLowerCase()
    const all = (membresPresents || []).filter((m) => {
      if (!search) return true
      const fn = `${m.contact?.prenom || m.prenom || ''} ${m.contact?.nom || m.nom || ''}`.toLowerCase()
      return fn.includes(lower)
    })
    return {
      presents: all.filter((m) => m.present_ce_jour !== false),
      horsPresence: all.filter((m) => m.present_ce_jour === false),
    }
  }, [membresPresents, search])

  const effectiveShowHors = showHors || search.trim().length > 0
  const selSet = new Set(selectedIds || [])

  const toggle = (id) => {
    const next = new Set(selSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange?.([...next])
  }

  const presentsIds = presents.map((m) => m.id)
  const allPresentsSelected =
    presentsIds.length > 0 && presentsIds.every((id) => selSet.has(id))
  const selectAllPresents = () => {
    if (allPresentsSelected) {
      onChange?.([...selSet].filter((id) => !presentsIds.includes(id)))
    } else {
      const next = new Set(selSet)
      for (const id of presentsIds) next.add(id)
      onChange?.([...next])
    }
  }

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        right: 0,
        zIndex: 20,
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        padding: 8,
        maxHeight: 320,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          style={{
            flex: 1,
            padding: '4px 8px',
            fontSize: 12,
            background: 'var(--bg-elev)',
            color: 'var(--txt)',
            border: '1px solid var(--brd-sub)',
            borderRadius: 4,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={selectAllPresents}
          disabled={presentsIds.length === 0}
          style={{
            fontSize: 11,
            padding: '4px 8px',
            background: allPresentsSelected ? 'var(--blue, #3B82F6)' : 'transparent',
            color: allPresentsSelected ? 'white' : 'var(--txt-2)',
            border: '1px solid var(--brd-sub)',
            borderRadius: 4,
            cursor: presentsIds.length === 0 ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Tous présents
        </button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {presents.length === 0 && horsPresence.length === 0 && (
          <div style={{ padding: 8, fontSize: 11, color: 'var(--txt-3)' }}>
            Aucun membre
          </div>
        )}
        {presents.length === 0 && horsPresence.length > 0 && (
          <div style={{ padding: 6, fontSize: 11, color: 'var(--txt-3)' }}>
            Aucun membre présent ce jour
          </div>
        )}
        {presents.map((m) => (
          <PickerRow
            key={m.id}
            membre={m}
            selected={selSet.has(m.id)}
            onToggle={() => toggle(m.id)}
          />
        ))}
        {horsPresence.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowHors((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                width: '100%',
                padding: '4px 6px',
                marginTop: 4,
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--txt-3)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: 0.05,
              }}
            >
              <span>{effectiveShowHors ? '▾' : '▸'}</span>
              Hors présence ({horsPresence.length})
            </button>
            {effectiveShowHors &&
              horsPresence.map((m) => (
                <PickerRow
                  key={m.id}
                  membre={m}
                  selected={selSet.has(m.id)}
                  onToggle={() => toggle(m.id)}
                  dimmed
                />
              ))}
          </>
        )}
      </div>
    </div>
  )
}

function PickerRow({ membre, selected, onToggle, dimmed = false }) {
  const fn = `${membre.contact?.prenom || membre.prenom || ''} ${membre.contact?.nom || membre.nom || ''}`.trim() || '?'
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 6px',
        borderRadius: 4,
        cursor: 'pointer',
        opacity: dimmed ? 0.6 : 1,
        background: selected ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        style={{ cursor: 'pointer' }}
      />
      <span style={{ fontSize: 12, color: 'var(--txt)' }}>{fn}</span>
    </label>
  )
}

// ─── PropagationModal (FEST-2.11) — propager les modifs aux enfants liés ──
// Affichée quand l'utilisateur clique le bouton "Propager" de la quick
// action bar (visible si le créneau est source d'au moins 1 enfant).
//
// V1 simple : une checkbox par enfant (tout-ou-rien). Si l'enfant est
// coché, on applique TOUS les champs de son anchor.fields. Granularité
// par champ (V2) viendra si Hugo le demande.
//
// Pour chaque enfant coché :
//   patch = applySourceUpdate(source, enfant, enfant.source_anchor)
//   → onApply([{ childId, patch }, ...])
function PropagationModal({
  source,
  linkedChildren,
  onClose,
  onApply,
}) {
  // Tous cochés par défaut
  const [selected, setSelected] = useState(() => {
    const s = new Set()
    for (const c of linkedChildren) s.add(c.id)
    return s
  })

  const toggleChild = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === linkedChildren.length) setSelected(new Set())
    else setSelected(new Set(linkedChildren.map((c) => c.id)))
  }

  const handleApply = () => {
    if (selected.size === 0) {
      onClose?.()
      return
    }
    const childPatches = []
    const childMembers = []
    for (const child of linkedChildren) {
      if (!selected.has(child.id)) continue
      const anchor = child.source_anchor || { fields: [] }
      const patch = applySourceUpdate(source, child, anchor)
      // Extraire member_ids (cas spécial — appel séparé)
      const { member_ids, ...structured } = patch
      if (Object.keys(structured).length > 0) {
        childPatches.push({ childId: child.id, patch: structured })
      }
      if (member_ids) {
        childMembers.push({ childId: child.id, member_ids })
      }
    }
    onApply?.(childPatches, childMembers)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Share2 size={16} style={{ color: 'var(--txt-2)' }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--txt)' }}>
              Propager aux {linkedChildren.length} créneau
              {linkedChildren.length > 1 ? 'x' : ''} lié
              {linkedChildren.length > 1 ? 's' : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          <div
            style={{
              fontSize: 12,
              color: 'var(--txt-2)',
              marginBottom: 12,
              padding: '8px 10px',
              background: 'var(--bg-elev)',
              borderRadius: 6,
              border: '1px solid var(--brd-sub)',
            }}
          >
            Les valeurs actuelles de{' '}
            <strong style={{ color: 'var(--txt)' }}>
              {source.titre || '(sans titre)'}
            </strong>{' '}
            seront appliquées aux créneaux liés cochés, selon les champs
            définis dans leur lien.
          </div>

          {/* Bouton tout cocher/décocher */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: 8,
            }}
          >
            <button
              type="button"
              onClick={toggleAll}
              style={{
                fontSize: 11,
                color: 'var(--txt-2)',
                background: 'transparent',
                border: '1px solid var(--brd-sub)',
                borderRadius: 4,
                padding: '3px 8px',
                cursor: 'pointer',
              }}
            >
              {selected.size === linkedChildren.length
                ? 'Tout décocher'
                : 'Tout cocher'}
            </button>
          </div>

          {/* Liste des enfants */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {linkedChildren.map((child) => {
              const isSelected = selected.has(child.id)
              const anchorFields = child.source_anchor?.fields || []
              return (
                <label
                  key={child.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: 10,
                    background: isSelected
                      ? 'var(--bg-elev)'
                      : 'transparent',
                    border: '1px solid var(--brd-sub)',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleChild(child.id)}
                    style={{ cursor: 'pointer', marginTop: 2 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--txt)',
                      }}
                    >
                      {child.titre || '(sans titre)'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                      {formatMinHHMM(child.heure_debut_min)} –{' '}
                      {formatMinHHMM(child.heure_fin_min)}
                    </div>
                    {anchorFields.length > 0 ? (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          color: 'var(--txt-2)',
                        }}
                      >
                        Champs synchronisés :{' '}
                        <span style={{ color: 'var(--txt)' }}>
                          {anchorFields
                            .map((f) => ANCHOR_FIELD_LABELS[f] || f)
                            .join(', ')}
                        </span>
                      </div>
                    ) : (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          color: 'var(--txt-3)',
                          fontStyle: 'italic',
                        }}
                      >
                        Aucun champ configuré dans le lien
                      </div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '10px 16px',
            borderTop: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              color: 'var(--txt-2)',
              background: 'transparent',
              border: '1px solid var(--brd-sub)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={selected.size === 0}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 500,
              color: 'white',
              background:
                selected.size === 0 ? 'var(--brd)' : 'var(--blue, #3B82F6)',
              border: '1px solid transparent',
              borderRadius: 6,
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Appliquer aux {selected.size}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── LinkCreneauModal (FEST-2.10) — création/édition d'un lien source ────
// Modal centré (par-dessus le popover) qui permet :
// - Si pas encore lié : choisir un créneau source + cocher les champs à
//   synchroniser (anchor.fields). Pré-coche les champs déjà identiques
//   via proposeAnchorDefault.
// - Si déjà lié : afficher les infos du lien + bouton "Délier".
//
// Le save se fait via la prop onSave(payload) qui appelle
// updateCreneau silencieusement.
function LinkCreneauModal({ creneau, allCreneaux, onClose, onSave }) {
  const alreadyLinked = Boolean(creneau?.source_creneau_id)
  const currentSource = useMemo(
    () => getSourceCreneau(allCreneaux, creneau),
    [allCreneaux, creneau],
  )

  // Candidates : tous les créneaux SAUF soi-même et les enfants déjà liés
  // à soi-même (pour éviter de devenir l'enfant d'un de ses enfants).
  const candidates = useMemo(() => {
    return (allCreneaux || []).filter((c) => {
      if (!c || c.id === creneau?.id) return false
      // Exclure les enfants directs de soi-même
      if (c.source_creneau_id === creneau?.id) return false
      return true
    })
  }, [allCreneaux, creneau?.id])

  const [selectedSourceId, setSelectedSourceId] = useState(
    creneau?.source_creneau_id || '',
  )
  const selectedSource = candidates.find((c) => c.id === selectedSourceId)

  // Anchor fields : pré-cochage automatique au choix d'une source
  const [anchorFields, setAnchorFields] = useState(() => {
    if (creneau?.source_anchor?.fields) {
      return new Set(creneau.source_anchor.fields)
    }
    return new Set()
  })

  // Quand on change de source, recalcule l'anchor proposé
  useEffect(() => {
    if (!selectedSource || alreadyLinked) return
    const proposed = proposeAnchorDefault(creneau, selectedSource)
    setAnchorFields(new Set(proposed.fields))
  }, [selectedSource, creneau, alreadyLinked])

  // Validation
  const validationError = selectedSource
    ? validateLinkTarget(creneau, selectedSource, allCreneaux)
    : null

  const canSave = Boolean(selectedSource) && !validationError && anchorFields.size > 0

  const toggleField = (f) => {
    setAnchorFields((prev) => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })
  }

  const handleSave = () => {
    if (!canSave) return
    onSave?.({
      source_creneau_id: selectedSource.id,
      source_anchor: { fields: [...anchorFields] },
      // FEST-2.10 : à la création du lien, on copie immédiatement les
      // valeurs de la source vers ce créneau pour les champs cochés.
      // Sinon le lien serait silencieux (rien ne change visuellement)
      // jusqu'à la prochaine modif de la source (FEST-2.11).
      applyCopy: true,
    })
  }
  const handleUnlink = () => {
    onSave?.({ source_creneau_id: null, source_anchor: null })
  }

  return (
    <div
      className="link-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(480px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LinkIcon size={16} style={{ color: 'var(--txt-2)' }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--txt)' }}>
              {alreadyLinked ? 'Lien source' : 'Lier à un créneau source'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {alreadyLinked && currentSource ? (
            <div>
              <div
                style={{
                  padding: 12,
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 6,
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 4 }}>
                  Lié à
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--txt)' }}>
                  {currentSource.titre || '(sans titre)'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)', marginTop: 2 }}>
                  {formatMinHHMM(currentSource.heure_debut_min)} –{' '}
                  {formatMinHHMM(currentSource.heure_fin_min)}
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--txt-3)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.05,
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                Champs synchronisés
              </div>
              <AnchorFieldsList
                anchorFields={anchorFields}
                onToggle={toggleField}
              />
            </div>
          ) : (
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--txt-3)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.05,
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                Créneau source
              </div>
              <select
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: 'var(--bg)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                  borderRadius: 6,
                  fontSize: 13,
                  outline: 'none',
                  marginBottom: 12,
                }}
              >
                <option value="">— Sélectionner —</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.titre || '(sans titre)'} ·{' '}
                    {formatMinHHMM(c.heure_debut_min)} –{' '}
                    {formatMinHHMM(c.heure_fin_min)}
                  </option>
                ))}
              </select>

              {validationError && (
                <div
                  style={{
                    padding: 8,
                    background: 'rgba(220, 38, 38, 0.1)',
                    border: '1px solid rgba(220, 38, 38, 0.3)',
                    borderRadius: 6,
                    color: '#EF4444',
                    fontSize: 12,
                    marginBottom: 12,
                  }}
                >
                  ⚠ {validationError}
                </div>
              )}

              {selectedSource && !validationError && (
                <>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--txt-3)',
                      textTransform: 'uppercase',
                      letterSpacing: 0.05,
                      marginBottom: 8,
                      fontWeight: 600,
                    }}
                  >
                    Champs à synchroniser depuis la source
                  </div>
                  <AnchorFieldsList
                    anchorFields={anchorFields}
                    onToggle={toggleField}
                  />
                  {anchorFields.size === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 8 }}>
                      Sélectionnez au moins 1 champ à synchroniser.
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: alreadyLinked ? 'space-between' : 'flex-end',
            gap: 8,
            padding: '10px 16px',
            borderTop: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          {alreadyLinked && (
            <button
              type="button"
              onClick={handleUnlink}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                color: '#EF4444',
                background: 'transparent',
                border: '1px solid rgba(220, 38, 38, 0.3)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Délier
            </button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                color: 'var(--txt-2)',
                background: 'transparent',
                border: '1px solid var(--brd-sub)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {alreadyLinked ? 'Fermer' : 'Annuler'}
            </button>
            {alreadyLinked ? (
              <button
                type="button"
                onClick={() => {
                  // Mise à jour de l'anchor : on applique aussi les valeurs
                  // de la source pour les nouveaux champs cochés (cohérence
                  // immédiate, comme à la création).
                  onSave?.({
                    source_creneau_id: currentSource.id,
                    source_anchor: { fields: [...anchorFields] },
                    applyCopy: true,
                  })
                }}
                disabled={anchorFields.size === 0}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'white',
                  background: anchorFields.size === 0 ? 'var(--brd)' : 'var(--blue, #3B82F6)',
                  border: '1px solid transparent',
                  borderRadius: 6,
                  cursor: anchorFields.size === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Mettre à jour
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'white',
                  background: canSave ? 'var(--blue, #3B82F6)' : 'var(--brd)',
                  border: '1px solid transparent',
                  borderRadius: 6,
                  cursor: canSave ? 'pointer' : 'not-allowed',
                }}
              >
                Lier
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AnchorFieldsList({ anchorFields, onToggle }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {ANCHOR_FIELDS.map((f) => (
        <label
          key={f}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: anchorFields.has(f) ? 'var(--bg-elev)' : 'transparent',
            border: '1px solid var(--brd-sub)',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--txt)',
            transition: 'background 0.1s',
          }}
        >
          <input
            type="checkbox"
            checked={anchorFields.has(f)}
            onChange={() => onToggle(f)}
            style={{ cursor: 'pointer' }}
          />
          <span>{ANCHOR_FIELD_LABELS[f] || f}</span>
        </label>
      ))}
    </div>
  )
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
    // FEST-3.2 C fix : préserver le lien soft (source_creneau_id + anchor)
    // au passage par initDraft. Sans ça, en mode create depuis
    // QuickCreateMenu "Lié à ce moment", le draft perdait le lien → l'enfant
    // était créé sans source → propagation auto impossible.
    source_creneau_id: creneau.source_creneau_id || null,
    source_anchor: creneau.source_anchor || null,
    // FEST-5.4 : alerte / point d'attention
    alerte_text: creneau.alerte_text || null,
    alerte_niveau: creneau.alerte_niveau || null,
  }
}
