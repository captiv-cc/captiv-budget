/**
 * Tests unitaires — matosRendu.js (MAT-13F)
 *
 * Ne couvre QUE les helpers purs (pas les wrappers Supabase `uploadBonRetourArchive`,
 * `closeRendu`, `setRenduFeedback*`…) :
 *   - bonRetourPdfFilename         : format global
 *   - bonRetourLoueurPdfFilename   : variante par loueur + fallback "sans-loueur"
 *   - bonRetourZipFilename         : archive ZIP multi-loueur (MAT-13H)
 *   - slugification interne        : accents NFD, caractères spéciaux, longueur
 *
 * Les 3 helpers partagent le slugifieur interne `_slugFilename`. Les tests
 * valident indirectement son comportement via les 3 entry points publics.
 */
import { describe, it, expect } from 'vitest'
import {
  bonRetourPdfFilename,
  bonRetourLoueurPdfFilename,
  bonRetourZipFilename,
} from './matosRendu'

// ─── bonRetourPdfFilename — format global ──────────────────────────────────

describe('bonRetourPdfFilename', () => {
  it('format "Bon-retour-<ref>-V<n>.pdf" quand ref_projet présent', () => {
    expect(
      bonRetourPdfFilename({
        project: { ref_projet: 'MTX-2026-03' },
        version: { numero: 1 },
      }),
    ).toBe('Bon-retour-MTX-2026-03-V1.pdf')
  })

  it('fallback sur project.title si ref_projet manquant', () => {
    expect(
      bonRetourPdfFilename({
        project: { title: 'Le Grand Film' },
        version: { numero: 2 },
      }),
    ).toBe('Bon-retour-Le-Grand-Film-V2.pdf')
  })

  it('retire les accents (NFD decomposition)', () => {
    expect(
      bonRetourPdfFilename({
        project: { title: 'Noël éclair 2025' },
        version: { numero: 1 },
      }),
    ).toBe('Bon-retour-Noel-eclair-2025-V1.pdf')
  })

  it('remplace les caractères spéciaux par des tirets', () => {
    expect(
      bonRetourPdfFilename({
        project: { title: 'Film / 2026 & Co !' },
        version: { numero: 3 },
      }),
    ).toBe('Bon-retour-Film-2026-Co-V3.pdf')
  })

  it('renvoie "projet-V?" quand project et version sont null', () => {
    expect(bonRetourPdfFilename({ project: null, version: null })).toBe(
      'Bon-retour-projet-V?.pdf',
    )
  })

  it('renvoie "projet" quand title et ref_projet sont tous deux vides', () => {
    expect(
      bonRetourPdfFilename({
        project: { title: '', ref_projet: '' },
        version: { numero: 0 },
      }),
    ).toBe('Bon-retour-projet-V0.pdf')
  })
})

// ─── bonRetourLoueurPdfFilename — variante par loueur ─────────────────────

describe('bonRetourLoueurPdfFilename', () => {
  const project = { ref_projet: 'MTX-2026-03' }
  const version = { numero: 2 }

  it('suffixe avec le nom du loueur slugifié', () => {
    expect(
      bonRetourLoueurPdfFilename({
        project,
        version,
        loueur: { nom: 'Lux Camera' },
      }),
    ).toBe('Bon-retour-MTX-2026-03-V2-Lux-Camera.pdf')
  })

  it('slugifie les accents et symboles du nom loueur', () => {
    expect(
      bonRetourLoueurPdfFilename({
        project,
        version,
        loueur: { nom: 'Caméra & Éclairage Ltd.' },
      }),
    ).toBe('Bon-retour-MTX-2026-03-V2-Camera-Eclairage-Ltd.pdf')
  })

  it('utilise "sans-loueur" quand loueur est null', () => {
    expect(
      bonRetourLoueurPdfFilename({ project, version, loueur: null }),
    ).toBe('Bon-retour-MTX-2026-03-V2-sans-loueur.pdf')
  })

  it('utilise "sans-loueur" quand loueur.nom est absent ou vide', () => {
    expect(
      bonRetourLoueurPdfFilename({ project, version, loueur: { nom: '' } }),
    ).toBe('Bon-retour-MTX-2026-03-V2-sans-loueur.pdf')
    expect(
      bonRetourLoueurPdfFilename({ project, version, loueur: {} }),
    ).toBe('Bon-retour-MTX-2026-03-V2-sans-loueur.pdf')
  })

  it('loueur par défaut = null si omis', () => {
    expect(bonRetourLoueurPdfFilename({ project, version })).toBe(
      'Bon-retour-MTX-2026-03-V2-sans-loueur.pdf',
    )
  })
})

// ─── bonRetourZipFilename — archive ZIP MAT-13H ───────────────────────────

describe('bonRetourZipFilename', () => {
  it('format "Bon-retour-<ref>-V<n>.zip"', () => {
    expect(
      bonRetourZipFilename({
        project: { ref_projet: 'MTX-2026-03' },
        version: { numero: 1 },
      }),
    ).toBe('Bon-retour-MTX-2026-03-V1.zip')
  })

  it('fallback sur title quand ref_projet absent', () => {
    expect(
      bonRetourZipFilename({
        project: { title: 'Matrice Golden' },
        version: { numero: 5 },
      }),
    ).toBe('Bon-retour-Matrice-Golden-V5.zip')
  })

  it('renvoie "projet-V?" quand entrée vide', () => {
    expect(bonRetourZipFilename({ project: null, version: null })).toBe(
      'Bon-retour-projet-V?.zip',
    )
  })
})
