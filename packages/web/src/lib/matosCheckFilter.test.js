/**
 * Tests unitaires — matosCheckFilter.js (MAT-10M)
 *
 * Couvre la sémantique "inclusive" du filtre loueur décidée avec Hugo et
 * le calcul de progression (avec exclusion des items retirés), qui sont
 * le cœur non-trivial de la checklist terrain. Ces tests blindent le pire
 * risque : un item qui "disparaît" de /check/:token sans raison visible.
 */
import { describe, it, expect } from 'vitest'
import {
  itemMatchesLoueur,
  computeBlockProgress,
  filterItemsByBlock,
  computeProgressByBlock,
  computeLoueurCounts,
} from './matosCheckFilter'

// ─── Fixtures partagées ─────────────────────────────────────────────────────
// Trois loueurs types + quelques items couvrant les cas métier :
//   i1 : taggé A
//   i2 : taggé B
//   i3 : taggé A + B (item partagé : ex. stinger qui vient des deux loueurs)
//   i4 : non taggé (défaut / oubli de tagging)
//   i5 : additif ajouté pendant les essais
//   i6 : retiré (soft remove) — doit être exclu des progress
//   i7 : coché (pre_check_at non null)
const LA = { id: 'L-A', nom: 'TSF', couleur: '#ff5a00' }
const LB = { id: 'L-B', nom: 'Panavision', couleur: '#2563eb' }
const LC = { id: 'L-C', nom: 'RVZ', couleur: '#00c875' }

function mkItem(id, patch = {}) {
  return {
    id,
    block_id: patch.block_id ?? 'B1',
    pre_check_at: null,
    added_during_check: false,
    removed_at: null,
    ...patch,
  }
}

const ITEMS = {
  i1: mkItem('i1'),
  i2: mkItem('i2'),
  i3: mkItem('i3'),
  i4: mkItem('i4'), // pas de loueur
  i5: mkItem('i5', { added_during_check: true }), // additif
  i6: mkItem('i6', { removed_at: '2026-04-22T10:00:00Z' }), // retiré
  i7: mkItem('i7', { pre_check_at: '2026-04-22T09:30:00Z' }), // coché
}

function buildLoueursByItem() {
  const m = new Map()
  m.set('i1', [LA])
  m.set('i2', [LB])
  m.set('i3', [LA, LB])
  // i4 : absent de la map → length 0
  // i5 : absent (additif sans loueur)
  // i6 : absent
  // i7 : absent
  return m
}

function buildItemsByBlock() {
  const m = new Map()
  m.set('B1', [ITEMS.i1, ITEMS.i2, ITEMS.i3, ITEMS.i4, ITEMS.i5, ITEMS.i6, ITEMS.i7])
  return m
}

// ─── itemMatchesLoueur ──────────────────────────────────────────────────────
describe('itemMatchesLoueur', () => {
  const loueursByItem = buildLoueursByItem()

  it('retourne true pour tous les items quand activeLoueurId est null', () => {
    for (const it of Object.values(ITEMS)) {
      expect(itemMatchesLoueur(it, loueursByItem, null)).toBe(true)
    }
  })

  it('retourne true pour les items explicitement taggés avec le loueur actif', () => {
    expect(itemMatchesLoueur(ITEMS.i1, loueursByItem, 'L-A')).toBe(true)
    expect(itemMatchesLoueur(ITEMS.i3, loueursByItem, 'L-A')).toBe(true)
    expect(itemMatchesLoueur(ITEMS.i3, loueursByItem, 'L-B')).toBe(true)
  })

  it('retourne false pour les items taggés avec un autre loueur', () => {
    expect(itemMatchesLoueur(ITEMS.i1, loueursByItem, 'L-B')).toBe(false)
    expect(itemMatchesLoueur(ITEMS.i2, loueursByItem, 'L-A')).toBe(false)
  })

  it('inclut les items sans aucun loueur (sémantique inclusive, évite disparitions)', () => {
    expect(itemMatchesLoueur(ITEMS.i4, loueursByItem, 'L-A')).toBe(true)
    expect(itemMatchesLoueur(ITEMS.i4, loueursByItem, 'L-B')).toBe(true)
  })

  it('inclut toujours les additifs (added_during_check=true) quel que soit le filtre', () => {
    expect(itemMatchesLoueur(ITEMS.i5, loueursByItem, 'L-A')).toBe(true)
    expect(itemMatchesLoueur(ITEMS.i5, loueursByItem, 'L-B')).toBe(true)
    expect(itemMatchesLoueur(ITEMS.i5, loueursByItem, 'L-C')).toBe(true)
  })

  it('retourne false pour un loueur inconnu quand l\'item a des loueurs stricts', () => {
    expect(itemMatchesLoueur(ITEMS.i1, loueursByItem, 'L-UNKNOWN')).toBe(false)
  })

  it('traite activeLoueurId === undefined comme "pas de filtre"', () => {
    expect(itemMatchesLoueur(ITEMS.i1, loueursByItem, undefined)).toBe(true)
  })

  it('ne crash pas sur un loueursByItem vide ou null', () => {
    expect(itemMatchesLoueur(ITEMS.i1, new Map(), 'L-A')).toBe(true) // sans loueur → inclus
    expect(itemMatchesLoueur(ITEMS.i1, null, 'L-A')).toBe(true)
  })
})

// ─── computeBlockProgress ───────────────────────────────────────────────────
describe('computeBlockProgress', () => {
  it('retourne 0/0 pour une liste vide', () => {
    expect(computeBlockProgress([])).toEqual({
      total: 0, checked: 0, ratio: 0, allChecked: false,
    })
  })

  it('compte les items actifs et cochés', () => {
    const items = [
      mkItem('a', { pre_check_at: '2026-04-22T10:00:00Z' }),
      mkItem('b', { pre_check_at: null }),
      mkItem('c', { pre_check_at: '2026-04-22T10:05:00Z' }),
    ]
    expect(computeBlockProgress(items)).toEqual({
      total: 3, checked: 2, ratio: 2 / 3, allChecked: false,
    })
  })

  it('exclut les items retirés du total ET du compteur', () => {
    // Pattern clé : si on retire un item, le bloc peut être "fini" sans être 10/10.
    const items = [
      mkItem('a', { pre_check_at: '2026-04-22T10:00:00Z' }),
      mkItem('b', { pre_check_at: '2026-04-22T10:01:00Z' }),
      mkItem('c', { removed_at: '2026-04-22T09:50:00Z' }), // exclu
    ]
    expect(computeBlockProgress(items)).toEqual({
      total: 2, checked: 2, ratio: 1, allChecked: true,
    })
  })

  it('allChecked=false même avec 0 item (évite le faux positif "tout coché")', () => {
    expect(computeBlockProgress([]).allChecked).toBe(false)
  })

  it('accepte un tableau de cochés retirés et ne les compte pas', () => {
    // Un item coché puis retiré : ne doit plus influencer la barre.
    const items = [
      mkItem('a', {
        pre_check_at: '2026-04-22T10:00:00Z',
        removed_at: '2026-04-22T10:10:00Z',
      }),
    ]
    expect(computeBlockProgress(items)).toEqual({
      total: 0, checked: 0, ratio: 0, allChecked: false,
    })
  })

  it('ignore null/undefined sans crash', () => {
    expect(computeBlockProgress(null)).toEqual({
      total: 0, checked: 0, ratio: 0, allChecked: false,
    })
    expect(computeBlockProgress(undefined)).toEqual({
      total: 0, checked: 0, ratio: 0, allChecked: false,
    })
  })
})

// ─── filterItemsByBlock ─────────────────────────────────────────────────────
describe('filterItemsByBlock', () => {
  it('retourne l\'index d\'origine (identité) quand activeLoueurId est null', () => {
    const idx = buildItemsByBlock()
    expect(filterItemsByBlock(idx, buildLoueursByItem(), null)).toBe(idx)
    expect(filterItemsByBlock(idx, buildLoueursByItem(), undefined)).toBe(idx)
  })

  it('filtre bloc par bloc en conservant la structure Map', () => {
    const out = filterItemsByBlock(buildItemsByBlock(), buildLoueursByItem(), 'L-A')
    expect(out).toBeInstanceOf(Map)
    const ids = (out.get('B1') || []).map((it) => it.id)
    // L-A → i1, i3 (taggés), i4 (sans loueur), i5 (additif),
    //       i6 (retiré mais toujours listé car le filtre laisse passer les
    //       items sans loueur — le retrait est géré plus tard dans progress),
    //       i7 (sans loueur + coché).
    expect(ids).toEqual(['i1', 'i3', 'i4', 'i5', 'i6', 'i7'])
  })

  it('ne laisse passer que les items compatibles avec un loueur exclusif', () => {
    const out = filterItemsByBlock(buildItemsByBlock(), buildLoueursByItem(), 'L-C')
    const ids = (out.get('B1') || []).map((it) => it.id)
    // L-C n'est taggé sur AUCUN item → ne restent que les items sans loueur
    // (i4, i6, i7) + les additifs (i5).
    expect(ids).toEqual(['i4', 'i5', 'i6', 'i7'])
  })
})

// ─── computeProgressByBlock ─────────────────────────────────────────────────
describe('computeProgressByBlock', () => {
  it('retourne une Map avec un progress par bloc', () => {
    const blocks = [{ id: 'B1' }, { id: 'B2' }]
    const itemsByBlock = new Map([
      ['B1', [mkItem('a', { pre_check_at: '2026-04-22T10:00:00Z' }), mkItem('b')]],
      ['B2', [mkItem('c', { pre_check_at: '2026-04-22T10:00:00Z' })]],
    ])
    const out = computeProgressByBlock(blocks, itemsByBlock)
    expect(out.get('B1')).toEqual({ total: 2, checked: 1, ratio: 0.5, allChecked: false })
    expect(out.get('B2')).toEqual({ total: 1, checked: 1, ratio: 1, allChecked: true })
  })

  it('retourne { total:0 } pour un bloc sans items', () => {
    const blocks = [{ id: 'B1' }]
    const out = computeProgressByBlock(blocks, new Map())
    expect(out.get('B1')).toEqual({ total: 0, checked: 0, ratio: 0, allChecked: false })
  })
})

// ─── computeLoueurCounts ────────────────────────────────────────────────────
describe('computeLoueurCounts', () => {
  it('calcule "all" comme total absolu hors retirés', () => {
    const counts = computeLoueurCounts([LA, LB, LC], buildItemsByBlock(), buildLoueursByItem())
    // items totaux = 7, retirés = 1 (i6) → 6
    expect(counts.get('all')).toBe(6)
  })

  it('compte pour chaque loueur : items taggés + sans loueur + additifs (hors retirés)', () => {
    const counts = computeLoueurCounts([LA, LB, LC], buildItemsByBlock(), buildLoueursByItem())
    // L-A : i1 (tag), i3 (tag), i4 (pas de loueur), i5 (additif), i7 (pas de loueur)
    //       → 5. i6 exclu (retiré).
    expect(counts.get('L-A')).toBe(5)
    // L-B : i2 (tag), i3 (tag), i4, i5, i7 → 5
    expect(counts.get('L-B')).toBe(5)
    // L-C : aucun tag → ne restent que i4, i5, i7 → 3
    expect(counts.get('L-C')).toBe(3)
  })

  it('gère une liste de loueurs vide (ne remplit que "all")', () => {
    const counts = computeLoueurCounts([], buildItemsByBlock(), buildLoueursByItem())
    expect(counts.get('all')).toBe(6)
    expect(counts.size).toBe(1)
  })

  it('gère un itemsByBlock vide', () => {
    const counts = computeLoueurCounts([LA, LB], new Map(), new Map())
    expect(counts.get('all')).toBe(0)
    expect(counts.get('L-A')).toBe(0)
    expect(counts.get('L-B')).toBe(0)
  })

  it('équivalence avec itemMatchesLoueur (contrat croisé)', () => {
    // Les compteurs doivent correspondre EXACTEMENT à ce que l'UI afficherait
    // si on simulait chaque tap de chip. Ce test protège contre une dérive
    // silencieuse entre les deux fonctions (elles ont dupliqué la logique).
    const loueurs = [LA, LB, LC]
    const itemsByBlock = buildItemsByBlock()
    const loueursByItem = buildLoueursByItem()
    const counts = computeLoueurCounts(loueurs, itemsByBlock, loueursByItem)

    for (const l of loueurs) {
      let expected = 0
      for (const arr of itemsByBlock.values()) {
        for (const it of arr) {
          if (it.removed_at) continue
          if (itemMatchesLoueur(it, loueursByItem, l.id)) expected += 1
        }
      }
      expect(counts.get(l.id)).toBe(expected)
    }
  })
})
