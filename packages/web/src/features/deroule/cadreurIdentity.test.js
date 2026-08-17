import { describe, it, expect } from 'vitest'
import {
  buildCadreurGroups,
  findCadreurGroup,
  resolveCadreurGroup,
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
    expect(groups).toEqual([
      { key: 'lane:x', id: 'x', ids: ['x'], laneIds: ['laneX'], nom: 'Inconnu' },
    ])
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

describe('resolveCadreurGroup', () => {
  // Le cas réel : l'identité mémorisée sur la logistique désigne la row
  // principale de la techlist ('p'), que le déroulé ne connaît pas — ni lane,
  // ni assignation. Sans résolution par personne, on retombait sur le premier
  // cadreur de la liste et on affichait SON planning.
  const MEMBRES_AVEC_PRINCIPALE = [
    ...MEMBRES,
    { id: 'p', contact_id: 'c1', prenom: 'Hugo', nom: 'Martin' },
  ]

  it('retrouve la personne depuis une row inconnue du déroulé', () => {
    const groups = buildCadreurGroups({
      lanes: LANES,
      creneaux: CRENEAUX,
      membres: MEMBRES_AVEC_PRINCIPALE,
    })
    const g = resolveCadreurGroup({
      groups,
      membreId: 'p',
      membres: MEMBRES_AVEC_PRINCIPALE,
    })
    expect(g.nom).toBe('Hugo Martin')
    expect(creneauxForCadreurGroup(CRENEAUX, g).map((c) => c.id).sort()).toEqual([
      'c1',
      'c2',
      'c4',
    ])
  })

  it('ne se rabat JAMAIS sur un autre cadreur', () => {
    const groups = buildCadreurGroups({ lanes: LANES, creneaux: CRENEAUX, membres: MEMBRES })
    expect(
      resolveCadreurGroup({ groups, membreId: 'inconnu', membres: MEMBRES }),
    ).toBeNull()
  })

  it('renvoie null sans id demandé', () => {
    const groups = buildCadreurGroups({ lanes: LANES, creneaux: CRENEAUX, membres: MEMBRES })
    expect(resolveCadreurGroup({ groups, membreId: null, membres: MEMBRES })).toBeNull()
  })
})
