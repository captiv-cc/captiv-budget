/**
 * PriceCell — cellule de saisie prix éditable.
 *
 * Affichée formatée (€) au repos, devient un input au clic/focus.
 *
 *   nullable = true  → vide retourne null (ex: cout_ht où null signifie "= vente")
 *   nullable = false → vide retourne 0
 *
 * Extraite de DevisEditor.jsx — chantier refacto.
 */

import { useState, useRef } from 'react'
import { fmtEur } from '../../../../lib/cotisations'

export default function PriceCell({
  value,
  onChange,
  placeholder = '—',
  style = {},
  nullable = false,
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef(null)

  function commit(raw) {
    if (nullable) {
      onChange(raw === '' ? null : parseFloat(raw) ?? null)
    } else {
      onChange(parseFloat(raw) || 0)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        className="input-cell w-full text-right"
        defaultValue={value || ''}
        autoFocus
        min={0}
        step={0.01}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter')  { e.preventDefault(); commit(e.currentTarget.value) }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        style={style}
      />
    )
  }

  return (
    <div
      className="input-cell w-full text-right tabular-nums cursor-text"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onFocus={() => setEditing(true)}
      style={style}
    >
      {value !== null && value !== undefined
        ? fmtEur(value)
        : <span style={{ color: 'var(--txt-3)', fontStyle: 'italic' }}>{placeholder}</span>}
    </div>
  )
}
