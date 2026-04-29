// ════════════════════════════════════════════════════════════════════════════
// Checkbox — checkbox custom 16×16 cohérente avec le design (LIV-14)
// ════════════════════════════════════════════════════════════════════════════
//
// Remplace le `<input type="checkbox">` natif (rendu OS-dependent moche). Utilise
// un `<button>` accessible avec icône Check ou Minus selon l'état.
//
// 3 états visuels :
//   - vide          : carré arrondi, bordure gris (--brd)
//   - checked       : carré rempli bleu (--blue), icône Check blanche
//   - indeterminate : carré rempli bleu (--blue), icône Minus blanche
//
// Comportement :
//   - click : appelle onClick(event) avec shiftKey natif disponible
//   - clavier : Space / Enter (a11y standard via <button>)
//
// Props :
//   - checked       : booléen
//   - indeterminate : booléen (priorité sur checked pour le visuel)
//   - onClick       : (e) => void — e.shiftKey accessible
//   - subtle        : booléen — si true, opacity 0.4 par défaut, 1 au hover
//                     ou si checked. Utilisé sur les rows (visible au survol).
//   - size          : 'sm' (14×14) | 'md' (16×16, défaut)
//   - ariaLabel     : a11y label
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { Check, Minus } from 'lucide-react'

export default function Checkbox({
  checked = false,
  indeterminate = false,
  onClick,
  subtle = false,
  size = 'md',
  ariaLabel = 'Sélectionner',
  disabled = false,
}) {
  const [hover, setHover] = useState(false)
  const dim = size === 'sm' ? 14 : 16
  const iconSize = size === 'sm' ? 10 : 12

  // Visuel actif si checked OU indeterminate.
  const active = checked || indeterminate

  // Opacité : si subtle et inactif et pas hover → 0.4. Sinon 1.
  let opacity = 1
  if (subtle && !active && !hover) opacity = 0.4

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="inline-flex items-center justify-center rounded shrink-0 transition-all"
      style={{
        width: dim,
        height: dim,
        background: active ? 'var(--blue)' : 'transparent',
        border: active ? '1px solid var(--blue)' : '1px solid var(--brd)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity,
        padding: 0,
      }}
    >
      {indeterminate ? (
        <Minus
          aria-hidden
          style={{ width: iconSize, height: iconSize, color: '#fff', strokeWidth: 3 }}
        />
      ) : checked ? (
        <Check
          aria-hidden
          style={{ width: iconSize, height: iconSize, color: '#fff', strokeWidth: 3 }}
        />
      ) : null}
    </button>
  )
}
