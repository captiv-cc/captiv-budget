import { describe, it, expect } from 'vitest'
import {
  PREVIEW_DUREE_MS,
  blocDureeMs,
  blocSource,
  clampCoupe,
  dureeExploitableMs,
  ecartCibleMs,
  timelineDureeMs,
  timelinePositions,
} from './musiqueBerceaux'

describe('blocSource', () => {
  it('préfère le fichier déposé à l’extrait', () => {
    expect(blocSource({ audio_path: 'x.mp3', preview_url: 'p' })).toBe('fichier')
    expect(blocSource({ preview_url: 'p' })).toBe('extrait')
    expect(blocSource({})).toBe('aucune')
  })
})

describe('dureeExploitableMs', () => {
  it('mesure le fichier quand il existe', () => {
    expect(dureeExploitableMs({ audio_path: 'x', audio_duree_ms: 245000 })).toBe(245000)
  })

  it('borne à l’extrait sans fichier, même si Spotify annonce 4 minutes', () => {
    // Le piège : duration_ms vient de Spotify et vaut la durée du morceau
    // entier. Sans fichier, on ne peut pourtant jouer que les 30 s d'extrait.
    expect(dureeExploitableMs({ preview_url: 'p', duration_ms: 245000 })).toBe(PREVIEW_DUREE_MS)
  })

  it('renvoie zéro quand il n’y a rien à jouer', () => {
    expect(dureeExploitableMs({ duration_ms: 245000 })).toBe(0)
  })
})

describe('timelinePositions', () => {
  const blocs = [
    { id: 'b', sort_order: 1, in_ms: 10000, out_ms: 40000 }, // 30 s
    { id: 'a', sort_order: 0, in_ms: 0, out_ms: 20000 }, // 20 s
  ]

  it('enchaîne les blocs bout à bout dans l’ordre', () => {
    const pos = timelinePositions(blocs)
    expect(pos.map((p) => p.bloc.id)).toEqual(['a', 'b'])
    expect(pos[0]).toMatchObject({ start_ms: 0, end_ms: 20000 })
    expect(pos[1]).toMatchObject({ start_ms: 20000, end_ms: 50000 })
  })

  it('ne modifie pas le tableau reçu', () => {
    const copie = [...blocs]
    timelinePositions(blocs)
    expect(blocs).toEqual(copie)
  })

  it('totalise la durée', () => {
    expect(timelineDureeMs(blocs)).toBe(50000)
    expect(timelineDureeMs([])).toBe(0)
  })
})

describe('blocDureeMs', () => {
  it('mesure la coupe', () => {
    expect(blocDureeMs({ in_ms: 5000, out_ms: 12000 })).toBe(7000)
  })

  it('ne descend jamais sous zéro', () => {
    expect(blocDureeMs({ in_ms: 12000, out_ms: 5000 })).toBe(0)
    expect(blocDureeMs(null)).toBe(0)
  })
})

describe('ecartCibleMs', () => {
  const blocs = [{ in_ms: 0, out_ms: 200000 }]

  it('dit combien il manque ou dépasse', () => {
    expect(ecartCibleMs(blocs, 240000)).toBe(-40000)
    expect(ecartCibleMs(blocs, 180000)).toBe(20000)
  })

  it('ne dit rien sans cible', () => {
    expect(ecartCibleMs(blocs, null)).toBeNull()
    expect(ecartCibleMs(blocs, 0)).toBeNull()
  })
})

describe('clampCoupe', () => {
  it('garde la coupe dans le morceau', () => {
    expect(clampCoupe({ in_ms: -500, out_ms: 999999 }, 60000)).toEqual({
      in_ms: 0,
      out_ms: 60000,
    })
  })

  it('empêche un bloc vide ou inversé', () => {
    const r = clampCoupe({ in_ms: 30000, out_ms: 30000 }, 60000)
    expect(r.out_ms).toBeGreaterThan(r.in_ms)
  })
})

describe('parseDuree (durées de livrables, saisies en texte)', () => {
  it('lit les formats courants', async () => {
    const { parseDuree } = await import('../features/musiques/BerceauxView')
    expect(parseDuree('4:00')).toBe(240000)
    expect(parseDuree('04:00')).toBe(240000)
    expect(parseDuree('1:02:30')).toBe(3750000)
    expect(parseDuree('90')).toBe(90000)
  })

  it('refuse ce qui n’est pas une durée', async () => {
    const { parseDuree } = await import('../features/musiques/BerceauxView')
    expect(parseDuree('court')).toBeNull()
    expect(parseDuree('')).toBeNull()
    expect(parseDuree(null)).toBeNull()
    expect(parseDuree('4:xx')).toBeNull()
  })
})
