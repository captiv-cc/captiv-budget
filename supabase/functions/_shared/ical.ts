/**
 * _shared/ical.ts — Port TypeScript (Deno) du builder iCalendar.
 *
 * MIRROIR de `src/lib/ical.js` (front). Les deux doivent rester synchrones :
 *   - même sémantique d'escape, fold, RRULE, EXDATE
 *   - même PRODID par défaut
 *
 * Gardés séparés parce que Deno ne peut pas aisément importer depuis src/
 * sans bundler dédié. Les tests unitaires côté front couvrent la logique ;
 * cette version est utilisée par l'edge function `ical-feed`.
 *
 * Référence : RFC 5545 — https://datatracker.ietf.org/doc/html/rfc5545
 */

const CRLF = '\r\n'
const DEFAULT_PRODID = '-//Captiv Desk//Planning//FR'
const ICAL_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export interface ICalEvent {
  id: string
  title?: string | null
  starts_at: string
  ends_at: string
  all_day?: boolean | null
  description?: string | null
  notes?: string | null
  location?: string | null
  external_url?: string | null
  rrule?: {
    freq: 'daily' | 'weekly' | 'monthly'
    interval?: number
    byweekday?: number[]
    end_type?: 'never' | 'count' | 'until'
    count?: number
    until?: string
  } | null
  rrule_exdates?: string[] | null
  uid?: string | null
}

export interface BuildICSOpts {
  calName?: string
  prodid?: string
  url?: string
  now?: Date
}

export function escapeICSText(text: unknown): string {
  if (text == null) return ''
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

export function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(line)
  if (bytes.length <= 75) return line
  const decoder = new TextDecoder('utf-8')
  const chunks: string[] = []
  let offset = 0
  while (offset < bytes.length) {
    const chunkSize = chunks.length === 0 ? 75 : 74
    let end = Math.min(offset + chunkSize, bytes.length)
    while (end > offset && end < bytes.length && (bytes[end] & 0xC0) === 0x80) {
      end -= 1
    }
    const chunk = decoder.decode(bytes.slice(offset, end))
    chunks.push(chunks.length === 0 ? chunk : ' ' + chunk)
    offset = end
  }
  return chunks.join(CRLF)
}

export function formatUTC(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
       + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

export function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

export function formatExdateDate(ymd: string): string {
  return String(ymd).replace(/-/g, '')
}

export function toICSRrule(rrule: ICalEvent['rrule']): string | null {
  if (!rrule || typeof rrule !== 'object') return null
  const freqMap: Record<string, string> = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }
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

function buildVEvent(event: ICalEvent, opts: BuildICSOpts): string {
  const lines: string[] = ['BEGIN:VEVENT']
  const now = opts.now || new Date()
  const uid = event.uid || `${event.id}@captiv.cc`
  lines.push(`UID:${escapeICSText(uid)}`)
  lines.push(`DTSTAMP:${formatUTC(now)}`)

  if (event.all_day) {
    lines.push(`DTSTART;VALUE=DATE:${formatDate(event.starts_at)}`)
    lines.push(`DTEND;VALUE=DATE:${formatDate(event.ends_at)}`)
  } else {
    lines.push(`DTSTART:${formatUTC(event.starts_at)}`)
    lines.push(`DTEND:${formatUTC(event.ends_at)}`)
  }

  lines.push(`SUMMARY:${escapeICSText(event.title || 'Sans titre')}`)

  const descParts: string[] = []
  if (event.description) descParts.push(event.description)
  if (event.notes) descParts.push(event.notes)
  if (descParts.length) {
    lines.push(`DESCRIPTION:${escapeICSText(descParts.join('\n\n'))}`)
  }
  if (event.location) lines.push(`LOCATION:${escapeICSText(event.location)}`)
  if (event.external_url) lines.push(`URL:${escapeICSText(event.external_url)}`)

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
        const master = new Date(event.starts_at)
        const exdates = event.rrule_exdates
          .map((ymd) => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd))
            if (!m) return null
            const local = new Date(
              Number(m[1]), Number(m[2]) - 1, Number(m[3]),
              master.getHours(), master.getMinutes(),
              master.getSeconds(), master.getMilliseconds(),
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

export function buildICS(events: ICalEvent[], opts: BuildICSOpts = {}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${opts.prodid || DEFAULT_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  if (opts.calName) lines.push(`X-WR-CALNAME:${escapeICSText(opts.calName)}`)
  if (opts.url) lines.push(`X-ORIGINAL-URL:${escapeICSText(opts.url)}`)
  lines.push('X-WR-TIMEZONE:Europe/Paris')

  for (const ev of events || []) {
    if (!ev || !ev.id || !ev.starts_at || !ev.ends_at) continue
    lines.push(buildVEvent(ev, opts))
  }
  lines.push('END:VCALENDAR')
  return lines.map((l) => (l.includes(CRLF) ? l : foldLine(l))).join(CRLF) + CRLF
}
