/**
 * Tests unitaires — matosCheckToken.js (MAT-10M)
 *
 * Ne couvre QUE les helpers purs (pas les wrappers Supabase) :
 *   - generateCheckToken  : format base64url, 32 chars, pas de +/=
 *   - buildCheckUrl       : assemblage + encodeURIComponent
 *   - get/setCheckUserName : persistence localStorage scopée par token
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  generateCheckToken,
  buildCheckUrl,
  getCheckUserName,
  setCheckUserName,
} from './matosCheckToken'

// ─── generateCheckToken ─────────────────────────────────────────────────────
describe('generateCheckToken', () => {
  it('produit une string base64url de 32 caractères', () => {
    const t = generateCheckToken()
    expect(typeof t).toBe('string')
    // 24 bytes → 32 chars base64 sans padding.
    expect(t.length).toBe(32)
    // Caractères autorisés : A-Z a-z 0-9 - _
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    // Pas de caractère de padding ni des variantes base64 classiques.
    expect(t).not.toMatch(/[+/=]/)
  })

  it('génère des tokens uniques sur 100 tirages (smoke de l\'entropie)', () => {
    // 24 bytes ~ 192 bits d'entropie → collision sur 100 = infiniment improbable.
    // Si ce test flaque, c'est qu'on a cassé le générateur, pas la chance.
    const seen = new Set()
    for (let i = 0; i < 100; i++) seen.add(generateCheckToken())
    expect(seen.size).toBe(100)
  })

  it('lève une erreur explicite si WebCrypto est absent', () => {
    const original = globalThis.crypto
    // @ts-ignore
    globalThis.crypto = undefined
    try {
      expect(() => generateCheckToken()).toThrow(/WebCrypto indisponible/)
    } finally {
      globalThis.crypto = original
    }
  })
})

// ─── buildCheckUrl ──────────────────────────────────────────────────────────
describe('buildCheckUrl', () => {
  const ORIGINAL_LOCATION = globalThis.window?.location

  beforeEach(() => {
    // Stubb l'origin pour ne pas dépendre de l'environnement de test
    // (jsdom par défaut : http://localhost:3000, mais on reste défensif).
    Object.defineProperty(globalThis.window, 'location', {
      value: { origin: 'https://desk.captiv.cc' },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis.window, 'location', {
      value: ORIGINAL_LOCATION,
      writable: true,
    })
  })

  it('assemble origin + /check/:token', () => {
    expect(buildCheckUrl('abc123')).toBe('https://desk.captiv.cc/check/abc123')
  })

  it('encode les caractères URL-unsafe dans le token', () => {
    // Pas réaliste (nos tokens sont base64url = safe) mais blinde l\'API.
    expect(buildCheckUrl('a/b c?d')).toBe('https://desk.captiv.cc/check/a%2Fb%20c%3Fd')
  })

  it('retourne une string vide si token est vide/null', () => {
    expect(buildCheckUrl('')).toBe('')
    expect(buildCheckUrl(null)).toBe('')
    expect(buildCheckUrl(undefined)).toBe('')
  })
})

// ─── get/setCheckUserName ───────────────────────────────────────────────────
describe('getCheckUserName / setCheckUserName', () => {
  beforeEach(() => {
    // Vide le localStorage entre chaque test pour un état déterministe.
    window.localStorage.clear()
  })

  it('retourne null tant qu\'on n\'a rien stocké', () => {
    expect(getCheckUserName('tok-1')).toBe(null)
  })

  it('stocke et relit un nom trim\'é', () => {
    setCheckUserName('tok-1', '  Camille  ')
    expect(getCheckUserName('tok-1')).toBe('Camille')
  })

  it('scope le stockage par token (pas de collision entre liens)', () => {
    setCheckUserName('tok-1', 'Camille')
    setCheckUserName('tok-2', 'Alex')
    expect(getCheckUserName('tok-1')).toBe('Camille')
    expect(getCheckUserName('tok-2')).toBe('Alex')
  })

  it('efface le nom quand on passe null ou une chaîne vide', () => {
    setCheckUserName('tok-1', 'Camille')
    setCheckUserName('tok-1', '')
    expect(getCheckUserName('tok-1')).toBe(null)

    setCheckUserName('tok-1', 'Camille')
    setCheckUserName('tok-1', null)
    expect(getCheckUserName('tok-1')).toBe(null)

    // "   " blanc seul = considéré comme vide après trim.
    setCheckUserName('tok-1', 'Camille')
    setCheckUserName('tok-1', '   ')
    expect(getCheckUserName('tok-1')).toBe(null)
  })

  it('no-op quand token est falsy (ne crash pas)', () => {
    expect(() => setCheckUserName(null, 'X')).not.toThrow()
    expect(() => setCheckUserName('', 'X')).not.toThrow()
    expect(getCheckUserName(null)).toBe(null)
    expect(getCheckUserName('')).toBe(null)
  })

  it('survit à un localStorage qui throw (mode privé Safari par ex.)', () => {
    // Simule un throw : on remplace setItem par un stub qui lève.
    const original = window.localStorage.setItem
    window.localStorage.setItem = vi.fn(() => {
      throw new Error('QuotaExceeded')
    })
    try {
      expect(() => setCheckUserName('tok-1', 'Camille')).not.toThrow()
    } finally {
      window.localStorage.setItem = original
    }
  })
})
