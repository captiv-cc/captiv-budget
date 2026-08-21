import { describe, it, expect } from 'vitest'
import {
  contenuSujet,
  refValues,
  formatJourLabel,
  resolveSujet,
  statutCountLabel,
} from './contenus'

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

describe('resolveSujet', () => {
  const artistes = [
    { id: 'a1', nom: 'Macklemore' },
    { id: 'a2', nom: 'Dimitri Vegas' },
  ]

  it('lie un artiste connu au lieu de dupliquer son nom', () => {
    expect(resolveSujet('Macklemore', artistes)).toEqual({
      artiste_id: 'a1',
      artiste_text: null,
    })
  })

  it('reconnaît l’artiste quelle que soit la casse', () => {
    expect(resolveSujet('  macklemore ', artistes).artiste_id).toBe('a1')
  })

  it('garde un moment libre en texte', () => {
    expect(resolveSujet('Ambiance camping', artistes)).toEqual({
      artiste_id: null,
      artiste_text: 'Ambiance camping',
    })
  })

  it('vide les deux champs sur une saisie vide', () => {
    expect(resolveSujet('   ', artistes)).toEqual({ artiste_id: null, artiste_text: null })
    expect(resolveSujet(null)).toEqual({ artiste_id: null, artiste_text: null })
  })
})

describe('statutCountLabel', () => {
  it('accorde ce qui s’accorde', () => {
    expect(statutCountLabel('valide', 1)).toBe('validé')
    expect(statutCountLabel('valide', 2)).toBe('validés')
    expect(statutCountLabel('non_shoote', 3)).toBe('non shootés')
    expect(statutCountLabel('refuse', 2)).toBe('refusés')
  })

  it('laisse invariables les états qui le sont', () => {
    expect(statutCountLabel('en_attente', 5)).toBe('en attente')
    expect(statutCountLabel('a_revoir', 5)).toBe('à revoir')
  })

  it('traite zéro comme un singulier', () => {
    expect(statutCountLabel('valide', 0)).toBe('validé')
  })
})
