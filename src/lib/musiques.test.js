// Tests unitaires lib/musiques.js + lib/projetArtistes.js
//
// Couvre les helpers purs (sans accès Supabase). Les fonctions de CRUD sont
// testées par les smoke tests E2E plus tard.

import { describe, it, expect } from 'vitest'
import { normalizeNom } from './projetArtistes'
import {
  STATUTS,
  STATUT_LABELS,
  normalizeTag,
  computeAggregates,
} from './musiques'

describe('normalizeNom', () => {
  it('retire les accents', () => {
    expect(normalizeNom('Tiësto')).toBe('tiesto')
  })
  it('lowercase et trim', () => {
    expect(normalizeNom('  Charlotte De Witte  ')).toBe('charlotte de witte')
  })
  it('retire la ponctuation', () => {
    expect(normalizeNom('Bigflo & Oli')).toBe('bigflo oli')
  })
  it('gère le O barré', () => {
    expect(normalizeNom('MØDE')).toBe('mode')
  })
  it('retire signes monétaires', () => {
    expect(normalizeNom('BU$HI')).toBe('bu hi')
  })
  it('condense les espaces multiples', () => {
    expect(normalizeNom('Hello    World')).toBe('hello world')
  })
  it('input vide → string vide', () => {
    expect(normalizeNom('')).toBe('')
    expect(normalizeNom('   ')).toBe('')
  })
  it('input non-string → string vide', () => {
    expect(normalizeNom(null)).toBe('')
    expect(normalizeNom(undefined)).toBe('')
    expect(normalizeNom(42)).toBe('')
  })
  it('cas Hugo : Peggy Gou', () => {
    expect(normalizeNom('Peggy Gou')).toBe('peggy gou')
  })
  it('cas Hugo : Eric PRYDZ → eric prydz', () => {
    expect(normalizeNom('Eric PRYDZ')).toBe('eric prydz')
  })
  it('match flou : "anetha" matche "Anetha"', () => {
    expect(normalizeNom('Anetha')).toBe(normalizeNom('anetha'))
  })
  it('match flou : "Bigflo Oli" matche "Bigflo & Oli"', () => {
    expect(normalizeNom('Bigflo Oli')).toBe(normalizeNom('Bigflo & Oli'))
  })
})

describe('normalizeTag', () => {
  it('lowercase et trim', () => {
    expect(normalizeTag('  Drop Banger  ')).toBe('drop banger')
  })
  it('limite à 40 chars', () => {
    const long = 'x'.repeat(50)
    expect(normalizeTag(long).length).toBe(40)
  })
  it('input vide', () => {
    expect(normalizeTag('')).toBe('')
    expect(normalizeTag(null)).toBe('')
  })
  it('garde les accents (pas comme normalizeNom)', () => {
    // Les tags peuvent contenir des accents (l'utilisateur tape "fémelle"
    // ou "naïf") — on ne décompose pas, pour rester fidèle à la saisie.
    expect(normalizeTag('Énergique')).toBe('énergique')
  })
})

describe('STATUTS', () => {
  it('contient 6 statuts dans l\'ordre du cycle de vie', () => {
    expect(STATUTS).toEqual([
      'vrac',
      'selectionne',
      'valide_festival',
      'en_nego',
      'accorde',
      'refuse',
    ])
  })
  it('chaque statut a un libellé', () => {
    for (const s of STATUTS) {
      expect(STATUT_LABELS[s]).toBeTruthy()
    }
  })
})

describe('computeAggregates', () => {
  it('calcule la moyenne et le count', () => {
    const notes = [
      { proposition_id: 'p1', user_id: 'u1', note: 5 },
      { proposition_id: 'p1', user_id: 'u2', note: 4 },
      { proposition_id: 'p1', user_id: 'u3', note: 3 },
    ]
    const out = computeAggregates(notes, [], null)
    const p1 = out.get('p1')
    expect(p1.noteAvg).toBe(4) // (5+4+3)/3 = 4.0
    expect(p1.noteCount).toBe(3)
    expect(p1.myNote).toBeNull()
  })
  it('identifie ma note', () => {
    const notes = [
      { proposition_id: 'p1', user_id: 'u1', note: 5 },
      { proposition_id: 'p1', user_id: 'u2', note: 4 },
    ]
    const out = computeAggregates(notes, [], 'u1')
    expect(out.get('p1').myNote).toBe(5)
  })
  it('arrondit à 1 décimale', () => {
    const notes = [
      { proposition_id: 'p1', user_id: 'u1', note: 5 },
      { proposition_id: 'p1', user_id: 'u2', note: 4 },
      { proposition_id: 'p1', user_id: 'u3', note: 4 },
    ]
    const out = computeAggregates(notes, [], null)
    expect(out.get('p1').noteAvg).toBe(4.3) // (5+4+4)/3 = 4.33 → 4.3
  })
  it('agrège les tags par proposition', () => {
    const tags = [
      { id: 't1', proposition_id: 'p1', tag: 'drop banger', user_id: 'u1' },
      { id: 't2', proposition_id: 'p1', tag: 'techno', user_id: 'u2' },
      { id: 't3', proposition_id: 'p2', tag: 'chill', user_id: 'u1' },
    ]
    const out = computeAggregates([], tags, null)
    expect(out.get('p1').tags).toHaveLength(2)
    expect(out.get('p1').tags[0].tag).toBe('drop banger')
    expect(out.get('p2').tags).toHaveLength(1)
  })
  it('combine notes et tags', () => {
    const notes = [{ proposition_id: 'p1', user_id: 'u1', note: 5 }]
    const tags = [{ id: 't1', proposition_id: 'p1', tag: 'banger', user_id: 'u1' }]
    const out = computeAggregates(notes, tags, 'u1')
    const p1 = out.get('p1')
    expect(p1.noteAvg).toBe(5)
    expect(p1.tags).toHaveLength(1)
    expect(p1.myNote).toBe(5)
  })
  it('proposition sans notes ni tags absente', () => {
    const out = computeAggregates([], [], null)
    expect(out.size).toBe(0)
  })
})
