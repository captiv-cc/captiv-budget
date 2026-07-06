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

describe('Récap loueur — ordre de la liste, blocs, totaux (2026-07-06)', () => {
  const blocks = [
    { id: 'b-cam-a', titre: 'FILM // CAM A', couleur: '#4d9fff', sort_order: 0 },
    { id: 'b-cam-b', titre: 'FILM // CAM B', couleur: '#00c875', sort_order: 1 },
  ]
  // Liste volontairement "désordonnée alphabétiquement" : la caméra AVANT
  // ses batteries, comme dans la vraie liste.
  const items = [
    { id: 'i1', block_id: 'b-cam-a', sort_order: 0, designation: 'Sony Venice 2', quantite: 1, label: 'Corps caméra', materiel_bdd_id: 'bdd-venice' },
    { id: 'i2', block_id: 'b-cam-a', sort_order: 1, designation: 'V-Lock Bebob Micro 150', quantite: 4, label: 'Batteries', materiel_bdd_id: 'bdd-vlock' },
    { id: 'i3', block_id: 'b-cam-b', sort_order: 0, designation: 'Sony FX3', quantite: 1, label: 'Corps caméra', materiel_bdd_id: 'bdd-fx3' },
    { id: 'i4', block_id: 'b-cam-b', sort_order: 1, designation: 'V-Lock Bebob Micro 150', quantite: 2, label: 'Batteries', materiel_bdd_id: 'bdd-vlock' },
  ]
  const itemLoueurs = [
    { item_id: 'i1', loueur_id: 'A' },
    { item_id: 'i2', loueur_id: 'A' },
    { item_id: 'i3', loueur_id: 'A' },
    { item_id: 'i4', loueur_id: 'A' },
  ]

  it('groupe par bloc dans l’ordre de la liste, lignes dans l’ordre du bloc', () => {
    const recap = computeRecapByLoueur({ items, itemLoueurs, loueurs, blocks })
    expect(recap).toHaveLength(1)
    const g = recap[0]
    expect(g.blocs.map((b) => b.titre)).toEqual(['FILM // CAM A', 'FILM // CAM B'])
    // La caméra reste AVANT ses batteries (plus de tri alphabétique).
    expect(g.blocs[0].lignes.map((l) => l.designation)).toEqual([
      'Sony Venice 2',
      'V-Lock Bebob Micro 150',
    ])
    expect(g.blocs[0].couleur).toBe('#4d9fff')
  })

  it('ne fusionne PLUS entre blocs, mais les totaux le font', () => {
    const recap = computeRecapByLoueur({ items, itemLoueurs, loueurs, blocks })
    const g = recap[0]
    // Détail : les V-Lock apparaissent dans chaque bloc (×4 puis ×2).
    const vlocks = g.lignes.filter((l) => l.materielBddId === 'bdd-vlock')
    expect(vlocks.map((l) => l.qte)).toEqual([4, 2])
    // Totaux : une seule référence V-Lock à ×6.
    const tot = g.totaux.find((t) => t.materielBddId === 'bdd-vlock')
    expect(tot.qte).toBe(6)
    expect(g.totaux).toHaveLength(3)
  })

  it('lignes (compat) = blocs aplatis dans l’ordre', () => {
    const recap = computeRecapByLoueur({ items, itemLoueurs, loueurs, blocks })
    expect(recap[0].lignes.map((l) => l.designation)).toEqual([
      'Sony Venice 2',
      'V-Lock Bebob Micro 150',
      'Sony FX3',
      'V-Lock Bebob Micro 150',
    ])
  })

  it('fusionne toujours DANS un bloc (même référence + même label)', () => {
    const recap = computeRecapByLoueur({
      items: [
        { id: 'x1', block_id: 'b-cam-a', sort_order: 0, designation: 'Carte SD', quantite: 4, label: null, materiel_bdd_id: 'bdd-sd' },
        { id: 'x2', block_id: 'b-cam-a', sort_order: 5, designation: 'Carte SD', quantite: 4, label: null, materiel_bdd_id: 'bdd-sd' },
      ],
      itemLoueurs: [
        { item_id: 'x1', loueur_id: 'A' },
        { item_id: 'x2', loueur_id: 'A' },
      ],
      loueurs,
      blocks,
    })
    expect(recap[0].blocs[0].lignes).toHaveLength(1)
    expect(recap[0].blocs[0].lignes[0].qte).toBe(8)
  })

  it('sans blocks fournis : un pseudo-bloc sans titre, ordre des items conservé', () => {
    const recap = computeRecapByLoueur({
      items: [
        { id: 'y1', designation: 'Zebra', quantite: 1, label: null },
        { id: 'y2', designation: 'Alpha', quantite: 1, label: null },
      ],
      itemLoueurs: [
        { item_id: 'y1', loueur_id: 'A' },
        { item_id: 'y2', loueur_id: 'A' },
      ],
      loueurs,
    })
    expect(recap[0].blocs).toHaveLength(1)
    expect(recap[0].blocs[0].titre).toBeNull()
    // Zebra reste avant Alpha : ordre de saisie, pas alphabétique.
    expect(recap[0].lignes.map((l) => l.designation)).toEqual(['Zebra', 'Alpha'])
  })
})
