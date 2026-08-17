// ════════════════════════════════════════════════════════════════════════════
// cadreurIdentity — une personne, plusieurs rows projet_membres
// ════════════════════════════════════════════════════════════════════════════
//
// Une personne qui cumule deux postes (cadreur + chef op, par exemple) a
// PLUSIEURS rows projet_membres : une principale et des rows rattachées
// (parent_membre_id). Toutes portent le même nom.
//
// Le déroulé, lui, indexait tout sur un id de row :
//   - la lane perso pointe sur UNE row,
//   - les assignations member_ids peuvent viser UNE AUTRE row,
//   - l'identité mémorisée sur la logistique désigne la row principale.
// Résultat : deux « Hugo Martin » dans le sélecteur, dont un à 0 mission,
// et un planning cadreur incomplet selon la row choisie.
//
// On regroupe donc les rows par PERSONNE (personaKey : contact_id, sinon
// prénom+nom) et on résout lanes et missions sur l'ensemble du groupe.
// ════════════════════════════════════════════════════════════════════════════

import { personaKey } from '../../lib/crew'

function displayName(m) {
  const prenom = m?.contact?.prenom || m?.prenom || ''
  const nom = m?.contact?.nom || m?.nom || ''
  return `${prenom} ${nom}`.trim()
}

/**
 * Groupes de cadreurs d'une journée : lanes perso + personnes assignées à
 * au moins un créneau, fusionnés par personne.
 *
 * @returns {Array<{ id, ids: string[], laneIds: string[], nom }>} `id` est
 *   le représentant du groupe (la row qui porte la lane perso en priorité,
 *   sinon la première rencontrée) ; `ids` liste toutes ses rows.
 */
export function buildCadreurGroups({ lanes = [], creneaux = [], membres = [] }) {
  const membreById = new Map((membres || []).map((m) => [m.id, m]))
  const personLanes = (lanes || []).filter((l) => l.type === 'personne' && l.membre_id)
  const laneByMembre = new Map(personLanes.map((l) => [l.membre_id, l]))

  // Ids candidats : lanes perso + assignations.
  const ids = new Set()
  for (const l of personLanes) ids.add(l.membre_id)
  for (const c of creneaux || []) {
    for (const id of Array.isArray(c.member_ids) ? c.member_ids : []) ids.add(id)
  }

  const groups = new Map()
  for (const id of ids) {
    const membre = membreById.get(id) || null
    const lane = laneByMembre.get(id) || null
    // Un membre absent du payload n'est identifiable que par sa lane : on lui
    // laisse alors sa propre clé (aucune fusion hasardeuse sur un libellé).
    const nom = membre ? displayName(membre) : lane?.libelle || ''
    const key = membre ? personaKey(membre) : `lane:${id}`

    const g = groups.get(key) || { key, id, ids: [], laneIds: [], nom: nom || '?' }
    if (!g.ids.includes(id)) g.ids.push(id)
    if (lane && !g.laneIds.includes(lane.id)) {
      g.laneIds.push(lane.id)
      // Le représentant est la row qui porte une lane : c'est celle que les
      // autres surfaces (export PNG, libellé de colonne) savent résoudre.
      g.id = id
    }
    if (!g.nom || g.nom === '?') g.nom = nom || g.nom
    groups.set(key, g)
  }

  return [...groups.values()].sort((a, b) =>
    a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }),
  )
}

/** Groupe contenant une row donnée (ou null). */
export function findCadreurGroup(groups, membreId) {
  if (!membreId) return null
  return groups.find((g) => g.ids.includes(membreId)) || null
}

/**
 * Résout un membre_id venu d'AILLEURS que du déroulé (identité mémorisée sur
 * la logistique, lien ?cadreur=…, deep-link mobile) vers le groupe de la
 * personne.
 *
 * L'id reçu désigne souvent la row principale de la techlist, alors que le
 * déroulé ne connaît que les rows portant une lane ou une assignation : la
 * recherche par id échoue donc, et retomber sur le premier cadreur de la
 * liste afficherait le planning de quelqu'un d'autre. On repasse donc par la
 * personne (personaKey) avant d'abandonner.
 *
 * @returns le groupe, ou null si la personne n'est pas au planning du jour.
 */
export function resolveCadreurGroup({ groups = [], membreId, membres = [] }) {
  if (!membreId) return null
  const direct = findCadreurGroup(groups, membreId)
  if (direct) return direct
  const membre = (membres || []).find((m) => m.id === membreId)
  if (!membre) return null
  const key = personaKey(membre)
  return groups.find((g) => g.key === key) || null
}

/**
 * Missions d'une personne : créneaux d'une de ses lanes perso (y compris
 * multi-colonnes) ou l'assignant via member_ids, sur n'importe laquelle de
 * ses rows.
 */
export function creneauxForCadreurGroup(creneaux = [], group) {
  if (!group) return []
  const ids = new Set(group.ids)
  const laneIds = new Set(group.laneIds)
  return (creneaux || []).filter((c) => {
    if (laneIds.has(c.lane_id)) return true
    if (Array.isArray(c.lane_ids) && c.lane_ids.some((id) => laneIds.has(id))) return true
    return Array.isArray(c.member_ids) && c.member_ids.some((id) => ids.has(id))
  })
}
