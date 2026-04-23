// ════════════════════════════════════════════════════════════════════════════
// ItemRowCard — variante mobile de ItemRow (layout flex-col, pas de <tr>)
// ════════════════════════════════════════════════════════════════════════════
//
// Au lieu d'une ligne de tableau à 7-9 colonnes qui forcerait un scroll
// horizontal sur mobile (<640px), on étale les champs verticalement dans une
// carte :
//
//   ┌─────────────────────────────────────────────────────┐
//   │ [🟢] Désignation..................................[⋯]│
//   │  Label            Qté                                │
//   │  LABEL            [ 2 ]                              │
//   │  [loueur1] [loueur2] [+ loueur]                      │
//   │  ── si detailed ─────────────────────────────────    │
//   │  ☐ Pré  ☐ Post  ☐ Prod                               │
//   │  Remarques : ____________________                    │
//   └─────────────────────────────────────────────────────┘
//
// Les subcomponents (FlagButton, DesignationAutocomplete, LoueurPillsEditor,
// ChecklistCells) sont identiques à ItemRow — on ne fait que changer la mise
// en page.
//
// Drag & drop : désactivé sur mobile (pas de hover + grip handle encombrant).
// Le réordonnancement se fera via un menu d'actions (futur MAT-RESP), ou en
// passant par l'admin desktop.
//
// Props : identiques à ItemRow (minus onDragStart/Over/Drop/End, isDragOver).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { notify } from '../../../lib/notify'
import FlagButton from './FlagButton'
import ChecklistCells from './ChecklistCells'
import DesignationAutocomplete from './DesignationAutocomplete'
import LoueurPillsEditor from './LoueurPillsEditor'

export default function ItemRowCard({
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
}) {
  const isConfig = blockAffichage === 'config'

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
  // Stratégie identique à ItemRow : commit sur onBlur, équivalence stricte
  // pour éviter les writes inutiles.
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

  return (
    <div
      className="flex flex-col gap-2 px-3 py-3"
      style={{
        borderBottom: '1px solid var(--brd-sub)',
        background: 'transparent',
      }}
    >
      {/* Ligne 1 : Flag + Désignation + bouton Supprimer (aligné à droite).
          La désignation prend toute la largeur restante via flex-1 min-w-0
          pour autoriser le truncate à l'intérieur de l'autocomplete. */}
      <div className="flex items-center gap-2">
        <FlagButton
          flag={item.flag || 'ok'}
          onChange={handleFlagChange}
          canEdit={canEdit}
          size="sm"
        />
        <div className="flex-1 min-w-0">
          <DesignationAutocomplete
            value={item.designation}
            materielBddId={item.materiel_bdd_id}
            materielBdd={materielBdd}
            onCommit={handleDesignationCommit}
            canEdit={canEdit}
            placeholder={isConfig ? 'ex. Sony FX6' : 'Désignation'}
          />
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={handleDelete}
            title="Supprimer l'item"
            aria-label="Supprimer"
            className="p-1.5 rounded transition-all shrink-0"
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
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Ligne 2 : Label + Quantité, côte à côte. Label flex-1 pour remplir,
          Qté en w-20 pour rester compact. */}
      <div className="flex items-center gap-2">
        <label
          className="flex-1 min-w-0 flex items-center gap-2 text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
        >
          <span className="shrink-0">Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => saveField('label', label.trim() || null)}
            disabled={!canEdit}
            placeholder="label…"
            className="flex-1 min-w-0 bg-transparent focus:outline-none text-xs font-semibold uppercase tracking-wider placeholder:normal-case placeholder:font-normal placeholder:italic placeholder:tracking-normal placeholder:text-[color:var(--txt-3)] placeholder:opacity-70"
            style={{
              color: 'var(--txt-2)',
              cursor: canEdit ? 'text' : 'default',
              letterSpacing: '0.05em',
            }}
          />
        </label>
        <label
          className="flex items-center gap-2 text-[10px] uppercase tracking-wider shrink-0"
          style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
        >
          <span>Qté</span>
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
            className="w-14 text-center bg-transparent focus:outline-none rounded py-1"
            style={{
              color: 'var(--txt)',
              cursor: canEdit ? 'text' : 'default',
              border: '1px solid var(--brd-sub)',
            }}
          />
        </label>
      </div>

      {/* Ligne 3 : Loueurs (pills). Le composant gère déjà son wrap interne. */}
      <div className="flex items-start gap-2">
        <span
          className="text-[10px] uppercase tracking-wider pt-1 shrink-0"
          style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
        >
          Loueurs
        </span>
        <div className="flex-1 min-w-0">
          <LoueurPillsEditor
            itemId={item.id}
            loueurs={loueurs}
            allLoueurs={allLoueurs}
            loueursById={loueursById}
            actions={actions}
            orgId={orgId}
            canEdit={canEdit}
          />
        </div>
      </div>

      {/* Détaillé : Pré/Post/Prod + Remarques, regroupés dans un bandeau
          visuellement séparé pour structurer le scan mobile. */}
      {detailed && (
        <div
          className="flex flex-col gap-2 pt-2 mt-1"
          style={{ borderTop: '1px dashed var(--brd-sub)' }}
        >
          <div className="flex items-center gap-3">
            <span
              className="text-[10px] uppercase tracking-wider shrink-0"
              style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
            >
              Pré · Post · Prod
            </span>
            <ChecklistCells
              item={item}
              onToggle={handleToggleCheck}
              canEdit={canEdit}
            />
          </div>
          <label
            className="flex items-start gap-2 text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
          >
            <span className="pt-1 shrink-0">Remarques</span>
            <input
              type="text"
              value={remarques}
              placeholder="—"
              onChange={(e) => setRemarques(e.target.value)}
              onBlur={() => saveField('remarques', remarques || null)}
              disabled={!canEdit}
              className="flex-1 min-w-0 bg-transparent focus:outline-none text-xs placeholder:text-[color:var(--txt-3)]"
              style={{
                color: 'var(--txt-2)',
                cursor: canEdit ? 'text' : 'default',
                border: '1px solid var(--brd-sub)',
                padding: '4px 8px',
                borderRadius: '4px',
                textTransform: 'none',
                letterSpacing: 'normal',
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}
