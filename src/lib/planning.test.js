/**
 * Tests unitaires — planning.js (fonctions pures uniquement)
 * Les wrappers CRUD Supabase ne sont pas testés ici : ils passeront par
 * des tests d'intégration plus tard (projet CI/CD).
 */
import { describe, it, expect } from 'vitest'
import {
  resolveEventColor,
  eventsOverlap,
  EVENT_MEMBER_STATUS,
  SYSTEM_EVENT_TYPE_SLUGS,
} from './planning'

describe('resolveEventColor', () => {
  it('utilise color_override si présent', () => {
    expect(resolveEventColor({ color_override: '#FF0000', type: { color: '#00FF00' } })).toBe('#FF0000')
  })
  it('retombe sur la couleur du type si pas de surcharge', () => {
    expect(resolveEventColor({ color_override: null, type: { color: '#00FF00' } })).toBe('#00FF00')
  })
  it('retombe sur le fallback si ni surcharge ni type', () => {
    expect(resolveEventColor({})).toBe('var(--txt-3)')
    expect(resolveEventColor({}, '#123456')).toBe('#123456')
  })
  it('gère null/undefined sans planter', () => {
    expect(resolveEventColor(null)).toBe('var(--txt-3)')
    expect(resolveEventColor(undefined)).toBe('var(--txt-3)')
  })
})

describe('eventsOverlap', () => {
  const mk = (s, e) => ({ starts_at: s, ends_at: e })
  it('détecte un chevauchement partiel', () => {
    const a = mk('2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z')
    const b = mk('2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z')
    expect(eventsOverlap(a, b)).toBe(true)
  })
  it('retourne false si A finit pile quand B commence', () => {
    const a = mk('2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z')
    const b = mk('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z')
    expect(eventsOverlap(a, b)).toBe(false)
  })
  it('détecte un inclusion complète', () => {
    const a = mk('2026-05-01T09:00:00Z', '2026-05-01T18:00:00Z')
    const b = mk('2026-05-01T12:00:00Z', '2026-05-01T14:00:00Z')
    expect(eventsOverlap(a, b)).toBe(true)
  })
  it('retourne false pour des événements disjoints', () => {
    const a = mk('2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z')
    const b = mk('2026-05-02T09:00:00Z', '2026-05-02T10:00:00Z')
    expect(eventsOverlap(a, b)).toBe(false)
  })
  it('retourne false pour null/undefined', () => {
    expect(eventsOverlap(null, {})).toBe(false)
    expect(eventsOverlap({}, null)).toBe(false)
  })
})

describe('Constantes planning', () => {
  it('expose 4 statuts membres', () => {
    expect(Object.keys(EVENT_MEMBER_STATUS)).toEqual([
      'pending', 'confirmed', 'declined', 'tentative',
    ])
  })
  it('expose 13 slugs système (= nb de types par défaut seedés)', () => {
    expect(SYSTEM_EVENT_TYPE_SLUGS).toHaveLength(13)
    expect(SYSTEM_EVENT_TYPE_SLUGS).toContain('tournage')
    expect(SYSTEM_EVENT_TYPE_SLUGS).toContain('montage')
    expect(SYSTEM_EVENT_TYPE_SLUGS).toContain('autre')
  })
})
