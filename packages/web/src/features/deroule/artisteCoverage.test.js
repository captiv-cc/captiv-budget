import { describe, it, expect } from 'vitest'
import { buildUncoveredArtisteSet } from './artisteCoverage'

const LANES = [
  { id: 'scene', type: 'lieu', libelle: 'Chateau' },
  { id: 'hm', type: 'personne', membre_id: 'm1', libelle: 'HM' },
]

const base = { heure_debut_min: 1200, heure_fin_min: 1260 }

describe('buildUncoveredArtisteSet', () => {
  it('signale un artiste sans aucun cadreur', () => {
    const creneaux = [{ id: 'c1', lane_id: 'scene', artiste_id: 'a1', ...base }]
    expect([...buildUncoveredArtisteSet({ lanes: LANES, creneaux })]).toEqual(['c1'])
  })

  it('ne signale pas un artiste avec des cadreurs assignés', () => {
    const creneaux = [
      { id: 'c1', lane_id: 'scene', artiste_id: 'a1', member_ids: ['m1'], ...base },
    ]
    expect(buildUncoveredArtisteSet({ lanes: LANES, creneaux }).size).toBe(0)
  })

  it('ne signale pas un artiste couvert par une mission liée', () => {
    const creneaux = [
      { id: 'c1', lane_id: 'scene', artiste_id: 'a1', ...base },
      { id: 'm', lane_id: 'hm', source_creneau_id: 'c1', ...base },
    ]
    expect(buildUncoveredArtisteSet({ lanes: LANES, creneaux }).size).toBe(0)
  })

  it('ne signale pas un artiste couvert par une mission du même artiste au même moment', () => {
    const creneaux = [
      { id: 'c1', lane_id: 'scene', artiste_id: 'a1', ...base },
      { id: 'm', lane_id: 'hm', artiste_id: 'a1', heure_debut_min: 1210, heure_fin_min: 1240 },
    ]
    expect(buildUncoveredArtisteSet({ lanes: LANES, creneaux }).size).toBe(0)
  })

  it('signale quand la mission du même artiste ne chevauche pas', () => {
    const creneaux = [
      { id: 'c1', lane_id: 'scene', artiste_id: 'a1', ...base },
      { id: 'm', lane_id: 'hm', artiste_id: 'a1', heure_debut_min: 600, heure_fin_min: 660 },
    ]
    expect([...buildUncoveredArtisteSet({ lanes: LANES, creneaux })]).toEqual(['c1'])
  })

  it('ignore les créneaux sans artiste, les indispos et les annulés', () => {
    const creneaux = [
      { id: 'sans', lane_id: 'scene', ...base },
      { id: 'indispo', lane_id: 'scene', artiste_id: 'a1', type: 'indispo', ...base },
      { id: 'annule', lane_id: 'scene', artiste_id: 'a2', statut: 'annule', ...base },
    ]
    expect(buildUncoveredArtisteSet({ lanes: LANES, creneaux }).size).toBe(0)
  })

  it('ne marque jamais une mission de colonne cadreur', () => {
    const creneaux = [{ id: 'm', lane_id: 'hm', artiste_id: 'a1', ...base }]
    expect(buildUncoveredArtisteSet({ lanes: LANES, creneaux }).size).toBe(0)
  })

  it('reconnaît une mission multi-colonnes couvrant une lane cadreur', () => {
    const creneaux = [
      { id: 'c1', lane_id: 'scene', artiste_id: 'a1', ...base },
      { id: 'm', lane_id: 'scene', lane_ids: ['scene', 'hm'], source_creneau_id: 'c1', ...base },
    ]
    expect(buildUncoveredArtisteSet({ lanes: LANES, creneaux }).size).toBe(0)
  })
})
