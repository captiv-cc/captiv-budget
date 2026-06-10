/**
 * Tests unitaires — rrule.js
 * Valide l'expansion, la validation et la description des règles de récurrence.
 */
import { describe, it, expect } from 'vitest'
import {
  validateRrule,
  expandEvent,
  expandEvents,
  occurrenceKey,
  defaultRrule,
  describeRrule,
} from './rrule'

// Helper : crée un event master minimal
function mkEvent(starts, ends, rrule = null, exdates = null) {
  return {
    id: 'evt-1',
    starts_at: new Date(starts).toISOString(),
    ends_at:   new Date(ends).toISOString(),
    title: 'Test',
    rrule,
    rrule_exdates: exdates,
  }
}

// ─── occurrenceKey ───────────────────────────────────────────────────────────
describe('occurrenceKey', () => {
  it('retourne YYYY-MM-DD local pour une date', () => {
    const d = new Date(2026, 0, 5, 10, 30) // 5 janvier 2026, 10h30 local
    expect(occurrenceKey(d)).toBe('2026-01-05')
  })
  it('accepte une string ISO', () => {
    expect(occurrenceKey(new Date(2026, 2, 15).toISOString())).toBe('2026-03-15')
  })
})

// ─── defaultRrule ────────────────────────────────────────────────────────────
describe('defaultRrule', () => {
  it('retourne weekly / interval 1 / byweekday aligné / never', () => {
    const monday = new Date(2026, 0, 5) // lundi
    const r = defaultRrule(monday)
    expect(r.freq).toBe('weekly')
    expect(r.interval).toBe(1)
    expect(r.byweekday).toEqual([0]) // lundi = 0
    expect(r.end_type).toBe('never')
  })
})

// ─── validateRrule ───────────────────────────────────────────────────────────
describe('validateRrule', () => {
  it('refuse un objet null / invalide', () => {
    expect(validateRrule(null).ok).toBe(false)
    expect(validateRrule({ freq: 'hourly' }).ok).toBe(false)
  })
  it('exige au moins un byweekday pour weekly', () => {
    const r = validateRrule({ freq: 'weekly', end_type: 'never' })
    expect(r.ok).toBe(false)
  })
  it('normalise byweekday (dedupe + sort)', () => {
    const r = validateRrule({ freq: 'weekly', byweekday: [3, 1, 1], end_type: 'never' })
    expect(r.ok).toBe(true)
    expect(r.value.byweekday).toEqual([1, 3])
  })
  it('clampe count hors bornes', () => {
    const r = validateRrule({ freq: 'daily', end_type: 'count', count: 0 })
    expect(r.ok).toBe(false)
  })
  it('valide une date until', () => {
    const r = validateRrule({ freq: 'daily', end_type: 'until', until: '2026-06-01T00:00:00Z' })
    expect(r.ok).toBe(true)
    expect(r.value.until).toBe(new Date('2026-06-01T00:00:00Z').toISOString())
  })
})

// ─── expandEvent — base cases ────────────────────────────────────────────────
describe('expandEvent', () => {
  it('retourne l\'event tel quel si pas de rrule', () => {
    const ev = mkEvent('2026-01-05T09:00', '2026-01-05T10:00', null)
    const out = expandEvent(ev, new Date('2026-01-01'), new Date('2026-01-31'))
    expect(out).toHaveLength(1)
    expect(out[0]._recurring).toBe(false)
    expect(out[0]._master_id).toBe('evt-1')
  })

  it('daily — génère chaque jour jusqu\'à count', () => {
    const ev = mkEvent(
      '2026-01-05T09:00', '2026-01-05T10:00',
      { freq: 'daily', interval: 1, end_type: 'count', count: 5 },
    )
    const out = expandEvent(ev, new Date('2026-01-01'), new Date('2026-01-31'))
    expect(out).toHaveLength(5)
    expect(out[0]._is_occurrence).toBe(false)
    expect(out[1]._is_occurrence).toBe(true)
  })

  it('daily — respecte l\'intervalle (tous les 2 jours)', () => {
    const ev = mkEvent(
      '2026-01-05T09:00', '2026-01-05T10:00',
      { freq: 'daily', interval: 2, end_type: 'count', count: 3 },
    )
    const out = expandEvent(ev, new Date('2026-01-01'), new Date('2026-01-31'))
    expect(out).toHaveLength(3)
    const days = out.map((o) => new Date(o.starts_at).getDate())
    expect(days).toEqual([5, 7, 9])
  })

  it('weekly — émet sur les jours byweekday', () => {
    const ev = mkEvent(
      '2026-01-05T09:00', '2026-01-05T10:00', // lundi 5 janvier 2026
      { freq: 'weekly', interval: 1, byweekday: [0, 2], end_type: 'count', count: 4 },
    )
    const out = expandEvent(ev, new Date('2026-01-01'), new Date('2026-01-31'))
    expect(out).toHaveLength(4)
    // attend: lun 5, mer 7, lun 12, mer 14
    const days = out.map((o) => new Date(o.starts_at).getDate())
    expect(days).toEqual([5, 7, 12, 14])
  })

  it('weekly avec interval 2 — saute une semaine', () => {
    const ev = mkEvent(
      '2026-01-05T09:00', '2026-01-05T10:00',
      { freq: 'weekly', interval: 2, byweekday: [0], end_type: 'count', count: 3 },
    )
    const out = expandEvent(ev, new Date('2026-01-01'), new Date('2026-03-31'))
    expect(out).toHaveLength(3)
    const days = out.map((o) => new Date(o.starts_at).toISOString().slice(0, 10))
    expect(days).toEqual(['2026-01-05', '2026-01-19', '2026-02-02'])
  })

  it('monthly — clampe au dernier jour du mois si le mois est plus court', () => {
    const ev = mkEvent(
      '2026-01-31T09:00', '2026-01-31T10:00',
      { freq: 'monthly', interval: 1, end_type: 'count', count: 3 },
    )
    const out = expandEvent(ev, new Date('2026-01-01'), new Date('2026-12-31'))
    expect(out).toHaveLength(3)
    const days = out.map((o) => new Date(o.starts_at).toISOString().slice(0, 10))
    // janvier 31, février 28 (clampé), mars 31
    expect(days[0]).toBe('2026-01-31')
    expect(days[1]).toBe('2026-02-28')
    expect(days[2]).toBe('2026-03-31')
  })

  it('end_type until — s\'arrête à la date limite', () => {
    const ev = mkEvent(
      '2026-01-05T09:00', '2026-01-05T10:00',
      {
        freq: 'daily', interval: 1, end_type: 'until',
        until: new Date('2026-01-08T00:00').toISOString(),
      },
    )
    const out = expandEvent(ev, new Date('2026-01-01'), new Date('2026-01-31'))
    // until exclusif de la date du 8 car starts_at = 9h ; 5,6,7 seuls
    expect(out.length).toBeGreaterThanOrEqual(3)
    expect(out.length).toBeLessThanOrEqual(4)
  })

  it('exdates — exclut les dates listées', () => {
    const ev = mkEvent(
      '2026-01-05T09:00', '2026-01-05T10:00',
      { freq: 'daily', interval: 1, end_type: 'count', count: 5 },
      ['2026-01-06', '2026-01-08'],
    )
    const out = expandEvent(ev, new Date('2026-01-01'), new Date('2026-01-31'))
    const days = out.map((o) => new Date(o.starts_at).toISOString().slice(0, 10))
    expect(days).toEqual(['2026-01-05', '2026-01-07', '2026-01-09'])
  })

  it('ne retourne rien si la fenêtre est avant le master', () => {
    const ev = mkEvent(
      '2026-01-05T09:00', '2026-01-05T10:00',
      { freq: 'daily', interval: 1, end_type: 'count', count: 3 },
    )
    const out = expandEvent(ev, new Date('2025-12-01'), new Date('2025-12-31'))
    expect(out).toHaveLength(0)
  })

  it('métadonnées internes cohérentes', () => {
    const ev = mkEvent(
      '2026-01-05T09:00', '2026-01-05T10:00',
      { freq: 'daily', interval: 1, end_type: 'count', count: 2 },
    )
    const out = expandEvent(ev, new Date('2026-01-01'), new Date('2026-01-31'))
    expect(out[0]._master_id).toBe('evt-1')
    expect(out[0]._occurrence_key).toBe('2026-01-05')
    expect(out[0]._master_starts_at).toBe(ev.starts_at)
    expect(out[0]._recurring).toBe(true)
    expect(out[1]._occurrence_key).toBe('2026-01-06')
  })
})

// ─── expandEvents (convenience) ──────────────────────────────────────────────
describe('expandEvents', () => {
  it('expand multiple events', () => {
    const a = mkEvent('2026-01-05T09:00', '2026-01-05T10:00', null)
    const b = mkEvent(
      '2026-01-05T14:00', '2026-01-05T15:00',
      { freq: 'daily', interval: 1, end_type: 'count', count: 3 },
    )
    b.id = 'evt-2'
    const out = expandEvents([a, b], new Date('2026-01-01'), new Date('2026-01-31'))
    expect(out).toHaveLength(1 + 3)
  })
})

// ─── describeRrule ───────────────────────────────────────────────────────────
describe('describeRrule', () => {
  it('null → "Événement unique"', () => {
    expect(describeRrule(null)).toBe('Événement unique')
  })
  it('daily interval 1', () => {
    expect(describeRrule({ freq: 'daily', interval: 1, end_type: 'never' })).toContain('Tous les jours')
  })
  it('weekly avec byweekday', () => {
    const desc = describeRrule({ freq: 'weekly', interval: 1, byweekday: [0, 2], end_type: 'never' })
    expect(desc).toContain('Lun')
    expect(desc).toContain('Mer')
  })
  it('count → mentionne les occurrences', () => {
    const desc = describeRrule({ freq: 'daily', interval: 1, end_type: 'count', count: 10 })
    expect(desc).toContain('10 occurrences')
  })
})
