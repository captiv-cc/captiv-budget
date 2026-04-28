// ════════════════════════════════════════════════════════════════════════════
// LivrableBlockList — liste verticale des blocs + drag & drop reorder (LIV-6)
// ════════════════════════════════════════════════════════════════════════════
//
// Orchestre le rendu de tous les blocs d'un projet et capte le drag & drop
// entre blocs pour appeler `actions.reorderBlocks(orderedIds)` en un seul
// UPDATE batch.
//
// Pattern strictement identique à `features/materiel/components/BlockList` :
//   - `dragBlockIdx` (ref) : index source, capté au dragStart
//   - `dragOverBlockIdx` (state) : index survolé, pour l'outline bleu
//   - `handleReorderBlocks(fromIdx, toIdx)` : splice local + persist
//
// Props :
//   - blocks              : Array<livrable_blocks> triés par sort_order
//   - livrablesByBlock    : Map<blockId, livrable[]>
//   - versionsByLivrable  : Map<livrableId, version[]> (LIV-8)
//   - actions             : objet actions de useLivrables
//   - canEdit             : booléen
//   - onOpenVersions      : (livrable) => void (LIV-8 — drawer historique)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react'
import LivrableBlockCard from './LivrableBlockCard'
import { notify } from '../../../lib/notify'

export default function LivrableBlockList({
  blocks = [],
  livrablesByBlock,
  versionsByLivrable,
  actions,
  canEdit = true,
  onOpenVersions,
}) {
  // Drag & drop : ref pour l'index source (capté au dragStart), state pour
  // l'index survolé (rendu visuel). Pattern MAT-9D.
  const dragBlockIdx = useRef(null)
  const [dragOverBlockIdx, setDragOverBlockIdx] = useState(null)

  const handleReorderBlocks = useCallback(
    async (fromIdx, toIdx) => {
      if (fromIdx === toIdx) return
      if (fromIdx < 0 || toIdx < 0) return
      if (fromIdx >= blocks.length || toIdx >= blocks.length) return

      const next = blocks.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      const orderedIds = next.map((b) => b.id)

      try {
        await actions.reorderBlocks(orderedIds)
      } catch (err) {
        notify.error('Erreur réorganisation : ' + (err?.message || err))
      }
    },
    [actions, blocks],
  )

  return (
    <div className="space-y-4">
      {blocks.map((block, idx) => (
        <LivrableBlockCard
          key={block.id}
          block={block}
          livrables={livrablesByBlock?.get(block.id) || []}
          versionsByLivrable={versionsByLivrable}
          onOpenVersions={onOpenVersions}
          actions={actions}
          canEdit={canEdit}
          isDragOver={dragOverBlockIdx === idx}
          onBlockDragStart={() => {
            dragBlockIdx.current = idx
          }}
          onBlockDragOver={() => setDragOverBlockIdx(idx)}
          onBlockDrop={() => {
            if (dragBlockIdx.current !== null && dragBlockIdx.current !== idx) {
              handleReorderBlocks(dragBlockIdx.current, idx)
            }
            dragBlockIdx.current = null
            setDragOverBlockIdx(null)
          }}
          onBlockDragEnd={() => {
            dragBlockIdx.current = null
            setDragOverBlockIdx(null)
          }}
        />
      ))}
    </div>
  )
}
