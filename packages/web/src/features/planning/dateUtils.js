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

// ── Vues semaine / jour ─────────────────────────────────────────────────────

/** Retourne les 7 jours de la semaine contenant la date (lundi → dimanche). */
export function getWeekDays(d) {
  const start = startOfWeekMonday(d)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/**
 * Retourne un tableau des N jours consécutifs à partir de la date (incluse).
 * Utile pour la vue "jour" (count=1) et pour le rendu en commun avec la semaine.
 */
export function getConsecutiveDays(d, count = 1) {
  const start = startOfDay(d)
  return Array.from({ length: count }, (_, i) => addDays(start, i))
}

/**
 * Format court d'une plage de jours consécutifs, utilisé pour le header
 * de la vue Semaine sur mobile/tablet où il y a moins de place.
 *
 * Exemples :
 *   - 1 jour       : "Mer. 15 avril 2026"
 *   - même mois    : "13 — 15 avril 2026"
 *   - même année   : "28 avr. — 2 mai 2026"
 *   - multi-années : "30 déc. 2025 — 2 janv. 2026"
 *
 * @param {Date[]} days tableau de Date à 00:00 local
 */
export function fmtShortRangeFR(days) {
  if (!Array.isArray(days) || days.length === 0) return ''
  if (days.length === 1) {
    const d = days[0]
    const wd = WEEKDAYS_SHORT_FR[(d.getDay() + 6) % 7]
    return `${wd}. ${d.getDate()} ${MONTHS_FR[d.getMonth()].toLowerCase()} ${d.getFullYear()}`
  }
  const first = days[0]
  const last = days[days.length - 1]
  const sameMonth = isSameMonth(first, last)
  const sameYear = first.getFullYear() === last.getFullYear()
  if (sameMonth) {
    return `${first.getDate()} — ${last.getDate()} ${MONTHS_FR[first.getMonth()].toLowerCase()} ${first.getFullYear()}`
  }
  if (sameYear) {
    return `${first.getDate()} ${MONTHS_FR[first.getMonth()].toLowerCase()} — ${last.getDate()} ${MONTHS_FR[last.getMonth()].toLowerCase()} ${first.getFullYear()}`
  }
  return `${first.getDate()} ${MONTHS_FR[first.getMonth()].toLowerCase()} ${first.getFullYear()} — ${last.getDate()} ${MONTHS_FR[last.getMonth()].toLowerCase()} ${last.getFullYear()}`
}

/** "Semaine du 14 au 20 avril 2026" */
export function fmtWeekRangeFR(d) {
  const [first, last] = [startOfWeekMonday(d), addDays(startOfWeekMonday(d), 6)]
  const sameMonth = isSameMonth(first, last)
  const sameYear = first.getFullYear() === last.getFullYear()
  if (sameMonth) {
    return `Semaine du ${first.getDate()} au ${last.getDate()} ${MONTHS_FR[first.getMonth()].toLowerCase()} ${first.getFullYear()}`
  }
  if (sameYear) {
    return `Semaine du ${first.getDate()} ${MONTHS_FR[first.getMonth()].toLowerCase()} au ${last.getDate()} ${MONTHS_FR[last.getMonth()].toLowerCase()} ${first.getFullYear()}`
  }
  return `Semaine du ${first.getDate()} ${MONTHS_FR[first.getMonth()].toLowerCase()} ${first.getFullYear()} au ${last.getDate()} ${MONTHS_FR[last.getMonth()].toLowerCase()} ${last.getFullYear()}`
}

/**
 * Donne un intervalle [from, to] ISO couvrant les jours affichés dans une vue.
 * days : tableau de Date (chacune à 00:00 local).
 */
export function daysToIsoRange(days) {
  if (!days?.length) return { from: null, to: null }
  const from = startOfDay(days[0])
  const to = endOfDay(days[days.length - 1])
  return { from: from.toISOString(), to: to.toISOString() }
}

/**
 * Position verticale (px) d'un instant dans une grille horaire.
 * - day         : Date du jour (00:00 local) de la colonne cible
 * - date        : Date de l'instant à placer
 * - hourHeight  : hauteur d'une heure en px
 * - startHour   : première heure affichée (par défaut 0)
 * Plafond haut/bas pour événements qui débordent la plage affichée.
 */
export function timeToTop(day, date, hourHeight, startHour = 0, endHour = 24) {
  const dayStart = startOfDay(day)
  const minutesFromDayStart = (date - dayStart) / 60000
  const startMin = startHour * 60
  const endMin = endHour * 60
  const clamped = Math.max(startMin, Math.min(endMin, minutesFromDayStart))
  return ((clamped - startMin) / 60) * hourHeight
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
    // PL-FIX-1 : pour les all-day stockés en convention exclusive UTC
    // (ends_at = lendemain 00:00 UTC), le DERNIER jour visible = ends_at - 1.
    // Pour les events timed (ou legacy non-exclusive), on garde le
    // comportement actuel.
    let end
    if (ev.all_day === true) {
      const lastDay = allDayEndIsoToLastDay(ev.ends_at)
      end = lastDay ? startOfDay(lastDay) : startOfDay(new Date(ev.ends_at))
    } else {
      end = startOfDay(new Date(ev.ends_at))
    }
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

// ════════════════════════════════════════════════════════════════════════════
// Convention all-day exclusive (PL-FIX-1)
// ════════════════════════════════════════════════════════════════════════════
//
// Tous les events `all_day=true` doivent être stockés selon la convention
// iCal RFC 5545 : `ends_at` pointe vers MINUIT UTC du JOUR SUIVANT le dernier
// jour inclus. Exemple : un event "13/04 → 15/04" all-day se stocke comme :
//   - starts_at = "2026-04-13T00:00:00.000Z"
//   - ends_at   = "2026-04-16T00:00:00.000Z"  (= 15/04 + 1 jour)
//
// Cette convention est cohérente avec :
//   - L'export iCal (PL-8 / `buildICS`)
//   - La sync miroir des étapes livrables (`livrablesPlanningSync`)
//   - Les calendriers tiers (Google, Apple, Outlook)
//
// Les helpers ci-dessous garantissent que toute saisie / lecture all-day
// passe par cette convention, peu importe le fuseau du navigateur.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Convertit une date saisie ('YYYY-MM-DD' depuis un <input type="date">) en
 * timestamp ISO de DÉBUT all-day : minuit UTC du jour saisi.
 *
 * Exemple : "2026-04-13" → "2026-04-13T00:00:00.000Z"
 */
export function allDayStartIso(dateStr) {
  if (!dateStr) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).slice(0, 10))
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`
}

/**
 * Convertit une date saisie ('YYYY-MM-DD') en timestamp ISO de FIN all-day
 * EXCLUSIVE : minuit UTC du JOUR SUIVANT (= dernier jour inclus + 1).
 *
 * Exemple : "2026-04-15" → "2026-04-16T00:00:00.000Z"
 */
export function allDayEndIsoExclusive(dateStr) {
  if (!dateStr) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).slice(0, 10))
  if (!m) return null
  // On utilise Date.UTC + 1 jour pour éviter tout souci DST.
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10) + 1))
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * Reverse : un `ends_at` exclusive UTC → la date du DERNIER jour inclus, au
 * format 'YYYY-MM-DD' utilisable dans un <input type="date">.
 *
 * Exemple : "2026-04-16T00:00:00.000Z" → "2026-04-15"
 *
 * Robuste aux timestamps qui ne sont pas exactement à minuit UTC (cas legacy
 * où on stockait 23:59 local) : on retombe sur la date UTC pour que
 * l'utilisateur ait une saisie cohérente, puis le save normalisera.
 */
export function allDayEndIsoToDateInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // Si déjà à minuit UTC pile (convention exclusive) → on recule d'1 jour.
  // Sinon (convention legacy 23:59 local) → on garde la date UTC du jour.
  const isMidnightUTC =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  const target = isMidnightUTC ? new Date(d.getTime() - 24 * 3600 * 1000) : d
  const y = target.getUTCFullYear()
  const m = String(target.getUTCMonth() + 1).padStart(2, '0')
  const day = String(target.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Reverse pour `starts_at` : timestamp ISO → 'YYYY-MM-DD' UTC.
 * Symétrique de `allDayStartIso`.
 *
 * Exemple : "2026-04-13T00:00:00.000Z" → "2026-04-13"
 */
export function allDayStartIsoToDateInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Pour le rendu calendrier : retourne le DERNIER jour inclus d'un event
 * all-day stocké en convention exclusive. Renvoie un objet Date à minuit UTC
 * du jour final.
 *
 * Permet aux calendriers (MonthCalendar, TimelineCalendar) de ne pas
 * dessiner la barre sur le jour suivant le dernier jour utile.
 *
 * Exemple : ends_at "2026-04-16T00:00:00Z" → Date "2026-04-15T00:00:00Z"
 */
export function allDayEndIsoToLastDay(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const isMidnightUTC =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  if (!isMidnightUTC) return d // legacy : pas exclusive, on garde
  return new Date(d.getTime() - 24 * 3600 * 1000)
}
