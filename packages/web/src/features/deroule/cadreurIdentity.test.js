import { describe, it, expect } from 'vitest'
import {
  buildCadreurGroups,
  findCadreurGroup,
  creneauxForCadreurGroup,
} from './cadreurIdentity'

// Hugo cumule deux postes : deux rows projet_membres pour le même contact.
// La lane perso pointe sur la row A, une assignation vise la row B.
const MEMBRES = [
  { id: 'a', contact_id: 'c1', prenom: 'Hugo', nom: 'Martin' },
  { id: 'b', contact_id: 'c1', parent_membre_id: 'a', prenom: 'Hugo', nom: 'Martin' },
  { id: 'z', contact_id: 'c2', prenom: 'Théo', nom: 'Landeau' },
]

const LANES = [
  { id: 'laneHM', type: 'personne', membre_id: 'a', libelle: 'HM' },
  { id: 'laneTL', type: 'personne', membre_id: 'z', libelle: 'TL' },
  { id: 'laneScene', type: 'lieu', libelle: 'Chateau' },
]

const CRENEAUX = [
  { id: 'c1', lane_id: 'laneHM', member_ids: [] },
  { id: 'c2', lane_id: 'laneScene', member_ids: ['b'] },
  { id: 'c3', lane_id: 'laneScene', member_ids: ['z'] },
  { id: 'c4', lane_id: 'laneScene', lane_ids: ['laneScene', 'laneHM'], member_ids: [] },
]

describe('buildCadreurGroups', () => {
  it('fusionne les rows d’une même personne en une seule entrée', () => {
    const groups = buildCadreurGroups({ lanes: LANES, creneaux: CRENEAUX, membres: MEMBRES })
    expect(groups).toHaveLength(2)
    const hugo = groups.find((g) => g.nom === 'Hugo Martin')
    expect(hugo.ids.sort()).toEqual(['a', 'b'])
  })

  it('choisit comme représentant la row qui porte la lane perso', () => {
    const groups = buildCadreurGroups({ lanes: LANES, creneaux: CRENEAUX, membres: MEMBRES })
    const hugo = groups.find((g) => g.nom === 'Hugo Martin')
    expect(hugo.id).toBe('a')
    expect(hugo.laneIds).toEqual(['laneHM'])
  })

  it('liste un membre absent du payload via le libellé de sa lane', () => {
    const groups = buildCadreurGroups({
      lanes: [{ id: 'laneX', type: 'personne', membre_id: 'x', libelle: 'Inconnu' }],
      creneaux: [],
      membres: [],
    })
    expect(groups).toEqual([{ id: 'x', ids: ['x'], laneIds: ['laneX'], nom: 'Inconnu' }])
  })
})

describe('creneauxForCadreurGroup', () => {
  it('agrège les créneaux de toutes les rows de la personne', () => {
    const groups = buildCadreurGroups({ lanes: LANES, creneaux: CRENEAUX, membres: MEMBRES })
    const hugo = findCadreurGroup(groups, 'b') // on le retrouve par n'importe quelle row
    const ids = creneauxForCadreurGroup(CRENEAUX, hugo).map((c) => c.id)
    // c1 : sa lane · c2 : assigné via la row B · c4 : multi-colonnes couvrant sa lane
    expect(ids.sort()).toEqual(['c1', 'c2', 'c4'])
  })

  it('ne mélange pas deux personnes distinctes', () => {
    const groups = buildCadreurGroups({ lanes: LANES, creneaux: CRENEAUX, membres: MEMBRES })
    const theo = findCadreurGroup(groups, 'z')
    expect(creneauxForCadreurGroup(CRENEAUX, theo).map((c) => c.id)).toEqual(['c3'])
  })

  it('renvoie une liste vide sans groupe', () => {
    expect(creneauxForCadreurGroup(CRENEAUX, null)).toEqual([])
  })
})
