/**
 * CheckBlockCard — carte d'un bloc de matériel dans la checklist terrain
 * (MAT-10E + MAT-10F).
 *
 * Rend un header coloré (titre + progression) + la liste des items cliquables
 * + une section "Additifs" séparée pour les items ajoutés pendant les essais
 * (added_during_check=true) + un formulaire d'ajout inline en bas.
 *
 * Quand tous les items (base + additifs) sont checkés, un bandeau vert est
 * ajouté en haut pour signaler visuellement "bloc validé".
 *
 *   ┌───────────────────────────────────────────┐
 *   │ ✓ BLOC VALIDÉ                             │  ← bandeau si allChecked
 *   │───────────────────────────────────────────│
 *   │ CAM LIVE 1              7/10 validés  ▓▓▓ │  ← header
 *   │───────────────────────────────────────────│
 *   │ ⬜ Corps caméra · ARRI                    │
 *   │ ✅ Optique · ZEISS                        │  ← items de base
 *   │ ...                                       │
 *   │─── Additifs (ajoutés pendant les essais) ─│
 *   │ ⬜ Bras magique · Ajouté par Camille      │  ← items added_during_check
 *   │───────────────────────────────────────────│
 *   │ + Ajouter un additif                      │  ← AddItemForm
 *   └───────────────────────────────────────────┘
 */

import { Check } from 'lucide-react'
import CheckItemRow from './CheckItemRow'
import AddItemForm from './AddItemForm'

export default function CheckBlockCard({
  block,
  items,
  progress,
  commentsByItem,
  // MAT-10O : index item_id → [loueurs]. Injecté depuis CheckSession pour
  // afficher les pastilles loueurs sur chaque ligne (read-only). Le parent
  // peut passer `null`/`undefined` si aucun tagging n'est activé.
  loueursByItem = null,
  onToggleItem,
  onAddItem,
  onAddComment,
  onSetRemoved,
  onDeleteAdditif,
}) {
  const { total = 0, checked = 0, ratio = 0, allChecked = false } = progress || {}
  const pct = Math.round(ratio * 100)

  // Sépare les items de base vs les additifs ajoutés pendant les essais.
  // Les additifs apparaissent dans une section dédiée en bas.
  const baseItems = items.filter((it) => !it.added_during_check)
  const additifItems = items.filter((it) => it.added_during_check)

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: `1px solid ${allChecked ? 'var(--green)' : 'var(--brd)'}`,
        transition: 'border-color 180ms',
      }}
    >
      {/* Bandeau "bloc validé" — apparaît seulement quand tout est coché ─── */}
      {allChecked && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
          style={{
            background: 'var(--green)',
            color: '#0a2e1a',
          }}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
          Bloc validé
        </div>
      )}

      {/* Header : titre + progression ────────────────────────────────────── */}
      <header
        className="px-4 py-3 flex items-center gap-3 border-b"
        style={{
          background: block.couleur ? `${block.couleur}14` : 'transparent',
          borderColor: 'var(--brd-sub)',
        }}
      >
        <div className="flex-1 min-w-0">
          <h2
            className="text-sm font-semibold uppercase tracking-wide truncate"
            style={{ color: 'var(--txt)' }}
          >
            {block.titre || 'Bloc'}
          </h2>
          {block.description && (
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--txt-3)' }}>
              {block.description}
            </p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-3">
          <span className="text-xs tabular-nums" style={{ color: 'var(--txt-2)' }}>
            {checked}/{total}
          </span>
          <div
            className="h-1.5 w-16 rounded-full overflow-hidden"
            style={{ background: 'var(--bg)' }}
          >
            <div
              className="h-full"
              style={{
                width: `${pct}%`,
                background: allChecked ? 'var(--green)' : 'var(--blue)',
                transition: 'width 220ms ease-out, background 220ms',
              }}
            />
          </div>
        </div>
      </header>

      {/* Items de base ────────────────────────────────────────────────────── */}
      {baseItems.length === 0 && additifItems.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--txt-3)' }}>
          Aucun item dans ce bloc.
        </div>
      ) : (
        <div>
          {baseItems.map((it) => (
            <CheckItemRow
              key={it.id}
              item={it}
              comments={commentsByItem?.get(it.id) || []}
              loueurs={loueursByItem?.get(it.id) || []}
              onToggle={onToggleItem}
              onAddComment={onAddComment}
              onSetRemoved={onSetRemoved}
              // onDeleteAdditif volontairement omis : pas de hard-delete sur
              // les items de base (ils doivent rester pour l'audit & le bilan).
            />
          ))}
        </div>
      )}

      {/* Section additifs ─────────────────────────────────────────────────── */}
      {additifItems.length > 0 && (
        <>
          <div
            className="px-4 py-2 text-xs font-medium uppercase tracking-wide border-t border-b"
            style={{
              color: 'var(--purple)',
              background: 'var(--purple-bg)',
              borderColor: 'var(--purple-brd)',
            }}
          >
            Additifs · ajoutés pendant les essais
          </div>
          <div>
            {additifItems.map((it) => (
              <CheckItemRow
                key={it.id}
                item={it}
                comments={commentsByItem?.get(it.id) || []}
                loueurs={loueursByItem?.get(it.id) || []}
                onToggle={onToggleItem}
                onAddComment={onAddComment}
                onSetRemoved={onSetRemoved}
                onDeleteAdditif={onDeleteAdditif}
                showAddedBy
              />
            ))}
          </div>
        </>
      )}

      {/* Formulaire d'ajout d'additif ─────────────────────────────────────── */}
      <AddItemForm blockId={block.id} onAdd={onAddItem} />
    </section>
  )
}
