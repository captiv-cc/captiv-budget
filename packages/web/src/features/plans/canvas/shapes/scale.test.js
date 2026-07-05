import { describe, it, expect } from 'vitest'
import { fmtMeters, pageMetersPerPx, setPageMetersPerPx } from './scale'

describe('fmtMeters', () => {
  it('sous 10 m : 2 décimales max, sans zéros inutiles', () => {
    expect(fmtMeters(1.234)).toBe('1,23')
    expect(fmtMeters(9.999)).toBe('10')
    expect(fmtMeters(2.5)).toBe('2,5')
    expect(fmtMeters(3)).toBe('3')
  })

  it('au-delà de 10 m : 1 décimale max', () => {
    expect(fmtMeters(12.34)).toBe('12,3')
    expect(fmtMeters(96)).toBe('96')
  })

  it('grands nombres : séparateur de milliers fr-FR (espace insécable)', () => {
    expect(fmtMeters(1500)).toBe((1500).toLocaleString('fr-FR'))
  })

  it('zéro', () => {
    expect(fmtMeters(0)).toBe('0')
  })
})

describe('pageMetersPerPx', () => {
  const editorWith = (meta) => ({ getCurrentPage: () => ({ id: 'page:page', meta }) })

  it('lit meta.metersPerPx de la page courante', () => {
    expect(pageMetersPerPx(editorWith({ metersPerPx: 0.05 }))).toBe(0.05)
  })

  it('0 si non défini / invalide / pas d’editor', () => {
    expect(pageMetersPerPx(editorWith({}))).toBe(0)
    expect(pageMetersPerPx(editorWith({ metersPerPx: 'nope' }))).toBe(0)
    expect(pageMetersPerPx(null)).toBe(0)
    expect(pageMetersPerPx({ getCurrentPage: () => null })).toBe(0)
  })
})

describe('setPageMetersPerPx', () => {
  it('met à jour la page en préservant le reste du meta', () => {
    const updates = []
    const editor = {
      getCurrentPage: () => ({ id: 'page:page', meta: { foo: 'bar' } }),
      updatePage: (patch) => updates.push(patch),
    }
    setPageMetersPerPx(editor, 0.02)
    expect(updates).toEqual([{ id: 'page:page', meta: { foo: 'bar', metersPerPx: 0.02 } }])
  })

  it('sans page courante : no-op', () => {
    const editor = { getCurrentPage: () => null, updatePage: () => { throw new Error('boom') } }
    expect(() => setPageMetersPerPx(editor, 0.02)).not.toThrow()
  })
})
