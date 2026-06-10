/**
 * AddItemForm — formulaire d'ajout d'un "additif" dans un bloc (MAT-10F / MAT-19).
 *
 * Compact, inline en bas de la liste d'items. Se replie en bouton
 * "+ Ajouter un additif" quand inactif pour ne pas encombrer la checklist.
 *
 *   ── replié ────────────────────────────────────────
 *   ┌───────────────────────────────────────────┐
 *   │  +  Ajouter un additif                    │
 *   └───────────────────────────────────────────┘
 *
 *   ── déplié (MAT-19) ───────────────────────────────
 *   ┌───────────────────────────────────────────────┐
 *   │  Désignation (ex. Bras magique 1m)            │
 *   │  Quantité [1]  ·  Loueur : [Aucun ▾]          │
 *   │                                               │
 *   │  Loueurs : ◯ Aucun  ● Lux  ◯ TSF  ◯ …         │
 *   │  [Annuler]                    [+ Ajouter]     │
 *   └───────────────────────────────────────────────┘
 *
 * MAT-19 : on propose les loueurs déjà taggés sur la version (l'API
 * `check_session_fetch` renvoie `session.loueurs`). Sélection optionnelle —
 * "Aucun" reste l'état par défaut et retombe dans le récap "Non assigné".
 *
 * Props :
 *   - blockId : uuid du bloc (obligatoire)
 *   - onAdd({ blockId, designation, quantite, loueurId }) : handler async
 *   - loueurs : Array<{ id, nom, couleur }> — loueurs connus de la version
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus, X } from 'lucide-react'

function alpha(hex, a = '22') {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#64748b' + a
  return hex + a
}

export default function AddItemForm({ blockId, onAdd, loueurs = [] }) {
  const [open, setOpen] = useState(false)
  const [designation, setDesignation] = useState('')
  const [quantite, setQuantite] = useState(1)
  const [loueurId, setLoueurId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  // On trie par nom pour une présentation stable / prévisible.
  const sortedLoueurs = useMemo(
    () => [...loueurs].sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' })),
    [loueurs],
  )

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
    setLoueurId(null)
    setOpen(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = designation.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await onAdd({
        blockId,
        designation: trimmed,
        quantite: Math.max(1, Number(quantite) || 1),
        loueurId: loueurId || null,
      })
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

      {/* Sélecteur de loueur — MAT-19. Affiché UNIQUEMENT si la version a des
          loueurs tagués, sinon on masque totalement le contrôle pour ne pas
          polluer le form avec une option inutile. */}
      {sortedLoueurs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
          >
            Loueur (optionnel)
          </label>
          <div className="flex flex-wrap gap-1.5">
            <LoueurChip
              active={loueurId === null}
              onClick={() => setLoueurId(null)}
              color="#64748b"
              label="Aucun"
            />
            {sortedLoueurs.map((l) => (
              <LoueurChip
                key={l.id}
                active={loueurId === l.id}
                onClick={() => setLoueurId(l.id)}
                color={l.couleur || '#64748b'}
                label={l.nom}
              />
            ))}
          </div>
        </div>
      )}

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

// ─── Chip loueur (toggle style) ────────────────────────────────────────────

function LoueurChip({ active, onClick, color, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold transition-all"
      style={{
        background: active ? alpha(color, '33') : 'var(--bg-surf)',
        color: active ? color : 'var(--txt-2)',
        border: `1px solid ${active ? color : 'var(--brd-sub)'}`,
        cursor: 'pointer',
      }}
    >
      <span
        className="inline-block rounded-full shrink-0"
        style={{
          width: '8px',
          height: '8px',
          background: color,
        }}
      />
      <span className="truncate max-w-[140px]">{label}</span>
    </button>
  )
}
