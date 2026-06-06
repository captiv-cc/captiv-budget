// ════════════════════════════════════════════════════════════════════════════
// GoldenHourOverlay (FEST-5.1d) — Bandes sunrise/sunset/golden sur la timeline
// ════════════════════════════════════════════════════════════════════════════
//
// Rend 2 bandes horizontales TRÈS DISCRÈTES superposées à la grille de la
// timeline déroulé, correspondant aux périodes golden hour du matin et du soir
// (calculées via SunCalc à partir du lat/lon du projet et de la date du jour).
//
// Définition golden hour (SunCalc, standard photo) :
//   - Golden hour matin = sunrise → sunriseEnd (mais on étend jusqu'à
//     goldenHourEnd ≈ 1h après le lever pour la "magic hour" complète)
//   - Golden hour soir = goldenHour ≈ 1h avant coucher → sunset
//   ⇒ Durée typique ~1h chaque, variable selon la latitude et la saison.
//
// Visuel (Hugo, Sprint 5 : "bien plus discret") :
//   - Dégradé orangé ultra-subtil (opacité max 0.08)
//   - Une fine ligne pleine au moment EXACT du lever/coucher
//   - Label minuscule sans fond, juste un texte coloré près de la ligne
//   - Z-index sous les blocs (1, non cliquable)
//
// Props :
//   - sunTimes : { sunriseMin, sunsetMin, goldenMorningStartMin, ... } depuis useGoldenHour
//   - heureDebutMin, heureFinMin : bornes de la timeline en minutes
//   - minToTop(min) : helper de conversion px depuis le parent
//   - timeColWidth : largeur de la colonne horaires (offset à gauche)
//   - visible : bool (toggle utilisateur)
// ════════════════════════════════════════════════════════════════════════════

import { formatMinAsHHMM } from '../../lib/sunTimes'

const GOLDEN_HUE = '245, 158, 11' // orange/ambre tailwind

export default function GoldenHourOverlay({
  sunTimes,
  heureDebutMin = 0,
  heureFinMin = 1440,
  minToTop,
  timeColWidth = 0,
  visible = true,
}) {
  if (!visible || !sunTimes || !minToTop) return null

  function clamp(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    const s = Math.max(start, heureDebutMin)
    const e = Math.min(end, heureFinMin)
    if (s >= e) return null
    return { start: s, end: e }
  }

  const morning = clamp(
    sunTimes.goldenMorningStartMin,
    sunTimes.goldenMorningEndMin,
  )
  const evening = clamp(
    sunTimes.goldenEveningStartMin,
    sunTimes.goldenEveningEndMin,
  )

  const sunriseInWindow =
    sunTimes.sunriseMin >= heureDebutMin && sunTimes.sunriseMin <= heureFinMin
  const sunsetInWindow =
    sunTimes.sunsetMin >= heureDebutMin && sunTimes.sunsetMin <= heureFinMin

  return (
    <>
      {/* Bande matin : gradient qui PART de la ligne du lever et fade vers le bas.
          Le lever est en HAUT de la période golden matin (durée ~1h après). */}
      {morning && (
        <SubtleBand
          start={morning.start}
          end={morning.end}
          minToTop={minToTop}
          timeColWidth={timeColWidth}
          direction="from-top"
        />
      )}
      {/* Bande soir : gradient qui MONTE jusqu'à la ligne du coucher en bas.
          Le coucher est en BAS de la période golden soir (durée ~1h avant). */}
      {evening && (
        <SubtleBand
          start={evening.start}
          end={evening.end}
          minToTop={minToTop}
          timeColWidth={timeColWidth}
          direction="to-bottom"
        />
      )}
      {sunriseInWindow && (
        <ExactLine
          min={sunTimes.sunriseMin}
          minToTop={minToTop}
          timeColWidth={timeColWidth}
          label={`lever ${formatMinAsHHMM(sunTimes.sunriseMin)}`}
        />
      )}
      {sunsetInWindow && (
        <ExactLine
          min={sunTimes.sunsetMin}
          minToTop={minToTop}
          timeColWidth={timeColWidth}
          label={`coucher ${formatMinAsHHMM(sunTimes.sunsetMin)}`}
        />
      )}
    </>
  )
}

/**
 * Bande dégradée discrète, ATTACHÉE à la ligne sunrise/sunset.
 * direction='from-top' : opaque au top (ligne lever), fade vers le bas.
 * direction='to-bottom' : transparent au top, opaque au bas (ligne coucher).
 * zIndex 0 + mixBlendMode 'soft-light' pour passer SOUS les blocs créneaux
 * et se fondre comme une ambiance lumineuse plutôt qu'un calque opaque.
 */
function SubtleBand({ start, end, minToTop, timeColWidth, direction }) {
  const top = minToTop(start)
  const height = Math.max(2, minToTop(end) - top)
  const gradient =
    direction === 'from-top'
      ? `linear-gradient(180deg, rgba(${GOLDEN_HUE}, 0.10) 0%, rgba(${GOLDEN_HUE}, 0) 100%)`
      : `linear-gradient(180deg, rgba(${GOLDEN_HUE}, 0) 0%, rgba(${GOLDEN_HUE}, 0.10) 100%)`
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top,
        left: timeColWidth,
        right: 0,
        height,
        zIndex: 0,
        background: gradient,
        // soft-light : se comporte comme une lumière diffuse plutôt qu'un
        // calque opaque ; les blocs au-dessus restent parfaitement visibles
        // et la teinte ambre ne fait que "teinter" les zones vides du fond.
        mixBlendMode: 'soft-light',
      }}
    />
  )
}

/**
 * Ligne horizontale 1px pleine au moment exact du lever ou coucher
 * + petit label texte sans fond. zIndex 0 pour passer sous les blocs.
 * v7 : label déplacé à GAUCHE (au-dessus de la colonne heures) — toujours
 * visible même si la timeline déborde / scroll, et collé au temps affiché.
 */
function ExactLine({ min, minToTop, timeColWidth, label }) {
  const top = minToTop(min)
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top,
        left: timeColWidth,
        right: 0,
        height: 0,
        zIndex: 0,
        borderTop: `1px solid rgba(${GOLDEN_HUE}, 0.3)`,
      }}
    >
      <span
        style={{
          position: 'absolute',
          // À GAUCHE (collé à la colonne des heures) au lieu de la droite.
          // Sticky à gauche : reste visible même si on scroll horizontalement.
          left: 4,
          top: -2,
          transform: 'translateY(-100%)',
          fontSize: 9,
          lineHeight: 1,
          color: `rgba(${GOLDEN_HUE}, 0.65)`,
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </span>
    </div>
  )
}
