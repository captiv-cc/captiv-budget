// ════════════════════════════════════════════════════════════════════════════
// sessions.test.js — Tests unitaires des helpers purs de sessions.js
// ════════════════════════════════════════════════════════════════════════════
//
// Couvre les helpers in-memory (pas de hit Supabase) :
//   - paletteAt / effectiveCouleur
//   - effectiveLabel
//   - effectiveLieu
//   - getActiveSessionForDay
//   - aggregateSessionsToMembre
//   - hasMultipleSessions
//   - sortSessions
//   - groupSessionsByMembre
//   - buildDayToSessionMap
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import {
  SESSION_PALETTE,
  paletteAt,
  effectiveCouleur,
  effectiveLabel,
  effectiveLieu,
  getActiveSessionForDay,
  aggregateSessionsToMembre,
  hasMultipleSessions,
  sortSessions,
  groupSessionsByMembre,
  buildDayToSessionMap,
} from './sessions'

// ── paletteAt / effectiveCouleur ──────────────────────────────────────────
describe('paletteAt', () => {
  it('retourne la 1ère couleur pour sort_order=1', () => {
    expect(paletteAt(1)).toBe(SESSION_PALETTE[0])
  })

  it('cycle après épuisement de la palette', () => {
    expect(paletteAt(1)).toBe(paletteAt(1 + SESSION_PALETTE.length))
  })

  it('gère les valeurs aberrantes', () => {
    expect(paletteAt(0)).toBe(SESSION_PALETTE[0])
    expect(paletteAt(null)).toBe(SESSION_PALETTE[0])
    expect(paletteAt(undefined)).toBe(SESSION_PALETTE[0])
  })
})

describe('effectiveCouleur', () => {
  it('respecte la couleur custom de la session', () => {
    expect(effectiveCouleur({ sort_order: 1, couleur: 'FF0000' })).toBe('FF0000')
  })

  it('tombe sur la palette si pas de couleur', () => {
    expect(effectiveCouleur({ sort_order: 2, couleur: null })).toBe(SESSION_PALETTE[1])
  })

  it('gère session null', () => {
    expect(effectiveCouleur(null)).toBe(SESSION_PALETTE[0])
  })
})

// ── effectiveLabel ────────────────────────────────────────────────────────
describe('effectiveLabel', () => {
  it('retourne le label saisi', () => {
    expect(effectiveLabel({ sort_order: 1, label: 'Essais' })).toBe('Essais')
  })

  it('trim le label', () => {
    expect(effectiveLabel({ sort_order: 1, label: '  Tournage  ' })).toBe('Tournage')
  })

  it('fallback "Session N" si vide', () => {
    expect(effectiveLabel({ sort_order: 1, label: '' })).toBe('Session 1')
    expect(effectiveLabel({ sort_order: 2, label: null })).toBe('Session 2')
    expect(effectiveLabel({ sort_order: 3 })).toBe('Session 3')
  })

  it('gère session null', () => {
    expect(effectiveLabel(null)).toBe('')
  })
})

// ── effectiveLieu ─────────────────────────────────────────────────────────
describe('effectiveLieu', () => {
  it('retourne le nom du lieu structuré si fourni', () => {
    const lieuById = { 'lieu-paris': { nom: 'Studio Paris 11' } }
    expect(
      effectiveLieu({ lieu_principal_id: 'lieu-paris', lieu_principal_text: 'Paris' }, lieuById),
    ).toBe('Studio Paris 11')
  })

  it('fallback texte libre si pas de map ou lieu inconnu', () => {
    expect(effectiveLieu({ lieu_principal_id: 'unknown', lieu_principal_text: 'Paris' })).toBe('Paris')
    expect(effectiveLieu({ lieu_principal_text: 'Mtp' })).toBe('Mtp')
  })

  it('retourne string vide si rien', () => {
    expect(effectiveLieu({})).toBe('')
    expect(effectiveLieu(null)).toBe('')
  })
})

// ── getActiveSessionForDay ────────────────────────────────────────────────
describe('getActiveSessionForDay', () => {
  const session1 = {
    id: 's1',
    sort_order: 1,
    arrival_date: '2026-05-11',
    departure_date: '2026-05-13',
    presence_days: ['2026-05-12'],
  }
  const session2 = {
    id: 's2',
    sort_order: 2,
    arrival_date: '2026-05-14',
    departure_date: '2026-05-18',
    presence_days: ['2026-05-14', '2026-05-15', '2026-05-16', '2026-05-17'],
  }

  it('match prioritaire par presence_days', () => {
    expect(getActiveSessionForDay([session1, session2], '2026-05-12')?.id).toBe('s1')
    expect(getActiveSessionForDay([session1, session2], '2026-05-15')?.id).toBe('s2')
  })

  it('fallback range arrival↔departure pour les jours transit', () => {
    // 11/05 = jour transit (arrival mais pas presence)
    expect(getActiveSessionForDay([session1, session2], '2026-05-11')?.id).toBe('s1')
    // 13/05 = jour transit (departure mais pas presence)
    expect(getActiveSessionForDay([session1, session2], '2026-05-13')?.id).toBe('s1')
    // 18/05 = jour transit (departure session 2)
    expect(getActiveSessionForDay([session1, session2], '2026-05-18')?.id).toBe('s2')
  })

  it('null si aucune session ne match', () => {
    expect(getActiveSessionForDay([session1, session2], '2026-05-20')).toBeNull()
  })

  it('null sur input vide', () => {
    expect(getActiveSessionForDay([], '2026-05-12')).toBeNull()
    expect(getActiveSessionForDay(null, '2026-05-12')).toBeNull()
    expect(getActiveSessionForDay([session1], null)).toBeNull()
  })
})

// ── aggregateSessionsToMembre ─────────────────────────────────────────────
describe('aggregateSessionsToMembre', () => {
  it('agrège correctement 2 sessions', () => {
    const sessions = [
      {
        sort_order: 1,
        arrival_date: '2026-05-11',
        departure_date: '2026-05-13',
        presence_days: ['2026-05-12'],
      },
      {
        sort_order: 2,
        arrival_date: '2026-05-14',
        departure_date: '2026-05-18',
        presence_days: ['2026-05-14', '2026-05-15', '2026-05-16', '2026-05-17'],
      },
    ]
    const result = aggregateSessionsToMembre(sessions)
    expect(result.arrival_date).toBe('2026-05-11')
    expect(result.departure_date).toBe('2026-05-18')
    expect(result.presence_days).toEqual([
      '2026-05-12',
      '2026-05-14',
      '2026-05-15',
      '2026-05-16',
      '2026-05-17',
    ])
  })

  it('gère 1 session simple', () => {
    const sessions = [
      {
        sort_order: 1,
        arrival_date: '2026-05-12',
        departure_date: '2026-05-17',
        presence_days: ['2026-05-12', '2026-05-13', '2026-05-14'],
      },
    ]
    const result = aggregateSessionsToMembre(sessions)
    expect(result.arrival_date).toBe('2026-05-12')
    expect(result.departure_date).toBe('2026-05-17')
    expect(result.presence_days).toEqual(['2026-05-12', '2026-05-13', '2026-05-14'])
  })

  it('dédoublonne les presence_days répétés entre sessions', () => {
    const sessions = [
      { presence_days: ['2026-05-12', '2026-05-13'] },
      { presence_days: ['2026-05-13', '2026-05-14'] },
    ]
    const result = aggregateSessionsToMembre(sessions)
    expect(result.presence_days).toEqual(['2026-05-12', '2026-05-13', '2026-05-14'])
  })

  it('retourne valeurs vides sur input vide', () => {
    expect(aggregateSessionsToMembre([])).toEqual({
      arrival_date: null,
      departure_date: null,
      presence_days: [],
    })
    expect(aggregateSessionsToMembre(null)).toEqual({
      arrival_date: null,
      departure_date: null,
      presence_days: [],
    })
  })
})

// ── hasMultipleSessions ───────────────────────────────────────────────────
describe('hasMultipleSessions', () => {
  it('false pour 0-1 session', () => {
    expect(hasMultipleSessions([])).toBe(false)
    expect(hasMultipleSessions([{ statut: 'confirme' }])).toBe(false)
  })

  it('true pour 2+ sessions actives', () => {
    expect(
      hasMultipleSessions([
        { statut: 'confirme' },
        { statut: 'planifie' },
      ]),
    ).toBe(true)
  })

  it('ignore les sessions annulées', () => {
    expect(
      hasMultipleSessions([
        { statut: 'confirme' },
        { statut: 'annule' },
      ]),
    ).toBe(false)
  })
})

// ── sortSessions ──────────────────────────────────────────────────────────
describe('sortSessions', () => {
  it('trie par sort_order croissant', () => {
    const input = [
      { id: 'b', sort_order: 2 },
      { id: 'a', sort_order: 1 },
      { id: 'c', sort_order: 3 },
    ]
    const sorted = sortSessions(input)
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    // Ne mute pas l'input
    expect(input.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })

  it('gère array vide ou null', () => {
    expect(sortSessions([])).toEqual([])
    expect(sortSessions(null)).toEqual([])
  })
})

// ── groupSessionsByMembre ─────────────────────────────────────────────────
describe('groupSessionsByMembre', () => {
  it('regroupe par membre_id et trie chaque groupe', () => {
    const sessions = [
      { id: 'a', membre_id: 'hugo', sort_order: 2 },
      { id: 'b', membre_id: 'kelly', sort_order: 1 },
      { id: 'c', membre_id: 'hugo', sort_order: 1 },
    ]
    const grouped = groupSessionsByMembre(sessions)
    expect(grouped.size).toBe(2)
    expect(grouped.get('hugo').map((s) => s.id)).toEqual(['c', 'a'])
    expect(grouped.get('kelly').map((s) => s.id)).toEqual(['b'])
  })

  it('ignore les sessions sans membre_id', () => {
    const grouped = groupSessionsByMembre([
      { id: 'a', membre_id: null },
      { id: 'b', membre_id: 'kelly' },
    ])
    expect(grouped.size).toBe(1)
    expect(grouped.has('kelly')).toBe(true)
  })

  it('retourne Map vide sur input vide', () => {
    expect(groupSessionsByMembre([]).size).toBe(0)
    expect(groupSessionsByMembre(null).size).toBe(0)
  })
})

// ── buildDayToSessionMap ──────────────────────────────────────────────────
describe('buildDayToSessionMap', () => {
  it('mappe chaque jour à la session active correspondante', () => {
    const sessions = [
      {
        id: 's1',
        sort_order: 1,
        arrival_date: '2026-05-11',
        departure_date: '2026-05-13',
        presence_days: ['2026-05-12'],
      },
      {
        id: 's2',
        sort_order: 2,
        arrival_date: '2026-05-14',
        departure_date: '2026-05-18',
        presence_days: ['2026-05-14', '2026-05-15'],
      },
    ]
    const days = ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15', '2026-05-19']
    const map = buildDayToSessionMap(sessions, days)
    expect(map.get('2026-05-11')).toBe('s1') // transit
    expect(map.get('2026-05-12')).toBe('s1') // presence
    expect(map.get('2026-05-13')).toBe('s1') // transit
    expect(map.get('2026-05-14')).toBe('s2') // presence
    expect(map.get('2026-05-15')).toBe('s2') // presence
    expect(map.get('2026-05-19')).toBeNull() // hors session
  })

  it('retourne Map vide si days vide', () => {
    expect(buildDayToSessionMap([], []).size).toBe(0)
    expect(buildDayToSessionMap(null, []).size).toBe(0)
  })
})
