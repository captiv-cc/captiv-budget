// ════════════════════════════════════════════════════════════════════════════
// useGoldenHour (FEST-5.1b) — Hook React qui expose les heures sunrise/sunset/golden
// ════════════════════════════════════════════════════════════════════════════
//
// Hook simple qui memoize le calcul des heures astronomiques pour un jour
// donné et un lat/lon. Si lat/lon manquent, renvoie null (le composant
// caller affiche/cache l'overlay selon).
//
// Usage :
//   const sun = useGoldenHour(deroule?.date_jour, project?.lat, project?.lon)
//   if (!sun) return null
//   // sun.sunriseMin, sun.sunsetMin, sun.goldenMorningStartMin, etc.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'
import { getSunTimes } from '../lib/sunTimes'

export function useGoldenHour(dateJour, lat, lon) {
  return useMemo(() => {
    if (!dateJour) return null
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return getSunTimes(dateJour, lat, lon)
  }, [dateJour, lat, lon])
}

export default useGoldenHour
