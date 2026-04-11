/**
 * Atomes UI du Budget Réel — Th, Checkbox, InlineInput, InlineNumberInput,
 * BlocTotal, StatusToggle, RegimeBadge.
 *
 * Extraits de BudgetReelTab.jsx — chantier refacto.
 */

import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'

export function BlocTotal({ label, value, color = 'default' }) {
  const C = { blue: 'var(--blue)', amber: 'var(--amber)', green: 'var(--green)', red: 'var(--red)', default: 'var(--txt)' }
  return (
    <span>
      <span style={{ color: 'var(--txt-3)' }}>{label} </span>
      <span className="font-bold tabular-nums" style={{ color: C[color] || C.default }}>{value}</span>
    </span>
  )
}

// ─── StatusToggle — 3 états : estimé / validé / payé ───────────────────────
// Estimé  → cercle vide ambre (clic = confirmer au prévu, déclenche valide auto)
// Validé  → cercle plein bleu  (clic = marquer payé)
// Payé    → cercle plein vert  (clic = annuler payé → retour à validé)
export function StatusToggle({ isEstime, valide, paye, onConfirmAtPrevu, onTogglePaye }) {
  let state, color, title, fill, Icon, onClick
  if (paye) {
    state = 'paye'; color = 'var(--green)'; fill = true; Icon = Check
    title = 'Payé · clic pour annuler le paiement'
    onClick = onTogglePaye
  } else if (isEstime) {
    state = 'estime'; color = 'var(--amber)'; fill = false; Icon = null
    title = 'Estimé · clic pour confirmer le coût au prévu'
    onClick = onConfirmAtPrevu
  } else {
    // saisi (auto-validé) mais non payé
    state = 'valide'; color = 'var(--blue)'; fill = true; Icon = Check
    title = 'Validé · clic pour marquer payé'
    onClick = onTogglePaye
  }

  return (
    <button
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
      title={title}
      disabled={!onClick}
      className="w-4 h-4 rounded-full flex items-center justify-center transition-all mx-auto"
      style={{
        background: fill ? color : 'transparent',
        border: `1.5px solid ${color}`,
        cursor: onClick ? 'pointer' : 'default',
      }}>
      {Icon && <Icon className="w-2.5 h-2.5" style={{ color: 'white' }} />}
    </button>
  )
}

export function Checkbox({ checked, onChange, color = 'blue' }) {
  const C = { blue: 'var(--blue)', green: 'var(--green)' }
  const c = C[color] || C.blue
  return (
    <button onClick={() => onChange(!checked)}
      className="w-4 h-4 rounded flex items-center justify-center transition-all mx-auto"
      style={{ background: checked ? c : 'transparent', border: `1.5px solid ${checked ? c : 'var(--brd)'}` }}>
      {checked && <Check className="w-2.5 h-2.5" style={{ color: 'white' }} />}
    </button>
  )
}

export function Th({ children, left, right, center, style }) {
  return (
    <th className="px-3 py-2 font-semibold uppercase tracking-wide whitespace-nowrap"
      style={{ color: 'var(--txt-3)', fontSize: 10, textAlign: left ? 'left' : right ? 'right' : 'center', ...style }}>
      {children}
    </th>
  )
}

export function InlineInput({ value, placeholder, onChange, style }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input value={v} placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== value) onChange(v) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      style={{ background: 'transparent', border: 'none', outline: 'none', width: '100%', ...style }} />
  )
}

export function InlineNumberInput({ value, onChange, style }) {
  const [v, setV] = useState(String(value || 0))
  useEffect(() => setV(String(value || 0)), [value])
  return (
    <input type="number" value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => { const n = parseFloat(v); if (!isNaN(n) && n !== value) onChange(n) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      style={{ background: 'transparent', border: 'none', outline: 'none', textAlign: 'right', width: 80, ...style }}
      step="0.01" />
  )
}

// Badge régime coloré — rappel visuel du type de dépense par ligne
export function RegimeBadge({ regime }) {
  const r = (regime || '').toLowerCase()
  const style = r.includes('intermittent')
    ? { color: 'var(--purple)', bg: 'rgba(156,95,253,.1)' }
    : r === 'interne'
    ? { color: 'var(--blue)',   bg: 'rgba(0,122,255,.1)'  }
    : r === 'externe'
    ? { color: 'var(--green)',  bg: 'rgba(0,200,117,.1)'  }
    : r === 'technique'
    ? { color: 'var(--amber)',  bg: 'rgba(255,174,0,.1)'  }
    : r === 'frais'
    ? { color: 'var(--txt-3)', bg: 'var(--bg-elev)'       }
    : { color: 'var(--txt-3)', bg: 'var(--bg-elev)'       }

  return (
    <span style={{
      display: 'inline-block',
      fontSize: 9,
      fontWeight: 600,
      padding: '1px 5px',
      borderRadius: 4,
      background: style.bg,
      color: style.color,
      letterSpacing: '0.03em',
    }}>
      {regime}
    </span>
  )
}
