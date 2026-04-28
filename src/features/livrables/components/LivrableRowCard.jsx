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
  ExternalLink,
  History,
  Link2,
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
import MonteurAvatar from './MonteurAvatar'
import PopoverFloat from './PopoverFloat'

export default function LivrableRowCard({
  livrable,
  actions,
  canEdit = true,
  onDelete,
  onEditNotes,
  // LIV-8 — versions
  versions = [],
  onOpenVersions,
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
  // ─── États locaux ────────────────────────────────────────────────────────
  const [numero, setNumero] = useState(livrable.numero || '')
  const [nom, setNom] = useState(livrable.nom || '')
  const [monteur, setMonteur] = useState(livrable.assignee_external || '')
  const [dateLivraison, setDateLivraison] = useState(livrable.date_livraison || '')
  const [notes, setNotes] = useState(livrable.notes || '')

  useEffect(() => setNumero(livrable.numero || ''), [livrable.numero])
  useEffect(() => setNom(livrable.nom || ''), [livrable.nom])
  useEffect(() => setMonteur(livrable.assignee_external || ''), [livrable.assignee_external])
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

  // ─── Menu ⋯ ──────────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false)
  const menuAnchorRef = useRef(null)

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
      className="px-3 py-3 flex flex-col gap-2"
      style={{ borderBottom: '1px solid var(--brd-sub)' }}
    >
      {/* Ligne 1 : (dot retard) numero + nom + menu ⋯ */}
      <div className="flex items-start gap-2">
        {enRetard && (
          <span
            aria-label="En retard"
            title="Livrable en retard"
            className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0"
            style={{ background: 'var(--red)' }}
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
          className="bg-transparent focus:outline-none text-[11px] font-mono w-14 shrink-0"
          style={{ color: 'var(--txt-3)' }}
        />
        <input
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onBlur={() => saveField('nom', nom.trim(), { nullIfEmpty: false })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={!canEdit}
          placeholder="Nom du livrable…"
          className="flex-1 bg-transparent focus:outline-none text-sm font-medium"
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
                onEditFrame={() => handleEditLink('lien_frame', 'Frame.io')}
                onEditDrive={() => handleEditLink('lien_drive', 'Drive')}
                onEditNotes={handleOpenNotes}
                onDelete={handleDelete}
              />
            </PopoverFloat>
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

      {/* Ligne 3 : avatar + monteur + date */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <MonteurAvatar name={monteur} size="sm" />
          <span className="text-[11px] shrink-0" style={{ color: 'var(--txt-3)' }}>
            Monteur :
          </span>
          <input
            type="text"
            value={monteur}
            onChange={(e) => setMonteur(e.target.value)}
            onBlur={() => saveField('assignee_external', monteur.trim())}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            disabled={!canEdit}
            placeholder="—"
            className="bg-transparent focus:outline-none text-xs flex-1 min-w-0"
            style={{ color: 'var(--txt-2)' }}
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

      {/* Ligne 4 : liens + badge versions */}
      <div className="flex items-center gap-2 flex-wrap">
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
        <span className="ml-auto">
          <VersionsBadge
            label={latestVersionLabel}
            count={versionsCount}
            onClick={() => onOpenVersions?.(livrable)}
            canEdit={canEdit}
          />
        </span>
      </div>

      {/* Notes (toujours visible — c'est l'atout du format card) */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => saveField('notes', notes.trim())}
        disabled={!canEdit}
        placeholder="Notes…"
        rows={2}
        className="w-full bg-transparent focus:outline-none text-xs resize-none rounded px-2 py-1"
        style={{
          color: 'var(--txt-2)',
          border: '1px solid var(--brd-sub)',
          background: 'var(--bg-elev)',
        }}
      />
    </div>
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
        minWidth: '200px',
      }}
    >
      <MenuRow icon={Copy} label="Dupliquer" onClick={onDuplicate} />
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
