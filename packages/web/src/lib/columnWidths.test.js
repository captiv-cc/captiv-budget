import { describe, it, expect } from 'vitest'
import {
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  clampWidth,
  getWidths,
  mergeWidths,
  subscribeWidths,
  updateWidths,
} from './columnWidths'

describe('clampWidth', () => {
  it('garde une largeur raisonnable', () => {
    expect(clampWidth(120)).toBe(120)
    expect(clampWidth(120.4)).toBe(120)
  })

  it('borne les extrêmes', () => {
    expect(clampWidth(2)).toBe(MIN_COL_WIDTH)
    expect(clampWidth(-50)).toBe(MIN_COL_WIDTH)
    expect(clampWidth(5000)).toBe(MAX_COL_WIDTH)
  })

  it('tolère une valeur absurde', () => {
    expect(clampWidth('abc')).toBe(MIN_COL_WIDTH)
    expect(clampWidth(null)).toBe(MIN_COL_WIDTH)
  })
})

describe('mergeWidths', () => {
  const defaults = { nom: 200, statut: 100 }

  it('applique les réglages enregistrés', () => {
    expect(mergeWidths(defaults, { nom: 320 })).toEqual({ nom: 320, statut: 100 })
  })

  it('ignore une colonne qui n’existe plus', () => {
    expect(mergeWidths(defaults, { supprimee: 300 })).toEqual(defaults)
  })

  it('borne les valeurs enregistrées', () => {
    expect(mergeWidths(defaults, { nom: 9999 }).nom).toBe(MAX_COL_WIDTH)
  })

  it('tolère l’absence de réglage', () => {
    expect(mergeWidths(defaults, null)).toEqual(defaults)
    expect(mergeWidths(defaults, 'nawak')).toEqual(defaults)
  })
})

describe('store partagé', () => {
  // Le cas réel : une page empile un tableau par bloc de livrables. Ils
  // partagent la même clé, un geste dans l'un doit déplacer tous les autres.
  it('notifie tous les abonnés d’une même clé', () => {
    const defaults = { nom: 200 }
    let vuA = getWidths('test.partage', defaults)
    let vuB = getWidths('test.partage', defaults)
    expect(vuA).toBe(vuB) // même référence : pas de boucle de rendu

    const abonnes = []
    subscribeWidths('test.partage', () => abonnes.push('A'))
    subscribeWidths('test.partage', () => abonnes.push('B'))

    updateWidths('test.partage', (prev) => ({ ...prev, nom: 340 }))

    expect(abonnes).toEqual(['A', 'B'])
    vuA = getWidths('test.partage', defaults)
    vuB = getWidths('test.partage', defaults)
    expect(vuA.nom).toBe(340)
    expect(vuA).toBe(vuB)
  })

  it('ne notifie pas quand rien ne change', () => {
    const defaults = { nom: 200 }
    getWidths('test.stable', defaults)
    let appels = 0
    subscribeWidths('test.stable', () => {
      appels += 1
    })
    updateWidths('test.stable', (prev) => prev)
    expect(appels).toBe(0)
  })

  it('n’affecte pas les autres clés', () => {
    getWidths('test.a', { nom: 100 })
    getWidths('test.b', { nom: 100 })
    updateWidths('test.a', (prev) => ({ ...prev, nom: 500 }))
    expect(getWidths('test.b', { nom: 100 }).nom).toBe(100)
  })
})
