// ════════════════════════════════════════════════════════════════════════════
// LivrableRow — ligne table desktop d'un livrable (LIV-7 + LIV-8)
// ════════════════════════════════════════════════════════════════════════════
//
// Ligne <tr> avec inline edit de tous les champs affichés. L'édition se fait
// sur `onBlur` (ou Enter) pour coller au pattern des autres outils (cf.
// ItemRow). Le hook `useLivrables.updateLivrable` est déjà optimistic →
// aucun flicker sur les renvois serveur.
//
// Colonnes (LIV-8 : ajout colonne Versions entre Statut et Monteur) :
//   [grip] [numero] [nom] [format] [durée] [statut] [versions] [monteur] [date] [liens] [⋯]
//
// Polish LIV-7 :
//   - Pastille rouge dot devant le numero si livrable en retard (date dépassée
//     et statut non terminé), via `isLivrableEnRetard` (livrablesHelpers).
//   - Format : dropdown `FormatSelect` (presets 16:9/9:16/1:1/4:5/5:4/4:3 +
//     "Autre…" → texte libre).
//   - Durée : `DurationInput` guidé (parse mm:ss / hh:mm:ss / nombre seul).
//   - Monteur : `MonteurAvatar` (initiale colorée, hash stable) + input texte
//     libre sur `assignee_external`. Autocomplete profiles → ticket dédié.
//   - Menu `⋯` rendu via `PopoverFloat` (createPortal) pour échapper au
//     `overflow-x-auto` du wrapper table (sinon clipping en bas).
//
// Liens frame / drive : affichés sous forme de chips cliquables.
//   - URL vide & canEdit  → chip "+ Frame" / "+ Drive" (edit via menu ⋯)
//   - URL présente        → chip "Frame ↗" (click ouvre window.open)
//
// Le menu ⋯ fournit : Dupliquer, Modifier Frame, Modifier Drive, Notes,
// Supprimer. Les "Modifier Frame/Drive" lancent un `prompt()` typé URL.
//
// Props :
//   - livrable, actions, canEdit, onDelete, onEditNotes
//   - isDragOver, onDragStart/Over/Drop/End (LIV-11 — neutres tant que le
//     parent ne les câble pas)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  CopyPlus,
  ExternalLink,
  GripVertical,
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

export default function LivrableRow({
  livrable,
  actions,
  canEdit = true,
  onDelete,
  onEditNotes,
  // LIV-8 — versions / LIV-9 — étapes (même drawer, 2 onglets)
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
  // DnD (LIV-11 — non câblé en LIV-7 mais on accepte les props pour
  // éviter un refacto plus tard)
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  // Label de la version la plus récente (sort_order desc) — affiché dans le
  // badge trigger du drawer historique. On ne se fie pas à `livrable.version_label`
  // qui est dénormalisé et peut désync après édition manuelle d'une version.
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
  // ─── États locaux (inline edit) ──────────────────────────────────────────
  const [numero, setNumero] = useState(livrable.numero || '')
  const [nom, setNom] = useState(livrable.nom || '')
  const [dateLivraison, setDateLivraison] = useState(livrable.date_livraison || '')

  useEffect(() => setNumero(livrable.numero || ''), [livrable.numero])
  useEffect(() => setNom(livrable.nom || ''), [livrable.nom])
  useEffect(() => setDateLivraison(livrable.date_livraison || ''), [livrable.date_livraison])

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

  // Save unifié pour MonteurInput (LIV-15) — patch les 2 champs en un appel.
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

  // LIV-13 — modal duplication cross-project (locale au row)
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

  // ─── DnD wiring ─────────────────────────────────────────────────────────
  const dndEnabled = canEdit && Boolean(onDragStart)

  // ─── Indicateur retard ──────────────────────────────────────────────────
  const enRetard = isLivrableEnRetard(livrable)

  return (
    <tr
      draggable={dndEnabled}
      onDragStart={
        dndEnabled
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move'
              try {
                e.dataTransfer.setData('text/plain', `livrable:${livrable.id}`)
              } catch {
                /* legacy */
              }
              onDragStart?.()
            }
          : undefined
      }
      onDragOver={
        dndEnabled
          ? (e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              onDragOver?.()
            }
          : undefined
      }
      onDrop={
        dndEnabled
          ? (e) => {
              e.preventDefault()
              onDrop?.()
            }
          : undefined
      }
      onDragEnd={dndEnabled ? onDragEnd : undefined}
      data-livrable-id={livrable.id}
      style={{
        borderBottom: '1px solid var(--brd-sub)',
        background: isHighlighted
          ? 'var(--orange-bg)'
          : isDragOver
            ? 'var(--bg-hov)'
            : 'transparent',
        outline: isDragOver
          ? '2px solid var(--blue)'
          : isHighlighted
            ? '2px solid var(--orange)'
            : 'none',
        outlineOffset: isDragOver || isHighlighted ? '-2px' : 0,
        // Transition lente pour laisser un "flash" visible quand on retire la
        // surbrillance (orange-bg → transparent en 600ms).
        transition: 'background 600ms ease-out, outline-color 600ms ease-out',
      }}
    >
      {/* Checkbox sélection (LIV-14) — visible au hover OR si sélectionnée */}
      <td
        className="px-1 py-1.5 align-middle text-center select-none"
        style={{ width: '24px' }}
      >
        {canEdit && onToggleSelect && (
          <Checkbox
            checked={selected}
            onClick={(e) => onToggleSelect?.({ shiftKey: e.shiftKey })}
            subtle
            size="sm"
            ariaLabel={selected ? 'Désélectionner' : 'Sélectionner'}
          />
        )}
      </td>

      {/* Grip */}
      <td
        className="px-1 py-1.5 align-middle text-center select-none"
        style={{
          width: '20px',
          color: 'var(--txt-3)',
          cursor: dndEnabled ? 'grab' : 'default',
        }}
      >
        {dndEnabled && <GripVertical className="w-3 h-3 mx-auto opacity-40" />}
      </td>

      {/* Numero (avec dot rouge si en retard, dot orange si "prochain") */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '70px' }}>
        <div className="flex items-center gap-1.5">
          {enRetard && (
            <span
              aria-label="En retard"
              title="Livrable en retard"
              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: 'var(--red)' }}
            />
          )}
          {isProchain && !enRetard && (
            <span
              aria-label="Prochain livrable"
              title="Prochain livrable à venir"
              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
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
            className="flex-1 min-w-0 bg-transparent focus:outline-none text-[11px] font-mono"
            style={{
              color: 'var(--txt-3)',
              cursor: canEdit ? 'text' : 'default',
            }}
          />
        </div>
      </td>

      {/* Nom */}
      <td className="px-2 py-1.5 align-middle">
        <input
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onBlur={() => saveField('nom', nom.trim(), { nullIfEmpty: false })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={!canEdit}
          placeholder="Nom du livrable…"
          className="w-full bg-transparent focus:outline-none text-sm"
          style={{
            color: 'var(--txt)',
            cursor: canEdit ? 'text' : 'default',
          }}
        />
      </td>

      {/* Format (presets dropdown) */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '90px' }}>
        <FormatSelect
          value={livrable.format || ''}
          onChange={(next) => saveField('format', next, { nullIfEmpty: true })}
          canEdit={canEdit}
        />
      </td>

      {/* Durée (input guidé) */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '70px' }}>
        <DurationInput
          value={livrable.duree || ''}
          onCommit={(next) => saveField('duree', next, { nullIfEmpty: true })}
          canEdit={canEdit}
        />
      </td>

      {/* Statut */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '108px' }}>
        <LivrableStatutPill
          value={livrable.statut}
          onChange={handleStatutChange}
          canEdit={canEdit}
          size="sm"
        />
      </td>

      {/* Détails — 2 badges : versions + étapes (LIV-8 + LIV-9) */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '130px' }}>
        <div className="flex items-center gap-1">
          <VersionsTrigger
            label={latestVersionLabel}
            count={versionsCount}
            onClick={() => onOpenVersions?.(livrable)}
            canEdit={canEdit}
          />
          <EtapesTrigger
            count={etapesCount}
            onClick={() => onOpenEtapes?.(livrable)}
            canEdit={canEdit}
          />
        </div>
      </td>

      {/* Monteur — autocomplete profile + texte libre (LIV-15) */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '130px' }}>
        <MonteurInput
          profileId={livrable.assignee_profile_id || null}
          external={livrable.assignee_external || null}
          profiles={profiles}
          profilesById={profilesById}
          canEdit={canEdit}
          onCommit={handleMonteurCommit}
        />
      </td>

      {/* Date livraison */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '132px' }}>
        <input
          type="date"
          value={dateLivraison}
          onChange={(e) => setDateLivraison(e.target.value)}
          onBlur={() => saveField('date_livraison', dateLivraison)}
          disabled={!canEdit}
          className="w-full bg-transparent focus:outline-none text-xs"
          style={{
            color: enRetard
              ? 'var(--red)'
              : dateLivraison
                ? 'var(--txt-2)'
                : 'var(--txt-3)',
            cursor: canEdit ? 'text' : 'default',
          }}
        />
      </td>

      {/* Liens (Frame + Drive) */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '112px' }}>
        <div className="flex items-center gap-1">
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
        </div>
      </td>

      {/* Menu ⋯ (portal pour échapper à overflow-x-auto) */}
      <td className="px-1 py-1.5 align-middle" style={{ width: '32px' }}>
        {canEdit && (
          <>
            <button
              ref={menuAnchorRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Actions livrable"
              className="p-1 rounded"
              style={{ color: 'var(--txt-3)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
                e.currentTarget.style.color = 'var(--txt)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--txt-3)'
              }}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            <PopoverFloat
              anchorRef={menuAnchorRef}
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              align="right"
            >
              <RowActionMenu
                onDuplicate={handleDuplicate}
                onDuplicateToProject={handleOpenDupModal}
                onEditFrame={() => handleEditLink('lien_frame', 'Frame.io')}
                onEditDrive={() => handleEditLink('lien_drive', 'Drive')}
                onEditNotes={() => {
                  setMenuOpen(false)
                  onEditNotes?.(livrable)
                }}
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
      </td>
    </tr>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// VersionsTrigger — badge cliquable pour ouvrir le drawer historique (LIV-8)
// ════════════════════════════════════════════════════════════════════════════

function VersionsTrigger({ label, count, onClick, canEdit }) {
  // 0 versions → bouton dashed "+ version" (lecture aussi : "—")
  if (!count) {
    if (!canEdit) {
      return (
        <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
          —
        </span>
      )
    }
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-dashed"
        style={{
          borderColor: 'var(--brd-sub)',
          color: 'var(--txt-3)',
        }}
        title="Ajouter une version"
      >
        <History className="w-3 h-3" />
        version
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded font-medium"
      style={{
        background: 'var(--blue-bg)',
        color: 'var(--blue)',
      }}
      title={`${count} version${count > 1 ? 's' : ''} — cliquer pour voir l'historique`}
    >
      <History className="w-3 h-3 shrink-0" />
      <span className="font-mono">{label || `V${count}`}</span>
      {count > 1 && (
        <span
          className="text-[10px] opacity-75 font-normal"
          style={{ marginLeft: 1 }}
        >
          ({count})
        </span>
      )}
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// EtapesTrigger — badge cliquable pour ouvrir le drawer onglet Étapes (LIV-9)
// ════════════════════════════════════════════════════════════════════════════

function EtapesTrigger({ count, onClick, canEdit }) {
  if (!count) {
    if (!canEdit) {
      return (
        <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
          —
        </span>
      )
    }
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-dashed"
        style={{
          borderColor: 'var(--brd-sub)',
          color: 'var(--txt-3)',
        }}
        title="Ajouter une étape"
      >
        <ListTodo className="w-3 h-3" />
        étape
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded font-medium"
      style={{
        background: 'var(--green-bg)',
        color: 'var(--green)',
      }}
      title={`${count} étape${count > 1 ? 's' : ''} — cliquer pour voir le pipeline`}
    >
      <ListTodo className="w-3 h-3 shrink-0" />
      <span className="font-mono">{count}</span>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Chip lien (Frame / Drive)
// ════════════════════════════════════════════════════════════════════════════

function LinkChip({ label, url, onEdit, canEdit }) {
  const hasUrl = Boolean(url)
  if (!hasUrl) {
    if (!canEdit) return null
    return (
      <button
        type="button"
        onClick={onEdit}
        className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-dashed"
        style={{
          borderColor: 'var(--brd-sub)',
          color: 'var(--txt-3)',
          cursor: 'pointer',
        }}
        title={`Ajouter un lien ${label}`}
      >
        <Link2 className="w-3 h-3" />
        {label}
      </button>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded"
      style={{
        background: 'var(--blue-bg)',
        color: 'var(--blue)',
        fontWeight: 500,
      }}
      title={url}
    >
      <ExternalLink className="w-3 h-3" />
      {label}
    </a>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Menu actions row
// ════════════════════════════════════════════════════════════════════════════

function RowActionMenu({
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
      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
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
