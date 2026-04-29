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
 *   — LIV-7 / LIV-8 / LIV-9 (LIV-9.1) :
 *   - parseDuree (parsing souple mm:ss / hh:mm:ss / nombre seul)
 *   - dureeToSeconds (conversion en secondes)
 *   - monteurAvatar (initiales + couleur stable hash)
 *   - computeLivrableStatutFromVersions (sync statut livrable depuis versions)
 *   - LIVRABLE_FORMATS / MONTEUR_AVATAR_COLORS (constantes export)
 */
import { describe, it, expect } from 'vitest'
import {
  computeCompteurs,
  computeLivrableStatutFromVersions,
  dureeToSeconds,
  filterLivrables,
  groupLivrablesByBlock,
  hasActiveFilter,
  indexEtapesByLivrable,
  indexVersionsByLivrable,
  isLivrableEnRetard,
  listMonteurs,
  LIVRABLE_FORMATS,
  monteurAvatar,
  MONTEUR_AVATAR_COLORS,
  nextLivrableNumero,
  parseDuree,
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
      ['p1', { id: 'p1', full_name: 'Hugo Mat' }],
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
      ['p1', { id: 'p1', full_name: 'Bernard' }],
      ['p2', { id: 'p2', full_name: 'Albert' }],
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

// ════════════════════════════════════════════════════════════════════════════
// LIV-7 — parseDuree / dureeToSeconds (helpers durée)
// ════════════════════════════════════════════════════════════════════════════

describe('parseDuree', () => {
  it('renvoie null pour vide / null / undefined', () => {
    expect(parseDuree('')).toEqual({ ok: true, normalized: null })
    expect(parseDuree(null)).toEqual({ ok: true, normalized: null })
    expect(parseDuree(undefined)).toEqual({ ok: true, normalized: null })
    expect(parseDuree('   ')).toEqual({ ok: true, normalized: null })
  })

  it('1-2 chiffres = secondes (mm:ss avec mm=00)', () => {
    expect(parseDuree('5')).toMatchObject({ ok: true, normalized: '00:05' })
    expect(parseDuree('45')).toMatchObject({ ok: true, normalized: '00:45' })
    expect(parseDuree('0')).toMatchObject({ ok: true, normalized: '00:00' })
  })

  it('refuse > 59 secondes en saisie 1-2 chiffres', () => {
    const r = parseDuree('60')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Secondes/)
  })

  it('3 chiffres = MSS', () => {
    expect(parseDuree('130')).toMatchObject({ ok: true, normalized: '01:30' })
    expect(parseDuree('905')).toMatchObject({ ok: true, normalized: '09:05' })
  })

  it('4 chiffres = MMSS', () => {
    expect(parseDuree('0130')).toMatchObject({ ok: true, normalized: '01:30' })
    expect(parseDuree('1230')).toMatchObject({ ok: true, normalized: '12:30' })
  })

  it('5 chiffres = HMMSS', () => {
    expect(parseDuree('13030')).toMatchObject({ ok: true, normalized: '01:30:30' })
  })

  it('6 chiffres = HHMMSS', () => {
    expect(parseDuree('013030')).toMatchObject({ ok: true, normalized: '01:30:30' })
  })

  it('refuse > 6 chiffres', () => {
    expect(parseDuree('1234567').ok).toBe(false)
  })

  it('format mm:ss → normalisé sur 2 chiffres', () => {
    expect(parseDuree('1:30')).toMatchObject({ ok: true, normalized: '01:30' })
    expect(parseDuree('01:30')).toMatchObject({ ok: true, normalized: '01:30' })
    expect(parseDuree('99:59')).toMatchObject({ ok: true, normalized: '99:59' })
  })

  it('format hh:mm:ss → normalisé', () => {
    expect(parseDuree('1:30:00')).toMatchObject({ ok: true, normalized: '01:30:00' })
    expect(parseDuree('01:30:45')).toMatchObject({ ok: true, normalized: '01:30:45' })
  })

  it('refuse minutes / secondes > 59 sur format avec :', () => {
    expect(parseDuree('99:99').ok).toBe(false)
    expect(parseDuree('1:99').ok).toBe(false)
    expect(parseDuree('1:60:00').ok).toBe(false)
  })

  it('refuse les chaînes invalides', () => {
    expect(parseDuree('abc').ok).toBe(false)
    expect(parseDuree('1m30').ok).toBe(false)
    expect(parseDuree('1:30:00:00').ok).toBe(false)
  })
})

describe('dureeToSeconds', () => {
  it('null/vide → null', () => {
    expect(dureeToSeconds(null)).toBeNull()
    expect(dureeToSeconds('')).toBeNull()
    expect(dureeToSeconds(undefined)).toBeNull()
  })

  it('mm:ss → secondes', () => {
    expect(dureeToSeconds('00:30')).toBe(30)
    expect(dureeToSeconds('01:30')).toBe(90)
    expect(dureeToSeconds('99:59')).toBe(99 * 60 + 59)
  })

  it('hh:mm:ss → secondes', () => {
    expect(dureeToSeconds('01:30:00')).toBe(5400)
    expect(dureeToSeconds('00:00:01')).toBe(1)
    expect(dureeToSeconds('02:30:45')).toBe(2 * 3600 + 30 * 60 + 45)
  })

  it('format invalide → null', () => {
    expect(dureeToSeconds('abc')).toBeNull()
    expect(dureeToSeconds('1:2:3:4')).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// LIV-7 — monteurAvatar (initiales + couleur stable)
// ════════════════════════════════════════════════════════════════════════════

describe('monteurAvatar', () => {
  it('renvoie null pour vide / null / undefined', () => {
    expect(monteurAvatar('')).toBeNull()
    expect(monteurAvatar(null)).toBeNull()
    expect(monteurAvatar(undefined)).toBeNull()
    expect(monteurAvatar('   ')).toBeNull()
  })

  it('1 mot → 2 premières lettres uppercase', () => {
    expect(monteurAvatar('Hugo').initials).toBe('HU')
    expect(monteurAvatar('Sam').initials).toBe('SA')
    expect(monteurAvatar('A').initials).toBe('A')
  })

  it('2+ mots → première lettre du premier + dernier mot', () => {
    expect(monteurAvatar('Marie Dupont').initials).toBe('MD')
    expect(monteurAvatar('Jean-Paul Sartre').initials).toBe('JS')
    expect(monteurAvatar('Anne Marie Lopez').initials).toBe('AL')
  })

  it('couleur stable pour le même nom', () => {
    const a = monteurAvatar('Hugo')
    const b = monteurAvatar('Hugo')
    expect(a.color).toBe(b.color)
  })

  it('couleur insensible à la casse / aux espaces autour', () => {
    expect(monteurAvatar('Hugo').color).toBe(monteurAvatar('hugo').color)
    expect(monteurAvatar('Hugo').color).toBe(monteurAvatar('  Hugo  ').color)
  })

  it('couleur tirée de MONTEUR_AVATAR_COLORS', () => {
    const a = monteurAvatar('Logan')
    expect(MONTEUR_AVATAR_COLORS).toContain(a.color)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// LIV-8 — computeLivrableStatutFromVersions
// ════════════════════════════════════════════════════════════════════════════

describe('computeLivrableStatutFromVersions', () => {
  const liv = (statut) => ({ id: 'l1', statut })
  const v = (sort_order, statut_validation) => ({ id: 'v' + sort_order, sort_order, statut_validation })

  it('null si livrable null', () => {
    expect(computeLivrableStatutFromVersions(null, [])).toBeNull()
  })

  it('respecte les statuts terminés (livre, archive)', () => {
    expect(computeLivrableStatutFromVersions(liv('livre'), [v(1, 'rejete')])).toBe('livre')
    expect(computeLivrableStatutFromVersions(liv('archive'), [v(1, 'en_attente')])).toBe('archive')
  })

  it('garde le statut courant si aucune version', () => {
    expect(computeLivrableStatutFromVersions(liv('brief'), [])).toBe('brief')
    expect(computeLivrableStatutFromVersions(liv('en_cours'), null)).toBe('en_cours')
  })

  it('version la plus récente valide → livrable valide', () => {
    expect(
      computeLivrableStatutFromVersions(liv('a_valider'), [
        v(1, 'rejete'),
        v(2, 'valide'),
      ]),
    ).toBe('valide')
  })

  it('version la plus récente non valide → livrable a_valider', () => {
    expect(
      computeLivrableStatutFromVersions(liv('valide'), [
        v(1, 'valide'),
        v(2, 'en_attente'),
      ]),
    ).toBe('a_valider')

    expect(
      computeLivrableStatutFromVersions(liv('en_cours'), [v(1, 'rejete')]),
    ).toBe('a_valider')

    expect(
      computeLivrableStatutFromVersions(liv('brief'), [v(1, 'retours_a_integrer')]),
    ).toBe('a_valider')
  })

  it('seul sort_order détermine "la plus récente" (pas l\'ordre du tableau)', () => {
    // V2 (sort 2) en_attente, V1 (sort 1) valide → suit V2 → a_valider
    expect(
      computeLivrableStatutFromVersions(liv('valide'), [
        v(2, 'en_attente'), // en premier dans le tableau mais sort_order plus haut
        v(1, 'valide'),
      ]),
    ).toBe('a_valider')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// LIV-7 / LIV-9 — Constantes exportées
// ════════════════════════════════════════════════════════════════════════════

describe('LIVRABLE_FORMATS', () => {
  it('contient les 6 ratios attendus', () => {
    expect(LIVRABLE_FORMATS).toEqual(['16:9', '9:16', '1:1', '4:5', '5:4', '4:3'])
  })
})

describe('MONTEUR_AVATAR_COLORS', () => {
  it('contient au moins 8 couleurs hex valides', () => {
    expect(MONTEUR_AVATAR_COLORS.length).toBeGreaterThanOrEqual(8)
    for (const c of MONTEUR_AVATAR_COLORS) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// LIV-15 — filterLivrables / hasActiveFilter
// ════════════════════════════════════════════════════════════════════════════

describe('filterLivrables', () => {
  // Dataset commun : 5 livrables couvrant les axes statut/format/monteur/bloc/retard.
  const LS = [
    {
      id: '1',
      statut: 'brief',
      format: '16:9',
      block_id: 'bA',
      assignee_profile_id: 'pHugo',
      assignee_external: null,
      date_livraison: null,
    },
    {
      id: '2',
      statut: 'en_cours',
      format: '9:16',
      block_id: 'bA',
      assignee_profile_id: null,
      assignee_external: 'Alice',
      date_livraison: '2020-01-01', // en retard (avant FAKE_NOW)
    },
    {
      id: '3',
      statut: 'a_valider',
      format: null,
      block_id: 'bB',
      assignee_profile_id: null,
      assignee_external: null,
      date_livraison: '2030-01-01', // futur
    },
    {
      id: '4',
      statut: 'livre',
      format: '16:9',
      block_id: 'bA',
      assignee_profile_id: 'pBob',
      assignee_external: null,
      date_livraison: '2020-01-01', // ancien mais livré → pas en retard
    },
    {
      id: '5',
      statut: 'archive',
      format: '1:1',
      block_id: 'bB',
      assignee_profile_id: null,
      assignee_external: 'Charlie',
      date_livraison: null,
    },
  ]

  it('renvoie tous les livrables si aucun filtre', () => {
    expect(filterLivrables(LS, {}).length).toBe(LS.length)
  })

  it('filtre par statut (multi)', () => {
    const set = new Set(['brief', 'a_valider'])
    expect(filterLivrables(LS, { statuts: set }).map((l) => l.id)).toEqual(['1', '3'])
  })

  it('filtre par format avec __none__ pour les sans-format', () => {
    expect(
      filterLivrables(LS, { formats: new Set(['__none__']) }).map((l) => l.id),
    ).toEqual(['3'])
    expect(
      filterLivrables(LS, { formats: new Set(['16:9']) }).map((l) => l.id),
    ).toEqual(['1', '4'])
  })

  it('filtre par bloc', () => {
    expect(filterLivrables(LS, { blockIds: new Set(['bB']) }).map((l) => l.id)).toEqual([
      '3',
      '5',
    ])
  })

  it('filtre par monteur (key profile + external + __none__)', () => {
    // Profile Hugo → seul livrable 1
    expect(
      filterLivrables(LS, { monteurs: new Set(['p:pHugo']) }).map((l) => l.id),
    ).toEqual(['1'])
    // External "Alice" → seul livrable 2
    expect(
      filterLivrables(LS, { monteurs: new Set(['x:alice']) }).map((l) => l.id),
    ).toEqual(['2'])
    // __none__ → livrable 3 (ni profile ni external)
    expect(
      filterLivrables(LS, { monteurs: new Set(['__none__']) }).map((l) => l.id),
    ).toEqual(['3'])
    // Combo profile + external
    expect(
      filterLivrables(LS, { monteurs: new Set(['p:pHugo', 'x:charlie']) })
        .map((l) => l.id)
        .sort(),
    ).toEqual(['1', '5'])
  })

  it('filtre par enRetard (statuts terminés exclus)', () => {
    const out = filterLivrables(LS, { enRetard: true }, { now: FAKE_NOW })
    // Seul livrable 2 : date passée + statut non terminé.
    // livrable 4 (livré) exclu malgré date passée.
    expect(out.map((l) => l.id)).toEqual(['2'])
  })

  it('filtre par mesLivrables avec ctx.userId', () => {
    expect(
      filterLivrables(LS, { mesLivrables: true }, { userId: 'pHugo' }).map((l) => l.id),
    ).toEqual(['1'])
    // Sans userId → 0 résultats
    expect(filterLivrables(LS, { mesLivrables: true }, {}).length).toBe(0)
  })

  it('combine plusieurs filtres en intersection (ET logique)', () => {
    // Statut brief OU a_valider, ET bloc bA → seul livrable 1
    const out = filterLivrables(LS, {
      statuts: new Set(['brief', 'a_valider']),
      blockIds: new Set(['bA']),
    })
    expect(out.map((l) => l.id)).toEqual(['1'])
  })

  it('Set vide est ignoré (équivalent à pas de filtre)', () => {
    expect(
      filterLivrables(LS, { statuts: new Set() }).length,
    ).toBe(LS.length)
  })
})

describe('hasActiveFilter', () => {
  it('false si filters vide ou tous Sets vides + bools off', () => {
    expect(hasActiveFilter({})).toBe(false)
    expect(
      hasActiveFilter({
        statuts: new Set(),
        monteurs: new Set(),
        formats: new Set(),
        blockIds: new Set(),
        enRetard: false,
        mesLivrables: false,
      }),
    ).toBe(false)
  })

  it('true dès qu un Set a un élément', () => {
    expect(hasActiveFilter({ statuts: new Set(['brief']) })).toBe(true)
    expect(hasActiveFilter({ monteurs: new Set(['p:abc']) })).toBe(true)
    expect(hasActiveFilter({ formats: new Set(['16:9']) })).toBe(true)
    expect(hasActiveFilter({ blockIds: new Set(['b1']) })).toBe(true)
  })

  it('true dès qu un toggle bool est activé', () => {
    expect(hasActiveFilter({ enRetard: true })).toBe(true)
    expect(hasActiveFilter({ mesLivrables: true })).toBe(true)
  })
})
