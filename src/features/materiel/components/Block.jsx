// ════════════════════════════════════════════════════════════════════════════
// Block — carte d'un bloc matos (header + items + footer)
// ════════════════════════════════════════════════════════════════════════════
//
// Chaque bloc est une section visuelle autonome qui affiche :
//   - Un header avec le titre éditable inline, un badge du mode d'affichage
//     (liste/config), un compteur d'items, et les actions bloc (toggle
//     affichage, renommer, supprimer).
//   - Un tableau d'items (ItemRow) avec en-têtes adaptés au mode.
//   - Un footer "+ Ajouter un item".
//
// Le rendu du tableau s'adapte au toggle global `detailed` :
//   - compressé : Flag / (Label) / Désignation / Qté / Loueurs
//   - détaillé  : + Checklist + Remarques
//
// Props :
//   - block                     : matos_block
//   - items                     : Array<matos_item> du bloc
//   - loueursByItem             : Map
//   - loueursById, allLoueurs   : catalogue loueurs
//   - materielBdd, materielBddById : catalogue matériel
//   - orgId, actions, canEdit
//   - detailed : boolean (toggle global)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  GripVertical,
  List,
  MoreHorizontal,
  Package,
  Trash2,
} from 'lucide-react'
import { MATOS_BLOCK_AFFICHAGES } from '../../../lib/materiel'
import { notify } from '../../../lib/notify'
import { confirm } from '../../../lib/confirm'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import ActionSheet from '../../../components/ActionSheet'
import ItemRow from './ItemRow'
import ItemRowCard from './ItemRowCard'
import BlockItemAdder from './BlockItemAdder'

export default function Block({
  block,
  items = [],
  loueursByItem,
  loueursById,
  allLoueurs = [],
  orgId,
  materielBdd = [],
  actions,
  canEdit = true,
  detailed = false,
  // ─── Drag & drop (depuis BlockList, pattern identique à ItemRow) ─────────
  // dragInsertPosition = 'before' | 'after' | null : indique où la ligne
  // d'insertion bleue doit s'afficher (au-dessus / en-dessous / nulle part).
  // Calculé par BlockList depuis la position relative du curseur (clientY)
  // dans la bounding box du bloc — voir handleBlockDragOver.
  dragInsertPosition = null,
  onBlockDragStart,
  onBlockDragOver,
  onBlockDrop,
  onBlockDragEnd,
}) {
  const [titleEditing, setTitleEditing] = useState(false)
  const [title, setTitle] = useState(block.titre || '')
  const [affichageMenuOpen, setAffichageMenuOpen] = useState(false)
  const affichageRef = useRef(null)

  // Collapse/expand : état local (self-contained). Par défaut, déplié.
  const [collapsed, setCollapsed] = useState(false)

  // Responsive : mobile (<640px) bascule du <table> vers une liste de cartes
  // (ItemRowCard) et collapse les 3 IconBtn d'actions bloc dans un ⋯
  // ActionSheet. Desktop/tablet gardent la table classique et les actions en
  // ligne — comportement d'origine préservé.
  const bp = useBreakpoint()
  const isMobile = bp.isMobile

  // Drag & drop des items (interne au bloc) : ref pour l'index source
  // (capté au dragStart), state pour l'index survolé (rendu visuel).
  // Pattern identique à CategoryBlock/DevisLine.
  const dragIdx = useRef(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  // DnD du bloc lui-même : activé uniquement si canEdit ET handlers fournis.
  const blockDndEnabled = canEdit && Boolean(onBlockDragStart)

  useEffect(() => {
    setTitle(block.titre || '')
  }, [block.titre])

  // Close affichage menu on outside click.
  useEffect(() => {
    if (!affichageMenuOpen) return undefined
    function onDoc(e) {
      if (affichageRef.current && !affichageRef.current.contains(e.target)) {
        setAffichageMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [affichageMenuOpen])

  // ─── Handlers ────────────────────────────────────────────────────────────
  const commitTitle = useCallback(async () => {
    const next = title.trim()
    setTitleEditing(false)
    if (!next || next === block.titre) {
      setTitle(block.titre || '')
      return
    }
    try {
      await actions.updateBlock(block.id, { titre: next })
    } catch (err) {
      notify.error('Erreur renommage : ' + (err?.message || err))
      setTitle(block.titre || '')
    }
  }, [actions, block.id, block.titre, title])

  const handleAffichageChange = useCallback(
    async (affichage) => {
      setAffichageMenuOpen(false)
      if (affichage === block.affichage) return
      try {
        await actions.updateBlock(block.id, { affichage })
      } catch (err) {
        notify.error('Erreur changement affichage : ' + (err?.message || err))
      }
    },
    [actions, block.id, block.affichage],
  )

  const handleDeleteBlock = useCallback(async () => {
    if (!canEdit) return

    const ok = await confirm({
      title: `Supprimer le bloc "${block.titre}" ?`,
      message: 'Tous les items et données associées seront supprimés. Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    try {
      await actions.deleteBlock(block.id)
      notify.success('Bloc supprimé')
    } catch (err) {
      notify.error('Erreur suppression : ' + (err?.message || err))
    }
  }, [actions, block.id, block.titre, canEdit])

  const handleDuplicateBlock = useCallback(async () => {
    if (!canEdit) return
    try {
      await actions.duplicateBlock(block.id)
      notify.success(`Bloc "${block.titre}" dupliqué`)
    } catch (err) {
      notify.error('Erreur duplication : ' + (err?.message || err))
    }
  }, [actions, block.id, block.titre, canEdit])

  const handleSaveDescription = useCallback(
    async (next) => {
      if (!canEdit) return
      const trimmed = (next || '').trim()
      const current = (block.description || '').trim()
      if (trimmed === current) return
      try {
        await actions.updateBlock(block.id, { description: trimmed || null })
      } catch (err) {
        notify.error('Erreur description : ' + (err?.message || err))
      }
    },
    [actions, block.id, block.description, canEdit],
  )

  const handleAddFromCatalogue = useCallback(
    async (mat) => {
      if (!canEdit || !mat) return
      try {
        // Label laissé null → l'input affiche son placeholder "Label"
        // (distinct visuellement des vrais labels remplis).
        await actions.createItem({
          blockId: block.id,
          data: {
            designation: mat.nom,
            materiel_bdd_id: mat.id,
            label: null,
            quantite: 1,
          },
        })
      } catch (err) {
        notify.error('Erreur ajout item : ' + (err?.message || err))
      }
    },
    [actions, block.id, canEdit],
  )

  const handleAddFreeForm = useCallback(
    async (text) => {
      if (!canEdit) return
      try {
        // Désignation et label laissés vides/null si l'utilisateur n'a rien
        // saisi — l'UI affichera les placeholders cliquables correspondants.
        await actions.createItem({
          blockId: block.id,
          data: {
            designation: text || '',
            label: null,
            quantite: 1,
          },
        })
      } catch (err) {
        notify.error('Erreur ajout item : ' + (err?.message || err))
      }
    },
    [actions, block.id, canEdit],
  )

  // ─── Drag & drop : reorder ───────────────────────────────────────────────
  // Reçoit les index source / destination dans le tableau `items` local, calcule
  // le nouvel ordre par splice, puis persiste en un seul UPDATE des sort_order
  // via actions.reorderItems (déjà disponible côté hook/lib matériel).
  const handleReorderItems = useCallback(
    async (fromIdx, toIdx) => {
      if (fromIdx === toIdx) return
      if (fromIdx < 0 || toIdx < 0) return
      if (fromIdx >= items.length || toIdx >= items.length) return

      const next = items.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      const orderedIds = next.map((i) => i.id)

      try {
        await actions.reorderItems(orderedIds)
      } catch (err) {
        notify.error('Erreur réorganisation : ' + (err?.message || err))
      }
    },
    [actions, items],
  )

  const handleDeleteItem = useCallback(
    async (item) => {
      const itemLabel = item.designation || item.label || 'cet item'
      const ok = await confirm({
        title: `Supprimer "${itemLabel}" ?`,
        message: 'Cette action est irréversible.',
        confirmLabel: 'Supprimer',
        cancelLabel: 'Annuler',
        danger: true,
      })
      if (!ok) return
      try {
        await actions.deleteItem(item.id)
      } catch (err) {
        notify.error('Erreur suppression : ' + (err?.message || err))
      }
    },
    [actions],
  )

  const isConfig = block.affichage === 'config'
  const affichageDef = MATOS_BLOCK_AFFICHAGES[block.affichage] || MATOS_BLOCK_AFFICHAGES.liste
  const AffichageIcon = isConfig ? Package : List

  // ─── DnD factory handlers (bloc) ─────────────────────────────────────────
  // Extraits en fonctions stables pour pouvoir les dupliquer sur <section> ET
  // <header> sans divergence. Firefox/Safari refusent de démarrer un drag
  // sans `setData`, d'où la ligne explicite dans dragStart.
  const handleBlockDragStart = blockDndEnabled
    ? (e) => {
        e.stopPropagation()
        e.dataTransfer.effectAllowed = 'move'
        // setData obligatoire pour Firefox — sans quoi le drag est annulé
        // immédiatement après le mousedown.
        try {
          e.dataTransfer.setData('text/plain', `matos-block:${block.id}`)
        } catch {
          // IE/Edge historique : setData peut échouer, on ignore.
        }
        onBlockDragStart?.()
      }
    : undefined

  // Calcule la position relative du curseur dans le bloc (above/below mid-line)
  // pour qu'on puisse afficher une ligne d'insertion ciblée plutôt qu'un
  // outline ambigu sur tout le bloc. Pattern courant (Notion / Linear / Figma).
  const computeInsertPosition = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetY = e.clientY - rect.top
    return offsetY < rect.height / 2 ? 'before' : 'after'
  }

  const handleBlockDragOver = blockDndEnabled
    ? (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onBlockDragOver?.(computeInsertPosition(e))
      }
    : undefined

  const handleBlockDragEnter = blockDndEnabled
    ? (e) => {
        e.preventDefault()
        onBlockDragOver?.(computeInsertPosition(e))
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

  // Indicateur d'insertion : box-shadow EXTERNE (3px bleu) au-dessus si on
  // drop avant, en-dessous si on drop après. `overflow-hidden` n'affecte
  // PAS les box-shadow externes (seulement les enfants débordants), donc
  // ce trick fonctionne sans toucher au clipping des coins arrondis.
  const insertShadow =
    dragInsertPosition === 'before'
      ? '0 -3px 0 0 var(--blue)'
      : dragInsertPosition === 'after'
        ? '0 3px 0 0 var(--blue)'
        : 'none'

  return (
    <section
      className="rounded-xl overflow-hidden"
      // Les handlers dragover/enter/drop/end sont sur la section pour que le
      // drop soit accepté quand le pointeur est n'importe où sur le bloc.
      // Le `draggable` lui-même est posé sur le header uniquement (ci-dessous)
      // pour que les inputs/textarea restent sélectionnables.
      onDragOver={handleBlockDragOver}
      onDragEnter={handleBlockDragEnter}
      onDrop={handleBlockDrop}
      onDragEnd={handleBlockDragEndCb}
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        boxShadow: insertShadow,
        transition: 'box-shadow 100ms ease',
      }}
    >
      {/* Header de bloc — zone de drop (les events dragover/drop bubblent
          déjà vers <section>, mais certains navigateurs avalent les bubbles
          de drag ; on double la ceinture).
          NB : le drag SOURCE n'est PAS sur le header — il est sur la poignée
          GripVertical dédiée ci-dessous. Sinon le bouton de titre (cursor:text)
          intercepte le mousedown et empêche le drag de démarrer (Chrome /
          Safari). Pattern adopté après retour utilisateur ("je n'arrive pas à
          drag les blocs"). */}
      <header
        className="flex items-center gap-2 px-4 py-2.5"
        onDragOver={isMobile ? undefined : handleBlockDragOver}
        onDragEnter={isMobile ? undefined : handleBlockDragEnter}
        onDrop={isMobile ? undefined : handleBlockDrop}
        onDragEnd={isMobile ? undefined : handleBlockDragEndCb}
        style={{
          background: 'var(--bg-elev)',
          borderBottom: collapsed ? '1px solid var(--brd)' : '1px solid var(--brd-sub)',
        }}
      >
        {/* Poignée drag dédiée. Seul élément `draggable` du header — évite
            le conflit avec le bouton-titre (cursor:text). cursor:grab pour
            une affordance claire. Masquée sur mobile : pas de hover et le
            long-press natif entre en conflit avec le tap usuel. */}
        {blockDndEnabled && !isMobile && (
          <div
            draggable
            onDragStart={handleBlockDragStart}
            onDragEnd={handleBlockDragEndCb}
            className="shrink-0 p-1 -ml-1 rounded transition-all"
            style={{
              cursor: 'grab',
              color: 'var(--txt-3)',
              touchAction: 'none',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--txt)'
              e.currentTarget.style.background = 'var(--bg-hov)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--txt-3)'
              e.currentTarget.style.background = 'transparent'
            }}
            title="Glisser pour réordonner le bloc"
            aria-label="Réordonner le bloc"
          >
            <GripVertical className="w-4 h-4" aria-hidden="true" />
          </div>
        )}

        {/* Chevron collapse/expand */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Déplier' : 'Replier'}
          aria-label={collapsed ? 'Déplier' : 'Replier'}
          className="p-0.5 rounded transition-all shrink-0"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--txt)'
            e.currentTarget.style.background = 'var(--bg-hov)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--txt-3)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>

        <AffichageIcon
          className="w-4 h-4 shrink-0"
          style={{ color: isConfig ? 'var(--amber, #f59e0b)' : 'var(--blue)' }}
        />

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
                setTitle(block.titre || '')
                setTitleEditing(false)
              }
            }}
            autoFocus
            className="text-xs font-bold uppercase tracking-wider bg-transparent focus:outline-none rounded px-1"
            style={{
              color: 'var(--txt)',
              letterSpacing: '0.08em',
              border: '1px solid var(--brd)',
              minWidth: '180px',
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => canEdit && setTitleEditing(true)}
            disabled={!canEdit}
            className="text-xs font-bold uppercase tracking-wider truncate text-left"
            style={{
              color: 'var(--txt)',
              letterSpacing: '0.08em',
              cursor: canEdit ? 'text' : 'default',
            }}
            title={canEdit ? 'Cliquer pour renommer' : block.titre}
          >
            {block.titre || 'Sans titre'}
          </button>
        )}

        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ background: 'var(--bg-hov)', color: 'var(--txt-3)' }}
        >
          {items.length}
        </span>

        {/* Actions bloc */}
        <div className="ml-auto flex items-center gap-0.5">
          {canEdit && (
            <div ref={affichageRef} className="relative">
              <button
                type="button"
                onClick={() => setAffichageMenuOpen((o) => !o)}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md transition-all"
                style={{
                  color: 'var(--txt-3)',
                  background: 'transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hov)'
                  e.currentTarget.style.color = 'var(--txt)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--txt-3)'
                }}
                title="Mode d'affichage"
              >
                {affichageDef.label}
                <ChevronDown className="w-3 h-3" />
              </button>
              {affichageMenuOpen && (
                <div
                  className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-20 rounded-lg shadow-lg overflow-hidden"
                  style={{
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--brd)',
                    // Clamp sur mobile : le bouton peut être près du bord
                    // gauche quand le titre est long. Sans clamp, le minWidth
                    // pousse le menu hors écran (cf. bug MAT-23C).
                    minWidth: 'min(160px, calc(100vw - 32px))',
                    maxWidth: 'calc(100vw - 32px)',
                  }}
                >
                  {Object.values(MATOS_BLOCK_AFFICHAGES).map((aff) => {
                    const selected = aff.key === block.affichage
                    return (
                      <button
                        key={aff.key}
                        type="button"
                        onClick={() => handleAffichageChange(aff.key)}
                        className="w-full text-left text-xs px-3 py-1.5 transition-colors"
                        style={{
                          background: selected ? 'var(--blue-bg)' : 'transparent',
                          color: selected ? 'var(--blue)' : 'var(--txt)',
                          fontWeight: selected ? 600 : 400,
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) e.currentTarget.style.background = 'var(--bg-hov)'
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        {aff.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {canEdit && !isMobile && (
            <IconBtn
              icon={Edit3}
              label="Renommer le bloc"
              onClick={() => setTitleEditing(true)}
            />
          )}
          {canEdit && !isMobile && (
            <IconBtn
              icon={Copy}
              label="Dupliquer le bloc"
              onClick={handleDuplicateBlock}
            />
          )}
          {canEdit && !isMobile && (
            <IconBtn
              icon={Trash2}
              label="Supprimer le bloc"
              onClick={handleDeleteBlock}
              danger
            />
          )}
          {/* Mobile : un seul trigger ⋯ qui ouvre une bottom sheet avec les
              3 actions. Évite l'empilement qui écrase le titre du bloc. */}
          {canEdit && isMobile && (
            <ActionSheet
              title="Actions du bloc"
              align="right"
              trigger={({ ref, toggle, open }) => (
                <button
                  ref={ref}
                  type="button"
                  onClick={toggle}
                  aria-label="Actions du bloc"
                  aria-expanded={open}
                  className="p-1.5 rounded-md transition-all"
                  style={{
                    color: 'var(--txt-3)',
                    background: open ? 'var(--bg-hov)' : 'transparent',
                  }}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              )}
              actions={[
                {
                  id: 'rename',
                  icon: Edit3,
                  label: 'Renommer le bloc',
                  onClick: () => setTitleEditing(true),
                },
                {
                  id: 'duplicate',
                  icon: Copy,
                  label: 'Dupliquer le bloc',
                  onClick: handleDuplicateBlock,
                },
                { id: 'sep', type: 'separator' },
                {
                  id: 'delete',
                  icon: Trash2,
                  label: 'Supprimer le bloc',
                  variant: 'danger',
                  onClick: handleDeleteBlock,
                },
              ]}
            />
          )}
        </div>
      </header>

      {/* Description libre du bloc (masquée si replié) */}
      {!collapsed && (
        <DescriptionField
          value={block.description || ''}
          canEdit={canEdit}
          onSave={handleSaveDescription}
        />
      )}

      {/* Items — table classique (≥tablet) ou liste de cartes (mobile).
          - Desktop/tablet : <table> avec overflow-x-auto (scroll résiduel si
            l'écran est vraiment étroit en tablet portrait). Le DnD y est
            opérationnel.
          - Mobile (<640px) : liste <div> de ItemRowCard, pas de table, pas
            de minWidth. Chaque carte étale ses champs verticalement. Le DnD
            est désactivé à ce breakpoint (pas de hover, conflits touch). */}
      {!collapsed && !isMobile && (
      <div className="overflow-x-auto">
        <table
          className="w-full text-xs"
          style={{ minWidth: detailed ? '980px' : '700px' }}
        >
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--brd-sub)',
                background: 'var(--bg-elev)',
                color: 'var(--txt-3)',
              }}
            >
              {/* Colonne drag handle — vide pour ne pas ajouter de bruit visuel */}
              <Th width="20px" />
              <Th width="32px">Flag</Th>
              {/* Label — désormais sur toutes les listes (config ET classique) */}
              <Th width="120px">Label</Th>
              <Th>Désignation</Th>
              <Th width="56px" align="center">Qté</Th>
              <Th width="220px">Loueurs</Th>
              {detailed && <Th width="110px" align="center">Pré · Post · Prod</Th>}
              {detailed && <Th width="200px">Remarques</Th>}
              <Th width="32px" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                {/* 7 colonnes + 2 si detailed (drag / flag / label / désig /
                    qté / loueurs [/ pré·post·prod / remarques] / delete) */}
                <td
                  colSpan={detailed ? 9 : 7}
                  className="px-3 py-4 text-center italic"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Aucun item — ajoute-en un ci-dessous
                </td>
              </tr>
            ) : (
              items.map((item, idx) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  blockAffichage={block.affichage}
                  loueurs={loueursByItem?.get(item.id) || []}
                  loueursById={loueursById}
                  allLoueurs={allLoueurs}
                  orgId={orgId}
                  materielBdd={materielBdd}
                  actions={actions}
                  canEdit={canEdit}
                  detailed={detailed}
                  onDelete={handleDeleteItem}
                  isDragOver={dragOverIdx === idx}
                  onDragStart={() => {
                    dragIdx.current = idx
                  }}
                  onDragOver={() => setDragOverIdx(idx)}
                  onDrop={() => {
                    if (dragIdx.current !== null && dragIdx.current !== idx) {
                      handleReorderItems(dragIdx.current, idx)
                    }
                    dragIdx.current = null
                    setDragOverIdx(null)
                  }}
                  onDragEnd={() => {
                    dragIdx.current = null
                    setDragOverIdx(null)
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      {!collapsed && isMobile && (
        <div className="flex flex-col">
          {items.length === 0 ? (
            <div
              className="px-3 py-4 text-center italic text-xs"
              style={{ color: 'var(--txt-3)' }}
            >
              Aucun item — ajoute-en un ci-dessous
            </div>
          ) : (
            items.map((item) => (
              <ItemRowCard
                key={item.id}
                item={item}
                blockAffichage={block.affichage}
                loueurs={loueursByItem?.get(item.id) || []}
                loueursById={loueursById}
                allLoueurs={allLoueurs}
                orgId={orgId}
                materielBdd={materielBdd}
                actions={actions}
                canEdit={canEdit}
                detailed={detailed}
                onDelete={handleDeleteItem}
              />
            ))
          )}
        </div>
      )}

      {/* Footer : add item (masqué si replié) */}
      {!collapsed && canEdit && (
        <footer
          style={{ borderTop: '1px solid var(--brd-sub)', background: 'var(--bg-surf)' }}
        >
          <BlockItemAdder
            onAddFromCatalogue={handleAddFromCatalogue}
            onAddFreeForm={handleAddFreeForm}
            materielBdd={materielBdd}
            blockAffichage={block.affichage}
            accentColor={isConfig ? 'var(--amber, #f59e0b)' : 'var(--blue)'}
            canEdit={canEdit}
          />
        </footer>
      )}
    </section>
  )
}

function Th({ children, width, align = 'left' }) {
  return (
    <th
      className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider"
      style={{
        textAlign: align,
        width,
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </th>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// DescriptionField — champ texte libre compact, toujours visible
// ═════════════════════════════════════════════════════════════════════════════
//
// Comportement :
//   - Vue : affiche la description (prose), ou un placeholder "Ajouter une
//     description…" si vide (et canEdit).
//   - Click : passe en édition → textarea multi-ligne autogrow.
//   - Blur  : commit (onSave). Escape : annule. Enter seul : commit (blur).
//     Shift+Enter : saut de ligne (pas de commit).
//   - Si !canEdit et valeur vide : le bandeau entier est masqué.
// ═════════════════════════════════════════════════════════════════════════════
function DescriptionField({ value = '', canEdit = true, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  // Autogrow à chaque changement
  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [draft, editing])

  const commit = useCallback(() => {
    setEditing(false)
    const next = (draft || '').trim()
    const current = (value || '').trim()
    if (next !== current) {
      onSave?.(next)
    } else {
      setDraft(value || '')
    }
  }, [draft, value, onSave])

  const cancel = useCallback(() => {
    setDraft(value || '')
    setEditing(false)
  }, [value])

  const hasValue = (value || '').trim().length > 0

  // Masqué si lecture seule et vide
  if (!canEdit && !hasValue) return null

  return (
    <div
      className="px-4 py-2"
      style={{
        background: 'var(--bg-surf)',
        borderBottom: '1px solid var(--brd-sub)',
      }}
    >
      {editing && canEdit ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          autoFocus
          rows={1}
          placeholder="Description du bloc (contexte, notes de prépa…)"
          className="w-full text-xs bg-transparent focus:outline-none rounded px-2 py-1 resize-none"
          style={{
            color: 'var(--txt)',
            border: '1px solid var(--brd)',
            lineHeight: 1.5,
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => canEdit && setEditing(true)}
          disabled={!canEdit}
          className="w-full text-left text-xs rounded px-2 py-1 transition-colors"
          style={{
            color: hasValue ? 'var(--txt-2)' : 'var(--txt-3)',
            fontStyle: hasValue ? 'normal' : 'italic',
            cursor: canEdit ? 'text' : 'default',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.5,
            minHeight: '24px',
          }}
          onMouseEnter={(e) => {
            if (canEdit) e.currentTarget.style.background = 'var(--bg-hov)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
          title={canEdit ? 'Cliquer pour éditer la description' : undefined}
        >
          {hasValue ? value : canEdit ? 'Ajouter une description…' : ''}
        </button>
      )}
    </div>
  )
}

function IconBtn({ icon: Icon, label, onClick, danger = false }) {
  const hoverColor = danger ? 'var(--red)' : 'var(--txt)'
  const hoverBg = danger ? 'var(--red-bg)' : 'var(--bg-hov)'
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-md transition-all"
      style={{ color: 'var(--txt-3)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hoverColor
        e.currentTarget.style.background = hoverBg
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--txt-3)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}
