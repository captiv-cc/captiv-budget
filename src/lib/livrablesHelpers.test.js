/**
 * Tests unitaires — LIV-3 : helpers purs livrablesHelpers.js
 * Vitest 2 (pas de setup, pas de mock — que du pur in-memory).
 *
 * Couverture :
 *   - sortBySortOrder (tie-break created_at)
 *   - groupLivrablesByBlock / indexVersionsByLivrable / indexEtapesByLivrable
 *   - isLivrableEnRetard (statuts terminés exclus, frontière minuit)
 *   - computeCompteurs (total / actifs / enRetard / livres / valides / prochain)
 *   - listMonteurs (dedupe interne + externe + tri alpha + profile lookup)
 *   - nextLivrableNumero (préfixe + index libre + matching insensible casse)
 *   - pickAllowed
 */
import { describe, it, expect } from 'vitest'
import {
  computeCompteurs,
  groupLivrablesByBlock,
  indexEtapesByLivrable,
  indexVersionsByLivrable,
  isLivrableEnRetard,
  listMonteurs,
  nextLivrableNumero,
  pickAllowed,
  sortBySortOrder,
} from './livrablesHelpers.js'

// On bloque "today" à 2026-04-24 pour les tests temporels.
const FAKE_NOW = new Date('2026-04-24T10:00:00Z')

describe('sortBySortOrder', () => {
  it('trie par sort_order croissant', () => {
    const out = sortBySortOrder([
      { id: 'b', sort_order: 2 },
      { id: 'a', sort_order: 1 },
      { id: 'c', sort_order: 3 },
    ])
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('tie-break sur created_at quand sort_order identique', () => {
    const out = sortBySortOrder([
      { id: 'late', sort_order: 1, created_at: '2026-04-24T11:00:00Z' },
      { id: 'early', sort_order: 1, created_at: '2026-04-24T08:00:00Z' },
    ])
    expect(out.map((r) => r.id)).toEqual(['early', 'late'])
  })

  it('ne mute pas le tableau d\'entrée', () => {
    const input = [{ id: 'b', sort_order: 2 }, { id: 'a', sort_order: 1 }]
    sortBySortOrder(input)
    expect(input.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('groupLivrablesByBlock', () => {
  it('regroupe par block_id en préservant l\'ordre d\'entrée', () => {
    const out = groupLivrablesByBlock([
      { id: 'l1', block_id: 'B1' },
      { id: 'l2', block_id: 'B2' },
      { id: 'l3', block_id: 'B1' },
    ])
    expect(out.get('B1').map((l) => l.id)).toEqual(['l1', 'l3'])
    expect(out.get('B2').map((l) => l.id)).toEqual(['l2'])
  })

  it('skip les entrées sans block_id', () => {
    const out = groupLivrablesByBlock([{ id: 'l1' }, { id: 'l2', block_id: 'B' }])
    expect(out.size).toBe(1)
    expect(out.get('B')).toHaveLength(1)
  })
})

describe('indexVersionsByLivrable / indexEtapesByLivrable', () => {
  it('indexe les versions par livrable_id', () => {
    const out = indexVersionsByLivrable([
      { id: 'v1', livrable_id: 'L1' },
      { id: 'v2', livrable_id: 'L1' },
      { id: 'v3', livrable_id: 'L2' },
    ])
    expect(out.get('L1')).toHaveLength(2)
    expect(out.get('L2')).toHaveLength(1)
  })

  it('indexe les étapes par livrable_id', () => {
    const out = indexEtapesByLivrable([
      { id: 'e1', livrable_id: 'L1' },
      { id: 'e2', livrable_id: 'L2' },
    ])
    expect(out.get('L1')).toHaveLength(1)
    expect(out.get('L2')).toHaveLength(1)
  })
})

describe('isLivrableEnRetard', () => {
  it('vrai si date_livraison < today et statut non terminé', () => {
    expect(
      isLivrableEnRetard({ date_livraison: '2026-04-20', statut: 'en_cours' }, FAKE_NOW),
    ).toBe(true)
  })

  it('faux si statut livré (même si date passée)', () => {
    expect(
      isLivrableEnRetard({ date_livraison: '2026-04-20', statut: 'livre' }, FAKE_NOW),
    ).toBe(false)
  })

  it('faux si statut archive', () => {
    expect(
      isLivrableEnRetard({ date_livraison: '2026-04-20', statut: 'archive' }, FAKE_NOW),
    ).toBe(false)
  })

  it('faux si date_livraison = today (frontière à 00:00 du lendemain)', () => {
    expect(
      isLivrableEnRetard({ date_livraison: '2026-04-24', statut: 'en_cours' }, FAKE_NOW),
    ).toBe(false)
  })

  it('faux si pas de date_livraison', () => {
    expect(isLivrableEnRetard({ statut: 'en_cours' }, FAKE_NOW)).toBe(false)
  })
})

describe('computeCompteurs', () => {
  const livrables = [
    { id: 'a', date_livraison: '2026-04-20', statut: 'en_cours' }, // en retard
    { id: 'b', date_livraison: '2026-04-20', statut: 'livre' }, // livré
    { id: 'c', date_livraison: '2026-04-25', statut: 'a_valider' }, // futur, candidat prochain
    { id: 'd', date_livraison: '2026-05-10', statut: 'brief' }, // futur plus loin
    { id: 'e', date_livraison: null, statut: 'valide' }, // validé sans date
    { id: 'f', date_livraison: '2026-04-30', statut: 'archive' }, // archivé → ignore
  ]

  it('compte tout', () => {
    const res = computeCompteurs(livrables, FAKE_NOW)
    expect(res.total).toBe(6)
    expect(res.livres).toBe(1)
    expect(res.valides).toBe(1)
    expect(res.enRetard).toBe(1)
    // actifs = brief + en_cours + a_valider + valide → 4
    expect(res.actifs).toBe(4)
  })

  it('sélectionne le prochain livrable (date la plus proche, non terminé)', () => {
    const res = computeCompteurs(livrables, FAKE_NOW)
    expect(res.prochain?.id).toBe('c')
  })

  it('renvoie prochain=null si aucun candidat', () => {
    const onlyTermines = [{ id: 'x', date_livraison: '2026-05-01', statut: 'livre' }]
    const res = computeCompteurs(onlyTermines, FAKE_NOW)
    expect(res.prochain).toBeNull()
  })
})

describe('listMonteurs', () => {
  it('dedupe par profile_id et external (case-insensitive)', () => {
    const livrables = [
      { assignee_profile_id: 'p1' },
      { assignee_profile_id: 'p1' }, // dup
      { assignee_external: 'Alice Dupont' },
      { assignee_external: 'alice dupont' }, // dup case-insensitive
      { assignee_external: 'Bob' },
    ]
    const res = listMonteurs(livrables, new Map())
    expect(res).toHaveLength(3) // p1, Alice, Bob
  })

  it('résout les profile names via profilesById', () => {
    const profilesById = new Map([
      ['p1', { id: 'p1', prenom: 'Hugo', nom: 'Mat' }],
    ])
    const res = listMonteurs([{ assignee_profile_id: 'p1' }], profilesById)
    expect(res[0].label).toBe('Hugo Mat')
    expect(res[0].profile?.id).toBe('p1')
  })

  it('fallback "Membre" si profile non trouvé dans la map', () => {
    const res = listMonteurs([{ assignee_profile_id: 'pX' }], new Map())
    expect(res[0].label).toBe('Membre')
    expect(res[0].profile).toBeNull()
  })

  it('trie alphabétiquement (insensible casse + français)', () => {
    const profilesById = new Map([
      ['p1', { id: 'p1', prenom: 'Bernard', nom: '' }],
      ['p2', { id: 'p2', prenom: 'Albert', nom: '' }],
    ])
    const res = listMonteurs(
      [{ assignee_profile_id: 'p1' }, { assignee_profile_id: 'p2' }],
      profilesById,
    )
    expect(res.map((m) => m.label)).toEqual(['Albert', 'Bernard'])
  })

  it('skip les externes vides ou whitespace-only', () => {
    const res = listMonteurs(
      [{ assignee_external: '   ' }, { assignee_external: '' }, { assignee_external: 'X' }],
      new Map(),
    )
    expect(res).toHaveLength(1)
    expect(res[0].label).toBe('X')
  })
})

describe('nextLivrableNumero', () => {
  it('suit le préfixe du bloc + premier index libre', () => {
    const block = { prefixe: 'A' }
    const livrables = [{ numero: 'A1' }, { numero: 'A3' }, { numero: 'A4' }]
    expect(nextLivrableNumero(block, livrables)).toBe('A2')
  })

  it('renvoie le préfixe + 1 si bloc vide', () => {
    expect(nextLivrableNumero({ prefixe: 'S' }, [])).toBe('S1')
  })

  it('ignore les numeros qui ne matchent pas le pattern', () => {
    const block = { prefixe: 'A' }
    const livrables = [{ numero: 'A1' }, { numero: 'A2*' }, { numero: 'A-rec' }]
    expect(nextLivrableNumero(block, livrables)).toBe('A2') // A2* ne consomme pas l'index 2
  })

  it('matching case-insensitive sur le préfixe', () => {
    const block = { prefixe: 'A' }
    const livrables = [{ numero: 'a1' }, { numero: 'A2' }]
    expect(nextLivrableNumero(block, livrables)).toBe('A3')
  })

  it('sans préfixe → numéros nus', () => {
    expect(nextLivrableNumero({ prefixe: null }, [{ numero: '1' }, { numero: '3' }])).toBe('2')
  })

  it('tronque les caractères spéciaux du préfixe (pas de regex injection)', () => {
    // "()" est un caractère valide tant qu'on l'échappe en interne — ne doit
    // pas crasher.
    const block = { prefixe: 'X(' }
    expect(() => nextLivrableNumero(block, [])).not.toThrow()
  })
})

describe('pickAllowed', () => {
  it('garde uniquement les champs whitelistés', () => {
    const out = pickAllowed({ a: 1, b: 2, c: 3 }, ['a', 'c'])
    expect(out).toEqual({ a: 1, c: 3 })
  })

  it('renvoie {} si aucun champ ne match', () => {
    expect(pickAllowed({ x: 1 }, ['a', 'b'])).toEqual({})
  })

  it('préserve null et undefined si la clé est listée et présente', () => {
    expect(pickAllowed({ a: null }, ['a'])).toEqual({ a: null })
    expect(pickAllowed({ a: undefined }, ['a'])).toEqual({ a: undefined })
  })
})
