// ════════════════════════════════════════════════════════════════════════════
// LivrableBlockCard — carte d'un bloc de livrables (LIV-6 blocs + LIV-7 rows)
// ════════════════════════════════════════════════════════════════════════════
//
// Un bloc regroupe des livrables autour d'un thème (MASTER, AFTERMOVIE, SNACK
// CONTENT…). Ce composant affiche l'header du bloc (pastille couleur, nom,
// préfixe, compteur, actions) + la liste éditable des livrables via
// `LivrableRow` (desktop) ou `LivrableRowCard` (mobile), plus un footer
// "+ Nouveau livrable".
//
// LIV-6 — CRUD blocs :
//   - Édition inline du nom (click titre → input → Enter valide / Escape annule)
//   - Édition inline du préfixe (max 4 char, uppercase auto)
//   - Changement de couleur (popover palette depuis LIVRABLE_BLOCK_COLOR_PRESETS)
//   - Suppression soft avec toast "Annuler" 5 s (restauration via restoreBlock)
//   - Collapse / expand de la liste des livrables
//   - Drag & drop : handle GripVertical + outline bleu sur le bloc survolé
//     (pattern MAT-9D HTML5 natif — pas de dépendance @dnd-kit)
//
// LIV-7 — CRUD livrables :
//   - Table desktop / cards mobile (pattern MAT-RESP-1)
//   - Création via footer (auto-numero côté serveur)
//   - Suppression soft avec toast "Annuler" 5 s (restaureLivrable)
//   - Édition des notes via prompt multiline
//   - (Drag & drop des livrables reste à brancher en LIV-11)
//
// Props :
//   - block               : livrable_blocks
//   - livrables           : Array<livrable> du bloc
//   - actions             : objet actions de useLivrables
//   - canEdit             : booléen (mode lecture si false → tout en read-only)
//   - isDragOver          : booléen (outline bleu depuis parent)
//   - onBlockDragStart    : callback (notifie parent de l'index source)
//   - onBlockDragOver     : callback (notifie parent de l'index survolé)
//   - onBlockDrop         : callback (déclenche reorderBlocks côté parent)
//   - onBlockDragEnd      : callback (nettoie état drag)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CopyPlus,
  GripVertical,
  MoreHorizontal,
  Palette,
  Plus,
  Trash2,
  Type,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LIVRABLE_BLOCK_COLOR_PRESETS } from '../../../lib/livrablesHelpers'
import { confirm, prompt as uiPrompt } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import LivrableRow from './LivrableRow'
import LivrableRowCard from './LivrableRowCard'
import DuplicateToProjectModal from './DuplicateToProjectModal'
import Checkbox from './Checkbox'

export default function LivrableBlockCard({
  block,
  livrables = [],
  actions,
  canEdit = true,
  // LIV-8 — versions / LIV-9 — étapes
  versionsByLivrable,  // Map<livrableId, version[]>
  etapesByLivrable,    // Map<livrableId, etape[]>
  onOpenVersions,      // (livrable) => void
  onOpenEtapes,        // (livrable) => void
  // LIV-14 — bulk select
  selectedIds,         // Set<string> (sélection cross-blocs)
  onToggleSelect,      // (livrableId, { shiftKey }) => void
  onSelectBlock,       // (livrableIdsOfBlock, allSelected) => void
  // LIV-15 — autocomplete monteur
  profiles = [],       // Array<profile> de l'org
  profilesById = null, // Map<id, profile>
  // Drag & drop wiring (depuis LivrableBlockList)
  isDragOver = false,
  onBlockDragStart,
  onBlockDragOver,
  onBlockDrop,
  onBlockDragEnd,
}) {
  const color = block.couleur || '#94a3b8'

  // ─── Inline edit : titre ──────────────────────────────────────────────────
  const [titleEditing, setTitleEditing] = useState(false)
  const [title, setTitle] = useState(block.nom || '')
  useEffect(() => {
    setTitle(block.nom || '')
  }, [block.nom])

  const commitTitle = useCallback(async () => {
    const next = title.trim()
    setTitleEditing(false)
    if (!next || next === block.nom) {
      setTitle(block.nom || '')
      return
    }
    try {
      await actions.renameBlock(block.id, next)
    } catch (err) {
      notify.error('Erreur renommage : ' + (err?.message || err))
      setTitle(block.nom || '')
    }
  }, [actions, block.id, block.nom, title])

  // ─── Inline edit : préfixe ────────────────────────────────────────────────
  const [prefixEditing, setPrefixEditing] = useState(false)
  const [prefix, setPrefix] = useState(block.prefixe || '')
  useEffect(() => {
    setPrefix(block.prefixe || '')
  }, [block.prefixe])

  const commitPrefix = useCallback(async () => {
    const next = (prefix || '').trim().toUpperCase().slice(0, 4)
    setPrefixEditing(false)
    // null explicite si vidé (évite chaîne vide en BDD)
    const current = block.prefixe || ''
    if (next === current) {
      setPrefix(block.prefixe || '')
      return
    }
    try {
      await actions.updateBlock(block.id, { prefixe: next || null })
    } catch (err) {
      notify.error('Erreur préfixe : ' + (err?.message || err))
      setPrefix(block.prefixe || '')
    }
  }, [actions, block.id, block.prefixe, prefix])

  // ─── Popover : palette de couleurs ────────────────────────────────────────
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  const colorMenuRef = useRef(null)
  useEffect(() => {
    if (!colorMenuOpen) return undefined
    function onDoc(e) {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target)) {
        setColorMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [colorMenuOpen])

  const handleColorPick = useCallback(
    async (nextColor) => {
      setColorMenuOpen(false)
      if (nextColor === block.couleur) return
      try {
        await actions.updateBlock(block.id, { couleur: nextColor })
      } catch (err) {
        notify.error('Erreur couleur : ' + (err?.message || err))
      }
    },
    [actions, block.id, block.couleur],
  )

  // ─── Menu (...) actions bloc ──────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // LIV-13 — modal duplication cross-project (locale au bloc)
  const [dupModalOpen, setDupModalOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen) return undefined
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  // ─── Suppression avec toast undo ─────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!canEdit) return
    setMenuOpen(false)
    const ok = await confirm({
      title: `Supprimer le bloc "${block.nom || 'Sans nom'}" ?`,
      message:
        livrables.length > 0
          ? `Tous les livrables (${livrables.length}) seront masqués. Tu pourras restaurer pendant 5 secondes.`
          : 'Le bloc sera masqué. Tu pourras restaurer pendant 5 secondes.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return

    try {
      await actions.deleteBlock(block.id)
      // Toast custom avec bouton Annuler (pattern MAT-10I)
      toast.custom(
        (t) => (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
          >
            <Trash2 className="w-4 h-4" style={{ color: 'var(--red)' }} />
            <span className="text-sm">Bloc supprimé</span>
            <button
              type="button"
              onClick={async () => {
                toast.dismiss(t.id)
                try {
                  await actions.restoreBlock(block.id)
                  notify.success('Bloc restauré')
                } catch (err) {
                  notify.error('Erreur restauration : ' + (err?.message || err))
                }
              }}
              className="text-sm font-medium px-2 py-1 rounded"
              style={{ color: 'var(--blue)', background: 'var(--blue-bg)' }}
            >
              Annuler
            </button>
          </div>
        ),
        { duration: 5000 },
      )
    } catch (err) {
      notify.error('Erreur suppression : ' + (err?.message || err))
    }
  }, [actions, block.id, block.nom, canEdit, livrables.length])

  // ─── Collapse / expand (local, self-contained) ────────────────────────────
  const [collapsed, setCollapsed] = useState(false)

  // ─── Layout responsive (MAT-RESP-1) ──────────────────────────────────────
  const bp = useBreakpoint()
  const isMobile = bp.isMobile

  // ─── LIV-14 — état checkbox "tout le bloc" ──────────────────────────────
  // 'all' si tous les livrables du bloc sont sélectionnés, 'partial' si
  // certains seulement, 'none' si aucun. Calculé via les ids du bloc et
  // selectedIds passé en prop.
  const blockSelectionState = (() => {
    if (!selectedIds || livrables.length === 0) return 'none'
    let count = 0
    for (const l of livrables) {
      if (selectedIds.has(l.id)) count++
    }
    if (count === 0) return 'none'
    if (count === livrables.length) return 'all'
    return 'partial'
  })()

  // ─── Création livrable (footer — saisie rapide en rafale) ────────────────
  // Pattern aligné sur `BlockItemAdder` (matériel) en simplifié : input
  // toujours visible avec placeholder, Entrée commit + reset + garde le focus
  // pour permettre la saisie en rafale. Pas de catalogue de livrables côté
  // DB → pas de dropdown de suggestions, juste l'input direct.
  const [creating, setCreating] = useState(false)
  const handleCreateLivrable = useCallback(
    async (nom = '') => {
      if (!canEdit || creating) return
      setCreating(true)
      try {
        // Si nom vide, le serveur met "Nouveau livrable" par défaut.
        await actions.createLivrable({
          blockId: block.id,
          data: { nom: (nom || '').trim() },
        })
      } catch (err) {
        notify.error('Création impossible : ' + (err?.message || err))
      } finally {
        setCreating(false)
      }
    },
    [actions, block.id, canEdit, creating],
  )

  // ─── Suppression livrable avec toast undo ────────────────────────────────
  const handleDeleteLivrable = useCallback(
    async (livrable) => {
      if (!canEdit || !livrable) return
      const ok = await confirm({
        title: `Supprimer "${livrable.nom || livrable.numero || 'ce livrable'}" ?`,
        message: 'Tu pourras restaurer pendant 5 secondes.',
        confirmLabel: 'Supprimer',
        cancelLabel: 'Annuler',
        danger: true,
      })
      if (!ok) return
      try {
        await actions.deleteLivrable(livrable.id)
        toast.custom(
          (t) => (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            >
              <Trash2 className="w-4 h-4" style={{ color: 'var(--red)' }} />
              <span className="text-sm">Livrable supprimé</span>
              <button
                type="button"
                onClick={async () => {
                  toast.dismiss(t.id)
                  try {
                    await actions.restoreLivrable(livrable.id)
                    notify.success('Livrable restauré')
                  } catch (err) {
                    notify.error('Erreur restauration : ' + (err?.message || err))
                  }
                }}
                className="text-sm font-medium px-2 py-1 rounded"
                style={{ color: 'var(--blue)', background: 'var(--blue-bg)' }}
              >
                Annuler
              </button>
            </div>
          ),
          { duration: 5000 },
        )
      } catch (err) {
        notify.error('Erreur suppression : ' + (err?.message || err))
      }
    },
    [actions, canEdit],
  )

  // ─── Édition notes (prompt multiline) ────────────────────────────────────
  const handleEditNotes = useCallback(
    async (livrable) => {
      if (!canEdit || !livrable) return
      const next = await uiPrompt({
        title: `Notes — ${livrable.nom || livrable.numero || 'Livrable'}`,
        message: 'Notes internes (non partagées avec le client).',
        multiline: true,
        initialValue: livrable.notes || '',
        placeholder: 'Ex : retours client, briefs DA, points d\'attention…',
        confirmLabel: 'Enregistrer',
      })
      if (next === null) return
      try {
        await actions.updateLivrable(livrable.id, { notes: next.trim() || null })
      } catch (err) {
        notify.error('Erreur notes : ' + (err?.message || err))
      }
    },
    [actions, canEdit],
  )

  // ─── Drag & drop livrables dans le bloc (LIV-11, pattern miroir MAT-9D) ──
  // Pendant pour les rows livrables du DnD blocs déjà câblé en LIV-6 :
  //   - `dragLivrableIdx` ref → index source capté au dragStart
  //   - `dragOverLivrableIdx` state → index survolé pour l'outline bleu
  //   - `handleReorderLivrables` → splice local + persist via
  //     `actions.reorderLivrables(orderedIds)` (déjà optimistic côté hook).
  // DnD désactivé sur mobile (cards) — l'utilisateur n'a pas de souris.
  const livrableDndEnabled = canEdit && !isMobile
  const dragLivrableIdx = useRef(null)
  const [dragOverLivrableIdx, setDragOverLivrableIdx] = useState(null)

  const handleReorderLivrables = useCallback(
    async (fromIdx, toIdx) => {
      if (fromIdx === toIdx) return
      if (fromIdx < 0 || toIdx < 0) return
      if (fromIdx >= livrables.length || toIdx >= livrables.length) return

      const next = livrables.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      const orderedIds = next.map((l) => l.id)

      try {
        await actions.reorderLivrables(orderedIds)
      } catch (err) {
        notify.error('Erreur réorganisation : ' + (err?.message || err))
      }
    },
    [actions, livrables],
  )

  // ─── Drag & drop blocs (HTML5 natif, pattern MAT-9D, déjà LIV-6) ─────────
  const blockDndEnabled = canEdit && Boolean(onBlockDragStart)

  const handleBlockDragStart = blockDndEnabled
    ? (e) => {
        e.stopPropagation()
        e.dataTransfer.effectAllowed = 'move'
        try {
          e.dataTransfer.setData('text/plain', `livrable-block:${block.id}`)
        } catch {
          /* IE legacy — ignore */
        }
        onBlockDragStart?.()
      }
    : undefined

  const handleBlockDragOver = blockDndEnabled
    ? (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onBlockDragOver?.()
      }
    : undefined

  const handleBlockDragEnter = blockDndEnabled
    ? (e) => {
        e.preventDefault()
        onBlockDragOver?.()
      }
    : undefined

  const handleBlockDrop = blockDndEnabled
    ? (e) => {
        e.preventDefault()
        e.stopPropagation()
        onBlockDrop?.()
      }
    : undefined

  const handleBlockDragEndCb = blockDndEnabled ? onBlockDragEnd : undefined

  return (
    <section
      className="rounded-xl relative"
      onDragOver={handleBlockDragOver}
      onDragEnter={handleBlockDragEnter}
      onDrop={handleBlockDrop}
      onDragEnd={handleBlockDragEndCb}
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        outline: isDragOver ? '2px solid var(--blue)' : 'none',
        outlineOffset: isDragOver ? '-2px' : 0,
        transition: 'outline 120ms ease',
      }}
    >
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <header
        // `rounded-t-xl` assure que le bg du header respecte le border-radius
        // du <section> (on a retiré overflow-hidden pour laisser le popover
        // Actions [...] s'étendre librement en dehors du bloc).
        className="flex items-center gap-2 px-3 py-2.5 rounded-t-xl"
        draggable={blockDndEnabled}
        onDragStart={handleBlockDragStart}
        onDragOver={handleBlockDragOver}
        onDragEnter={handleBlockDragEnter}
        onDrop={handleBlockDrop}
        onDragEnd={handleBlockDragEndCb}
        style={{
          background: 'var(--bg-elev)',
          borderBottom: collapsed ? 'none' : '1px solid var(--brd)',
          cursor: blockDndEnabled ? 'grab' : 'default',
        }}
      >
        {/* Grip — handle drag (affordance visuelle) */}
        {blockDndEnabled && (
          <GripVertical
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: 'var(--txt-3)', opacity: 0.5 }}
            aria-hidden="true"
          />
        )}

        {/* Chevron collapse */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Déplier' : 'Replier'}
          className="p-0.5 rounded shrink-0"
          style={{ color: 'var(--txt-3)' }}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {/* LIV-14 — checkbox "Tout le bloc" (état tri : none/partial/all) */}
        {canEdit && onSelectBlock && livrables.length > 0 && (
          <BlockCheckbox
            state={blockSelectionState}
            onToggle={() => {
              const ids = livrables.map((l) => l.id)
              onSelectBlock?.(ids, blockSelectionState === 'all')
            }}
          />
        )}

        {/* Pastille couleur — click ouvre la palette */}
        <div ref={colorMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => canEdit && setColorMenuOpen((o) => !o)}
            disabled={!canEdit}
            aria-label="Changer la couleur"
            className="w-3.5 h-3.5 rounded-full border"
            style={{
              background: color,
              borderColor: 'var(--brd)',
              cursor: canEdit ? 'pointer' : 'default',
            }}
            title={canEdit ? 'Changer la couleur' : color}
          />
          {colorMenuOpen && (
            <ColorPalette
              currentColor={color}
              onPick={handleColorPick}
            />
          )}
        </div>

        {/* Titre éditable inline */}
        {titleEditing && canEdit ? (
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setTitle(block.nom || '')
                setTitleEditing(false)
              }
            }}
            autoFocus
            className="text-sm font-semibold bg-transparent focus:outline-none rounded px-1.5 py-0.5"
            style={{
              color: 'var(--txt)',
              border: '1px solid var(--brd)',
              minWidth: '180px',
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => canEdit && setTitleEditing(true)}
            disabled={!canEdit}
            className="text-sm font-semibold truncate text-left"
            style={{
              color: 'var(--txt)',
              cursor: canEdit ? 'text' : 'default',
            }}
            title={canEdit ? 'Cliquer pour renommer' : block.nom}
          >
            {block.nom || 'Sans nom'}
          </button>
        )}

        {/* Préfixe éditable inline (max 4 car, uppercase) */}
        {prefixEditing && canEdit ? (
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase().slice(0, 4))}
            onBlur={commitPrefix}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setPrefix(block.prefixe || '')
                setPrefixEditing(false)
              }
            }}
            autoFocus
            maxLength={4}
            placeholder="A"
            className="text-[11px] font-mono bg-transparent focus:outline-none rounded px-1.5 py-0.5 w-16 uppercase"
            style={{
              color: 'var(--txt)',
              border: '1px solid var(--brd)',
            }}
          />
        ) : block.prefixe ? (
          <button
            type="button"
            onClick={() => canEdit && setPrefixEditing(true)}
            disabled={!canEdit}
            className="text-[11px] font-mono px-2 py-0.5 rounded"
            style={{
              background: 'var(--bg-2)',
              color: 'var(--txt-3)',
              cursor: canEdit ? 'text' : 'default',
            }}
            title={canEdit ? 'Cliquer pour modifier le préfixe' : 'Préfixe'}
          >
            {block.prefixe}
          </button>
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => setPrefixEditing(true)}
            className="text-[11px] font-mono px-2 py-0.5 rounded border border-dashed"
            style={{
              color: 'var(--txt-3)',
              borderColor: 'var(--brd-sub)',
              cursor: 'text',
            }}
            title="Ajouter un préfixe"
          >
            + préfixe
          </button>
        ) : null}

        {/* Compteur livrables */}
        <span
          className="text-[11px] ml-auto px-2 py-0.5 rounded-full shrink-0"
          style={{ background: 'var(--bg-2)', color: 'var(--txt-3)' }}
        >
          {livrables.length}
        </span>

        {/* Menu (...) — renommer / couleur / préfixe / supprimer */}
        {canEdit && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Actions bloc"
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
            {menuOpen && (
              <BlockActionMenu
                onRename={() => {
                  setMenuOpen(false)
                  setTitleEditing(true)
                }}
                onEditPrefix={() => {
                  setMenuOpen(false)
                  setPrefixEditing(true)
                }}
                onEditColor={() => {
                  setMenuOpen(false)
                  setColorMenuOpen(true)
                }}
                onDuplicateToProject={() => {
                  setMenuOpen(false)
                  setDupModalOpen(true)
                }}
                onDelete={handleDelete}
              />
            )}
            {dupModalOpen && (
              <DuplicateToProjectModal
                mode="bloc"
                source={{ id: block.id, label: block.nom || 'Sans nom' }}
                currentProjectId={block.project_id}
                actions={actions}
                onClose={() => setDupModalOpen(false)}
              />
            )}
          </div>
        )}
      </header>

      {/* ─── Corps : liste des livrables (desktop table / mobile cards) ───── */}
      {!collapsed && !isMobile && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: '1114px' }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--brd-sub)',
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-3)',
                }}
              >
                <Th width="24px" />
                <Th width="20px" />
                <Th width="70px">N°</Th>
                <Th>Nom</Th>
                <Th width="90px">Format</Th>
                <Th width="70px">Durée</Th>
                <Th width="108px">Statut</Th>
                <Th width="130px">Détails</Th>
                <Th width="130px">Monteur</Th>
                <Th width="132px">Livraison</Th>
                <Th width="112px">Liens</Th>
                <Th width="32px" />
              </tr>
            </thead>
            <tbody>
              {livrables.length === 0 ? (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-4 text-center italic"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    Aucun livrable — ajoute-en un ci-dessous.
                  </td>
                </tr>
              ) : (
                livrables.map((l, idx) => (
                  <LivrableRow
                    key={l.id}
                    livrable={l}
                    actions={actions}
                    canEdit={canEdit}
                    onDelete={handleDeleteLivrable}
                    onEditNotes={handleEditNotes}
                    versions={versionsByLivrable?.get(l.id) || []}
                    etapes={etapesByLivrable?.get(l.id) || []}
                    onOpenVersions={onOpenVersions}
                    onOpenEtapes={onOpenEtapes}
                    selected={selectedIds?.has(l.id) || false}
                    profiles={profiles}
                    profilesById={profilesById}
                    onToggleSelect={
                      onToggleSelect
                        ? (opts) => onToggleSelect(l.id, opts || {})
                        : undefined
                    }
                    isDragOver={dragOverLivrableIdx === idx}
                    onDragStart={
                      livrableDndEnabled
                        ? () => {
                            dragLivrableIdx.current = idx
                          }
                        : undefined
                    }
                    onDragOver={
                      livrableDndEnabled
                        ? () => setDragOverLivrableIdx(idx)
                        : undefined
                    }
                    onDrop={
                      livrableDndEnabled
                        ? () => {
                            if (
                              dragLivrableIdx.current !== null &&
                              dragLivrableIdx.current !== idx
                            ) {
                              handleReorderLivrables(dragLivrableIdx.current, idx)
                            }
                            dragLivrableIdx.current = null
                            setDragOverLivrableIdx(null)
                          }
                        : undefined
                    }
                    onDragEnd={
                      livrableDndEnabled
                        ? () => {
                            dragLivrableIdx.current = null
                            setDragOverLivrableIdx(null)
                          }
                        : undefined
                    }
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!collapsed && isMobile && (
        <div className="flex flex-col">
          {livrables.length === 0 ? (
            <div
              className="px-3 py-4 text-center italic text-xs"
              style={{ color: 'var(--txt-3)' }}
            >
              Aucun livrable — ajoute-en un ci-dessous.
            </div>
          ) : (
            livrables.map((l) => (
              <LivrableRowCard
                key={l.id}
                livrable={l}
                actions={actions}
                canEdit={canEdit}
                onDelete={handleDeleteLivrable}
                onEditNotes={handleEditNotes}
                versions={versionsByLivrable?.get(l.id) || []}
                etapes={etapesByLivrable?.get(l.id) || []}
                onOpenVersions={onOpenVersions}
                onOpenEtapes={onOpenEtapes}
                selected={selectedIds?.has(l.id) || false}
                profiles={profiles}
                profilesById={profilesById}
                onToggleSelect={
                  onToggleSelect
                    ? (opts) => onToggleSelect(l.id, opts || {})
                    : undefined
                }
              />
            ))
          )}
        </div>
      )}

      {/* Footer : add livrable inline (masqué si replié ou read-only) */}
      {!collapsed && canEdit && (
        <footer
          className="px-3 py-1.5"
          style={{
            borderTop: '1px solid var(--brd-sub)',
            background: 'var(--bg-surf)',
          }}
        >
          <LivrableQuickAdd
            disabled={creating}
            onAdd={handleCreateLivrable}
          />
        </footer>
      )}
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// LivrableQuickAdd — input inline pour créer un livrable en rafale
// ════════════════════════════════════════════════════════════════════════════
//
// Pattern aligné sur `BlockItemAdder` (matériel) en version simplifiée :
//   - placeholder "+ Nouveau livrable" (icône Plus à gauche)
//   - focus → l'input s'éclaircit, prêt à recevoir le nom
//   - Entrée (avec contenu) → `onAdd(nom)` + reset l'input + garde le focus
//     (saisie en rafale)
//   - Entrée (vide) → `onAdd('')` puis blur (= ligne par défaut "Nouveau
//     livrable", utile si on veut juste une ligne vide à remplir plus tard)
//   - Escape → reset + blur
//   - blur → reset (pas de soumission)
// ════════════════════════════════════════════════════════════════════════════

function LivrableQuickAdd({ disabled = false, onAdd }) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)

  const handleSubmit = useCallback(async () => {
    const nom = value.trim()
    setValue('')
    try {
      await onAdd?.(nom)
    } catch {
      // l'appelant notifie
    }
    // Garde le focus pour saisie en rafale (uniquement si l'utilisateur
    // a tapé un nom — sinon on laisse blur naturel après Entrée vide).
    if (nom && inputRef.current) {
      // Petit setTimeout pour laisser React rerender avant le focus.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [onAdd, value])

  // Click sur le wrapper (Plus icon ou zone vide à droite) → focus l'input.
  // On utilise un <div> au lieu d'un <button> pour éviter d'imbriquer un
  // <input> dans un <button> (invalide HTML5).
  return (
    <div
      onMouseDown={(e) => {
        // Empêche le blur si on clique en dehors de l'input mais dans la zone
        // (l'icône Plus par exemple). On focus l'input à la place.
        if (e.target !== inputRef.current) {
          e.preventDefault()
          inputRef.current?.focus()
        }
      }}
      className="w-full flex items-center gap-2 px-2 py-1 rounded transition-colors"
      style={{
        background: focused ? 'var(--bg-hov)' : 'transparent',
        cursor: 'text',
      }}
    >
      <Plus
        className="w-3.5 h-3.5 shrink-0"
        style={{ color: focused || value ? 'var(--blue)' : 'var(--txt-3)' }}
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          // On reset à la perte de focus pour que l'état de retour soit
          // propre (placeholder visible). Pas de submission ici.
          setValue('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleSubmit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setValue('')
            inputRef.current?.blur()
          }
        }}
        disabled={disabled}
        placeholder="Nouveau livrable… (Entrée pour valider)"
        className="flex-1 bg-transparent focus:outline-none text-xs"
        style={{
          color: focused || value ? 'var(--blue)' : 'var(--txt-3)',
          fontWeight: 500,
          opacity: disabled ? 0.5 : 1,
        }}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Header cell helper (desktop table)
// ════════════════════════════════════════════════════════════════════════════

function Th({ children, width, align = 'left' }) {
  return (
    <th
      className="px-2 py-2 font-medium uppercase tracking-wider text-[10px]"
      style={{
        width,
        textAlign: align,
        color: 'var(--txt-3)',
      }}
    >
      {children}
    </th>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Palette de couleurs (popover)
// ════════════════════════════════════════════════════════════════════════════

function ColorPalette({ currentColor, onPick }) {
  return (
    <div
      className="absolute left-0 top-full mt-1 z-20 p-2 rounded-lg shadow-lg"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
      }}
    >
      <div className="grid grid-cols-5 gap-1.5" style={{ width: 'max-content' }}>
        {LIVRABLE_BLOCK_COLOR_PRESETS.map((c) => {
          const active = c.toLowerCase() === (currentColor || '').toLowerCase()
          return (
            <button
              key={c}
              type="button"
              onClick={() => onPick(c)}
              aria-label={`Couleur ${c}`}
              className="w-6 h-6 rounded-full transition-transform hover:scale-110"
              style={{
                background: c,
                border: active ? '2px solid var(--txt)' : '1px solid var(--brd)',
                boxShadow: active ? '0 0 0 2px var(--bg-elev)' : 'none',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Menu (...) actions bloc
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// BlockCheckbox — checkbox "Tout le bloc" avec état tri (LIV-14)
// ════════════════════════════════════════════════════════════════════════════
//
// Trois états visuels :
//   - 'none'    : aucun livrable du bloc sélectionné → checkbox vide
//   - 'partial' : certains sélectionnés → checkbox indeterminate (HTML5)
//   - 'all'     : tous sélectionnés → checkbox pleine
//
// Click :
//   - 'none' / 'partial' → coche tous les livrables du bloc
//   - 'all'              → décoche tous

function BlockCheckbox({ state, onToggle }) {
  return (
    <Checkbox
      checked={state === 'all'}
      indeterminate={state === 'partial'}
      onClick={onToggle}
      size="md"
      ariaLabel="Sélectionner / désélectionner tout le bloc"
    />
  )
}

function BlockActionMenu({
  onRename,
  onEditPrefix,
  onEditColor,
  onDuplicateToProject,
  onDelete,
}) {
  return (
    <div
      className="absolute right-0 top-full mt-1 z-20 rounded-lg shadow-lg overflow-hidden"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        minWidth: '220px',
      }}
    >
      <MenuRow icon={Type} label="Renommer" onClick={onRename} />
      <MenuRow icon={Type} label="Préfixe" onClick={onEditPrefix} />
      <MenuRow icon={Palette} label="Couleur" onClick={onEditColor} />
      <div style={{ borderTop: '1px solid var(--brd-sub)' }}>
        <MenuRow
          icon={CopyPlus}
          label="Dupliquer dans un autre projet…"
          onClick={onDuplicateToProject}
        />
      </div>
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
      style={{
        color: danger ? 'var(--red)' : 'var(--txt)',
      }}
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
