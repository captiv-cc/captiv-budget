// Helpers conversion minutes (0-1440) + date_jour ↔ Date

/**
 * Combine date_jour (YYYY-MM-DD) + heure en minutes (0-1439) en Date locale.
 * Si heure >= 1440, déborde au jour suivant.
 */
export function combineDateAndMinutes(dateJour, heureMin) {
  if (!dateJour) return null
  const [y, m, d] = dateJour.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0)
  dt.setMinutes(heureMin || 0)
  return dt
}

/**
 * Calcule durée en minutes entre 2 valeurs heure_min.
 * Gère le débordement minuit (ex: 1380 → 60 = 120 min).
 */
export function dureeMinutes(debutMin, finMin) {
  if (debutMin == null || finMin == null) return 0
  return finMin > debutMin ? finMin - debutMin : finMin + 1440 - debutMin
}

/**
 * Renvoie aujourd'hui en YYYY-MM-DD (timezone locale)
 */
export function aujourdhuiJour() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const JOURS_FR = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM']
const JOURS_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MOIS_LONG = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/**
 * Label court pour une pill de jour : "SAM 14" depuis "2026-06-14".
 * (arrays manuels — pas d'Intl, Hermes ne le garantit pas)
 */
export function formatJourPill(dateJour) {
  if (!dateJour) return ''
  const [y, m, d] = dateJour.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${JOURS_FR[dt.getDay()]} ${d}`
}

/**
 * Date + heure en clair depuis une Date/ISO : "vendredi 12 juin 20h" ou
 * "vendredi 12 juin 20h15".
 */
export function formatDateHeureLong(value) {
  if (!value) return ''
  const dt = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  const h = dt.getHours()
  const min = dt.getMinutes()
  const heure = min ? `${h}h${String(min).padStart(2, '0')}` : `${h}h`
  return `${JOURS_LONG[dt.getDay()]} ${dt.getDate()} ${MOIS_LONG[dt.getMonth()]} ${heure}`
}
