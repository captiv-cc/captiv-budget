// ════════════════════════════════════════════════════════════════════════════
// Geocoding — Wrapper Nominatim (OpenStreetMap) gratuit (FEST-5.1b)
// ════════════════════════════════════════════════════════════════════════════
//
// Service de géocodage Nominatim, gratuit et sans clé API. Utilisé pour
// convertir le `lieu_text` d'un projet (ex: "Vand'B Fest, Vendeuvre-sur-Barse")
// en coordonnées lat/lon nécessaires au calcul du golden hour.
//
// Rate-limit : 1 req/seconde max selon les conditions Nominatim. Pour notre
// usage (1 géocodage par projet par modification du lieu_text), c'est
// largement suffisant. On cache le résultat en BDD (projects.lat/lon).
//
// Le User-Agent est OBLIGATOIRE — Nominatim renvoie 403 sans. Voir :
// https://operations.osmfoundation.org/policies/nominatim/
//
// Si tu observes des 429/403 répétés, basculer vers un provider payant
// (Mapbox, Google) sera trivial — l'interface de geocodeAddress() reste la
// même.
// ════════════════════════════════════════════════════════════════════════════

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'Captiv/1.0 (contact@captiv.cc)'

/**
 * Géocode une adresse/lieu vers lat/lon via Nominatim.
 *
 * Cas particuliers :
 * - Si `query` matche un pattern "lat, lon" (deux floats séparés par virgule),
 *   on parse directement sans appeler l'API.
 *
 * @param {string} query - Adresse ou lieu à géocoder
 * @returns {Promise<{ lat: number, lon: number, display_name: string } | null>}
 */
export async function geocodeAddress(query) {
  if (!query || typeof query !== 'string') return null
  const trimmed = query.trim()
  if (trimmed.length === 0) return null

  // Cas "lat, lon" direct — pas besoin de réseau
  const coordsMatch = trimmed.match(
    /^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  )
  if (coordsMatch) {
    const lat = parseFloat(coordsMatch[1])
    const lon = parseFloat(coordsMatch[2])
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    ) {
      return {
        lat,
        lon,
        display_name: `${lat}, ${lon}`,
      }
    }
  }

  // Géocodage Nominatim
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    q: trimmed,
  })
  const url = `${NOMINATIM_URL}?${params.toString()}`

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        // Accept-Language guide les résultats sur les noms FR quand possible
        'Accept-Language': 'fr',
      },
    })
    if (!r.ok) {
      console.warn('[geocode] HTTP', r.status, await r.text())
      return null
    }
    const data = await r.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const first = data[0]
    const lat = parseFloat(first.lat)
    const lon = parseFloat(first.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return {
      lat,
      lon,
      display_name: first.display_name || trimmed,
    }
  } catch (e) {
    console.warn('[geocode] fetch error', e)
    return null
  }
}

/**
 * Formate des coordonnées en notation human-readable.
 *   formatLatLon(48.8566, 2.3522) → "48.857°N, 2.352°E"
 */
export function formatLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return ''
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'O'
  return `${Math.abs(lat).toFixed(3)}°${ns}, ${Math.abs(lon).toFixed(3)}°${ew}`
}
