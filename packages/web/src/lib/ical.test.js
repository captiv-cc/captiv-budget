/**
 * Tests unitaires — ical.js
 * Valide le builder iCalendar (RFC 5545) : escape, fold, RRULE, EXDATE,
 * all-day, timed, et la forme globale d'un VCALENDAR.
 */
import { describe, it, expect } from 'vitest'
import {
  buildICS,
  escapeICSText,
  foldLine,
  formatUTC,
  formatDate,
  formatExdateDate,
  toICSRrule,
} from './ical'

const FIXED_NOW = new Date('2026-04-19T12:00:00Z')

// Helper : crée un event master minimal avec ISO UTC déterministe.
function mkEvent(overrides = {}) {
  return {
    id: 'evt-1',
    title: 'Tournage',
    starts_at: '2026-04-20T08:00:00.000Z',
    ends_at:   '2026-04-20T17:00:00.000Z',
    all_day: false,
    ...overrides,
  }
}


// ─── escapeICSText ──────────────────────────────────────────────────────────
describe('escapeICSText', () => {
  it('échappe backslash, virgule, point-virgule et retours ligne', () => {
    expect(escapeICSText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })
  it('gère null/undefined en retournant une string vide', () => {
    expect(escapeICSText(null)).toBe('')
    expect(escapeICSText(undefined)).toBe('')
  })
  it('convertit CRLF en \\n', () => {
    expect(escapeICSText('a\r\nb')).toBe('a\\nb')
  })
  it('laisse le texte normal intact', () => {
    expect(escapeICSText('Bonjour')).toBe('Bonjour')
  })
})


// ─── foldLine ────────────────────────────────────────────────────────────────
describe('foldLine', () => {
  it('ne plie pas les lignes ≤ 75 octets', () => {
    const line = 'A'.repeat(75)
    expect(foldLine(line)).toBe(line)
  })

  it('plie les lignes > 75 octets avec CRLF + espace de continuation', () => {
    const line = 'A'.repeat(150)
    const folded = foldLine(line)
    expect(folded).toContain('\r\n ')
    // Chaque ligne individuellement ≤ 75 octets
    for (const chunk of folded.split('\r\n')) {
      const bytes = new TextEncoder().encode(chunk).length
      expect(bytes).toBeLessThanOrEqual(75)
    }
  })

  it('ne coupe pas un caractère UTF-8 multibyte au milieu', () => {
    // 40 caractères "é" = 80 octets en UTF-8
    const line = 'é'.repeat(40)
    const folded = foldLine(line)
    // Reconstituable sans diagnostic
    const rebuilt = folded.split('\r\n').map((l, i) => i === 0 ? l : l.slice(1)).join('')
    expect(rebuilt).toBe(line)
  })
})


// ─── formatUTC / formatDate / formatExdateDate ──────────────────────────────
describe('formatUTC', () => {
  it('formate un ISO string en YYYYMMDDTHHMMSSZ', () => {
    expect(formatUTC('2026-04-20T08:15:30.000Z')).toBe('20260420T081530Z')
  })
  it('accepte une Date', () => {
    expect(formatUTC(new Date('2026-01-01T00:00:00Z'))).toBe('20260101T000000Z')
  })
})

describe('formatDate', () => {
  it('formate en YYYYMMDD', () => {
    expect(formatDate('2026-04-20T08:00:00Z')).toBe('20260420')
  })
})

describe('formatExdateDate', () => {
  it('supprime les tirets', () => {
    expect(formatExdateDate('2026-04-22')).toBe('20260422')
  })
})


// ─── toICSRrule ─────────────────────────────────────────────────────────────
describe('toICSRrule', () => {
  it('retourne null si rrule invalide', () => {
    expect(toICSRrule(null)).toBeNull()
    expect(toICSRrule({})).toBeNull()
    expect(toICSRrule({ freq: 'yearly' })).toBeNull()
  })

  it('daily, interval 1, sans fin → FREQ=DAILY', () => {
    expect(toICSRrule({ freq: 'daily', interval: 1, end_type: 'never' }))
      .toBe('FREQ=DAILY')
  })

  it('daily, interval 3 → FREQ=DAILY;INTERVAL=3', () => {
    expect(toICSRrule({ freq: 'daily', interval: 3, end_type: 'never' }))
      .toBe('FREQ=DAILY;INTERVAL=3')
  })

  it('weekly avec byweekday → BYDAY trié (Lun, Mer, Ven)', () => {
    expect(toICSRrule({
      freq: 'weekly', interval: 1, byweekday: [4, 0, 2], end_type: 'never',
    })).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
  })

  it('weekly, end_type count → COUNT=10', () => {
    expect(toICSRrule({
      freq: 'weekly', interval: 1, byweekday: [1], end_type: 'count', count: 10,
    })).toBe('FREQ=WEEKLY;BYDAY=TU;COUNT=10')
  })

  it('weekly, end_type until → UNTIL UTC', () => {
    expect(toICSRrule({
      freq: 'weekly', interval: 2, byweekday: [0], end_type: 'until',
      until: '2026-06-01T00:00:00.000Z',
    })).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;UNTIL=20260601T000000Z')
  })

  it('monthly → FREQ=MONTHLY', () => {
    expect(toICSRrule({ freq: 'monthly', interval: 1, end_type: 'never' }))
      .toBe('FREQ=MONTHLY')
  })

  it('dédoublonne les byweekday dupliqués', () => {
    expect(toICSRrule({
      freq: 'weekly', interval: 1, byweekday: [0, 0, 2, 2], end_type: 'never',
    })).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
  })
})


// ─── buildICS — forme globale ───────────────────────────────────────────────
describe('buildICS — squelette VCALENDAR', () => {
  it('émet un calendrier vide valide', () => {
    const ics = buildICS([], { now: FIXED_NOW })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('PRODID:-//Captiv Desk//Planning//FR')
    expect(ics).toContain('CALSCALE:GREGORIAN')
    expect(ics).toContain('METHOD:PUBLISH')
    expect(ics).toContain('X-WR-TIMEZONE:Europe/Paris')
    expect(ics).toContain('END:VCALENDAR')
    // Pas de VEVENT si events vide
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('utilise CRLF comme séparateur de ligne', () => {
    const ics = buildICS([], { now: FIXED_NOW })
    expect(ics).toMatch(/\r\n/)
    // Pas de \n orphelin (sans \r devant)
    const bareLF = ics.replace(/\r\n/g, '').indexOf('\n')
    expect(bareLF).toBe(-1)
  })

  it('applique le PRODID custom et X-WR-CALNAME', () => {
    const ics = buildICS([], {
      now: FIXED_NOW,
      prodid: '-//Test//EN',
      calName: 'Mon planning',
    })
    expect(ics).toContain('PRODID:-//Test//EN')
    expect(ics).toContain('X-WR-CALNAME:Mon planning')
  })

  it('skip les events invalides (sans id ou sans dates)', () => {
    const ics = buildICS([
      null,
      { id: null, starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-01-01T01:00:00Z' },
      { id: 'x', starts_at: null, ends_at: '2026-01-01T01:00:00Z' },
    ], { now: FIXED_NOW })
    expect(ics).not.toContain('BEGIN:VEVENT')
  })
})


// ─── buildICS — VEVENT timé ─────────────────────────────────────────────────
describe('buildICS — VEVENT timé', () => {
  it('émet UID, DTSTAMP, DTSTART/DTEND en UTC, SUMMARY', () => {
    const ics = buildICS([mkEvent()], { now: FIXED_NOW })
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('UID:evt-1@captiv.cc')
    expect(ics).toContain('DTSTAMP:20260419T120000Z')
    expect(ics).toContain('DTSTART:20260420T080000Z')
    expect(ics).toContain('DTEND:20260420T170000Z')
    expect(ics).toContain('SUMMARY:Tournage')
    expect(ics).toContain('END:VEVENT')
  })

  it('échappe correctement les caractères spéciaux du SUMMARY', () => {
    const ics = buildICS([mkEvent({
      title: 'Scène 1, prise 3 ; notes: voir',
    })], { now: FIXED_NOW })
    expect(ics).toContain('SUMMARY:Scène 1\\, prise 3 \\; notes: voir')
  })

  it('concatène description + notes dans DESCRIPTION', () => {
    const ics = buildICS([mkEvent({
      description: 'Tournage séquence',
      notes: 'Prévoir eau',
    })], { now: FIXED_NOW })
    expect(ics).toContain('DESCRIPTION:Tournage séquence\\n\\nPrévoir eau')
  })

  it('émet LOCATION et URL séparément', () => {
    const ics = buildICS([mkEvent({
      location: 'Studio A',
      external_url: 'https://example.com/sheet',
    })], { now: FIXED_NOW })
    expect(ics).toContain('LOCATION:Studio A')
    expect(ics).toContain('URL:https://example.com/sheet')
  })

  it('utilise un title par défaut si vide', () => {
    const ics = buildICS([mkEvent({ title: null })], { now: FIXED_NOW })
    expect(ics).toContain('SUMMARY:Sans titre')
  })

  it('préserve l\'UID custom si fourni', () => {
    const ics = buildICS([mkEvent({ uid: 'custom-uid-123@other.com' })], { now: FIXED_NOW })
    expect(ics).toContain('UID:custom-uid-123@other.com')
  })
})


// ─── buildICS — VEVENT all-day ──────────────────────────────────────────────
describe('buildICS — VEVENT all-day', () => {
  it('émet DTSTART/DTEND avec VALUE=DATE', () => {
    const ics = buildICS([mkEvent({
      all_day: true,
      starts_at: '2026-04-20T00:00:00Z',
      ends_at:   '2026-04-21T00:00:00Z',
    })], { now: FIXED_NOW })
    expect(ics).toContain('DTSTART;VALUE=DATE:20260420')
    expect(ics).toContain('DTEND;VALUE=DATE:20260421')
    expect(ics).not.toMatch(/DTSTART:\d{8}T/)
  })
})


// ─── buildICS — RRULE + EXDATE ──────────────────────────────────────────────
describe('buildICS — RRULE + EXDATE', () => {
  it('émet RRULE pour un event récurrent weekly', () => {
    const ics = buildICS([mkEvent({
      rrule: { freq: 'weekly', interval: 1, byweekday: [0, 2, 4], end_type: 'never' },
    })], { now: FIXED_NOW })
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR')
  })

  it('émet EXDATE pour un event timé avec exceptions', () => {
    // Master à 08:00 UTC = 10:00 Paris (CEST en avril). L'exdate "2026-04-27"
    // doit recomposer 10:00 Paris local puis sérialiser en UTC (08:00 Z).
    // Le test s'exécute en TZ système — on vérifie juste la forme.
    const ics = buildICS([mkEvent({
      rrule: { freq: 'weekly', interval: 1, byweekday: [0], end_type: 'never' },
      rrule_exdates: ['2026-04-27'],
    })], { now: FIXED_NOW })
    expect(ics).toMatch(/EXDATE:\d{8}T\d{6}Z/)
  })

  it('émet EXDATE;VALUE=DATE pour un event all-day', () => {
    const ics = buildICS([mkEvent({
      all_day: true,
      starts_at: '2026-04-20T00:00:00Z',
      ends_at:   '2026-04-21T00:00:00Z',
      rrule: { freq: 'daily', interval: 1, end_type: 'never' },
      rrule_exdates: ['2026-04-22', '2026-04-23'],
    })], { now: FIXED_NOW })
    expect(ics).toContain('EXDATE;VALUE=DATE:20260422,20260423')
  })

  it('filtre les exdates malformés', () => {
    const ics = buildICS([mkEvent({
      all_day: true,
      starts_at: '2026-04-20T00:00:00Z',
      ends_at:   '2026-04-21T00:00:00Z',
      rrule: { freq: 'daily', interval: 1, end_type: 'never' },
      rrule_exdates: ['2026-04-22', 'invalid', ''],
    })], { now: FIXED_NOW })
    expect(ics).toContain('EXDATE;VALUE=DATE:20260422')
  })

  it('n\'émet pas d\'EXDATE si rrule_exdates est vide', () => {
    const ics = buildICS([mkEvent({
      rrule: { freq: 'weekly', interval: 1, byweekday: [0], end_type: 'never' },
      rrule_exdates: [],
    })], { now: FIXED_NOW })
    expect(ics).not.toContain('EXDATE')
  })

  it('ne casse pas sur un rrule invalide (null retour de toICSRrule)', () => {
    const ics = buildICS([mkEvent({
      rrule: { freq: 'yearly' },  // non supporté
    })], { now: FIXED_NOW })
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).not.toContain('RRULE:')
  })
})


// ─── buildICS — multi-events + ordering ─────────────────────────────────────
describe('buildICS — plusieurs events', () => {
  it('émet plusieurs VEVENT dans l\'ordre reçu', () => {
    const ics = buildICS([
      mkEvent({ id: 'e1', title: 'Premier' }),
      mkEvent({ id: 'e2', title: 'Second' }),
    ], { now: FIXED_NOW })
    const firstUid = ics.indexOf('UID:e1@captiv.cc')
    const secondUid = ics.indexOf('UID:e2@captiv.cc')
    expect(firstUid).toBeGreaterThan(-1)
    expect(secondUid).toBeGreaterThan(firstUid)
  })

  it('se termine par END:VCALENDAR + CRLF', () => {
    const ics = buildICS([mkEvent()], { now: FIXED_NOW })
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})
