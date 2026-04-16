/**
 * dateUtils — Utilitaires dates pour le module Planning (PL-2+).
 *
 * Volontairement sans dépendance externe (pas de date-fns / luxon) pour rester
 * légers. Week start = lundi (convention FR). Fuseau local navigateur utilisé
 * pour l'affichage ; les événements stockent `starts_at` / `ends_at` en UTC.
 */

// ── Noms FR (pour affichage entête / navigation) ────────────────────────────
export const WEEKDAYS_SHORT_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
export const WEEKDAYS_LONG_FR  = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
export const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

// ── Constructeurs / opérations de base ──────────────────────────────────────

/** Retourne une nouvelle Date à 00:00 local. */
export function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Retourne une nouvelle Date à 23:59:59.999 local. */
export function endOfDay(d) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

/** Premier jour du mois à 00:00 local. */
export function startOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1)
  return x
}

/** Dernier jour du mois à 23:59:59.999 local. */
export function endOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
  return x
}

/** Ajoute n mois (négatif accepté). Préserve l'heure. */
export function addMonths(d, n) {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

/** Ajoute n jours (négatif accepté). */
export function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Même jour civil (local) ? */
export function isSameDay(a, b) {
  if (!a || !b) return false
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Même mois civil (local) ? */
export function isSameMonth(a, b) {
  if (!a || !b) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

/** Retourne le lundi de la semaine contenant la date (week start = lundi). */
export function startOfWeekMonday(d) {
  const x = startOfDay(d)
  const dow = x.getDay() // 0 = dim, 1 = lun, ...
  const diff = (dow + 6) % 7 // nb jours à reculer pour atteindre lundi
  x.setDate(x.getDate() - diff)
  return x
}

// ── Grille mensuelle ────────────────────────────────────────────────────────

/**
 * Retourne la grille 6×7 = 42 cellules qui couvre le mois référencé.
 * Commence au lundi qui précède (ou contient) le 1er, finit au dimanche
 * qui suit (ou contient) le dernier jour.
 */
export function getMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const gridStart = startOfWeekMonday(first)
  const cells = []
  for (let i = 0; i < 42; i += 1) {
    cells.push(addDays(gridStart, i))
  }
  return cells
}

// ── Formatage ───────────────────────────────────────────────────────────────

/** "Avril 2026" */
export function fmtMonthYear(d) {
  return `${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`
}

/** "2026-04-16" (clé ISO locale, stable pour regroupements). */
export function fmtDateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** "16/04/2026" */
export function fmtDateFR(d) {
  const day = String(d.getDate()).padStart(2, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${m}/${d.getFullYear()}`
}

/** "16 avril 2026" */
export function fmtDateLongFR(d) {
  return `${d.getDate()} ${MONTHS_FR[d.getMonth()].toLowerCase()} ${d.getFullYear()}`
}

/** "09:30" */
export function fmtTimeFR(d) {
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/** "16/04/2026 09:30" */
export function fmtDateTimeFR(d) {
  return `${fmtDateFR(d)} ${fmtTimeFR(d)}`
}

/**
 * Valeur compatible avec un <input type="datetime-local"> (local, sans tz).
 * datetime-local attend "YYYY-MM-DDTHH:MM".
 */
export function toDatetimeLocalValue(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

/**
 * Valeur compatible avec un <input type="date"> (YYYY-MM-DD, local).
 */
export function toDateInputValue(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Regroupement d'événements par jour ──────────────────────────────────────

/**
 * Construit une Map<dateKey, event[]> pour un tableau d'événements.
 * Un événement multi-jours est inséré dans chaque jour qu'il traverse.
 * Les événements sont triés par heure de début croissante à l'intérieur d'un jour.
 */
export function groupEventsByDay(events) {
  const map = new Map()
  const safeEvents = Array.isArray(events) ? events : []
  safeEvents.forEach((ev) => {
    if (!ev?.starts_at || !ev?.ends_at) return
    const start = startOfDay(new Date(ev.starts_at))
    const end = startOfDay(new Date(ev.ends_at))
    // Itère jour par jour
    let cursor = new Date(start)
    let safety = 0
    while (cursor <= end && safety < 366) {
      const key = fmtDateKey(cursor)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(ev)
      cursor = addDays(cursor, 1)
      safety += 1
    }
  })
  // Tri intra-jour
  map.forEach((arr) => {
    arr.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  })
  return map
}
