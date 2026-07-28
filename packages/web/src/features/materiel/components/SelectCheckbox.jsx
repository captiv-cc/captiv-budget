// ════════════════════════════════════════════════════════════════════════════
// SelectCheckbox — case à cocher stylée du mode sélection (MAT-OUTILS)
// ════════════════════════════════════════════════════════════════════════════
//
// Les <input type="checkbox"> natifs jurent dans l'UI sombre (rendu OS,
// accent-color mal intégré). Celle-ci est un bouton dessiné : carré arrondi,
// bordure discrète, fond bleu + Check blanc quand cochée, Minus pour l'état
// partiel (sélection par bloc). Utilisée par ItemRow (ligne) et Block
// (en-tête : tout le bloc).
// ════════════════════════════════════════════════════════════════════════════

import { Check, Minus } from 'lucide-react'

export default function SelectCheckbox({
  checked = false,
  indeterminate = false,
  onToggle = null,
  title = 'Sélectionner',
  size = 15,
}) {
  const active = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onToggle?.()
      }}
      className="inline-flex items-center justify-center rounded transition-all align-middle shrink-0"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        background: active ? 'var(--blue)' : 'var(--bg-elev)',
        border: `1.5px solid ${active ? 'var(--blue)' : 'var(--brd)'}`,
        cursor: 'pointer',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.borderColor = 'var(--txt-3)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.borderColor = 'var(--brd)'
      }}
    >
      {checked && !indeterminate && (
        <Check className="text-white" style={{ width: `${size - 4}px`, height: `${size - 4}px` }} strokeWidth={3} />
      )}
      {indeterminate && (
        <Minus className="text-white" style={{ width: `${size - 4}px`, height: `${size - 4}px` }} strokeWidth={3} />
      )}
    </button>
  )
}
