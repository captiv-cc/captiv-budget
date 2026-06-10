// ════════════════════════════════════════════════════════════════════════════
// derouleExport — Helpers communs export PNG/PDF (FEST-6.A)
// ════════════════════════════════════════════════════════════════════════════
//
// Module de helpers partagés entre l'export PNG (Canvas API) et l'export PDF
// (jsPDF). Responsable de :
//   - Calcul des dimensions de la grille horaire (px par heure, total height)
//   - Filtrage des lanes selon le type d'export (PNG cadreur = scènes + global
//     + cadreur cible ; PDF = toutes)
//   - Normalisation des couleurs des créneaux et des labels
//   - Helpers de formattage de date et de durée
//
// Les modules exportPNG.js et exportPDF.js consomment ces helpers et ajoutent
// la logique de rendu spécifique à leur target (canvas vs PDF).
// ════════════════════════════════════════════════════════════════════════════

import {
  effectiveCouleurCreneau,
  formatMinHHMM,
  CRENEAU_TYPES,
  hasAlerte,
  ALERTE_COLORS,
} from '../../../lib/deroule'

/**
 * Sélectionne les lanes pertinentes pour un export PNG cadreur :
 *   - toutes les lanes type='global'
 *   - toutes les lanes type='lieu' (scènes)
 *   - UNIQUEMENT la lane du cadreur sélectionné (type='personne' + matching id)
 *   - exclut les lanes type='equipe' et les autres cadreurs
 *
 * @param {Array} lanes
 * @param {string|null} membreId - id du membre (cadreur) à inclure
 * @returns {Array} lanes filtrées, dans l'ordre sort_order
 */
export function filterLanesForCadreurExport(lanes, membreId) {
  if (!Array.isArray(lanes)) return []
  return [...lanes]
    .filter((l) => {
      if (l.type === 'global') return true
      if (l.type === 'lieu') return true
      if (l.type === 'personne' && l.membre_id === membreId) return true
      return false
    })
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
}

/**
 * Tri canonique des lanes pour l'export PDF (toutes incluses).
 */
export function sortLanesForExport(lanes) {
  if (!Array.isArray(lanes)) return []
  return [...lanes].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
}

/**
 * Trouve les bornes horaires effectives du déroulé en regardant les créneaux.
 * On élargit légèrement (1h avant le 1er, 1h après le dernier) pour aération
 * visuelle.
 *
 * @returns {{ minStart: number, maxEnd: number }} en minutes depuis 00:00
 */
export function computeTimeBounds(deroule, creneaux) {
  const fallbackStart = deroule?.heure_debut_min ?? 0
  const fallbackEnd = deroule?.heure_fin_min ?? 1439

  if (!Array.isArray(creneaux) || creneaux.length === 0) {
    return { minStart: fallbackStart, maxEnd: fallbackEnd }
  }

  let minStart = Infinity
  let maxEnd = -Infinity
  for (const c of creneaux) {
    if (typeof c.heure_debut_min === 'number' && c.heure_debut_min < minStart) {
      minStart = c.heure_debut_min
    }
    if (typeof c.heure_fin_min === 'number' && c.heure_fin_min > maxEnd) {
      maxEnd = c.heure_fin_min
    }
  }
  // Snap aux 30min inférieures/supérieures + buffer 30min de part et d'autre
  // pour aération.
  const snapDown = (m) => Math.floor(m / 30) * 30
  const snapUp = (m) => Math.ceil(m / 30) * 30
  minStart = Math.max(0, snapDown(minStart) - 30)
  maxEnd = Math.min(1680, snapUp(maxEnd) + 30)

  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || minStart >= maxEnd) {
    return { minStart: fallbackStart, maxEnd: fallbackEnd }
  }

  return { minStart, maxEnd }
}

/**
 * Filtre les créneaux qui appartiennent à une lane donnée.
 * Inclut les créneaux multi_lane (qui couvrent toutes les lanes) si la lane
 * est passée (sauf si excludeMultiLane=true).
 */
export function getCreneauxForLane(creneaux, laneId, excludeMultiLane = false) {
  if (!Array.isArray(creneaux)) return []
  return creneaux
    .filter((c) => {
      if (c.multi_lane && !excludeMultiLane) return true
      return c.lane_id === laneId
    })
    .sort((a, b) => (a.heure_debut_min || 0) - (b.heure_debut_min || 0))
}

/**
 * Détecte les créneaux multi-lane (transverses).
 */
export function getMultiLaneCreneaux(creneaux) {
  if (!Array.isArray(creneaux)) return []
  return creneaux
    .filter((c) => c.multi_lane === true)
    .sort((a, b) => (a.heure_debut_min || 0) - (b.heure_debut_min || 0))
}

/**
 * Couleur effective d'un créneau pour le rendu.
 *
 * `projectTypes` (optionnel) : liste des types custom du projet
 * (issue de getProjectCreneauTypes ou project.creneau_types). Si fourni,
 * les types custom rendent avec leur couleur définie ; sinon ils tombent
 * sur le gris fallback CRENEAU_TYPE_COLORS.autre.
 */
export function getCreneauColor(creneau, projectTypes = null) {
  return effectiveCouleurCreneau(creneau, projectTypes)
}

/**
 * Couleur d'alerte (info bleu / important orange) ou null si pas d'alerte.
 */
export function getCreneauAlertColor(creneau) {
  if (!hasAlerte(creneau)) return null
  return ALERTE_COLORS[creneau.alerte_niveau] || ALERTE_COLORS.important
}

/**
 * Format horaire compact pour les labels d'export.
 *   formatHoraireLabel(1010, 1080) → "16:50 – 18:00"
 *   formatHoraireLabel(1010, 1080, { vertical: true }) → "16:50\n18:00"
 */
export function formatHoraireLabel(debutMin, finMin, opts = {}) {
  const d = formatMinHHMM(debutMin)
  const f = formatMinHHMM(finMin)
  if (opts.vertical) return `${d}\n${f}`
  return `${d} – ${f}`
}

/**
 * Format date : "2026-06-04" → "jeudi 4 juin 2026"
 */
export function formatHumanDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(`${iso}T12:00:00`)
    return d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

/**
 * Format date court : "2026-06-04" → "jeu. 4 juin"
 */
export function formatShortDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(`${iso}T12:00:00`)
    return d.toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
  } catch {
    return iso
  }
}

/**
 * Génère les graduations horaires (chaque heure pleine entre min et max).
 * Renvoie un tableau de { minutes, label }.
 */
export function buildHourGraduations(minStart, maxEnd) {
  const out = []
  const start = Math.ceil(minStart / 60) * 60
  for (let m = start; m <= maxEnd; m += 60) {
    out.push({ minutes: m, label: formatMinHHMM(m) })
  }
  return out
}

/**
 * Label métier d'un type de créneau (FR). Sprint types V2 : aligné sur
 * CRENEAU_TYPE_LABELS de lib/deroule.js. Inclut les types core uniquement
 * (les exports peuvent compléter avec project.creneau_types pour les
 * libellés custom).
 */
export const TYPE_LABELS = {
  install: 'Installation',
  brief: 'Briefing',
  tournage: 'Tournage',
  captation: 'Captation live',
  show: 'Show',
  interview: 'Interview',
  drone: 'Drone',
  ambiance: 'Ambiance',
  repas: 'Repas',
  pause: 'Pause',
  transport: 'Transport',
  postprod: 'Post-prod',
  autre: 'Autre',
  indispo: 'Indispo',
}

/**
 * Libellé court d'une lane :
 *  - type='lieu' : on strip "Scène " du libelle (icône suffit)
 *  - type='personne' : nom complet du cadreur
 *  - autres : libelle tel quel
 */
export function getLaneShortLabel(lane, membres = []) {
  if (!lane) return ''
  if (lane.type === 'personne' && lane.membre_id) {
    const m = membres.find((mb) => mb.id === lane.membre_id)
    if (m) {
      const prenom = m.contact?.prenom || m.prenom || ''
      const nom = m.contact?.nom || m.nom || ''
      const full = `${prenom} ${nom}`.trim()
      if (full) return full
    }
    return lane.libelle || 'Cadreur'
  }
  if (lane.type === 'lieu') {
    const lib = lane.libelle || ''
    const m = lib.match(/^(?:Scène|Scene|SCÈNE|SCENE)\s+(.+)$/)
    if (m && m[1]) return m[1]
    return lib
  }
  return lane.libelle || ''
}

/**
 * Nom complet d'un cadreur depuis son membre_id.
 */
export function getMembreFullName(membreId, membres = []) {
  const m = (membres || []).find((mb) => mb.id === membreId)
  if (!m) return '?'
  const prenom = m.contact?.prenom || m.prenom || ''
  const nom = m.contact?.nom || m.nom || ''
  return `${prenom} ${nom}`.trim() || '?'
}

/**
 * Sanitise un nom pour utilisation dans un nom de fichier.
 */
export function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'export'
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents
    .replace(/[^\w\d\-_. ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60)
}

// Re-exports utiles pour les modules exportPNG / exportPDF
export { CRENEAU_TYPES, hasAlerte }
