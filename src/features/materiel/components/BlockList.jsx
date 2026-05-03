// ════════════════════════════════════════════════════════════════════════════
// BlockList — flux vertical des blocs de la version active + empty state
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche tous les blocs d'une version, empilés verticalement, suivis d'un
// bouton "+ Ajouter un bloc" qui ouvre un menu avec :
//
//   [Modèles rapides]          ← blocs "liste" (départements : CAMÉRA, LUM…)
//   [Configs caméra]           ← templates pré-remplis (CAM LIVE, CAM PUB)
//   [Vierge]                   ← bloc liste/config totalement vide
//
// Les templates créent un bloc `affichage='config'` + insèrent les items
// pré-remplis avec leur `label` (corps caméra, optique, etc.). Le titre est
// auto-numéroté via `nextTemplateTitle` (CAM LIVE 1, 2, 3…).
//
// Empty state quand la version n'a aucun bloc : gros CTA avec suggestions.
//
// Props :
//   - blocks, itemsByBlock, loueursByItem, loueursById, allLoueurs, orgId
//   - materielBdd, materielBddById
//   - actions, canEdit, detailed
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { Layers, Package, Plus, Video } from 'lucide-react'
import {
  MATOS_BLOCK_SUGGESTIONS,
  MATOS_BLOCK_TEMPLATES,
  nextTemplateTitle,
} from '../../../lib/materiel'
import { notify } from '../../../lib/notify'
import Block from './Block'

export default function BlockList({
  blocks = [],
  itemsByBlock,
  loueursByItem,
  loueursById,
  allLoueurs = [],
  orgId,
  materielBdd = [],
  actions,
  canEdit = true,
  detailed = false,
}) {
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // ─── DnD state ──────────────────────────────────────────────────────────
  // On gère 2 types de drag (mutuellement exclusifs) :
  //   - blocs : grip header → déplace le bloc complet
  //   - items : ligne d'item → déplace l'item (intra OU cross-bloc)
  //
  // L'état des items est lifted ICI (et plus dans Block.jsx) pour permettre
  // le drag cross-bloc : la source vient d'un bloc, la cible peut être un
  // autre bloc. Si on gardait l'état dans chaque Block, chacun ne saurait
  // que ses propres items et le hover/drop entre blocs ne marcherait pas.

  // Drag des blocs (inchangé).
  const dragBlockIdx = useRef(null)
  const [dragOverInfo, setDragOverInfo] = useState(null)

  // Drag des items.
  //   - itemDragSource (ref)   : { blockIdx, itemIdx, itemId } — capté au
  //                              dragstart d'un ItemRow.
  //   - itemDragOver (state)   : { blockIdx, itemIdx, position } — position
  //                              cible courante (= ligne d'insertion).
  // `dragKind` ('block' | 'item' | null) sert juste à empêcher la confusion
  // visuelle quand un item est dragué AU-DESSUS d'un autre bloc : la section
  // du bloc afficherait sinon ses propres indicateurs (block-reorder) en
  // plus de la ligne d'insertion item.
  const itemDragSource = useRef(null)
  const [itemDragOver, setItemDragOver] = useState(null)
  const dragKind = useRef(null)

  // Reorder blocs : splice local + persistance via actions.reorderBlocks.
  // `targetIdx` = idx du bloc survolé. `position` = 'before'|'after'.
  // On calcule l'index final puis on ajuste pour le shift causé par le
  // splice de retrait (si fromIdx < finalToIdx, l'index cible glisse de -1).
  const handleReorderBlocks = useCallback(
    async (fromIdx, targetIdx, position) => {
      if (fromIdx < 0 || targetIdx < 0) return
      if (fromIdx >= blocks.length || targetIdx >= blocks.length) return

      const finalToIdx = position === 'after' ? targetIdx + 1 : targetIdx
      const adjustedTo = fromIdx < finalToIdx ? finalToIdx - 1 : finalToIdx
      if (adjustedTo === fromIdx) return

      const next = blocks.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(adjustedTo, 0, moved)
      const orderedIds = next.map((b) => b.id)

      try {
        await actions.reorderBlocks(orderedIds)
      } catch (err) {
        notify.error('Erreur réorganisation : ' + (err?.message || err))
      }
    },
    [actions, blocks],
  )

  // Drop d'un item : décide entre intra-bloc (reorderItems) et cross-bloc
  // (moveItemAcrossBlocks). Calcule le nouvel ordre dans les deux cas et
  // gère l'ajustement d'index dû au splice de retrait préalable.
  const handleDropItem = useCallback(async () => {
    const source = itemDragSource.current
    const target = itemDragOver
    if (!source || !target) return

    const sourceBlock = blocks[source.blockIdx]
    const targetBlock = blocks[target.blockIdx]
    if (!sourceBlock || !targetBlock) return

    const sourceItems = itemsByBlock?.get(sourceBlock.id) || []
    const targetItems = itemsByBlock?.get(targetBlock.id) || []

    if (source.blockIdx === target.blockIdx) {
      // ── Cas 1 : intra-bloc (reorder) ─────────────────────────────────
      const finalToIdx =
        target.position === 'after' ? target.itemIdx + 1 : target.itemIdx
      const adjustedTo =
        source.itemIdx < finalToIdx ? finalToIdx - 1 : finalToIdx
      if (adjustedTo === source.itemIdx) return // no-op

      const next = sourceItems.slice()
      const [moved] = next.splice(source.itemIdx, 1)
      next.splice(adjustedTo, 0, moved)
      const orderedIds = next.map((i) => i.id)

      try {
        await actions.reorderItems(orderedIds)
      } catch (err) {
        notify.error('Erreur réorganisation : ' + (err?.message || err))
      }
    } else {
      // ── Cas 2 : cross-bloc (move) ────────────────────────────────────
      // Source : on retire l'item.
      const newSource = sourceItems.filter((_, idx) => idx !== source.itemIdx)
      const sourceOrderedIds = newSource.map((i) => i.id)

      // Target : on insère l'item au bon endroit.
      const finalToIdx =
        target.position === 'after' ? target.itemIdx + 1 : target.itemIdx
      const newTarget = targetItems.slice()
      newTarget.splice(finalToIdx, 0, sourceItems[source.itemIdx])
      const targetOrderedIds = newTarget.map((i) => i.id)

      try {
        await actions.moveItemAcrossBlocks({
          itemId: source.itemId,
          targetBlockId: targetBlock.id,
          sourceOrderedIds,
          targetOrderedIds,
        })
      } catch (err) {
        notify.error('Erreur déplacement : ' + (err?.message || err))
      }
    }
  }, [actions, blocks, itemsByBlock, itemDragOver])

  // Handlers item → exposés à Block.jsx (qui les transmet à ItemRow).
  const handleItemDragStart = useCallback((blockIdx, itemIdx, itemId) => {
    itemDragSource.current = { blockIdx, itemIdx, itemId }
    dragKind.current = 'item'
  }, [])

  const handleItemDragOver = useCallback((blockIdx, itemIdx, position) => {
    setItemDragOver((prev) =>
      prev?.blockIdx === blockIdx &&
      prev?.itemIdx === itemIdx &&
      prev?.position === position
        ? prev
        : { blockIdx, itemIdx, position },
    )
  }, [])

  const handleItemDragEnd = useCallback(() => {
    itemDragSource.current = null
    dragKind.current = null
    setItemDragOver(null)
  }, [])

  const handleItemDropFromBlock = useCallback(async () => {
    await handleDropItem()
    handleItemDragEnd()
  }, [handleDropItem, handleItemDragEnd])

  useEffect(() => {
    if (!addMenuOpen) return undefined
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAddMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [addMenuOpen])

  // ─── Create vierge (bouton "Modèles rapides" + "Bloc vierge") ───────────
  const handleCreateBlock = useCallback(
    async ({ titre, affichage = 'liste' } = {}) => {
      if (!canEdit) return
      try {
        await actions.createBlock({ titre: titre || 'Nouveau bloc', affichage })
        notify.success(`Bloc "${titre || 'Nouveau bloc'}" ajouté`)
        setAddMenuOpen(false)
      } catch (err) {
        notify.error('Erreur création bloc : ' + (err?.message || err))
      }
    },
    [actions, canEdit],
  )

  // ─── Create depuis template (CAM LIVE / CAM PUB) ─────────────────────────
  const handleCreateFromTemplate = useCallback(
    async (templateKey) => {
      if (!canEdit) return
      const template = MATOS_BLOCK_TEMPLATES[templateKey]
      if (!template) return
      const titre = nextTemplateTitle(blocks, template.titrePrefix)
      try {
        const block = await actions.createBlock({
          titre,
          affichage: template.affichage,
        })
        if (block) {
          // Insère les items pré-remplis en série (ordre préservé).
          for (let i = 0; i < template.itemLabels.length; i++) {
            await actions.createItem({
              blockId: block.id,
              data: {
                label: template.itemLabels[i],
                designation: '',
                quantite: 1,
                sort_order: i,
              },
            })
          }
        }
        notify.success(`Bloc "${titre}" ajouté (${template.itemLabels.length} items)`)
        setAddMenuOpen(false)
      } catch (err) {
        notify.error('Erreur création bloc : ' + (err?.message || err))
      }
    },
    [canEdit, actions, blocks],
  )

  // ─── Empty state ─────────────────────────────────────────────────────────
  if (blocks.length === 0) {
    return (
      <EmptyState
        canEdit={canEdit}
        onCreateBlock={handleCreateBlock}
        onCreateFromTemplate={handleCreateFromTemplate}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {blocks.map((block, idx) => (
        <Block
          key={block.id}
          block={block}
          items={itemsByBlock?.get(block.id) || []}
          loueursByItem={loueursByItem}
          loueursById={loueursById}
          allLoueurs={allLoueurs}
          orgId={orgId}
          materielBdd={materielBdd}
          actions={actions}
          canEdit={canEdit}
          detailed={detailed}
          // Drag bloc (inchangé)
          dragInsertPosition={
            dragOverInfo?.idx === idx ? dragOverInfo.position : null
          }
          onBlockDragStart={() => {
            dragBlockIdx.current = idx
            dragKind.current = 'block'
          }}
          onBlockDragOver={(position) => {
            // Si un item est en cours de drag, on ignore : c'est l'item DnD
            // qui pilote l'indicateur visuel (pas le block-reorder).
            if (dragKind.current === 'item') return
            setDragOverInfo((prev) =>
              prev?.idx === idx && prev?.position === position
                ? prev
                : { idx, position },
            )
          }}
          onBlockDrop={() => {
            if (dragBlockIdx.current !== null && dragOverInfo) {
              handleReorderBlocks(
                dragBlockIdx.current,
                dragOverInfo.idx,
                dragOverInfo.position,
              )
            }
            dragBlockIdx.current = null
            dragKind.current = null
            setDragOverInfo(null)
          }}
          onBlockDragEnd={() => {
            dragBlockIdx.current = null
            dragKind.current = null
            setDragOverInfo(null)
          }}
          // Drag item (lifted) — chaque ligne wire ses callbacks vers les
          // handlers parents pour permettre le cross-bloc.
          itemDragOverInfo={
            itemDragOver?.blockIdx === idx
              ? { idx: itemDragOver.itemIdx, position: itemDragOver.position }
              : null
          }
          onItemDragStart={(itemIdx, itemId) =>
            handleItemDragStart(idx, itemIdx, itemId)
          }
          onItemDragOver={(itemIdx, position) =>
            handleItemDragOver(idx, itemIdx, position)
          }
          onItemDrop={handleItemDropFromBlock}
          onItemDragEnd={handleItemDragEnd}
        />
      ))}

      {canEdit && (
        <div ref={menuRef} className="relative self-start">
          <button
            type="button"
            onClick={() => setAddMenuOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{
              color: 'var(--blue)',
              background: 'var(--blue-bg)',
              border: '1px dashed var(--blue)',
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Ajouter un bloc
          </button>

          {addMenuOpen && (
            <AddBlockMenu
              onSelect={handleCreateBlock}
              onSelectTemplate={handleCreateFromTemplate}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Menu déroulant "Ajouter un bloc" (3 sections : départements + configs + vierge)
// ═════════════════════════════════════════════════════════════════════════════

function AddBlockMenu({ onSelect, onSelectTemplate }) {
  return (
    <div
      className="absolute left-0 top-full mt-1 z-20 rounded-lg shadow-lg overflow-hidden"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        minWidth: '260px',
      }}
    >
      {/* Départements (liste vierges) */}
      <SectionHeader>Départements</SectionHeader>
      <div className="py-1">
        {MATOS_BLOCK_SUGGESTIONS.map((s) => (
          <MenuRow
            key={s.titre}
            icon={Package}
            iconColor="var(--blue)"
            label={s.titre}
            onClick={() => onSelect(s)}
          />
        ))}
      </div>

      {/* Configs caméra (templates pré-remplis) */}
      <SectionHeader>Configs caméra (pré-remplies)</SectionHeader>
      <div className="py-1">
        {Object.values(MATOS_BLOCK_TEMPLATES).map((t) => (
          <MenuRow
            key={t.key}
            icon={Video}
            iconColor="var(--amber, #f59e0b)"
            label={t.displayName}
            hint={`${t.itemLabels.length} labels`}
            onClick={() => onSelectTemplate(t.key)}
          />
        ))}
      </div>

      {/* Vierges (échappatoire) */}
      <div style={{ borderTop: '1px solid var(--brd-sub)' }} className="py-1">
        <MenuRow
          icon={Plus}
          iconColor="var(--blue)"
          label="Bloc vierge (liste)"
          bold
          onClick={() => onSelect({ titre: 'Nouveau bloc', affichage: 'liste' })}
        />
        <MenuRow
          icon={Video}
          iconColor="var(--amber, #f59e0b)"
          label="Bloc vierge (config caméra)"
          bold
          onClick={() => onSelect({ titre: 'Nouvelle config', affichage: 'config' })}
        />
      </div>
    </div>
  )
}

function SectionHeader({ children }) {
  return (
    <div
      className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
      style={{
        color: 'var(--txt-3)',
        borderBottom: '1px solid var(--brd-sub)',
        background: 'var(--bg-surf)',
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </div>
  )
}

function MenuRow({ icon: Icon, iconColor, label, hint, onClick, bold = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
      style={{
        color: 'var(--txt)',
        fontWeight: bold ? 600 : 400,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: iconColor }} />
      <span className="truncate flex-1">{label}</span>
      {hint && (
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </span>
      )}
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Empty state
// ═════════════════════════════════════════════════════════════════════════════

function EmptyState({ canEdit, onCreateBlock, onCreateFromTemplate }) {
  return (
    <div
      className="rounded-xl p-8 flex flex-col items-center text-center"
      style={{
        background: 'var(--bg-surf)',
        border: '1px dashed var(--brd)',
      }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
        style={{ background: 'var(--blue-bg)' }}
      >
        <Layers className="w-6 h-6" style={{ color: 'var(--blue)' }} />
      </div>
      <h3 className="text-base font-bold mb-1" style={{ color: 'var(--txt)' }}>
        Aucun bloc dans cette version
      </h3>
      <p className="text-xs mb-5 max-w-md" style={{ color: 'var(--txt-3)' }}>
        Démarre par un département (CAMÉRA, LUMIÈRE…) ou une config caméra
        pré-remplie (Cam live / Cam pub).
      </p>

      {canEdit ? (
        <div className="flex flex-col items-center gap-3 max-w-lg">
          {/* Départements */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {MATOS_BLOCK_SUGGESTIONS.map((s) => (
              <SuggestionButton
                key={s.titre}
                icon={Package}
                iconColor="var(--blue)"
                label={s.titre}
                onClick={() => onCreateBlock(s)}
              />
            ))}
          </div>
          {/* Templates */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {Object.values(MATOS_BLOCK_TEMPLATES).map((t) => (
              <SuggestionButton
                key={t.key}
                icon={Video}
                iconColor="var(--amber, #f59e0b)"
                label={t.displayName}
                onClick={() => onCreateFromTemplate(t.key)}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
          Tu n&apos;as pas les droits pour créer un bloc.
        </p>
      )}
    </div>
  )
}

function SuggestionButton({ icon: Icon, iconColor, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
      style={{
        background: 'var(--bg-elev)',
        color: 'var(--txt-2)',
        border: '1px solid var(--brd)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.color = 'var(--txt)'
        e.currentTarget.style.borderColor = iconColor
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-elev)'
        e.currentTarget.style.color = 'var(--txt-2)'
        e.currentTarget.style.borderColor = 'var(--brd)'
      }}
    >
      <Icon className="w-3 h-3" style={{ color: iconColor }} />
      {label}
    </button>
  )
}
