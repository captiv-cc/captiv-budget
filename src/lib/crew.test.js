// ════════════════════════════════════════════════════════════════════════════
// crew.test.js — Tests unitaires des helpers purs de crew.js
// ════════════════════════════════════════════════════════════════════════════
//
// Couvre les helpers in-memory (pas de hit Supabase) :
//   - personaKey
//   - groupByPerson
//   - groupByCategory
//   - listCategories
//   - condensePresenceDays
//   - distributeForfait
//   - fullNameFromPersona / initialsFromPersona / effectiveSecteur
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import {
  personaKey,
  groupByPerson,
  groupByCategory,
  listCategories,
  condensePresenceDays,
  distributeForfait,
  fullNameFromPersona,
  initialsFromPersona,
  effectiveSecteur,
  DEFAULT_CATEGORIES,
} from './crew.js'

describe('personaKey', () => {
  it('retourne contact_id si présent', () => {
    expect(personaKey({ contact_id: 'abc' })).toBe('abc')
  })

  it('fallback sur name:prenom|nom si pas de contact_id', () => {
    expect(personaKey({ prenom: 'Hugo', nom: 'Martin' })).toBe('name:Hugo|Martin')
  })

  it('trim les espaces du fallback', () => {
    expect(personaKey({ prenom: '  Hugo ', nom: ' Martin  ' })).toBe('name:Hugo|Martin')
  })

  it('gère les valeurs manquantes', () => {
    expect(personaKey({})).toBe('name:|')
    expect(personaKey({ prenom: 'Hugo' })).toBe('name:Hugo|')
  })
})

describe('groupByPerson', () => {
  it('regroupe 2 rows du même contact dans une seule persona', () => {
    const members = [
      { id: 'm1', contact_id: 'c1', category: 'PRODUCTION', sort_order: 0 },
      { id: 'm2', contact_id: 'c1', category: 'PRODUCTION', sort_order: 0 },
    ]
    const personae = groupByPerson(members)
    expect(personae).toHaveLength(1)
    expect(personae[0].contact_id).toBe('c1')
    expect(personae[0].members).toHaveLength(2)
  })

  it('sépare 2 rows de contacts différents', () => {
    const members = [
      { id: 'm1', contact_id: 'c1' },
      { id: 'm2', contact_id: 'c2' },
    ]
    expect(groupByPerson(members)).toHaveLength(2)
  })

  it('regroupe par fallback nom si contact_id manquant', () => {
    const members = [
      { id: 'm1', prenom: 'Hugo', nom: 'Martin' },
      { id: 'm2', prenom: 'Hugo', nom: 'Martin' },
    ]
    expect(groupByPerson(members)).toHaveLength(1)
  })

  it('ne mélange pas contact_id et fallback nom même si nom identique', () => {
    const members = [
      { id: 'm1', contact_id: 'c1', prenom: 'Hugo', nom: 'Martin' },
      { id: 'm2', prenom: 'Hugo', nom: 'Martin' }, // pas de contact_id
    ]
    expect(groupByPerson(members)).toHaveLength(2)
  })

  it('prend les attributs persona-level depuis la 1ère row', () => {
    const members = [
      { id: 'm1', contact_id: 'c1', category: 'PRODUCTION', secteur: 'Paris' },
      { id: 'm2', contact_id: 'c1', category: 'PRODUCTION', secteur: 'Paris' },
    ]
    const [p] = groupByPerson(members)
    expect(p.category).toBe('PRODUCTION')
    expect(p.secteur).toBe('Paris')
  })

  it('preserve l\'ordre d\'apparition des personae', () => {
    const members = [
      { id: 'm1', contact_id: 'c2' },
      { id: 'm2', contact_id: 'c1' },
      { id: 'm3', contact_id: 'c2' },
    ]
    const personae = groupByPerson(members)
    expect(personae.map((p) => p.contact_id)).toEqual(['c2', 'c1'])
  })

  it('valeurs par défaut si attributs persona-level absents', () => {
    const [p] = groupByPerson([{ id: 'm1', contact_id: 'c1' }])
    expect(p.category).toBe('PRODUCTION')
    expect(p.sort_order).toBe(0)
    expect(p.chauffeur).toBe(false)
    expect(p.presence_days).toEqual([])
    expect(p.movinmotion_statut).toBe('non_applicable')
  })

  it('retourne tableau vide pour input vide ou undefined', () => {
    expect(groupByPerson([])).toEqual([])
    expect(groupByPerson()).toEqual([])
  })
})

describe('groupByCategory', () => {
  it('groupe les personae par category', () => {
    const personae = [
      { key: 'a', category: 'PRODUCTION' },
      { key: 'b', category: 'EQUIPE TECHNIQUE' },
      { key: 'c', category: 'PRODUCTION' },
    ]
    const grouped = groupByCategory(personae)
    expect(grouped['PRODUCTION']).toHaveLength(2)
    expect(grouped['EQUIPE TECHNIQUE']).toHaveLength(1)
  })

  it('PRODUCTION par défaut si category null', () => {
    const grouped = groupByCategory([{ key: 'a', category: null }])
    expect(grouped['PRODUCTION']).toHaveLength(1)
  })
})

describe('listCategories', () => {
  it('retourne les 3 par défaut même si aucune persona', () => {
    expect(listCategories([])).toEqual(DEFAULT_CATEGORIES)
  })

  it('inclut les catégories custom triées alpha après les défaut', () => {
    const personae = [
      { category: 'CASTING' },
      { category: 'BUDGET' },
      { category: 'PRODUCTION' }, // déjà dans DEFAULT
    ]
    const cats = listCategories(personae)
    expect(cats).toEqual([
      ...DEFAULT_CATEGORIES,
      'BUDGET',
      'CASTING',
    ])
  })

  it('ne duplique pas les catégories par défaut', () => {
    const personae = [{ category: 'EQUIPE TECHNIQUE' }, { category: 'POST PRODUCTION' }]
    const cats = listCategories(personae)
    expect(cats).toEqual(DEFAULT_CATEGORIES)
  })
})

describe('condensePresenceDays', () => {
  it('retourne empty pour input vide', () => {
    expect(condensePresenceDays([])).toBe('')
    expect(condensePresenceDays()).toBe('')
  })

  it('un jour seul', () => {
    expect(condensePresenceDays(['2026-04-08'])).toBe('08/04')
  })

  it('plage consécutive', () => {
    expect(condensePresenceDays([
      '2026-04-08', '2026-04-09', '2026-04-10',
    ])).toBe('08-10/04')
  })

  it('jours non-consécutifs', () => {
    expect(condensePresenceDays(['2026-04-08', '2026-04-12'])).toBe('08/04, 12/04')
  })

  it('plage + jour isolé', () => {
    expect(condensePresenceDays([
      '2026-04-08', '2026-04-09', '2026-04-12',
    ])).toBe('08-09/04, 12/04')
  })

  it('plage cross-mois', () => {
    expect(condensePresenceDays([
      '2026-04-29', '2026-04-30', '2026-05-01',
    ])).toBe('29/04-01/05')
  })

  it('trie les jours non-ordonnés', () => {
    expect(condensePresenceDays([
      '2026-04-10', '2026-04-08', '2026-04-09',
    ])).toBe('08-10/04')
  })

  it('ignore les dates malformées', () => {
    expect(condensePresenceDays([
      '2026-04-08', 'invalid', '2026-04-09',
    ])).toBe('08-09/04')
  })
})

describe('distributeForfait', () => {
  it('Map vide pour input vide', () => {
    expect(distributeForfait([], 1000).size).toBe(0)
    expect(distributeForfait([{ id: 'l1', cout_estime: 100 }], 0).size).toBe(0)
  })

  it('mode prorata : ventile selon le coût estimé', () => {
    const lines = [
      { id: 'l1', cout_estime: 100 },
      { id: 'l2', cout_estime: 200 },
      { id: 'l3', cout_estime: 700 },
    ]
    const result = distributeForfait(lines, 1500, 'prorata')
    expect(result.get('l1')).toBeCloseTo(150, 2)
    expect(result.get('l2')).toBeCloseTo(300, 2)
    expect(result.get('l3')).toBeCloseTo(1050, 2)
  })

  it('mode prorata : la somme = forfait exact (pas de centime perdu)', () => {
    const lines = [
      { id: 'l1', cout_estime: 100 },
      { id: 'l2', cout_estime: 100 },
      { id: 'l3', cout_estime: 100 },
    ]
    const result = distributeForfait(lines, 100, 'prorata')
    const sum = [...result.values()].reduce((s, v) => s + v, 0)
    expect(Math.round(sum * 100) / 100).toBe(100)
  })

  it('mode equiparti : divise par le nombre de lignes', () => {
    const lines = [
      { id: 'l1', cout_estime: 100 },
      { id: 'l2', cout_estime: 999 },
    ]
    const result = distributeForfait(lines, 200, 'equiparti')
    expect(result.get('l1')).toBe(100)
    expect(result.get('l2')).toBe(100)
  })

  it('fallback equiparti si total_cout_estime = 0', () => {
    const lines = [
      { id: 'l1', cout_estime: 0 },
      { id: 'l2', cout_estime: 0 },
    ]
    const result = distributeForfait(lines, 200, 'prorata')
    expect(result.get('l1')).toBe(100)
    expect(result.get('l2')).toBe(100)
  })

  it('1 seule ligne reçoit tout', () => {
    const result = distributeForfait([{ id: 'l1', cout_estime: 500 }], 1500)
    expect(result.get('l1')).toBe(1500)
  })
})

describe('fullNameFromPersona', () => {
  it('priorise contact joint', () => {
    expect(fullNameFromPersona({
      contact: { prenom: 'Hugo', nom: 'Martin' },
      members: [{ prenom: 'Different', nom: 'Person' }],
    })).toBe('Hugo Martin')
  })

  it('fallback sur 1ère row si pas de contact', () => {
    expect(fullNameFromPersona({
      contact: null,
      members: [{ prenom: 'Hugo', nom: 'Martin' }],
    })).toBe('Hugo Martin')
  })

  it('— si rien', () => {
    expect(fullNameFromPersona({ members: [{}] })).toBe('—')
    expect(fullNameFromPersona({})).toBe('—')
  })
})

describe('initialsFromPersona', () => {
  it('retourne 2 lettres uppercase', () => {
    expect(initialsFromPersona({
      contact: { prenom: 'Hugo', nom: 'Martin' },
    })).toBe('HM')
  })

  it('? si rien', () => {
    expect(initialsFromPersona({ members: [{}] })).toBe('?')
  })
})

describe('effectiveSecteur', () => {
  it('priorise crew secteur (override projet)', () => {
    expect(effectiveSecteur({
      secteur: 'Paris',
      contact: { ville: 'Lyon' },
    })).toBe('Paris')
  })

  it('fallback sur contact.ville', () => {
    expect(effectiveSecteur({
      secteur: null,
      contact: { ville: 'Lyon' },
    })).toBe('Lyon')
  })

  it('null si rien', () => {
    expect(effectiveSecteur({ secteur: null, contact: null })).toBe(null)
  })
})
