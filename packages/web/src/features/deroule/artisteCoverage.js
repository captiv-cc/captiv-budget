// ════════════════════════════════════════════════════════════════════════════
// artisteCoverage — quels artistes n'ont personne pour les filmer
// ════════════════════════════════════════════════════════════════════════════
//
// Sur un festival, la timeline compte vite 40 créneaux artistes répartis sur
// 6 scènes. Repérer à l'œil ceux que personne ne couvre est fastidieux, alors
// que c'est LA question de la préparation de journée.
//
// Un artiste peut être couvert de trois façons, toutes équivalentes ici :
//   1. des cadreurs assignés directement au créneau (member_ids) ;
//   2. une mission dans une colonne cadreur liée au créneau
//      (source_creneau_id — le lien 🔗 posé depuis l'inspecteur) ;
//   3. une mission dans une colonne cadreur portant le MÊME artiste et
//      chevauchant l'horaire (créée à la main, sans lien).
//
// Tout est une aide à la lecture, pas une règle : beaucoup d'artistes n'ont
// volontairement aucun cadreur. Le rendu doit donc rester discret.
// ════════════════════════════════════════════════════════════════════════════

function overlaps(a, b) {
  const aStart = a.heure_debut_min ?? 0
  const aEnd = a.heure_fin_min ?? aStart
  const bStart = b.heure_debut_min ?? 0
  const bEnd = b.heure_fin_min ?? bStart
  return aStart < bEnd && bStart < aEnd
}

/**
 * Ids des créneaux artiste que personne ne couvre.
 *
 * @param {{ lanes: Array, creneaux: Array }} args
 * @returns {Set<string>}
 */
export function buildUncoveredArtisteSet({ lanes = [], creneaux = [] }) {
  const personLaneIds = new Set(
    (lanes || []).filter((l) => l.type === 'personne').map((l) => l.id),
  )
  const isOnPersonLane = (c) =>
    personLaneIds.has(c.lane_id) ||
    (Array.isArray(c.lane_ids) && c.lane_ids.some((id) => personLaneIds.has(id)))

  const missions = (creneaux || []).filter(isOnPersonLane)
  const coveredBySource = new Set(
    missions.map((m) => m.source_creneau_id).filter(Boolean),
  )

  const out = new Set()
  for (const c of creneaux || []) {
    // Seuls les créneaux d'artiste sont concernés, et jamais depuis une
    // colonne cadreur (une mission n'a pas à être « couverte »).
    if (!c.artiste_id || isOnPersonLane(c)) continue
    if (c.type === 'indispo' || c.statut === 'annule') continue
    if (Array.isArray(c.member_ids) && c.member_ids.length > 0) continue
    if (coveredBySource.has(c.id)) continue
    const sameArtiste = missions.some(
      (m) => m.artiste_id && m.artiste_id === c.artiste_id && overlaps(m, c),
    )
    if (sameArtiste) continue
    out.add(c.id)
  }
  return out
}
