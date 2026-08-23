// ════════════════════════════════════════════════════════════════════════════
// WaveformMini — forme d'onde compacte d'une proposition
// ════════════════════════════════════════════════════════════════════════════
//
// Dessinée depuis les pics calculés au dépôt du fichier (colonne audio_peaks) :
// redécoder le MP3 à chaque affichage serait inutilisable dans une liste de
// cent morceaux.
//
// Sans fichier déposé, on affiche une trame morte plutôt que rien : la
// différence entre « morceau complet disponible » et « extrait 30 s » doit
// se voir d'un coup d'œil, c'est elle qui décide de ce qu'on peut couper.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'

export default function WaveformMini({
  peaks = null,
  width = 120,
  height = 22,
  color = 'var(--purple, #a78bfa)',
  // Portion déjà jouée (0-1), pour le suivi de lecture.
  progress = 0,
  className = '',
}) {
  const bars = useMemo(() => {
    if (!Array.isArray(peaks) || peaks.length === 0) return null
    // On sous-échantillonne à la largeur disponible : inutile de tracer
    // 800 traits dans 120 pixels.
    const count = Math.max(12, Math.floor(width / 2))
    const step = peaks.length / count
    const out = []
    for (let i = 0; i < count; i += 1) {
      const slice = peaks.slice(Math.floor(i * step), Math.max(1, Math.floor((i + 1) * step)))
      const max = slice.length ? Math.max(...slice) : 0
      out.push(max / 255)
    }
    return out
  }, [peaks, width])

  if (!bars) {
    return (
      <span
        className={`inline-block rounded-sm ${className}`}
        style={{
          width,
          height,
          background:
            'repeating-linear-gradient(90deg, var(--brd-sub) 0 1px, transparent 1px 4px)',
          opacity: 0.5,
        }}
        title="Aucun fichier déposé — lecture limitée à l’extrait"
      />
    )
  }

  const barW = width / bars.length
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {bars.map((v, i) => {
        const h = Math.max(1, v * height)
        const joue = progress > 0 && i / bars.length <= progress
        return (
          <rect
            key={i}
            x={i * barW}
            y={(height - h) / 2}
            width={Math.max(0.8, barW - 0.6)}
            height={h}
            fill={color}
            opacity={joue ? 1 : 0.45}
          />
        )
      })}
    </svg>
  )
}
