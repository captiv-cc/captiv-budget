// ════════════════════════════════════════════════════════════════════════════
// format — helpers de formatage divers (initiales, distance, etc.)
// ════════════════════════════════════════════════════════════════════════════

/**
 * "Hugo Martin" → "HM"
 * "hugo" → "H"
 * "Jean-Marc Dupont" → "JD"
 */
export function initiales(nom) {
  if (!nom) return '?'
  const parts = String(nom).trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/**
 * 340 → "340m", 1240 → "1.2km"
 */
export function formatDistance(metres) {
  if (metres == null || metres < 0) return ''
  if (metres < 1000) return `${Math.round(metres)}m`
  return `${(metres / 1000).toFixed(1)}km`
}

/**
 * Couleur déterministe à partir d'un id (pour avatar fallback).
 * Renvoie un hex pris dans une palette stable.
 */
const COULEURS_AVATAR = [
  '#3B82F6', // bleu
  '#8B5CF6', // violet
  '#EC4899', // rose
  '#F59E0B', // orange
  '#10B981', // vert
  '#06B6D4', // cyan
  '#EF4444', // rouge
  '#84CC16', // lime
]

export function couleurAvatar(id) {
  if (!id) return COULEURS_AVATAR[0]
  let hash = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i)
    hash |= 0
  }
  return COULEURS_AVATAR[Math.abs(hash) % COULEURS_AVATAR.length]
}

/**
 * "5" → "5", "12" → "12", "0" → "0"
 * "" / null / undefined → fallback
 */
export function nombreOu(valeur, fallback = '—') {
  if (valeur == null || valeur === '') return fallback
  return String(valeur)
}
