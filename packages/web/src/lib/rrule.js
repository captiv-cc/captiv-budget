/**
 * rrule — Règles de récurrence simplifiées pour les événements Captiv.
 *
 * Format JSON stocké en colonne events.rrule :
 *   {
 *     freq:       'daily' | 'weekly' | 'monthly',
 *     interval:   int >= 1            (1 par défaut),
 *     byweekday:  [0..6][]            (optionnel, 0=Lun ... 6=Dim, pour freq='weekly'),
 *     end_type:   'never' | 'count' | 'until',
 *     count:      int > 0             (si end_type='count'),
 *     until:      ISO string          (si end_type='until'),
 *   }
 *
 * Les exceptions sont stockées dans events.rrule_exdates sous forme de tableau
 * de clés locales "YYYY-MM-DD" (une entrée = une occurrence annulée ou détachée).
 */

export const RRULE_FREQS = {
  daily:   { key: 'daily',   label: 'Chaque jour' },
  weekly:  { key: 'weekly',  label: 'Chaque semaine' },
  monthly: { key: 'monthly', label: 'Chaque mois' },
}

export const RRULE_END_TYPES = {
  never: { key: 'never', label: 'Sans fin' },
  count: { key: 'count', label: 'Après N occurrences' },
  until: { key: 'until', label: "Jusqu'à une date" },
}

export const WEEKDAY_LABELS_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
export const WEEKDAY_LABELS_LONG = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

/** Retourne la rrule par défaut (hebdomadaire, 1x, sans fin). */
export function defaultRrule(fromDate) {
  const dow = fromDate ? (fromDate.getDay() + 6) % 7 : 0
  return {
    freq: 'weekly',
    interval: 1,
    byweekday: [dow],
    end_type: 'never',
  }
}

/**
 * Valide / normalise une rrule. Retourne { ok: true, value } ou { ok: false, error }.
 */
export function validateRrule(rrule) {
  if (!rrule || typeof rrule !== 'object') {
    return { ok: false, error: 'Règle invalide' }
  }
  if (!RRULE_FREQS[rrule.freq]) {
    return { ok: false, error: 'Fréquence invalide' }
  }
  const interval = Number(rrule.interval) || 1
  if (interval < 1 || interval > 99) {
    return { ok: false, error: 'Intervalle invalide' }
  }
  const endType = rrule.end_type || 'never'
  if (!RRULE_END_TYPES[endType]) {
    return { ok: false, error: 'Fin invalide' }
  }
  const normalized = { freq: rrule.freq, interval, end_type: endType }

  if (rrule.freq === 'weekly') {
    const days = Array.isArray(rrule.byweekday) ? rrule.byweekday.filter(d => d >= 0 && d <= 6) : []
    if (!days.length) {
      return { ok: false, error: 'Sélectionne au moins un jour de la semaine' }
    }
    normalized.byweekday = [...new Set(days)].sort((a, b) => a - b)
  }

  if (endType === 'count') {
    const count = Number(rrule.count)
    if (!Number.isFinite(count) || count < 1 || count > 365) {
      return { ok: false, error: 'Nombre d\'occurrences invalide (1-365)' }
    }
    normalized.count = count
  }

  if (endType === 'until') {
    if (!rrule.until) {
      return { ok: false, error: 'Date de fin requise' }
    }
    const d = new Date(rrule.until)
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: 'Date de fin invalide' }
    }
    normalized.until = d.toISOString()
  }

  return { ok: true, value: normalized }
}

/** Clé locale "YYYY-MM-DD" pour identifier une occurrence dans les exdates. */
export function occurrenceKey(date) {
  const d = date instanceof Date ? date : new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Étend un événement potentiellement récurrent en une liste d'occurrences
 * qui intersectent la fenêtre [rangeFrom, rangeTo].
 *
 * Si event.rrule est null/absent, retourne [event] s'il intersecte la fenêtre,
 * sinon [] (ou [event] inchangé pour compatibilité : on laisse le composant filtrer).
 *
 * Chaque occurrence retournée est un clone shallow du master avec starts_at/ends_at
 * ajustés + les métadonnées internes préfixées par "_" :
 *   _master_id        = id du master
 *   _master_starts_at = starts_at d'origine du master (ISO string)
 *   _master_ends_at   = ends_at d'origine du master (ISO string)
 *   _occurrence_key   = clé "YYYY-MM-DD"
 *   _is_occurrence    = true si ce n'est pas la 1ère occurrence
 *   _recurring        = true si le master a une rrule
 */
export function expandEvent(event, rangeFrom, rangeTo) {
  if (!event) return []
  const recurring = Boolean(event.rrule)
  const masterStart = new Date(event.starts_at)
  const masterEnd = new Date(event.ends_at)
  const duration = masterEnd - masterStart
  const from = rangeFrom instanceof Date ? rangeFrom : new Date(rangeFrom)
  const to = rangeTo instanceof Date ? rangeTo : new Date(rangeTo)

  if (!recurring) {
    // Non-récurrent : retourne tel quel (le filtrage est fait plus haut)
    return [{
      ...event,
      _master_id: event.id,
      _master_starts_at: event.starts_at,
      _master_ends_at: event.ends_at,
      _recurring: false,
    }]
  }

  const rrule = event.rrule
  const interval = Math.max(1, Number(rrule.interval) || 1)
  const exdates = new Set(
    (event.rrule_exdates || []).map((d) => occurrenceKey(d)),
  )
  const endType = rrule.end_type || 'never'
  const untilDate = endType === 'until' && rrule.until ? new Date(rrule.until) : null
  const maxCount = endType === 'count' && rrule.count ? Number(rrule.count) : Infinity

  const out = []
  const SAFETY = 2000
  let iter = 0
  let emitted = 0

  function tryEmit(date) {
    if (emitted >= maxCount) return false
    if (untilDate && date > untilDate) return false
    if (date < masterStart) return true // continue sans émettre (pré-master)
    const key = occurrenceKey(date)
    emitted += 1
    if (exdates.has(key)) return true
    const occEnd = new Date(date.getTime() + duration)
    // Intersecte la fenêtre visible ?
    if (occEnd < from || date > to) return true
    out.push({
      ...event,
      starts_at: date.toISOString(),
      ends_at: occEnd.toISOString(),
      _master_id: event.id,
      _master_starts_at: event.starts_at,
      _master_ends_at: event.ends_at,
      _occurrence_key: key,
      _is_occurrence: emitted > 1,
      _recurring: true,
    })
    return true
  }

  if (rrule.freq === 'daily') {
    let cursor = new Date(masterStart)
    while (iter < SAFETY) {
      if (cursor > to && (!untilDate || cursor > untilDate)) break
      if (!tryEmit(cursor)) break
      cursor = addDaysPreserveLocal(cursor, interval)
      iter += 1
    }
  } else if (rrule.freq === 'weekly') {
    const startDow = (masterStart.getDay() + 6) % 7
    const days = Array.isArray(rrule.byweekday) && rrule.byweekday.length
      ? [...new Set(rrule.byweekday)].sort((a, b) => a - b)
      : [startDow]
    // Aligne sur le lundi de la semaine du master, en heure locale
    const masterMonday = startOfWeekMondayLocal(masterStart)
    let weekCursor = new Date(masterMonday)
    while (iter < SAFETY) {
      if (weekCursor > to && (!untilDate || weekCursor > untilDate)) break
      let stoppedInWeek = false
      for (const dow of days) {
        const candidate = new Date(weekCursor)
        candidate.setDate(candidate.getDate() + dow)
        candidate.setHours(
          masterStart.getHours(),
          masterStart.getMinutes(),
          masterStart.getSeconds(),
          masterStart.getMilliseconds(),
        )
        if (emitted >= maxCount) { stoppedInWeek = true; break }
        if (untilDate && candidate > untilDate) { stoppedInWeek = true; break }
        if (!tryEmit(candidate)) { stoppedInWeek = true; break }
      }
      if (stoppedInWeek || emitted >= maxCount) break
      weekCursor = addDaysPreserveLocal(weekCursor, 7 * interval)
      iter += 1
    }
  } else if (rrule.freq === 'monthly') {
    // Mensuel : même jour du mois que le master (clampé si le mois est plus court)
    const baseDay = masterStart.getDate()
    const baseYear = masterStart.getFullYear()
    const baseMonth = masterStart.getMonth()
    let step = 0
    while (iter < SAFETY) {
      const targetYear = baseYear + Math.floor((baseMonth + step * interval) / 12)
      const targetMonth = ((baseMonth + step * interval) % 12 + 12) % 12
      // Clamp si nécessaire (ex. 31 → 30 en avril, 28/29 en février)
      const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate()
      const day = Math.min(baseDay, lastDay)
      const cursor = new Date(
        targetYear,
        targetMonth,
        day,
        masterStart.getHours(),
        masterStart.getMinutes(),
        masterStart.getSeconds(),
        masterStart.getMilliseconds(),
      )
      if (cursor > to && (!untilDate || cursor > untilDate)) break
      if (!tryEmit(cursor)) break
      step += 1
      iter += 1
    }
  }

  return out
}

/**
 * Expand une liste d'événements sur la plage [from, to]. Convenience.
 */
export function expandEvents(events, rangeFrom, rangeTo) {
  const out = []
  for (const ev of events || []) {
    const occ = expandEvent(ev, rangeFrom, rangeTo)
    for (const o of occ) out.push(o)
  }
  return out
}

// ─── Helpers internes ────────────────────────────────────────────────────────
function addDaysPreserveLocal(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function startOfWeekMondayLocal(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const dow = x.getDay()
  const diff = (dow + 6) % 7
  x.setDate(x.getDate() - diff)
  return x
}

/** Donne une description lisible d'une rrule (pour UI résumé). */
export function describeRrule(rrule) {
  if (!rrule) return 'Événement unique'
  const interval = Math.max(1, Number(rrule.interval) || 1)
  let base
  if (rrule.freq === 'daily') {
    base = interval === 1 ? 'Tous les jours' : `Tous les ${interval} jours`
  } else if (rrule.freq === 'weekly') {
    const days = Array.isArray(rrule.byweekday)
      ? rrule.byweekday.map((d) => WEEKDAY_LABELS_LONG[d]).join(', ')
      : ''
    base = interval === 1
      ? `Chaque semaine${days ? ` (${days})` : ''}`
      : `Toutes les ${interval} semaines${days ? ` (${days})` : ''}`
  } else if (rrule.freq === 'monthly') {
    base = interval === 1 ? 'Chaque mois' : `Tous les ${interval} mois`
  } else {
    base = 'Récurrent'
  }

  if (rrule.end_type === 'count') {
    return `${base}, ${rrule.count} occurrences`
  }
  if (rrule.end_type === 'until' && rrule.until) {
    const d = new Date(rrule.until)
    const day = String(d.getDate()).padStart(2, '0')
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${base}, jusqu'au ${day}/${m}/${d.getFullYear()}`
  }
  return base
}
