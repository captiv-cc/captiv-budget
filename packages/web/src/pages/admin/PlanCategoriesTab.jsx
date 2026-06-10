// ════════════════════════════════════════════════════════════════════════════
// PlanCategoriesTab — Settings admin org : gestion des catégories de plans
// ════════════════════════════════════════════════════════════════════════════
//
// Accessible depuis Paramètres > Catégories de plans (admin org uniquement,
// gating au niveau de la route Settings parent).
//
// Permet à l'admin org de :
//   - Lister les 10 catégories par défaut + custom
//   - Renommer une catégorie inline (commit au blur ou Enter)
//   - Changer la couleur (input type=color natif)
//   - Réordonner par drag & drop (HTML5 native, pattern aligné Block.jsx)
//   - Archiver / Restaurer (soft archive — les plans existants conservent
//     leur catégorie, qui apparaît grisée "(archivée)" mais filtre toujours)
//   - Créer une nouvelle catégorie (modale prompt simple)
//
// Indicateur "(par défaut)" : sur les 10 catégories seedées par Captiv, juste
// informatif — aucune restriction de modif/archive.
// ════════════════════════════════════════════════════════════════════════════

import { useRef, useState } from 'react'
import {
  ChevronDown,
  Edit3,
  GripVertical,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import usePlanCategories from '../../hooks/usePlanCategories'
import { notify } from '../../lib/notify'
import { confirm, prompt } from '../../lib/confirm'

export default function PlanCategoriesTab() {
  const { org } = useAuth()
  const orgId = org?.id

  const { categories, loading, actions } = usePlanCategories({
    orgId,
    includeArchived: true,
  })

  // Sépare actives / archivées (et trie par sort_order respectif).
  const active = categories.filter((c) => !c.is_archived)
  const archived = categories.filter((c) => c.is_archived)

  const [showArchived, setShowArchived] = useState(false)

  // Drag & drop state — index source capturé au dragstart, index survolé en
  // state pour la ligne d'insertion. Pattern aligné sur Block.jsx (matos).
  const dragIdx = useRef(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  async function handleReorder(fromIdx, toIdx) {
    if (fromIdx === toIdx) return
    if (fromIdx < 0 || toIdx < 0) return
    if (fromIdx >= active.length || toIdx >= active.length) return
    const next = active.slice()
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    const orderedIds = next.map((c) => c.id)
    try {
      await actions.reorderCategories(orderedIds)
    } catch (err) {
      notify.error('Erreur réorganisation : ' + (err?.message || err))
    }
  }

  async function handleCreate() {
    const label = await prompt({
      title: 'Nouvelle catégorie',
      message: 'Nom de la catégorie (ex : Pyrotechnie, Régie son live…)',
      placeholder: 'Nom',
      required: true,
      confirmLabel: 'Créer',
    })
    if (!label) return
    try {
      await actions.createCategory({
        label,
        // Couleur par défaut neutre — l'admin pourra changer après création.
        color: '#5c5c5c',
      })
      notify.success(`Catégorie « ${label} » créée`)
    } catch (err) {
      notify.error('Erreur création : ' + (err?.message || err))
    }
  }

  async function handleArchive(cat) {
    const ok = await confirm({
      title: `Archiver « ${cat.label} » ?`,
      message:
        "La catégorie disparaîtra du dropdown de création. Les plans existants la conservent (affichée « archivée »). Tu pourras la restaurer.",
      confirmLabel: 'Archiver',
      danger: true,
    })
    if (!ok) return
    try {
      await actions.archiveCategory(cat.id)
      notify.success('Catégorie archivée')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  async function handleRestore(cat) {
    try {
      await actions.restoreCategory(cat.id)
      notify.success('Catégorie restaurée')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  if (!orgId) {
    return (
      <div className="text-sm" style={{ color: 'var(--txt-3)' }}>
        Aucune organisation chargée.
      </div>
    )
  }

  if (loading && categories.length === 0) {
    return (
      <div className="text-sm" style={{ color: 'var(--txt-3)' }}>
        Chargement…
      </div>
    )
  }

  return (
    <div>
      {/* Intro */}
      <div className="mb-5 max-w-2xl">
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          Catégories utilisées dans la tab <strong>Plans</strong> de chaque
          projet. 10 catégories par défaut sont seedées automatiquement à la
          création de l&apos;organisation. Tu peux les renommer, en ajouter,
          en archiver ou les réorganiser librement — les modifications
          s&apos;appliquent à tous les projets de l&apos;organisation.
        </p>
      </div>

      {/* Liste actives */}
      <section
        className="mb-6 rounded-lg overflow-hidden"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
        }}
      >
        <header
          className="flex items-center justify-between px-4 py-2.5"
          style={{
            background: 'var(--bg-elev)',
            borderBottom: '1px solid var(--brd-sub)',
          }}
        >
          <h3
            className="text-[11px] uppercase tracking-wider font-semibold"
            style={{ color: 'var(--txt-3)' }}
          >
            Actives · {active.length}
          </h3>
          <button
            type="button"
            onClick={handleCreate}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md"
            style={{ background: 'var(--blue)', color: 'white' }}
          >
            <Plus className="w-3 h-3" />
            Nouvelle catégorie
          </button>
        </header>

        {active.length === 0 ? (
          <p
            className="px-4 py-6 text-sm text-center"
            style={{ color: 'var(--txt-3)' }}
          >
            Aucune catégorie active. Crée-en une pour commencer.
          </p>
        ) : (
          <ul>
            {active.map((cat, idx) => (
              <CategoryRow
                key={cat.id}
                cat={cat}
                isLast={idx === active.length - 1}
                isDragOver={dragOverIdx === idx}
                onDragStart={() => {
                  dragIdx.current = idx
                }}
                onDragOver={() => setDragOverIdx(idx)}
                onDrop={() => {
                  if (dragIdx.current !== null && dragIdx.current !== idx) {
                    handleReorder(dragIdx.current, idx)
                  }
                  dragIdx.current = null
                  setDragOverIdx(null)
                }}
                onDragEnd={() => {
                  dragIdx.current = null
                  setDragOverIdx(null)
                }}
                onUpdate={(fields) => actions.updateCategory(cat.id, fields)}
                onArchive={() => handleArchive(cat)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Liste archivées (collapsable) */}
      {archived.length > 0 && (
        <section
          className="rounded-lg overflow-hidden"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
          }}
        >
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left"
            style={{
              background: 'var(--bg-elev)',
              borderBottom: showArchived
                ? '1px solid var(--brd-sub)'
                : '1px solid transparent',
            }}
          >
            <h3
              className="flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold"
              style={{ color: 'var(--txt-3)' }}
            >
              <ChevronDown
                className="w-3 h-3 transition-transform"
                style={{
                  transform: showArchived ? 'rotate(0deg)' : 'rotate(-90deg)',
                }}
              />
              Archivées · {archived.length}
            </h3>
          </button>
          {showArchived && (
            <ul>
              {archived.map((cat, idx) => (
                <ArchivedRow
                  key={cat.id}
                  cat={cat}
                  isLast={idx === archived.length - 1}
                  onRestore={() => handleRestore(cat)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function CategoryRow({
  cat,
  isLast,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onUpdate,
  onArchive,
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(cat.label || '')

  function commitLabel() {
    const trimmed = label.trim()
    setEditing(false)
    if (!trimmed || trimmed === cat.label) {
      setLabel(cat.label || '')
      return
    }
    onUpdate({ label: trimmed }).catch((err) => {
      notify.error('Erreur : ' + (err?.message || err))
      setLabel(cat.label || '')
    })
  }

  function commitColor(e) {
    const newColor = e.target.value
    if (newColor === cat.color) return
    onUpdate({ color: newColor }).catch((err) => {
      notify.error('Erreur : ' + (err?.message || err))
    })
  }

  return (
    <li
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver?.()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop?.()
      }}
      onDragEnd={onDragEnd}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors"
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--brd-sub)',
        background: isDragOver ? 'var(--bg-hov)' : 'transparent',
        outline: isDragOver ? '2px solid var(--blue)' : 'none',
        outlineOffset: '-2px',
      }}
    >
      {/* Drag handle */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          try {
            e.dataTransfer.setData('text/plain', `plan-cat:${cat.id}`)
          } catch {
            /* noop */
          }
          onDragStart?.()
        }}
        className="p-1 -ml-1 rounded shrink-0"
        style={{ cursor: 'grab', color: 'var(--txt-3)' }}
        title="Glisser pour réordonner"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* Color picker (input type=color natif) */}
      <label
        className="relative w-7 h-7 rounded-full shrink-0 cursor-pointer"
        style={{
          background: cat.color,
          border: '2px solid var(--bg-surf)',
          boxShadow: '0 0 0 1px var(--brd)',
        }}
        title="Cliquer pour changer la couleur"
      >
        <input
          type="color"
          defaultValue={cat.color}
          onBlur={commitColor}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>

      {/* Label (édition inline) */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setLabel(cat.label || '')
                setEditing(false)
              }
            }}
            autoFocus
            className="w-full text-sm px-2 py-1 rounded outline-none"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt)',
              border: '1px solid var(--blue)',
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-left truncate flex items-center gap-1.5"
            style={{ color: 'var(--txt)' }}
            title="Cliquer pour renommer"
          >
            <span className="truncate">{cat.label}</span>
            {cat.is_default && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                style={{ background: 'var(--bg-hov)', color: 'var(--txt-3)' }}
              >
                par défaut
              </span>
            )}
            <Edit3
              className="w-3 h-3 opacity-0 group-hover:opacity-60"
              style={{ color: 'var(--txt-3)' }}
            />
          </button>
        )}
      </div>

      {/* Actions */}
      <button
        type="button"
        onClick={onArchive}
        className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded shrink-0 transition-colors"
        style={{
          color: 'var(--txt-3)',
          background: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
          e.currentTarget.style.color = 'var(--orange)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--txt-3)'
        }}
        title="Archiver"
      >
        <Trash2 className="w-3 h-3" />
        Archiver
      </button>
    </li>
  )
}

function ArchivedRow({ cat, isLast, onRestore }) {
  return (
    <li
      className="flex items-center gap-3 px-4 py-2.5"
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--brd-sub)',
        opacity: 0.7,
      }}
    >
      <Tag className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: cat.color }}
      />
      <span
        className="flex-1 min-w-0 text-sm truncate"
        style={{ color: 'var(--txt-2)' }}
      >
        {cat.label}
      </span>
      <button
        type="button"
        onClick={onRestore}
        className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-colors"
        style={{ color: 'var(--blue)', background: 'transparent' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--blue-bg)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <RotateCcw className="w-3 h-3" />
        Restaurer
      </button>
    </li>
  )
}
