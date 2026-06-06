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
      {morning && (
        <SubtleBand
          start={morning.start}
          end={morning.end}
          minToTop={minToTop}
          timeColWidth={timeColWidth}
        />
      )}
      {evening && (
        <SubtleBand
          start={evening.start}
          end={evening.end}
          minToTop={minToTop}
          timeColWidth={timeColWidth}
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
 * Bande dégradée très subtile sur toute la durée du golden hour.
 * Opacité max 0.06 — on doit deviner plus que voir.
 */
function SubtleBand({ start, end, minToTop, timeColWidth }) {
  const top = minToTop(start)
  const height = Math.max(2, minToTop(end) - top)
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top,
        left: timeColWidth,
        right: 0,
        height,
        zIndex: 1,
        background: `linear-gradient(180deg, rgba(${GOLDEN_HUE}, 0) 0%, rgba(${GOLDEN_HUE}, 0.06) 50%, rgba(${GOLDEN_HUE}, 0) 100%)`,
      }}
    />
  )
}

/**
 * Ligne horizontale 1px pleine au moment exact du lever ou coucher
 * + petit label texte sans fond.
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
        zIndex: 2,
        borderTop: `1px solid rgba(${GOLDEN_HUE}, 0.35)`,
      }}
    >
      <span
        style={{
          position: 'absolute',
          right: 6,
          top: -7,
          fontSize: 9,
          color: `rgba(${GOLDEN_HUE}, 0.75)`,
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </span>
    </div>
  )
}
