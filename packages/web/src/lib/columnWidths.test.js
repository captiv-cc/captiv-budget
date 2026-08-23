import { describe, it, expect } from 'vitest'
import { MAX_COL_WIDTH, MIN_COL_WIDTH, clampWidth, mergeWidths } from './columnWidths'

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
