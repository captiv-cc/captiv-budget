// ════════════════════════════════════════════════════════════════════════════
// LivrableBlockCard — carte d'un bloc de livrables (LIV-6 CRUD)
// ════════════════════════════════════════════════════════════════════════════
//
// Un bloc regroupe des livrables autour d'un thème (MASTER, AFTERMOVIE, SNACK
// CONTENT…). Ce composant affiche l'header du bloc (pastille couleur, nom,
// préfixe, compteur, actions) + la liste MVP des livrables. Le rendu fin des
// livrables (inline edit, versions, étapes) arrive à LIV-7.
//
// LIV-6 cable la partie CRUD blocs :
//   - Édition inline du nom (click titre → input → Enter valide / Escape annule)
//   - Édition inline du préfixe (max 4 char, uppercase auto)
//   - Changement de couleur (popover palette depuis LIVRABLE_BLOCK_COLOR_PRESETS)
//   - Suppression soft avec toast "Annuler" 5 s (restauration via restoreBlock)
//   - Collapse / expand de la liste des livrables
//   - Drag & drop : handle GripVertical + outline bleu sur le bloc survolé
//     (pattern MAT-9D HTML5 natif — pas de dépendance @dnd-kit)
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
  GripVertical,
  MoreHorizontal,
  Palette,
  Trash2,
  Type,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LIVRABLE_BLOCK_COLOR_PRESETS, LIVRABLE_STATUTS } from '../../../lib/livrablesHelpers'
import { confirm } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'

export default function LivrableBlockCard({
  block,
  livrables = [],
  actions,
  canEdit = true,
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

  // ─── Drag & drop (HTML5 natif, pattern MAT-9D) ────────────────────────────
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
                onDelete={handleDelete}
              />
            )}
          </div>
        )}
      </header>

      {/* ─── Corps : liste des livrables (MVP — LIV-7 rendra éditable) ────── */}
      {!collapsed &&
        (livrables.length === 0 ? (
          <div
            className="p-4 text-center text-xs"
            style={{ color: 'var(--txt-3)' }}
          >
            Aucun livrable dans ce bloc.
            {canEdit && <span className="ml-1">Arrive à LIV-7.</span>}
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--brd-sub)' }}>
            {livrables.map((l) => {
              const statut = LIVRABLE_STATUTS[l.statut]
              return (
                <li
                  key={l.id}
                  className="px-4 py-2.5 flex items-center gap-3 text-sm"
                  style={{ borderColor: 'var(--brd-sub)' }}
                >
                  {l.numero && (
                    <span
                      className="text-[11px] font-mono shrink-0"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      {l.numero}
                    </span>
                  )}
                  <span className="truncate" style={{ color: 'var(--txt)' }}>
                    {l.nom || '— sans nom —'}
                  </span>
                  {l.format && (
                    <span
                      className="text-xs shrink-0"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      {l.format}
                    </span>
                  )}
                  {statut && (
                    <span
                      className="ml-auto text-[11px] px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: statut.bg, color: statut.color }}
                    >
                      {statut.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        ))}
    </section>
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

function BlockActionMenu({ onRename, onEditPrefix, onEditColor, onDelete }) {
  return (
    <div
      className="absolute right-0 top-full mt-1 z-20 rounded-lg shadow-lg overflow-hidden"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        minWidth: '180px',
      }}
    >
      <MenuRow icon={Type} label="Renommer" onClick={onRename} />
      <MenuRow icon={Type} label="Préfixe" onClick={onEditPrefix} />
      <MenuRow icon={Palette} label="Couleur" onClick={onEditColor} />
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
