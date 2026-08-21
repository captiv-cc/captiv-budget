import { describe, it, expect } from 'vitest'
import { contenuSujet, suggestValues } from './contenus'

describe('contenuSujet', () => {
  it('préfère le libellé libre à l’annuaire', () => {
    expect(contenuSujet({ artiste_text: 'Ambiance camping', artiste: { nom: 'Moby' } }))
      .toBe('Ambiance camping')
  })

  it('retombe sur l’artiste lié', () => {
    expect(contenuSujet({ artiste: { nom: 'Moby' } })).toBe('Moby')
  })

  it('ignore un libellé vide', () => {
    expect(contenuSujet({ artiste_text: '   ', artiste: { nom: 'Moby' } })).toBe('Moby')
  })

  it('a un repli lisible', () => {
    expect(contenuSujet({})).toBe('Sans titre')
    expect(contenuSujet(null)).toBe('Sans titre')
  })
})

describe('suggestValues', () => {
  const contenus = [
    { photographe: 'Nico Lavail', scene: 'Château' },
    { photographe: 'Josic', scene: 'Château' },
    { photographe: '  ', scene: null },
    { photographe: 'Nico Lavail', scene: 'Mediator' },
  ]

  it('dédoublonne et trie sans casse', () => {
    expect(suggestValues(contenus, 'photographe')).toEqual(['Josic', 'Nico Lavail'])
  })

  it('fusionne les valeurs extérieures (scènes du déroulé)', () => {
    expect(suggestValues(contenus, 'scene', ['Terminal', 'Château'])).toEqual([
      'Château',
      'Mediator',
      'Terminal',
    ])
  })

  it('tolère une liste vide', () => {
    expect(suggestValues(null, 'scene')).toEqual([])
  })
})
