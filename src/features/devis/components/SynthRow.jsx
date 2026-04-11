/**
 * SynthRow — ligne du tableau "Détail" de la synthèse (sous-total, mg, TVA...).
 *
 * Variantes :
 *   big       → taille de police plus grande, valeur en bold
 *   highlight → fond et bordure (utilisé pour le TOTAL TTC)
 *   muted     → couleur grise discrète
 *   colored   → 'blue' | 'purple' | 'orange' | 'green'
 *
 * Extraite de DevisEditor.jsx — chantier refacto.
 */

const COLOR_MAP = {
  blue:   'var(--blue)',
  purple: 'var(--purple)',
  orange: 'var(--orange)',
  green:  'var(--green)',
}

export default function SynthRow({ label, val, big, highlight, muted, colored }) {
  return (
    <div
      className="flex items-center justify-between px-2 py-1 rounded"
      style={highlight ? { background: 'rgba(255,255,255,.08)', border: '1px solid var(--brd)' } : {}}
    >
      <span
        className="text-xs"
        style={{
          color: muted ? 'var(--txt-3)' : highlight ? 'var(--txt-2)' : 'var(--txt-2)',
          fontWeight: highlight ? 500 : 400,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: big ? '0.875rem' : '0.75rem',
          fontWeight: big ? 700 : 500,
          color: highlight ? 'var(--txt)'
               : muted     ? 'var(--txt-3)'
               : colored   ? COLOR_MAP[colored]
               :             'var(--txt)',
        }}
      >
        {val}
      </span>
    </div>
  )
}
