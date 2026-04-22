/**
 * AddItemForm — formulaire d'ajout d'un "additif" dans un bloc (MAT-10F).
 *
 * Compact, inline en bas de la liste d'items. 2 champs : désignation + quantité.
 * Se replie en bouton "+ Ajouter un additif" quand inactif pour ne pas
 * encombrer la checklist quand on ne s'en sert pas.
 *
 *   ── replié ────────────────────────────────────────
 *   ┌───────────────────────────────────────────┐
 *   │  +  Ajouter un additif                    │
 *   └───────────────────────────────────────────┘
 *
 *   ── déplié ────────────────────────────────────────
 *   ┌───────────────────────────────────────────┐
 *   │  Désignation (ex. Bras magique 1m)        │
 *   │  Quantité  [ 1 ]                          │
 *   │  [Annuler]                [+ Ajouter]     │
 *   └───────────────────────────────────────────┘
 */

import { useState, useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'

export default function AddItemForm({ blockId, onAdd }) {
  const [open, setOpen] = useState(false)
  const [designation, setDesignation] = useState('')
  const [quantite, setQuantite] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  // Focus auto à l'ouverture pour enchaîner la saisie immédiatement.
  useEffect(() => {
    if (open) {
      // Petit setTimeout pour laisser React rendre l'input avant de focus.
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open])

  function reset() {
    setDesignation('')
    setQuantite(1)
    setOpen(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = designation.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await onAdd({ blockId, designation: trimmed, quantite: Math.max(1, Number(quantite) || 1) })
      reset()
    } catch (err) {
      console.error('[AddItemForm] ajout failed', err)
      // On laisse le form ouvert avec les valeurs saisies pour retry.
    } finally {
      setSubmitting(false)
    }
  }

  // ── État replié : juste le bouton d'ouverture ───────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm border-t"
        style={{
          color: 'var(--txt-2)',
          borderColor: 'var(--brd-sub)',
          background: 'transparent',
        }}
      >
        <Plus className="w-4 h-4" />
        Ajouter un additif
      </button>
    )
  }

  // ── État déplié : le formulaire ─────────────────────────────────────────
  return (
    <form
      onSubmit={handleSubmit}
      className="px-4 py-3 border-t space-y-3"
      style={{
        borderColor: 'var(--brd-sub)',
        background: 'var(--bg)',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={designation}
        onChange={(e) => setDesignation(e.target.value)}
        placeholder="Désignation (ex. Bras magique 1m)"
        className="w-full px-3 py-2.5 rounded-md text-sm"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          color: 'var(--txt)',
        }}
      />

      <div className="flex items-center gap-3">
        <label className="text-xs" style={{ color: 'var(--txt-3)' }}>
          Quantité
        </label>
        <input
          type="number"
          min="1"
          value={quantite}
          onChange={(e) => setQuantite(e.target.value)}
          className="w-20 px-3 py-2 rounded-md text-sm tabular-nums"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="px-3 py-2 rounded-md text-sm flex items-center gap-1"
          style={{
            color: 'var(--txt-2)',
            background: 'transparent',
          }}
        >
          <X className="w-4 h-4" />
          Annuler
        </button>
        <button
          type="submit"
          disabled={!designation.trim() || submitting}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1 disabled:opacity-40"
          style={{
            background: 'var(--acc)',
            color: '#000',
          }}
        >
          <Plus className="w-4 h-4" />
          {submitting ? 'Ajout…' : 'Ajouter'}
        </button>
      </div>
    </form>
  )
}
