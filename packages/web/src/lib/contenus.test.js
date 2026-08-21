import { describe, it, expect } from 'vitest'
import { contenuSujet, refValues, formatJourLabel } from './contenus'

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

describe('refValues', () => {
  const refs = [
    { kind: 'espace', valeur: 'Château' },
    { kind: 'photographe', valeur: 'Nico Lavail' },
    { kind: 'espace', valeur: 'Camping' },
  ]

  it('ne renvoie que la liste demandée', () => {
    expect(refValues(refs, 'espace')).toEqual(['Château', 'Camping'])
    expect(refValues(refs, 'photographe')).toEqual(['Nico Lavail'])
  })

  it('tolère une liste absente', () => {
    expect(refValues(null, 'espace')).toEqual([])
    expect(refValues(refs, 'suivi')).toEqual([])
  })
})

describe('formatJourLabel', () => {
  it('numérote le jour de festival et rappelle la date', () => {
    expect(formatJourLabel('2026-08-20', 0)).toBe('Jour 1 · jeudi 20 août')
    expect(formatJourLabel('2026-08-21', 1)).toBe('Jour 2 · vendredi 21 août')
  })

  it('renvoie une chaîne vide sans date', () => {
    expect(formatJourLabel(null, 0)).toBe('')
  })
})
