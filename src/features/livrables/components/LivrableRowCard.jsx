// ════════════════════════════════════════════════════════════════════════════
// LivrableRowCard — variante mobile du livrable (LIV-7)
// ════════════════════════════════════════════════════════════════════════════
//
// Layout vertical en carte — équivalent mobile de `LivrableRow`. Pas de
// <table>, tout en flex-col. Inclut aussi les champs secondaires (notes,
// liens en pills) qu'on ne mettait pas sur la table desktop.
//
//   ┌─────────────────────────────────────────────────────────┐
//   │ • [num]  Nom du livrable.............................[⋯] │  ← • dot rouge si en retard
//   │ [Statut pill]                       [Format · Durée]    │
//   │ [👤 init] Monteur : _______    Date : ______________    │
//   │ [Frame ↗] [Drive ↗]                                     │
//   │ Notes : ________________________________________        │
//   └─────────────────────────────────────────────────────────┘
//
// Polish LIV-7 :
//   - Dot rouge si en retard (helper `isLivrableEnRetard`)
//   - Format : `FormatSelect` (presets + Autre…)
//   - Durée : `DurationInput` guidé
//   - Monteur : `MonteurAvatar` (initiale colorée)
//   - Menu ⋯ rendu via `PopoverFloat` (cohérent avec desktop)
//
// Props : mêmes que LivrableRow (sans DnD — désactivé sur mobile).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  CopyPlus,
  ExternalLink,
  History,
  Link2,
  ListTodo,
  MoreHorizontal,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { notify } from '../../../lib/notify'
import { prompt as uiPrompt } from '../../../lib/confirm'
import { isLivrableEnRetard } from '../../../lib/livrablesHelpers'
import LivrableStatutPill from './LivrableStatutPill'
import FormatSelect from './FormatSelect'
import DurationInput from './DurationInput'
import MonteurInput from './MonteurInput'
import PopoverFloat from './PopoverFloat'
import DuplicateToProjectModal from './DuplicateToProjectModal'
import Checkbox from './Checkbox'

export default function LivrableRowCard({
  livrable,
  actions,
  canEdit = true,
  onDelete,
  onEditNotes,
  // LIV-8 — versions / LIV-9 — étapes
  versions = [],
  etapes = [],
  onOpenVersions,
  onOpenEtapes,
  // LIV-14 — bulk select
  selected = false,
  onToggleSelect,
  // LIV-15 — autocomplete monteur
  profiles = [],
  profilesById = null,
  // LIV-16 — marqueur "prochain" + highlight scroll-to depuis le header
  isProchain = false,
  isHighlighted = false,
}) {
  // Badge version (cf. LivrableRow desktop pour la logique exacte)
  const latestVersionLabel = useMemo(() => {
    if (!versions || versions.length === 0) return null
    let best = null
    let bestOrder = -Infinity
    for (const v of versions) {
      const o = v?.sort_order ?? 0
      if (o > bestOrder) {
        bestOrder = o
        best = v
      }
    }
    return best?.numero_label || null
  }, [versions])
  const versionsCount = versions?.length || 0
  const etapesCount = etapes?.length || 0
  // ─── États locaux ────────────────────────────────────────────────────────
  const [numero, setNumero] = useState(livrable.numero || '')
  const [nom, setNom] = useState(livrable.nom || '')
  const [dateLivraison, setDateLivraison] = useState(livrable.date_livraison || '')
  const [notes, setNotes] = useState(livrable.notes || '')

  useEffect(() => setNumero(livrable.numero || ''), [livrable.numero])
  useEffect(() => setNom(livrable.nom || ''), [livrable.nom])
  useEffect(() => setDateLivraison(livrable.date_livraison || ''), [livrable.date_livraison])
  useEffect(() => setNotes(livrable.notes || ''), [livrable.notes])

  // ─── Save helper ─────────────────────────────────────────────────────────
  const saveField = useCallback(
    async (field, value, { nullIfEmpty = true } = {}) => {
      if (!canEdit) return
      const current = livrable[field] ?? (nullIfEmpty ? null : '')
      const nextValue =
        nullIfEmpty && (value === '' || value == null) ? null : value
      if (nextValue === current) return
      try {
        await actions.updateLivrable(livrable.id, { [field]: nextValue })
      } catch (err) {
        notify.error('Erreur sauvegarde : ' + (err?.message || err))
      }
    },
    [actions, canEdit, livrable],
  )

  const handleStatutChange = useCallback(
    async (next) => {
      if (!canEdit) return
      if (next === livrable.statut) return
      try {
        await actions.updateLivrable(livrable.id, { statut: next })
      } catch (err) {
        notify.error('Erreur statut : ' + (err?.message || err))
      }
    },
    [actions, canEdit, livrable.id, livrable.statut],
  )

  // Save unifié pour MonteurInput (LIV-15)
  const handleMonteurCommit = useCallback(
    async ({ profileId, external }) => {
      if (!canEdit) return
      const currentP = livrable.assignee_profile_id || null
      const currentX = livrable.assignee_external || null
      if (currentP === profileId && currentX === external) return
      try {
        await actions.updateLivrable(livrable.id, {
          assignee_profile_id: profileId,
          assignee_external: external,
        })
      } catch (err) {
        notify.error('Erreur sauvegarde : ' + (err?.message || err))
      }
    },
    [actions, canEdit, livrable.id, livrable.assignee_profile_id, livrable.assignee_external],
  )

  // ─── Menu ⋯ ──────────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false)
  const menuAnchorRef = useRef(null)

  // LIV-13 — modal duplication cross-project (locale au card)
  const [dupModalOpen, setDupModalOpen] = useState(false)

  const handleDuplicate = useCallback(async () => {
    setMenuOpen(false)
    if (!canEdit) return
    try {
      await actions.duplicateLivrable(livrable.id)
      notify.success('Livrable dupliqué')
    } catch (err) {
      notify.error('Duplication impossible : ' + (err?.message || err))
    }
  }, [actions, canEdit, livrable.id])

  const handleOpenDupModal = useCallback(() => {
    setMenuOpen(false)
    if (!canEdit) return
    setDupModalOpen(true)
  }, [canEdit])

  const handleEditLink = useCallback(
    async (field, label) => {
      setMenuOpen(false)
      if (!canEdit) return
      const next = await uiPrompt({
        title: `Lien ${label}`,
        message: `Colle l'URL ${label} (laisse vide pour retirer).`,
        placeholder: 'https://…',
        initialValue: livrable[field] || '',
        confirmLabel: 'Enregistrer',
      })
      if (next === null) return
      try {
        await actions.updateLivrable(livrable.id, { [field]: next.trim() || null })
      } catch (err) {
        notify.error('Erreur lien : ' + (err?.message || err))
      }
    },
    [actions, canEdit, livrable],
  )

  const handleDelete = useCallback(() => {
    setMenuOpen(false)
    if (!canEdit) return
    onDelete?.(livrable)
  }, [canEdit, livrable, onDelete])

  const handleOpenNotes = useCallback(() => {
    setMenuOpen(false)
    onEditNotes?.(livrable)
  }, [livrable, onEditNotes])

  // ─── Indicateur retard ──────────────────────────────────────────────────
  const enRetard = isLivrableEnRetard(livrable)

  return (
    <div
      className="px-3 py-2.5 flex flex-col gap-1.5"
      data-livrable-id={livrable.id}
      style={{
        borderBottom: '1px solid var(--brd-sub)',
        background: isHighlighted ? 'var(--orange-bg)' : 'transparent',
        outline: isHighlighted ? '2px solid var(--orange)' : 'none',
        outlineOffset: isHighlighted ? '-2px' : 0,
        transition: 'background 600ms ease-out, outline-color 600ms ease-out',
      }}
    >
      {/* Ligne 1 : checkbox + (dot retard / prochain) numero + nom + menu ⋯ */}
      <div className="flex items-center gap-2">
        {canEdit && onToggleSelect && (
          <Checkbox
            checked={selected}
            onClick={(e) => onToggleSelect?.({ shiftKey: e.shiftKey })}
            subtle
            size="sm"
            ariaLabel={selected ? 'Désélectionner' : 'Sélectionner'}
          />
        )}
        {enRetard && (
          <span
            aria-label="En retard"
            title="Livrable en retard"
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ background: 'var(--red)' }}
          />
        )}
        {isProchain && !enRetard && (
          <span
            aria-label="Prochain livrable"
            title="Prochain livrable à venir"
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ background: 'var(--orange)' }}
          />
        )}
        <input
          type="text"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          onBlur={() => saveField('numero', numero.trim(), { nullIfEmpty: false })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={!canEdit}
          placeholder="—"
          className="bg-transparent focus:outline-none text-[11px] font-mono shrink-0"
          style={{ color: 'var(--txt-3)', width: '32px' }}
        />
        <input
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onBlur={() => saveField('nom', nom.trim(), { nullIfEmpty: false })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={!canEdit}
          placeholder="Nom du livrable…"
          className="flex-1 min-w-0 bg-transparent focus:outline-none text-sm font-semibold text-left"
          style={{ color: 'var(--txt)' }}
        />
        {canEdit && (
          <>
            <button
              ref={menuAnchorRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Actions livrable"
              className="p-1.5 rounded shrink-0"
              style={{ color: 'var(--txt-3)' }}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            <PopoverFloat
              anchorRef={menuAnchorRef}
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              align="right"
            >
              <CardActionMenu
                onDuplicate={handleDuplicate}
                onDuplicateToProject={handleOpenDupModal}
                onEditFrame={() => handleEditLink('lien_frame', 'Frame.io')}
                onEditDrive={() => handleEditLink('lien_drive', 'Drive')}
                onEditNotes={handleOpenNotes}
                onDelete={handleDelete}
              />
            </PopoverFloat>
            {dupModalOpen && (
              <DuplicateToProjectModal
                mode="livrable"
                source={{
                  id: livrable.id,
                  label: livrable.nom || livrable.numero || 'Livrable',
                }}
                currentProjectId={livrable.project_id}
                actions={actions}
                onClose={() => setDupModalOpen(false)}
              />
            )}
          </>
        )}
      </div>

      {/* Ligne 2 : statut + format · durée */}
      <div className="flex items-center gap-2 flex-wrap">
        <LivrableStatutPill
          value={livrable.statut}
          onChange={handleStatutChange}
          canEdit={canEdit}
          size="xs"
        />
        <div className="flex items-center gap-1 ml-auto">
          <div style={{ minWidth: 70 }}>
            <FormatSelect
              value={livrable.format || ''}
              onChange={(next) => saveField('format', next, { nullIfEmpty: true })}
              canEdit={canEdit}
              size="xs"
              placeholder="Format"
            />
          </div>
          <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
            ·
          </span>
          <div style={{ width: 60 }}>
            <DurationInput
              value={livrable.duree || ''}
              onCommit={(next) => saveField('duree', next, { nullIfEmpty: true })}
              canEdit={canEdit}
              placeholder="Durée"
            />
          </div>
        </div>
      </div>

      {/* Ligne 3 : avatar + monteur (autocomplete LIV-15) + date */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[11px] shrink-0" style={{ color: 'var(--txt-3)' }}>
            Monteur :
          </span>
          <MonteurInput
            profileId={livrable.assignee_profile_id || null}
            external={livrable.assignee_external || null}
            profiles={profiles}
            profilesById={profilesById}
            canEdit={canEdit}
            onCommit={handleMonteurCommit}
            className="flex-1 min-w-0"
          />
        </div>
        <input
          type="date"
          value={dateLivraison}
          onChange={(e) => setDateLivraison(e.target.value)}
          onBlur={() => saveField('date_livraison', dateLivraison)}
          disabled={!canEdit}
          className="bg-transparent focus:outline-none text-xs shrink-0"
          style={{
            color: enRetard
              ? 'var(--red)'
              : dateLivraison
                ? 'var(--txt-2)'
                : 'var(--txt-3)',
          }}
        />
      </div>

      {/* Ligne 4 : tous les chips (liens + détails + notes) sur une seule
          ligne avec wrap. Plus dense que 3 lignes labellées. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <LinkChip
          label="Frame"
          url={livrable.lien_frame}
          onEdit={() => handleEditLink('lien_frame', 'Frame.io')}
          canEdit={canEdit}
        />
        <LinkChip
          label="Drive"
          url={livrable.lien_drive}
          onEdit={() => handleEditLink('lien_drive', 'Drive')}
          canEdit={canEdit}
        />
        <span style={{ width: 1, height: 14, background: 'var(--brd-sub)' }} />
        <VersionsBadge
          label={latestVersionLabel}
          count={versionsCount}
          onClick={() => onOpenVersions?.(livrable)}
          canEdit={canEdit}
        />
        <EtapesBadge
          count={etapesCount}
          onClick={() => onOpenEtapes?.(livrable)}
          canEdit={canEdit}
        />
        <NotesChip
          value={notes}
          onClick={() => onEditNotes?.(livrable)}
          canEdit={canEdit}
        />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// NotesChip — chip compact pour les notes (mobile, sur la ligne des chips)
// ════════════════════════════════════════════════════════════════════════════
//
// Style aligné avec les autres chips de la ligne (Frame/Drive, badges) pour
// rester homogène. Click → ouvre `uiPrompt({ multiline: true })` (handler
// parent identique à desktop).
//   - vide & canEdit   → chip dashed "+ note"
//   - rempli           → chip plein "Note" (icône + indicateur de présence)
//   - vide & read-only → caché

function NotesChip({ value, onClick, canEdit }) {
  const hasNote = Boolean((value || '').trim())

  if (!hasNote) {
    if (!canEdit) return null
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-dashed"
        style={{
          borderColor: 'var(--brd-sub)',
          color: 'var(--txt-3)',
        }}
        title="Ajouter une note interne"
      >
        <StickyNote className="w-3 h-3" />+ note
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={canEdit ? onClick : undefined}
      disabled={!canEdit}
      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium"
      style={{
        background: 'var(--bg-2)',
        color: 'var(--txt-2)',
        cursor: canEdit ? 'pointer' : 'default',
      }}
      title={canEdit ? 'Cliquer pour éditer la note' : (value || '').trim()}
    >
      <StickyNote className="w-3 h-3 shrink-0" />
      Note
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// VersionsBadge — badge cliquable pour ouvrir le drawer historique (LIV-8)
// ════════════════════════════════════════════════════════════════════════════

function VersionsBadge({ label, count, onClick, canEdit }) {
  if (!count) {
    if (!canEdit) return null
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-dashed"
        style={{
          borderColor: 'var(--brd-sub)',
          color: 'var(--txt-3)',
        }}
        title="Ajouter une version"
      >
        <History className="w-3 h-3" />+ version
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium"
      style={{
        background: 'var(--blue-bg)',
        color: 'var(--blue)',
      }}
      title={`${count} version${count > 1 ? 's' : ''}`}
    >
      <History className="w-3 h-3 shrink-0" />
      <span className="font-mono">{label || `V${count}`}</span>
      {count > 1 && (
        <span className="text-[10px] opacity-75 font-normal">({count})</span>
      )}
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// EtapesBadge — badge cliquable pour ouvrir le drawer onglet Étapes (LIV-9)
// ════════════════════════════════════════════════════════════════════════════

function EtapesBadge({ count, onClick, canEdit }) {
  if (!count) {
    if (!canEdit) return null
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-dashed"
        style={{
          borderColor: 'var(--brd-sub)',
          color: 'var(--txt-3)',
        }}
        title="Ajouter une étape"
      >
        <ListTodo className="w-3 h-3" />+ étape
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium"
      style={{
        background: 'var(--green-bg)',
        color: 'var(--green)',
      }}
      title={`${count} étape${count > 1 ? 's' : ''}`}
    >
      <ListTodo className="w-3 h-3 shrink-0" />
      <span className="font-mono">{count}</span>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Chip lien (partagé avec LivrableRow — dupliqué ici pour rester self-contained)
// ════════════════════════════════════════════════════════════════════════════

function LinkChip({ label, url, onEdit, canEdit }) {
  const hasUrl = Boolean(url)
  if (!hasUrl) {
    if (!canEdit) return null
    return (
      <button
        type="button"
        onClick={onEdit}
        className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-dashed"
        style={{
          borderColor: 'var(--brd-sub)',
          color: 'var(--txt-3)',
        }}
      >
        <Link2 className="w-3 h-3" />+ {label}
      </button>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
      style={{
        background: 'var(--blue-bg)',
        color: 'var(--blue)',
        fontWeight: 500,
      }}
    >
      <ExternalLink className="w-3 h-3" />
      {label}
    </a>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Menu actions card
// ════════════════════════════════════════════════════════════════════════════

function CardActionMenu({
  onDuplicate,
  onDuplicateToProject,
  onEditFrame,
  onEditDrive,
  onEditNotes,
  onDelete,
}) {
  return (
    <div
      className="rounded-lg shadow-lg overflow-hidden"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        minWidth: '220px',
      }}
    >
      <MenuRow icon={Copy} label="Dupliquer" onClick={onDuplicate} />
      <MenuRow
        icon={CopyPlus}
        label="Dupliquer dans un autre projet…"
        onClick={onDuplicateToProject}
      />
      <MenuRow icon={Link2} label="Lien Frame.io" onClick={onEditFrame} />
      <MenuRow icon={Link2} label="Lien Drive" onClick={onEditDrive} />
      <MenuRow icon={StickyNote} label="Notes" onClick={onEditNotes} />
      <div style={{ borderTop: '1px solid var(--brd-sub)' }}>
        <MenuRow icon={Trash2} label="Supprimer" onClick={onDelete} danger />
      </div>
    </div>
  )
}

function MenuRow({ icon: Icon, label, onClick, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left"
      style={{ color: danger ? 'var(--red)' : 'var(--txt)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
    </button>
  )
}
