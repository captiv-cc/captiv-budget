// ════════════════════════════════════════════════════════════════════════════
// GoldenHourOverlay (FEST-5.1d) — Bandes sunrise/sunset/golden sur la timeline
// ════════════════════════════════════════════════════════════════════════════
//
// Rend 2 bandes horizontales semi-transparentes superposées à la grille de la
// timeline déroulé, correspondant aux périodes golden hour du matin et du soir
// (calculées via SunCalc à partir du lat/lon du projet et de la date du jour).
//
// Visuel :
//   - Dégradé orangé/doré (top → bottom = montée puis descente d'opacité)
//   - Label flottant "🌅 lever 06:32" / "🌇 coucher 21:18" à droite
//   - Z-index sous les blocs (1, non cliquable)
//
// Props :
//   - sunTimes : { sunriseMin, sunsetMin, goldenMorningStartMin, ... } depuis useGoldenHour
//   - heureDebutMin, heureFinMin : bornes de la timeline en minutes
//   - minToTop(min) : helper de conversion px depuis le parent
//   - timeColWidth : largeur de la colonne horaires (offset à gauche)
//   - visible : bool (toggle utilisateur)
//
// Si une période golden hour tombe hors de la fenêtre visible (ex: lever à 05h
// alors que la timeline commence à 08h), on clipe à la borne de la timeline.
// ════════════════════════════════════════════════════════════════════════════

import { formatMinAsHHMM } from '../../lib/sunTimes'

const GOLDEN_COLOR_TOP = 'rgba(245, 158, 11, 0.06)'
const GOLDEN_COLOR_MID = 'rgba(245, 158, 11, 0.18)'

export default function GoldenHourOverlay({
  sunTimes,
  heureDebutMin = 0,
  heureFinMin = 1440,
  minToTop,
  timeColWidth = 0,
  visible = true,
}) {
  if (!visible || !sunTimes || !minToTop) return null

  // Clipping helper : clamp un intervalle [start, end] dans [heureDebutMin, heureFinMin].
  // Renvoie null si l'intervalle est entièrement hors fenêtre.
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
      {/* Bande golden hour matin */}
      {morning && (
        <Band
          start={morning.start}
          end={morning.end}
          minToTop={minToTop}
          timeColWidth={timeColWidth}
          label={
            sunriseInWindow
              ? `🌅 lever ${formatMinAsHHMM(sunTimes.sunriseMin)}`
              : `🌅 golden matin`
          }
        />
      )}
      {/* Bande golden hour soir */}
      {evening && (
        <Band
          start={evening.start}
          end={evening.end}
          minToTop={minToTop}
          timeColWidth={timeColWidth}
          label={
            sunsetInWindow
              ? `🌇 coucher ${formatMinAsHHMM(sunTimes.sunsetMin)}`
              : `🌇 golden soir`
          }
        />
      )}
    </>
  )
}

function Band({ start, end, minToTop, timeColWidth, label }) {
  const top = minToTop(start)
  const bottom = minToTop(end)
  const height = Math.max(2, bottom - top)
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top,
        left: timeColWidth,
        right: 0,
        height,
        zIndex: 1,
        background: `linear-gradient(180deg, ${GOLDEN_COLOR_TOP} 0%, ${GOLDEN_COLOR_MID} 50%, ${GOLDEN_COLOR_TOP} 100%)`,
        borderTop: '1px dashed rgba(245, 158, 11, 0.35)',
        borderBottom: '1px dashed rgba(245, 158, 11, 0.35)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: 6,
          top: 2,
          fontSize: 10,
          fontWeight: 500,
          color: 'rgba(245, 158, 11, 0.95)',
          background: 'rgba(0,0,0,0.35)',
          padding: '1px 6px',
          borderRadius: 3,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    </div>
  )
}
