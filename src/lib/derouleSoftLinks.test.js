// ════════════════════════════════════════════════════════════════════════════
// Tests unitaires — derouleSoftLinks (FEST-2)
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import {
  ANCHOR_FIELDS,
  isFieldEqual,
  proposeAnchorDefault,
  getLinkedChildren,
  getSourceCreneau,
  isLinkedToSource,
  isSourceOf,
  applySourceUpdate,
  computeDiffForPropagation,
  countChangedFields,
  validateLinkTarget,
} from './derouleSoftLinks'

const NOTES_FOO = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'foo' }] },
  ],
}
const NOTES_FOO_REORDERED = {
  content: [
    { content: [{ text: 'foo', type: 'text' }], type: 'paragraph' },
  ],
  type: 'doc',
}
const NOTES_BAR = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'bar' }] },
  ],
}

function mkCreneau(over = {}) {
  return {
    id: over.id || 'c1',
    titre: 'Q&A',
    description: null,
    type: 'tournage',
    couleur: '#3B82F6',
    lieu_text: 'Salle de presse',
    notes: null,
    heure_debut_min: 600,
    heure_fin_min: 630,
    member_ids: ['m1', 'm2'],
    source_creneau_id: null,
    source_anchor: null,
    ...over,
  }
}

describe('isFieldEqual', () => {
  it('compare les champs scalaires (titre, type, lieu_text…)', () => {
    const a = mkCreneau({ titre: 'A' })
    const b = mkCreneau({ titre: 'A' })
    expect(isFieldEqual('titre', a, b)).toBe(true)
    const c = mkCreneau({ titre: 'B' })
    expect(isFieldEqual('titre', a, c)).toBe(false)
  })

  it('compare les cadreurs comme sets (ordre indifférent)', () => {
    const a = mkCreneau({ member_ids: ['m1', 'm2', 'm3'] })
    const b = mkCreneau({ member_ids: ['m3', 'm1', 'm2'] })
    expect(isFieldEqual('cadreurs', a, b)).toBe(true)
    const c = mkCreneau({ member_ids: ['m1', 'm2'] })
    expect(isFieldEqual('cadreurs', a, c)).toBe(false)
  })

  it('compare duree_min indépendamment de l\'heure de début', () => {
    const a = mkCreneau({ heure_debut_min: 600, heure_fin_min: 660 }) // 60min
    const b = mkCreneau({ heure_debut_min: 900, heure_fin_min: 960 }) // 60min
    expect(isFieldEqual('duree_min', a, b)).toBe(true)
    const c = mkCreneau({ heure_debut_min: 600, heure_fin_min: 700 }) // 100min
    expect(isFieldEqual('duree_min', a, c)).toBe(false)
  })

  it('compare les notes JSON de façon canonique (ordre clés indifférent)', () => {
    const a = mkCreneau({ notes: NOTES_FOO })
    const b = mkCreneau({ notes: NOTES_FOO_REORDERED })
    expect(isFieldEqual('notes', a, b)).toBe(true)
    const c = mkCreneau({ notes: NOTES_BAR })
    expect(isFieldEqual('notes', a, c)).toBe(false)
  })

  it('considère null === null et null !== valeur', () => {
    const a = mkCreneau({ description: null })
    const b = mkCreneau({ description: null })
    expect(isFieldEqual('description', a, b)).toBe(true)
    const c = mkCreneau({ description: 'foo' })
    expect(isFieldEqual('description', a, c)).toBe(false)
  })
})

describe('proposeAnchorDefault', () => {
  it('pré-coche tous les champs identiques entre child et source', () => {
    const source = mkCreneau({ id: 's', titre: 'Q&A', lieu_text: 'Presse' })
    const child = mkCreneau({
      id: 'c',
      titre: 'Q&A',
      lieu_text: 'Presse',
      heure_debut_min: 900,
      heure_fin_min: 930,
    })
    const anchor = proposeAnchorDefault(child, source)
    expect(anchor.fields).toContain('titre')
    expect(anchor.fields).toContain('lieu_text')
    expect(anchor.fields).toContain('duree_min')
    expect(anchor.fields).toContain('cadreurs')
  })

  it("retourne fields:[] si rien d'identique", () => {
    const source = mkCreneau({ titre: 'A', lieu_text: 'X', member_ids: ['m1'] })
    const child = mkCreneau({
      titre: 'B',
      lieu_text: 'Y',
      heure_debut_min: 0,
      heure_fin_min: 999,
      member_ids: ['m2'],
      type: 'preparation',
      couleur: '#FF0000',
      description: 'foo',
    })
    expect(proposeAnchorDefault(child, source).fields).toEqual([])
  })

  it('gère les inputs null/undefined', () => {
    expect(proposeAnchorDefault(null, mkCreneau()).fields).toEqual([])
    expect(proposeAnchorDefault(mkCreneau(), null).fields).toEqual([])
  })
})

describe('getLinkedChildren / getSourceCreneau / helpers bool', () => {
  const creneaux = [
    mkCreneau({ id: 's1', titre: 'Source A' }),
    mkCreneau({ id: 'c1', source_creneau_id: 's1' }),
    mkCreneau({ id: 'c2', source_creneau_id: 's1' }),
    mkCreneau({ id: 'c3', source_creneau_id: 's2' }),
    mkCreneau({ id: 'orphan' }),
  ]

  it('getLinkedChildren retourne tous les enfants directs', () => {
    const children = getLinkedChildren(creneaux, 's1')
    expect(children).toHaveLength(2)
    expect(children.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
  })

  it('getLinkedChildren retourne [] si pas de match', () => {
    expect(getLinkedChildren(creneaux, 'inexistant')).toEqual([])
    expect(getLinkedChildren(null, 's1')).toEqual([])
  })

  it('getSourceCreneau retourne le parent', () => {
    const child = creneaux.find((c) => c.id === 'c1')
    const source = getSourceCreneau(creneaux, child)
    expect(source?.id).toBe('s1')
  })

  it('getSourceCreneau retourne null si parent introuvable', () => {
    const child = creneaux.find((c) => c.id === 'c3')
    expect(getSourceCreneau(creneaux, child)).toBeNull()
  })

  it('isLinkedToSource détecte les liens', () => {
    expect(isLinkedToSource({ source_creneau_id: 's1' })).toBe(true)
    expect(isLinkedToSource({ source_creneau_id: null })).toBe(false)
    expect(isLinkedToSource(null)).toBe(false)
  })

  it('isSourceOf détecte les sources actives', () => {
    expect(isSourceOf(creneaux, 's1')).toBe(true)
    expect(isSourceOf(creneaux, 'orphan')).toBe(false)
  })
})

describe('applySourceUpdate', () => {
  it("applique titre + lieu_text quand l'anchor le demande", () => {
    const source = mkCreneau({ titre: 'NOUVEAU', lieu_text: 'Scène B' })
    const child = mkCreneau({ titre: 'ANCIEN', lieu_text: 'Scène A' })
    const patch = applySourceUpdate(source, child, {
      fields: ['titre', 'lieu_text'],
    })
    expect(patch.titre).toBe('NOUVEAU')
    expect(patch.lieu_text).toBe('Scène B')
    expect(patch.heure_fin_min).toBeUndefined()
  })

  it("préserve heure_debut_min mais recalcule heure_fin_min pour 'duree_min'", () => {
    const source = mkCreneau({ heure_debut_min: 600, heure_fin_min: 660 }) // 60min
    const child = mkCreneau({ heure_debut_min: 900, heure_fin_min: 930 })
    const patch = applySourceUpdate(source, child, { fields: ['duree_min'] })
    expect(patch.heure_debut_min).toBeUndefined()
    expect(patch.heure_fin_min).toBe(960) // 900 + 60
  })

  it("clone member_ids quand 'cadreurs' est dans l'anchor", () => {
    const source = mkCreneau({ member_ids: ['x', 'y'] })
    const child = mkCreneau({ member_ids: ['z'] })
    const patch = applySourceUpdate(source, child, { fields: ['cadreurs'] })
    expect(patch.member_ids).toEqual(['x', 'y'])
  })

  it("propage le JSON ProseMirror tel quel pour 'notes'", () => {
    const source = mkCreneau({ notes: NOTES_FOO })
    const child = mkCreneau({ notes: null })
    const patch = applySourceUpdate(source, child, { fields: ['notes'] })
    expect(patch.notes).toEqual(NOTES_FOO)
  })

  it("retourne {} si anchor vide / inputs nuls", () => {
    expect(applySourceUpdate(mkCreneau(), mkCreneau(), { fields: [] })).toEqual({})
    expect(applySourceUpdate(null, mkCreneau(), { fields: ['titre'] })).toEqual({})
  })
})

describe('computeDiffForPropagation + countChangedFields', () => {
  it('marque changed=true sur les champs qui diffèrent', () => {
    const source = mkCreneau({ titre: 'NEW', lieu_text: 'B' })
    const child = mkCreneau({ titre: 'OLD', lieu_text: 'B' }) // lieu identique
    const diff = computeDiffForPropagation(source, child, {
      fields: ['titre', 'lieu_text'],
    })
    expect(diff.titre.changed).toBe(true)
    expect(diff.titre.from).toBe('OLD')
    expect(diff.titre.to).toBe('NEW')
    expect(diff.lieu_text.changed).toBe(false)
    expect(countChangedFields(diff)).toBe(1)
  })

  it('gère cadreurs et duree_min', () => {
    const source = mkCreneau({
      member_ids: ['a', 'b'],
      heure_debut_min: 0,
      heure_fin_min: 90,
    })
    const child = mkCreneau({
      member_ids: ['c'],
      heure_debut_min: 600,
      heure_fin_min: 660,
    })
    const diff = computeDiffForPropagation(source, child, {
      fields: ['cadreurs', 'duree_min'],
    })
    expect(diff.cadreurs.changed).toBe(true)
    expect(diff.cadreurs.from).toEqual(['c'])
    expect(diff.cadreurs.to).toEqual(['a', 'b'])
    expect(diff.duree_min.from).toBe(60)
    expect(diff.duree_min.to).toBe(90)
    expect(diff.duree_min.changed).toBe(true)
  })
})

describe('validateLinkTarget', () => {
  it('refuse l\'auto-référence', () => {
    const c = mkCreneau({ id: 'x' })
    expect(validateLinkTarget(c, c, [])).toMatch(/lui-même/)
  })

  it('refuse cycle direct (source pointe déjà sur child)', () => {
    const child = mkCreneau({ id: 'a' })
    const source = mkCreneau({ id: 'b', source_creneau_id: 'a' })
    expect(validateLinkTarget(child, source, [])).toMatch(/cycle/i)
  })

  it("refuse une source qui est elle-même un enfant", () => {
    const child = mkCreneau({ id: 'a' })
    const source = mkCreneau({ id: 'b', source_creneau_id: 'c' })
    const err = validateLinkTarget(child, source, [])
    expect(err).toMatch(/déjà l'enfant/)
  })

  it("refuse un child qui est déjà source", () => {
    const child = mkCreneau({ id: 'a' })
    const source = mkCreneau({ id: 'b' })
    const creneaux = [child, source, mkCreneau({ id: 'c', source_creneau_id: 'a' })]
    const err = validateLinkTarget(child, source, creneaux)
    expect(err).toMatch(/déjà source/)
  })

  it('accepte un lien valide', () => {
    const child = mkCreneau({ id: 'a' })
    const source = mkCreneau({ id: 'b' })
    expect(validateLinkTarget(child, source, [child, source])).toBeNull()
  })
})

describe('ANCHOR_FIELDS', () => {
  it("n'inclut pas heure_debut_min / heure_fin_min (sync horaire = absurde)", () => {
    expect(ANCHOR_FIELDS).not.toContain('heure_debut_min')
    expect(ANCHOR_FIELDS).not.toContain('heure_fin_min')
  })

  it('inclut duree_min comme proxy pour la durée', () => {
    expect(ANCHOR_FIELDS).toContain('duree_min')
  })
})
