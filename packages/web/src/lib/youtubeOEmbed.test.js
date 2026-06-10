// Tests unitaires lib/youtubeOEmbed.js
//
// Couvre les fonctions pures (extraction video_id, normalisation URL, parser
// titre). fetchOEmbed et resolveFromUrl ne sont pas testés ici car ils font
// du fetch HTTP — leurs entrées et sorties sont testées via les fonctions
// pures qui les composent.

import { describe, it, expect } from 'vitest'
import {
  extractVideoId,
  isYouTubeUrl,
  normalizeYouTubeUrl,
  parseVideoTitle,
} from './youtubeOEmbed'

describe('extractVideoId', () => {
  it('extrait depuis youtube.com/watch?v=', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=CfOYq4Dv4CQ'))
      .toBe('CfOYq4Dv4CQ')
  })
  it('extrait depuis youtu.be/', () => {
    expect(extractVideoId('https://youtu.be/H_P91SxZUAE')).toBe('H_P91SxZUAE')
  })
  it('extrait depuis youtu.be/ avec ?si=', () => {
    expect(extractVideoId('https://youtu.be/H_P91SxZUAE?si=WHe2Zz8-MNZ2unTv'))
      .toBe('H_P91SxZUAE')
  })
  it('extrait depuis youtube.com avec t= (timecode)', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=AgFG6_TGdTY&t=140s'))
      .toBe('AgFG6_TGdTY')
  })
  it('extrait depuis m.youtube.com (mobile)', () => {
    expect(extractVideoId('https://m.youtube.com/watch?v=ABC12345678'))
      .toBe('ABC12345678')
  })
  it('extrait depuis youtube.com/embed/', () => {
    expect(extractVideoId('https://www.youtube.com/embed/CfOYq4Dv4CQ'))
      .toBe('CfOYq4Dv4CQ')
  })
  it('extrait depuis youtube.com/shorts/', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/CfOYq4Dv4CQ'))
      .toBe('CfOYq4Dv4CQ')
  })
  it('extrait depuis music.youtube.com', () => {
    expect(extractVideoId('https://music.youtube.com/watch?v=CfOYq4Dv4CQ'))
      .toBe('CfOYq4Dv4CQ')
  })
  it('accepte une URL sans schéma', () => {
    expect(extractVideoId('youtu.be/CfOYq4Dv4CQ')).toBe('CfOYq4Dv4CQ')
  })
  it('accepte un video_id brut de 11 caractères', () => {
    expect(extractVideoId('CfOYq4Dv4CQ')).toBe('CfOYq4Dv4CQ')
  })
  it('renvoie null pour une URL invalide', () => {
    expect(extractVideoId('https://example.com/foo')).toBeNull()
  })
  it('renvoie null pour une chaîne vide', () => {
    expect(extractVideoId('')).toBeNull()
  })
  it('renvoie null pour null/undefined', () => {
    expect(extractVideoId(null)).toBeNull()
    expect(extractVideoId(undefined)).toBeNull()
  })
  it('renvoie null si video_id mal formé', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=trop_court'))
      .toBeNull()
  })
})

describe('isYouTubeUrl', () => {
  it('détecte youtube.com', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=ABC')).toBe(true)
  })
  it('détecte youtu.be', () => {
    expect(isYouTubeUrl('https://youtu.be/ABC')).toBe(true)
  })
  it('détecte music.youtube.com', () => {
    expect(isYouTubeUrl('https://music.youtube.com/watch?v=ABC')).toBe(true)
  })
  it('détecte même sans schéma', () => {
    expect(isYouTubeUrl('youtu.be/ABC')).toBe(true)
  })
  it('refuse une URL non YouTube', () => {
    expect(isYouTubeUrl('https://spotify.com/track/ABC')).toBe(false)
  })
  it('refuse un texte simple', () => {
    expect(isYouTubeUrl('Eat sleep slay')).toBe(false)
  })
  it('refuse une chaîne vide', () => {
    expect(isYouTubeUrl('')).toBe(false)
  })
})

describe('normalizeYouTubeUrl', () => {
  it('canonicalise depuis youtu.be', () => {
    expect(normalizeYouTubeUrl('https://youtu.be/CfOYq4Dv4CQ?si=xyz'))
      .toBe('https://www.youtube.com/watch?v=CfOYq4Dv4CQ')
  })
  it('canonicalise depuis embed', () => {
    expect(normalizeYouTubeUrl('https://www.youtube.com/embed/CfOYq4Dv4CQ'))
      .toBe('https://www.youtube.com/watch?v=CfOYq4Dv4CQ')
  })
  it('renvoie null pour URL invalide', () => {
    expect(normalizeYouTubeUrl('https://example.com')).toBeNull()
  })
})

describe('parseVideoTitle', () => {
  // ─── Cas standards : "Artiste - Titre (Official Video)" ─────────────────
  it('parse "Artiste - Titre (Official Video)"', () => {
    expect(parseVideoTitle('Horsegiirl - Eat Sleep Slay (Official Video)'))
      .toEqual({ artiste: 'Horsegiirl', titre: 'Eat Sleep Slay' })
  })
  it('parse "Artiste - Titre (Official Music Video)"', () => {
    expect(parseVideoTitle('Charlotte de Witte - Roar (Official Music Video)'))
      .toEqual({ artiste: 'Charlotte de Witte', titre: 'Roar' })
  })
  it('parse "Artiste - Titre (Official Audio)"', () => {
    expect(parseVideoTitle('Peggy Gou - Nanana (Official Audio)'))
      .toEqual({ artiste: 'Peggy Gou', titre: 'Nanana' })
  })
  it('parse avec suffixe Lyrics', () => {
    expect(parseVideoTitle('BOOBA - Dolce Camara (Lyrics)'))
      .toEqual({ artiste: 'BOOBA', titre: 'Dolce Camara' })
  })

  // ─── Suffixes qualité (HD, 4K) ─────────────────────────────────────────
  it('retire suffixe HD', () => {
    expect(parseVideoTitle('Anetha - Whistleblower (HD)'))
      .toEqual({ artiste: 'Anetha', titre: 'Whistleblower' })
  })
  it('retire double suffixe en cascade', () => {
    expect(parseVideoTitle('Anetha - Whistleblower (Official Video) (HD)'))
      .toEqual({ artiste: 'Anetha', titre: 'Whistleblower' })
  })

  // ─── Suffixe pipe ────────────────────────────────────────────────────────
  it('retire suffixe après pipe', () => {
    expect(parseVideoTitle('Anetha - Whistleblower | Official Music Video'))
      .toEqual({ artiste: 'Anetha', titre: 'Whistleblower' })
  })
  it('retire suffixe après pipe avec quotes', () => {
    expect(
      parseVideoTitle(
        'Eric Prydz - Pjanoo (Original Mix) | UMF Festival 2024',
      ),
    ).toEqual({ artiste: 'Eric Prydz', titre: 'Pjanoo (Original Mix)' })
  })

  // ─── Chaîne Topic (YouTube Music auto-generated) ───────────────────────
  it('utilise author si chaîne Topic', () => {
    // Sur les chaînes "Artiste - Topic", le titre vidéo = juste le titre
    // du morceau, et l'auteur = l'artiste fiable.
    expect(parseVideoTitle('Whistleblower', 'Anetha - Topic'))
      .toEqual({ artiste: 'Anetha', titre: 'Whistleblower' })
  })
  it('nettoie le titre même sur chaîne Topic', () => {
    expect(parseVideoTitle('Roar (Original Mix)', 'Charlotte de Witte - Topic'))
      .toEqual({ artiste: 'Charlotte de Witte', titre: 'Roar (Original Mix)' })
  })

  // ─── Brackets en préfixe ────────────────────────────────────────────────
  it('extrait artiste depuis [BRACKETS] préfixe', () => {
    expect(parseVideoTitle('[Anetha] - Whistleblower (Official Video)'))
      .toEqual({ artiste: 'Anetha', titre: 'Whistleblower' })
  })

  // ─── Cas em dash / en dash ──────────────────────────────────────────────
  it('split sur em dash —', () => {
    expect(parseVideoTitle('KETTAMA — Yosemite'))
      .toEqual({ artiste: 'KETTAMA', titre: 'Yosemite' })
  })
  it('split sur en dash –', () => {
    expect(parseVideoTitle('KETTAMA – Yosemite'))
      .toEqual({ artiste: 'KETTAMA', titre: 'Yosemite' })
  })

  // ─── Feat. / ft. conservés dans le titre ────────────────────────────────
  it('garde feat. dans le titre', () => {
    expect(parseVideoTitle('Tiesto - Hot In It (feat. Charli XCX)'))
      .toEqual({
        artiste: 'Tiesto',
        titre: 'Hot In It (feat. Charli XCX)',
      })
  })

  // ─── Pas de séparateur : fallback ──────────────────────────────────────
  it('fallback : pas de séparateur, tout est titre', () => {
    expect(parseVideoTitle('Lobster Telephone', 'PeggyGouOfficial'))
      .toEqual({ artiste: 'PeggyGouOfficial', titre: 'Lobster Telephone' })
  })
  it('fallback : VEVO retiré du author', () => {
    expect(parseVideoTitle('Some Track', 'AnethaVEVO'))
      .toEqual({ artiste: 'Anetha', titre: 'Some Track' })
  })

  // ─── Cas limites ────────────────────────────────────────────────────────
  it('input vide → tout vide', () => {
    expect(parseVideoTitle('')).toEqual({ artiste: '', titre: '' })
  })
  it('input vide avec auteur fournit l\'artiste', () => {
    expect(parseVideoTitle('', 'Horsegiirl'))
      .toEqual({ artiste: 'Horsegiirl', titre: '' })
  })
  it('garde le titre tel quel si pas de motif reconnu', () => {
    expect(parseVideoTitle('Just A Random Title'))
      .toEqual({ artiste: '', titre: 'Just A Random Title' })
  })

  // ─── Cas musique électro réels observés dans les gsheets Hugo ──────────
  it('cas réel : Eric Prydz Pjanoo', () => {
    expect(parseVideoTitle('Eric Prydz - Pjanoo (Beyond Wizard Mix)'))
      .toEqual({
        artiste: 'Eric Prydz',
        titre: 'Pjanoo (Beyond Wizard Mix)',
      })
  })
  it('cas réel : Bellaire Sunshine', () => {
    expect(parseVideoTitle('Bellaire - Sunshine is coming'))
      .toEqual({ artiste: 'Bellaire', titre: 'Sunshine is coming' })
  })
})
