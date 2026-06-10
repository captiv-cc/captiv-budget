/**
 * ical.js — Builder iCalendar (RFC 5545) pour l'export feed du planning.
 *
 * Helper pur, sans dépendance tierce :
 *   - Consommé par l'edge function `ical-feed` (Deno) : token → events → .ics
 *   - Testable en isolation (vitest, cf. ical.test.js)
 *
 * Ce module NE LIT PAS la base : il reçoit déjà des "master rows" d'events
 * (avec éventuellement rrule + rrule_exdates) et produit la string ICS.
 * Les occurrences ne sont pas pré-expansées : c'est le client iCal (Apple
 * Calendar, Google Calendar, Outlook…) qui les calcule à partir du RRULE.
 *
 * Limitations v1 (intentionnelles) :
 *   - Pas de VTIMEZONE block : on sérialise DTSTART/DTEND en UTC (suffixe Z).
 *     Simple, interopérable, pas de logique DST à maintenir. Les clients
 *     iCal affichent bien l'heure locale du lecteur. Quelques edge cases
 *     autour des bascules DST restent possibles sur les récurrences ; on
 *     pourra passer sur TZID=Europe/Paris + VTIMEZONE en v2 si besoin.
 *   - Pas d'ATTENDEE/ORGANIZER : feed lecture-seule, pas de RSVP.
 *   - Pas de VALARM : ce n'est pas le rôle d'un feed partagé.
 *
 * Référence : RFC 5545 — https://datatracker.ietf.org/doc/html/rfc5545
 */

const CRLF = '\r\n'
const DEFAULT_PRODID = '-//Captiv Desk//Planning//FR'

// Mapping byweekday interne (0=Lun … 6=Dim) → codes iCal (MO, TU, …)
const ICAL_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']


/* ─── Helpers texte ─────────────────────────────────────────────────────── */

/** Échappe les caractères spéciaux d'un champ TEXT (RFC 5545 §3.3.11). */
export function escapeICSText(text) {
  if (text == null) return ''
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * Plie une ligne à 75 octets (RFC 5545 §3.1). On compte en octets UTF-8
 * pour ne jamais couper un caractère multibyte (accents, emojis).
 * Les continuations sont préfixées d'un espace.
 */
export function foldLine(line) {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(line)
  if (bytes.length <= 75) return line

  const decoder = new TextDecoder('utf-8')
  const chunks = []
  let offset = 0
  while (offset < bytes.length) {
    // 1ʳᵉ ligne : 75 octets ; continuations : 74 octets (l'espace de début compte)
    const chunkSize = chunks.length === 0 ? 75 : 74
    let end = Math.min(offset + chunkSize, bytes.length)
    // Ne pas couper au milieu d'un caractère UTF-8 (octets de continuation 10xxxxxx)
    while (end > offset && end < bytes.length && (bytes[end] & 0xC0) === 0x80) {
      end -= 1
    }
    const chunk = decoder.decode(bytes.slice(offset, end))
    chunks.push(chunks.length === 0 ? chunk : ' ' + chunk)
    offset = end
  }
  return chunks.join(CRLF)
}

/** Formate un timestamp en YYYYMMDDTHHMMSSZ (UTC). */
export function formatUTC(date) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
       + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Formate une date en YYYYMMDD (utilisé pour les events all-day). */
export function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/** "YYYY-MM-DD" local → "YYYYMMDD" (pour EXDATE all-day). */
export function formatExdateDate(ymd) {
  return String(ymd).replace(/-/g, '')
}


/* ─── Conversion rrule interne → RRULE iCal ─────────────────────────────── */

/**
 * Convertit notre format rrule interne (cf. src/lib/rrule.js) en valeur de
 * propriété RRULE iCal. Retourne null si non convertible.
 */
export function toICSRrule(rrule) {
  if (!rrule || typeof rrule !== 'object') return null
  const freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }
  const freq = freqMap[rrule.freq]
  if (!freq) return null

  const parts = [`FREQ=${freq}`]
  const interval = Math.max(1, Number(rrule.interval) || 1)
  if (interval > 1) parts.push(`INTERVAL=${interval}`)

  if (rrule.freq === 'weekly' && Array.isArray(rrule.byweekday) && rrule.byweekday.length) {
    const days = [...new Set(rrule.byweekday)]
      .filter((d) => d >= 0 && d <= 6)
      .sort((a, b) => a - b)
      .map((d) => ICAL_WEEKDAYS[d])
      .join(',')
    if (days) parts.push(`BYDAY=${days}`)
  }

  if (rrule.end_type === 'count' && rrule.count) {
    parts.push(`COUNT=${Number(rrule.count)}`)
  } else if (rrule.end_type === 'until' && rrule.until) {
    parts.push(`UNTIL=${formatUTC(rrule.until)}`)
  }

  return parts.join(';')
}


/* ─── Construction d'un VEVENT ─────────────────────────────────────────── */

function buildVEvent(event, opts) {
  const lines = ['BEGIN:VEVENT']
  const now = opts.now || new Date()

  // UID stable : event.id + domaine. Pour un master récurrent, l'UID reste
  // identique pour toutes les occurrences — RFC 5545 : le RRULE détermine
  // les occurrences à partir du même UID.
  const uid = event.uid || `${event.id}@captiv.cc`
  lines.push(`UID:${escapeICSText(uid)}`)
  lines.push(`DTSTAMP:${formatUTC(now)}`)

  if (event.all_day) {
    // All-day : DTEND est exclusif (RFC 5545 §3.8.2.2). Les events Captiv
    // stockent déjà la fin au lendemain 00:00 quand all_day=true, donc on
    // émet tel quel.
    lines.push(`DTSTART;VALUE=DATE:${formatDate(event.starts_at)}`)
    lines.push(`DTEND;VALUE=DATE:${formatDate(event.ends_at)}`)
  } else {
    lines.push(`DTSTART:${formatUTC(event.starts_at)}`)
    lines.push(`DTEND:${formatUTC(event.ends_at)}`)
  }

  lines.push(`SUMMARY:${escapeICSText(event.title || 'Sans titre')}`)

  // DESCRIPTION = description + notes, séparées par une ligne vide.
  // L'URL externe est exposée via la propriété URL (dédiée) plutôt que
  // dupliquée dans DESCRIPTION — les clients majeurs (Apple, Google,
  // Outlook) affichent la propriété URL comme lien cliquable.
  const descParts = []
  if (event.description) descParts.push(event.description)
  if (event.notes)       descParts.push(event.notes)
  if (descParts.length) {
    lines.push(`DESCRIPTION:${escapeICSText(descParts.join('\n\n'))}`)
  }

  if (event.location) {
    lines.push(`LOCATION:${escapeICSText(event.location)}`)
  }
  if (event.external_url) {
    lines.push(`URL:${escapeICSText(event.external_url)}`)
  }

  // RRULE + EXDATE (pour les masters récurrents uniquement)
  if (event.rrule) {
    const rrule = toICSRrule(event.rrule)
    if (rrule) lines.push(`RRULE:${rrule}`)

    if (Array.isArray(event.rrule_exdates) && event.rrule_exdates.length) {
      if (event.all_day) {
        const exdates = event.rrule_exdates
          .map(formatExdateDate)
          .filter((s) => /^\d{8}$/.test(s))
          .join(',')
        if (exdates) lines.push(`EXDATE;VALUE=DATE:${exdates}`)
      } else {
        // Les exdates sont des "YYYY-MM-DD" en timezone locale (cf.
        // occurrenceKey dans src/lib/rrule.js). On recompose la date avec
        // le time-of-day local du master puis on sérialise en UTC pour
        // rester cohérent avec DTSTART.
        const master = new Date(event.starts_at)
        const exdates = event.rrule_exdates
          .map((ymd) => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd))
            if (!m) return null
            const local = new Date(
              Number(m[1]), Number(m[2]) - 1, Number(m[3]),
              master.getHours(),
              master.getMinutes(),
              master.getSeconds(),
              master.getMilliseconds(),
            )
            return formatUTC(local)
          })
          .filter(Boolean)
          .join(',')
        if (exdates) lines.push(`EXDATE:${exdates}`)
      }
    }
  }

  lines.push('END:VEVENT')
  return lines.map(foldLine).join(CRLF)
}


/* ─── API publique ─────────────────────────────────────────────────────── */

/**
 * Construit un corpus iCalendar (ICS) à partir d'une liste d'events "master".
 * Les occurrences des events récurrents sont laissées à la charge du client
 * iCal (via RRULE + EXDATE).
 *
 * @param {Array} events  lignes master Captiv :
 *   { id, starts_at, ends_at, all_day?, tz?, title, description?, notes?,
 *     location?, external_url?, rrule?, rrule_exdates? }
 * @param {Object} [opts]
 * @param {string} [opts.calName]  X-WR-CALNAME — nom affiché du calendrier
 * @param {string} [opts.prodid]   PRODID (défaut "-//Captiv Desk//Planning//FR")
 * @param {string} [opts.url]      X-ORIGINAL-URL (informatif)
 * @param {Date}   [opts.now]      override pour DTSTAMP (tests déterministes)
 * @returns {string} corpus ICS avec CRLF, terminé par un CRLF final
 */
export function buildICS(events, opts = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${opts.prodid || DEFAULT_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  if (opts.calName) {
    lines.push(`X-WR-CALNAME:${escapeICSText(opts.calName)}`)
  }
  if (opts.url) {
    lines.push(`X-ORIGINAL-URL:${escapeICSText(opts.url)}`)
  }
  // Fuseau suggéré pour les clients qui l'honorent (informatif, pas de VTIMEZONE)
  lines.push('X-WR-TIMEZONE:Europe/Paris')

  for (const ev of events || []) {
    if (!ev || !ev.id || !ev.starts_at || !ev.ends_at) continue
    lines.push(buildVEvent(ev, opts))
  }

  lines.push('END:VCALENDAR')

  // Les VEVENT sont déjà foldés en interne ; on fold aussi les headers
  // (courts en pratique mais défensif pour les titres de calName longs).
  return lines
    .map((l) => (l.includes(CRLF) ? l : foldLine(l)))
    .join(CRLF) + CRLF
}
