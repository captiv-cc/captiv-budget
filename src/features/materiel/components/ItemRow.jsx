// ════════════════════════════════════════════════════════════════════════════
// ItemRow — ligne d'item matériel (polymorphe)
// ════════════════════════════════════════════════════════════════════════════
//
// Un seul composant qui rend une ligne d'item quel que soit le mode du bloc :
//
//   - Mode "liste"  : [Flag] [Désignation] [Qté] [Loueurs] (+ Remarques en détaillé)
//   - Mode "config" : [Flag] [Label : Désignation] [Qté] [Loueurs] (+ Remarques en détaillé)
//                      Le label (ex. "Boîtier") est la colonne de gauche, séparée
//                      par " : " visuellement. Pour CAM configs.
//
// Le toggle global `detailed` (géré dans MaterielTab → passé ici) ajoute les
// colonnes Pré/Post/Prod + Remarques.
//
// Sauvegarde :
//   - Tous les champs sont en édition inline (onBlur ou Enter commit)
//   - Le Flag est cyclique (clic sur la pastille)
//   - Les checklist toggles sont directs
//
// Props :
//   - item, blockAffichage : 'liste' | 'config'
//   - loueurs, loueursById, allLoueurs, orgId
//   - materielBdd, materielBddById
//   - actions, canEdit
//   - detailed : boolean (affiche les colonnes Pré/Post/Prod + Remarques)
//   - onDelete(itemId) : handler de suppression (remonté pour confirm global)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { GripVertical, Trash2 } from 'lucide-react'
import { notify } from '../../../lib/notify'
import FlagButton from './FlagButton'
import ChecklistCells from './ChecklistCells'
import DesignationAutocomplete from './DesignationAutocomplete'
import LoueurPillsEditor from './LoueurPillsEditor'

export default function ItemRow({
  item,
  blockAffichage = 'liste',
  loueurs = [],
  loueursById,
  allLoueurs = [],
  orgId,
  materielBdd = [],
  actions,
  canEdit = true,
  detailed = false,
  onDelete,
  // ─── Drag & drop (pattern aligné sur Block / BlockList) ─────────────────
  // dragInsertPosition = 'before' | 'after' | null : indique où la ligne
  // d'insertion bleue doit s'afficher (au-dessus / en-dessous / nulle part).
  // Calculée par le parent (Block) via clientY vs middle of bounding rect
  // dans handleItemDragOver.
  dragInsertPosition = null,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const isConfig = blockAffichage === 'config'

  // États locaux : label, qté, remarques (la designation a son propre composant).
  const [label, setLabel] = useState(item.label || '')
  const [quantite, setQuantite] = useState(item.quantite ?? 1)
  const [remarques, setRemarques] = useState(item.remarques || '')

  useEffect(() => {
    setLabel(item.label || '')
  }, [item.label])
  useEffect(() => {
    setQuantite(item.quantite ?? 1)
  }, [item.quantite])
  useEffect(() => {
    setRemarques(item.remarques || '')
  }, [item.remarques])

  // ─── Handlers ────────────────────────────────────────────────────────────
  const saveField = useCallback(
    async (field, value) => {
      if (!canEdit) return
      if (value === (item[field] ?? '')) return
      try {
        await actions.updateItem(item.id, { [field]: value })
      } catch (err) {
        notify.error('Erreur sauvegarde : ' + (err?.message || err))
      }
    },
    [actions, canEdit, item],
  )

  const handleDesignationCommit = useCallback(
    async ({ designation, materiel_bdd_id }) => {
      if (!canEdit) return
      const sameText = designation === item.designation
      const sameBdd = (materiel_bdd_id || null) === (item.materiel_bdd_id || null)
      if (sameText && sameBdd) return
      try {
        await actions.updateItem(item.id, {
          designation,
          materiel_bdd_id: materiel_bdd_id || null,
        })
      } catch (err) {
        notify.error('Erreur sauvegarde : ' + (err?.message || err))
      }
    },
    [actions, canEdit, item.id, item.designation, item.materiel_bdd_id],
  )

  const handleFlagChange = useCallback(
    async (next) => {
      if (!canEdit) return
      try {
        await actions.setFlag(item.id, next)
      } catch (err) {
        notify.error('Erreur changement flag : ' + (err?.message || err))
      }
    },
    [actions, canEdit, item.id],
  )

  const handleToggleCheck = useCallback(
    async (type) => {
      if (!canEdit) return
      try {
        await actions.toggleCheck(item.id, type)
      } catch (err) {
        notify.error('Erreur check : ' + (err?.message || err))
      }
    },
    [actions, canEdit, item.id],
  )

  const handleDelete = useCallback(() => {
    if (!canEdit) return
    if (onDelete) onDelete(item)
  }, [canEdit, item, onDelete])

  // ─── Rendu ───────────────────────────────────────────────────────────────
  // Drag & drop : activé uniquement si canEdit ET si les handlers sont fournis.
  // On ne pose `draggable` que dans ce cas pour éviter les drags accidentels
  // sur les lignes en lecture seule (partage client, rôle Visiteur…).
  const dndEnabled = canEdit && Boolean(onDragStart)

  // Calcule la position relative du curseur dans la ligne pour afficher la
  // ligne d'insertion (above/below mid-line) — pattern identique à Block.
  const computeInsertPosition = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetY = e.clientY - rect.top
    return offsetY < rect.height / 2 ? 'before' : 'after'
  }

  // Indicateur d'insertion : box-shadow externe 3px bleu au-dessus si on
  // drop avant, en-dessous si on drop après. Fonctionne sur <tr> en mode
  // border-collapse: separate (défaut sans tailwind class).
  const insertShadow =
    dragInsertPosition === 'before'
      ? '0 -3px 0 0 var(--blue)'
      : dragInsertPosition === 'after'
        ? '0 3px 0 0 var(--blue)'
        : 'none'

  return (
    <tr
      draggable={dndEnabled}
      onDragStart={
        dndEnabled
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move'
              onDragStart?.()
            }
          : undefined
      }
      onDragOver={
        dndEnabled
          ? (e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              onDragOver?.(computeInsertPosition(e))
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
      style={{
        borderBottom: '1px solid var(--brd-sub)',
        boxShadow: insertShadow,
        transition: 'box-shadow 100ms ease',
      }}
    >
      {/* Grip drag handle */}
      <td
        className="px-1 py-1.5 align-middle text-center select-none"
        style={{
          width: '20px',
          color: 'var(--txt-3)',
          cursor: dndEnabled ? 'grab' : 'default',
        }}
        title={dndEnabled ? 'Glisser pour réordonner' : undefined}
      >
        {dndEnabled && <GripVertical className="w-3 h-3 mx-auto opacity-40" />}
      </td>

      {/* Flag */}
      <td className="px-2 py-1.5 align-middle text-center">
        <FlagButton
          flag={item.flag || 'ok'}
          onChange={handleFlagChange}
          canEdit={canEdit}
          size="sm"
        />
      </td>

      {/* Label — affiché sur tous les modes (liste ET config). Le placeholder
          italique + normalisé (casse, tracking) permet de distinguer
          visuellement un label vide d'un vrai label rempli.

          Historiquement la colonne était réservée aux blocs 'config' (CAM),
          mais elle est utile aussi sur les listes classiques pour structurer
          (ex. "Body" / "Optiques" / "Accessoires") — MAT-16. */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '120px' }}>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => saveField('label', label.trim() || null)}
          disabled={!canEdit}
          placeholder="label…"
          className="w-full bg-transparent focus:outline-none text-xs font-semibold uppercase tracking-wider placeholder:normal-case placeholder:font-normal placeholder:italic placeholder:tracking-normal placeholder:text-[color:var(--txt-3)] placeholder:opacity-70"
          style={{
            color: 'var(--txt-2)',
            cursor: canEdit ? 'text' : 'default',
            letterSpacing: '0.05em',
          }}
        />
      </td>

      {/* Designation + autocomplete */}
      <td className="px-2 py-1.5 align-middle">
        <DesignationAutocomplete
          value={item.designation}
          materielBddId={item.materiel_bdd_id}
          materielBdd={materielBdd}
          onCommit={handleDesignationCommit}
          canEdit={canEdit}
          placeholder={isConfig ? 'ex. Sony FX6' : 'Désignation'}
        />
      </td>

      {/* Quantité */}
      <td className="px-2 py-1.5 align-middle text-center" style={{ width: '56px' }}>
        <input
          type="number"
          min="1"
          value={quantite}
          onChange={(e) => setQuantite(e.target.value)}
          onBlur={() => {
            const n = parseInt(quantite, 10)
            if (Number.isFinite(n) && n >= 1) saveField('quantite', n)
            else setQuantite(item.quantite ?? 1)
          }}
          disabled={!canEdit}
          className="w-12 text-center bg-transparent focus:outline-none rounded"
          style={{
            color: 'var(--txt)',
            cursor: canEdit ? 'text' : 'default',
            border: '1px solid transparent',
          }}
        />
      </td>

      {/* Loueurs */}
      <td className="px-2 py-1.5 align-middle" style={{ width: '220px' }}>
        <LoueurPillsEditor
          itemId={item.id}
          loueurs={loueurs}
          allLoueurs={allLoueurs}
          loueursById={loueursById}
          actions={actions}
          orgId={orgId}
          canEdit={canEdit}
        />
      </td>

      {/* Détaillé : Pré/Post/Prod */}
      {detailed && (
        <td className="px-2 py-1.5 align-middle text-center" style={{ width: '110px' }}>
          <ChecklistCells item={item} onToggle={handleToggleCheck} canEdit={canEdit} />
        </td>
      )}

      {/* Détaillé : Remarques */}
      {detailed && (
        <td className="px-2 py-1.5 align-middle" style={{ width: '200px' }}>
          <input
            type="text"
            value={remarques}
            placeholder="—"
            onChange={(e) => setRemarques(e.target.value)}
            onBlur={() => saveField('remarques', remarques || null)}
            disabled={!canEdit}
            className="w-full bg-transparent focus:outline-none text-xs"
            style={{
              color: 'var(--txt-2)',
              cursor: canEdit ? 'text' : 'default',
            }}
          />
        </td>
      )}

      {/* Actions */}
      <td className="px-2 py-1.5 align-middle text-center" style={{ width: '32px' }}>
        {canEdit && (
          <button
            type="button"
            onClick={handleDelete}
            title="Supprimer l'item"
            aria-label="Supprimer"
            className="p-1 rounded transition-all"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--red)'
              e.currentTarget.style.background = 'var(--red-bg)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--txt-3)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}
