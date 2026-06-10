/**
 * Tests unitaires — MAT-18 : computeRecapByLoueur + groupe "Non assigné"
 * Vitest 2 (pas de setup, pas de mock — que du pur in-memory).
 */
import { describe, it, expect } from 'vitest'
import {
  computeRecapByLoueur,
  isUnassignedRecap,
  UNASSIGNED_LOUEUR_ID,
} from './materiel.js'

const loueurs = [
  { id: 'A', nom: 'Loueur A', couleur: '#ff0000' },
  { id: 'B', nom: 'Loueur B', couleur: '#00ff00' },
]

describe('MAT-18 — computeRecapByLoueur + Non assigné', () => {
  it('place le groupe unassigned en fin de liste quand des items sont sans loueur', () => {
    const items = [
      { id: 'i1', designation: 'FX6', quantite: 1, label: null, materiel_bdd_id: 'bdd-fx6' },
      { id: 'i2', designation: '24-70', quantite: 1, label: 'principal', materiel_bdd_id: 'bdd-24' },
      { id: 'i3', designation: 'Tripod', quantite: 2, label: null, materiel_bdd_id: null },
      { id: 'i4', designation: 'Tripod', quantite: 1, label: null, materiel_bdd_id: null },
    ]
    const itemLoueurs = [
      { item_id: 'i1', loueur_id: 'A' },
      { item_id: 'i2', loueur_id: 'B' },
    ]
    const recap = computeRecapByLoueur({ items, itemLoueurs, loueurs })
    expect(recap).toHaveLength(3)
    expect(recap[0].loueur.id).toBe('A')
    expect(recap[1].loueur.id).toBe('B')
    expect(recap[2].loueur.id).toBe(UNASSIGNED_LOUEUR_ID)
    expect(isUnassignedRecap(recap[2])).toBe(true)
    expect(isUnassignedRecap(recap[0])).toBe(false)
    // Tripod x2 + x1 → agrégés dans le groupe unassigned
    expect(recap[2].lignes).toHaveLength(1)
    expect(recap[2].lignes[0].qte).toBe(3)
  })

  it("n'émet pas de groupe unassigned si tous les items ont un loueur", () => {
    const recap = computeRecapByLoueur({
      items: [{ id: 'x', designation: 'X', quantite: 1, label: null }],
      itemLoueurs: [{ item_id: 'x', loueur_id: 'A' }],
      loueurs,
    })
    expect(recap).toHaveLength(1)
    expect(isUnassignedRecap(recap[0])).toBe(false)
  })

  it('émet uniquement le groupe unassigned si aucun item n\'a de loueur', () => {
    const recap = computeRecapByLoueur({
      items: [{ id: 'x', designation: 'X', quantite: 1, label: null }],
      itemLoueurs: [],
      loueurs,
    })
    expect(recap).toHaveLength(1)
    expect(isUnassignedRecap(recap[0])).toBe(true)
    expect(recap[0].loueur.nom).toBe('Non assigné')
  })

  it('ne casse pas avec items/itemLoueurs/loueurs vides', () => {
    expect(computeRecapByLoueur({})).toEqual([])
    expect(computeRecapByLoueur({ items: [], itemLoueurs: [], loueurs: [] })).toEqual([])
  })

  it("garde les items 'orphelins' (loueur_id inexistant) dans leur pivot — pas unassigned", () => {
    // L'item a un pivot, mais le loueur est introuvable → on le drop
    // (choix historique). Il ne doit PAS basculer dans unassigned car
    // l'attribution existe en base.
    const recap = computeRecapByLoueur({
      items: [{ id: 'x', designation: 'X', quantite: 1, label: null }],
      itemLoueurs: [{ item_id: 'x', loueur_id: 'GHOST' }],
      loueurs,
    })
    // Ni loueur GHOST, ni unassigné → liste vide.
    expect(recap).toHaveLength(0)
  })
})
