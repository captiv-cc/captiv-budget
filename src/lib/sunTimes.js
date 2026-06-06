// ════════════════════════════════════════════════════════════════════════════
// SunTimes — Wrapper SunCalc pour les heures de lever / coucher / golden hour
// ════════════════════════════════════════════════════════════════════════════
//
// Wrapper autour de la lib `suncalc` (MIT, ~6KB) pour exposer les heures
// pertinentes à un cadreur audiovisuel :
//   - sunrise / sunset (lever / coucher du soleil)
//   - goldenHourMorning (≈30min après le lever, lumière dorée)
//   - goldenHourEvening (≈1h avant le coucher, lumière dorée)
//
// Les heures sont retournées en MINUTES depuis 00:00 du jour spécifié,
// cohérent avec le reste du module déroulé (cf. lib/deroule.js).
//
// Si lat/lon sont null, le module retourne null.
//
// Installation requise (côté Hugo) :
//   npm install suncalc
//
// SunCalc API : https://github.com/mourner/suncalc
// ════════════════════════════════════════════════════════════════════════════

import SunCalc from 'suncalc'

/**
 * Calcule les heures astronomiques utiles pour une date + position.
 *
 * @param {string} dateJour - ISO YYYY-MM-DD
 * @param {number} lat - Latitude WGS84
 * @param {number} lon - Longitude WGS84
 * @returns {{
 *   sunriseMin: number,           // minutes depuis 00:00 ce jour-là
 *   sunsetMin: number,
 *   goldenMorningStartMin: number, // début du golden hour matinal (juste avant lever)
 *   goldenMorningEndMin: number,   // fin du golden hour matinal (~1h après lever)
 *   goldenEveningStartMin: number, // début du golden hour soir (~1h avant coucher)
 *   goldenEveningEndMin: number,   // fin du golden hour soir (juste après coucher)
 * } | null}
 */
export function getSunTimes(dateJour, lat, lon) {
  if (!dateJour || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  // SunCalc utilise UTC. On passe une date locale midi pour matcher
  // précisément le jour visé (évite les bord-effets ±1j selon timezone).
  const localNoon = new Date(`${dateJour}T12:00:00`)
  if (Number.isNaN(localNoon.getTime())) return null

  let times
  try {
    times = SunCalc.getTimes(localNoon, lat, lon)
  } catch (e) {
    console.warn('[sunTimes] SunCalc error', e)
    return null
  }
  if (!times) return null

  const baseMidnight = new Date(`${dateJour}T00:00:00`)
  const baseMs = baseMidnight.getTime()

  const toMin = (d) => {
    if (!d || Number.isNaN(d.getTime())) return null
    const minutes = Math.round((d.getTime() - baseMs) / 60000)
    return minutes
  }

  // SunCalc fournit :
  //   sunrise, sunriseEnd, goldenHourEnd  ← matin
  //   goldenHour, sunsetStart, sunset      ← soir
  // - "goldenHour" (soir) = début golden hour soir
  // - "goldenHourEnd" (matin) = fin golden hour matin

  const sunriseMin = toMin(times.sunrise)
  const sunsetMin = toMin(times.sunset)
  const goldenMorningStartMin = toMin(times.sunrise) // juste avant lever
  const goldenMorningEndMin = toMin(times.goldenHourEnd) // ~1h après lever
  const goldenEveningStartMin = toMin(times.goldenHour) // ~1h avant coucher
  const goldenEveningEndMin = toMin(times.sunset) // juste après coucher

  // Si une des valeurs est null (cas extrême : nuit polaire), on annule
  if (
    sunriseMin == null ||
    sunsetMin == null ||
    goldenMorningStartMin == null ||
    goldenMorningEndMin == null ||
    goldenEveningStartMin == null ||
    goldenEveningEndMin == null
  ) {
    return null
  }

  return {
    sunriseMin,
    sunsetMin,
    goldenMorningStartMin,
    goldenMorningEndMin,
    goldenEveningStartMin,
    goldenEveningEndMin,
  }
}

/**
 * Formate un nombre de minutes depuis minuit en "HH:MM".
 */
export function formatMinAsHHMM(min) {
  if (!Number.isFinite(min)) return '—'
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = Math.floor(m % 60)
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
