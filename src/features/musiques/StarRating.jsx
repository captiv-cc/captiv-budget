// ════════════════════════════════════════════════════════════════════════════
// StarRating — Notation ★ cliquable 1-5
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.12
//
// Composant compact pour noter une proposition :
//   - 5 étoiles affichées
//   - Hover : preview à droite de la position
//   - Click : set ma note (1-5)
//   - Click sur ma note actuelle : retire ma note (toggle off)
//   - Affiche soit MA note (priorité), soit la moyenne communautaire
//
// Props :
//   - myValue (number|null)   : ma note actuelle (1-5) ou null
//   - avgValue (number|null)  : moyenne agrégée (optionnel, affichée
//                                 quand myValue=null)
//   - count (number)          : nb de votes total (pour le tooltip)
//   - onChange (n => void)    : appelé avec la nouvelle valeur (0 = remove)
//   - disabled (boolean)      : désactive l'interaction
//   - size (number)           : taille des stars en px (default 14)
//
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'

const COLOR_FILLED = '#D97706'      // amber-600
const COLOR_EMPTY_DARK = 'rgba(255,255,255,0.18)' // dark mode empty
const COLOR_PREVIEW = '#FCD34D'     // amber-300 (preview hover, plus pâle)

export default function StarRating({
  myValue = null,
  avgValue = null,
  count = 0,
  onChange,
  disabled = false,
  size = 14,
}) {
  const [hover, setHover] = useState(0)

  // Valeur "remplie" affichée : priorité hover > myValue > avg arrondi
  const displayed =
    hover > 0
      ? hover
      : myValue != null
      ? myValue
      : avgValue != null
      ? Math.round(avgValue)
      : 0

  // Couleur selon contexte :
  //   - hover : amber pâle (preview)
  //   - myValue : amber foncé (mon vote)
  //   - avg : amber foncé mais opacité réduite (ce n'est pas moi)
  const filledColor =
    hover > 0
      ? COLOR_PREVIEW
      : myValue != null
      ? COLOR_FILLED
      : COLOR_FILLED
  const filledOpacity = myValue != null || hover > 0 ? 1 : 0.5

  function handleClick(value) {
    if (disabled) return
    // Click sur ma note actuelle = remove (toggle off)
    const next = value === myValue ? 0 : value
    onChange?.(next)
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
      onMouseLeave={() => setHover(0)}
      role="radiogroup"
      aria-label={`Note (${myValue || 'pas notée'} sur 5)`}
      title={
        count > 0
          ? `${count} vote${count > 1 ? 's' : ''}${
              avgValue ? ` · moyenne ${avgValue}` : ''
            }`
          : myValue
          ? `Ta note : ${myValue}/5`
          : 'Clique pour noter'
      }
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const isFilled = n <= displayed
        return (
          <span
            key={n}
            role="radio"
            aria-checked={isFilled}
            aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
            onMouseEnter={() => !disabled && setHover(n)}
            onClick={(e) => {
              e.stopPropagation()
              handleClick(n)
            }}
            style={{
              display: 'inline-flex',
              padding: 1,
              cursor: disabled ? 'default' : 'pointer',
              transition: 'transform 60ms',
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.85)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            <Star
              size={size}
              filled={isFilled}
              color={isFilled ? filledColor : COLOR_EMPTY_DARK}
              opacity={isFilled ? filledOpacity : 1}
            />
          </span>
        )
      })}
    </div>
  )
}

// Star SVG inline (plus simple que lucide-react pour gérer le filled
// custom + couleur dynamique).
function Star({ size, filled, color, opacity }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity, display: 'block' }}
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}
