// ════════════════════════════════════════════════════════════════════════════
// dateFormat — helpers de formatage de date, agnostiques web/mobile
// ════════════════════════════════════════════════════════════════════════════
//
// Utilise Intl.DateTimeFormat (standard ES, dispo partout sauf vieux Hermès).
// Si tu vois un crash Hermès → mettre intl-listformat polyfill.
//
// ════════════════════════════════════════════════════════════════════════════

const LOCALE_FR = 'fr-FR'

/**
 * "12/06/2026"
 */
export function formatDateCourte(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(LOCALE_FR, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

/**
 * "12 juin 2026"
 */
export function formatDateLongue(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(LOCALE_FR, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}

/**
 * "Ven 12"
 */
export function formatJourCourt(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const jour = new Intl.DateTimeFormat(LOCALE_FR, { weekday: 'short' })
    .format(d)
    .replace('.', '')
  const num = d.getDate()
  return `${capitalize(jour)} ${num}`
}

/**
 * "VEN" (3 lettres majuscules)
 */
export function formatJourTrigramme(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(LOCALE_FR, { weekday: 'short' })
    .format(d)
    .replace('.', '')
    .slice(0, 3)
    .toUpperCase()
}

/**
 * "20:00"
 */
export function formatHeure(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(LOCALE_FR, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

/**
 * "20:00 → 21:00"
 */
export function formatPlageHoraire(start, end) {
  return `${formatHeure(start)} → ${formatHeure(end)}`
}

/**
 * "1h", "1h30", "45min" — durée humaine
 */
export function formatDuree(minutes) {
  if (!minutes || minutes <= 0) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

/**
 * "il y a 5 min", "il y a 1h", "hier", "12/06"
 * Renvoie un label "relatif" type Twitter.
 */
export function formatRelatif(date, now = new Date()) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''

  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffH = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffH / 24)

  if (diffSec < 60) return "à l'instant"
  if (diffMin < 60) return `il y a ${diffMin} min`
  if (diffH < 24) return `il y a ${diffH}h`
  if (diffDays === 1) return 'hier'
  if (diffDays < 7) return `il y a ${diffDays}j`
  return formatDateCourte(d)
}

/**
 * "Dans 1h47", "Dans 12 min" — countdown vers le futur
 */
export function formatCountdown(date, now = new Date()) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''

  const diffMs = d.getTime() - now.getTime()
  if (diffMs <= 0) return 'Maintenant'

  const diffMin = Math.floor(diffMs / 60_000)
  const diffH = Math.floor(diffMin / 60)
  const restMin = diffMin % 60

  if (diffH === 0) return `Dans ${restMin} min`
  if (restMin === 0) return `Dans ${diffH}h`
  return `Dans ${diffH}h${String(restMin).padStart(2, '0')}`
}

/**
 * true si la date est aujourd'hui (même calendar day, timezone locale)
 */
export function estAujourdhui(date, now = new Date()) {
  if (!date) return false
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/**
 * true si la date est hier
 */
export function estHier(date, now = new Date()) {
  if (!date) return false
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return false
  const hier = new Date(now)
  hier.setDate(hier.getDate() - 1)
  return (
    d.getFullYear() === hier.getFullYear() &&
    d.getMonth() === hier.getMonth() &&
    d.getDate() === hier.getDate()
  )
}

// ─── Utils privés ───────────────────────────────────────────────────────────
function capitalize(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}
