import { describe, it, expect } from 'vitest'
import {
  buildPeaks,
  formatMs,
  matchFileToProposition,
  normalizeForMatch,
} from './musiqueAudio'

describe('normalizeForMatch', () => {
  it('retire extension, numéro de piste et mentions parasites', () => {
    expect(normalizeForMatch('03 - Moby - Bodyrock (Official Audio).mp3')).toBe('moby bodyrock')
    expect(normalizeForMatch('ANETHA — Nuit Blanche [HD].wav')).toBe('anetha nuit blanche')
  })

  it('ignore accents et casse', () => {
    expect(normalizeForMatch('Éléphant.mp3')).toBe('elephant')
  })
})

describe('matchFileToProposition', () => {
  const props = [
    { id: '1', titre: 'Bodyrock', artiste_text: 'Moby' },
    { id: '2', titre: 'Mott St 1992', artiste_text: 'Moby' },
    { id: '3', titre: 'Nuit Blanche', artiste: { nom: 'ANETHA' } },
  ]

  it('reconnaît « Artiste - Titre.mp3 »', () => {
    expect(matchFileToProposition('Moby - Bodyrock.mp3', props).proposition.id).toBe('1')
  })

  it('reconnaît un titre seul', () => {
    expect(matchFileToProposition('Mott St 1992.mp3', props).proposition.id).toBe('2')
  })

  it('résout via l’artiste de l’annuaire', () => {
    expect(matchFileToProposition('ANETHA_Nuit Blanche.mp3', props).proposition.id).toBe('3')
  })

  it('ne rattache rien quand le nom ne dit rien', () => {
    const r = matchFileToProposition('piste_01.mp3', props)
    expect(r.proposition).toBeNull()
    expect(r.ambigu).toBe(false)
  })

  it('refuse de trancher entre deux candidats équivalents', () => {
    const jumeaux = [
      { id: 'a', titre: 'Roar', artiste_text: 'X' },
      { id: 'b', titre: 'Roar', artiste_text: 'Y' },
    ]
    const r = matchFileToProposition('Roar.mp3', jumeaux)
    expect(r.proposition).toBeNull()
    expect(r.ambigu).toBe(true)
  })
})

describe('buildPeaks', () => {
  it('garde le pic de chaque tranche, pas la moyenne', () => {
    // Une impulsion isolée doit rester visible : une moyenne l'effacerait.
    const data = new Float32Array(100)
    data[42] = 1
    const peaks = buildPeaks(data, 10)
    expect(peaks).toHaveLength(10)
    expect(peaks[4]).toBe(255)
    expect(peaks[0]).toBe(0)
  })

  it('tolère un signal vide', () => {
    expect(buildPeaks(new Float32Array(0), 10)).toEqual([])
    expect(buildPeaks(null)).toEqual([])
  })
})

describe('formatMs', () => {
  it('formate en minutes:secondes', () => {
    expect(formatMs(187000)).toBe('3:07')
    expect(formatMs(59999)).toBe('1:00')
    expect(formatMs(0)).toBe('0:00')
  })

  it('tolère une valeur absente', () => {
    expect(formatMs(null)).toBe('0:00')
  })
})
