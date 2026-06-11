// ════════════════════════════════════════════════════════════════════════════
//  DÉROULÉ JOUR — Data layer
//  ────────────────────────────
//  Cf. CHANTIER_DEROULE.md pour la roadmap complète et les décisions tranchées.
//
//  Modèle (Phase A V1) :
//    projet_deroules                   1 row par jour de tournage
//      └ projet_deroule_lanes          0..5 lanes par déroulé (lane 0 "Global")
//      └ projet_deroule_creneaux       N créneaux dans la timeline
//          └ projet_deroule_creneau_membres   N membres assignés
//
//  Convention horaires : on stocke en TIME ('HH:MM:SS') côté DB et on
//  travaille en MINUTES (entiers depuis 00:00) côté JS pour les calculs
//  d'overlap, snap, durée. Helpers timeToMinutes / minutesToTime ci-dessous.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// ─── Constantes ─────────────────────────────────────────────────────────────

/**
 * Types CORE de créneau (Sprint Festival types V2).
 *
 * Universels, couvrent tous les formats de projet : festival, live, pub,
 * doc, fiction. Chaque projet peut ajouter ses propres types personnalisés
 * stockés dans projects.creneau_types (JSONB).
 *
 * Migration data (20260608_creneau_types_v2.sql) :
 *   - 'prise' → 'tournage' (terme universel)
 *   - 'live'  → 'show' (le terme désignait un set d'artiste)
 *
 * Pour accéder à la liste effective (core + custom du projet courant),
 * utiliser getProjectCreneauTypes(project) dans lib/creneauTypes.js.
 */
export const CRENEAU_TYPES = [
  'install',
  'brief',
  'tournage',
  'captation',
  'show',
  'interview',
  'drone',
  'ambiance',
  'repas',
  'pause',
  'transport',
  'postprod',
  'autre',
  'indispo', // FEST-5.2 : sommeil/repos cadreur (lane type='personne')
]

/**
 * Labels FR pour l'UI (picker dans CreneauInspector, légende exports, etc.).
 */
export const CRENEAU_TYPE_LABELS = {
  install: 'Installation',
  brief: 'Briefing',
  tournage: 'Tournage',
  captation: 'Live',
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
 * Types qui représentent une INDISPONIBILITÉ du cadreur (la lane est
 * "bloquée" pendant ces créneaux : pas de drop d'autres créneaux, pas
 * de clic-create dans la zone, rendu visuel hachuré).
 */
export const CRENEAU_UNAVAILABLE_TYPES = new Set(['indispo'])

export function isCreneauUnavailable(creneau) {
  return Boolean(creneau && CRENEAU_UNAVAILABLE_TYPES.has(creneau.type))
}

/**
 * Couleur hex par défaut par type de créneau (utilisée si `creneau.couleur`
 * est NULL — ce qui est le cas par défaut).
 *
 * Palette V3 — Tailwind 300/400 désaturée (Hugo : "pas flashy, ça fait mal
 * aux yeux"). On regroupe les types par "famille" pour distribuer les hues
 * de manière lisible sans avoir deux types côte à côte qui se ressemblent
 * trop sur la timeline.
 *
 * COOL (technique / scène / cool topics) — du gris-bleu au violet :
 *   install   = slate     (setup technique, neutre froid)
 *   show      = blue pâle (scène — Hugo)
 *   interview = cyan pâle (échange)
 *   drone     = teal pâle (aérien)
 *   postprod  = indigo    (étape post, distinct du blue show et du brief)
 *   brief     = violet    (réflexion)
 *   ambiance  = purple    (atmosphère, B-roll — pas de vert)
 *
 * WARM (action / chaud) — du jaune au rose :
 *   tournage  = amber     (jaune pâle — Hugo)
 *   repas     = orange    (convivial)
 *   captation = red pâle  (live, distinct de transport par tonalité)
 *   transport = rose      (mouvement)
 *
 * NEUTRAL :
 *   pause     = gray clair (neutre repos)
 *   autre     = gray moyen (fallback)
 *   indispo   = gris hachuré
 *
 * Pour les types custom (projects.creneau_types), la couleur est portée
 * par le type lui-même. effectiveCouleurCreneau() fait le fallback.
 */
export const CRENEAU_TYPE_COLORS = {
  // Cool
  install: '#94A3B8',   // slate-400
  show: '#93C5FD',      // blue-300 (bleu pâle, Hugo)
  interview: '#67E8F9', // cyan-300
  drone: '#5EEAD4',     // teal-300
  postprod: '#A5B4FC',  // indigo-300
  brief: '#C4B5FD',     // violet-300
  ambiance: '#D8B4FE',  // purple-300
  // Warm
  tournage: '#FCD34D',  // amber-300 (jaune pâle, Hugo)
  repas: '#FDBA74',     // orange-300
  captation: '#FCA5A5', // red-300 (Live)
  transport: '#FDA4AF', // rose-300
  // Neutral
  pause: '#D1D5DB',     // gray-300
  autre: '#9CA3AF',     // gray-400
  indispo: '#888888',
}

/** Statuts opérationnels (synchronisé avec le CHECK SQL). */
export const CRENEAU_STATUTS = ['planifie', 'en_cours', 'fait', 'annule']

/**
 * Niveaux d'alerte / point d'attention sur créneaux (FEST-5.4).
 * Synchronisé avec le CHECK SQL sur projet_deroule_creneaux.alerte_niveau.
 *
 *   - info      : info utile, bleu, signale sans urgence
 *                 ex: "3 premiers titres seulement"
 *   - important : attention requise, orange, pointe une particularité
 *                 ex: "Show décalé !", "Pas d'autorisation côté scène"
 */
export const ALERTE_NIVEAUX = ['info', 'important']
export const ALERTE_COLORS = {
  info: '#3B82F6',
  important: '#F59E0B',
}
export const ALERTE_LABELS = {
  info: 'Info',
  important: 'Important',
}

/** Retourne true si le créneau a une alerte renseignée + son niveau. */
export function hasAlerte(creneau) {
  return Boolean(
    creneau &&
      typeof creneau.alerte_text === 'string' &&
      creneau.alerte_text.trim().length > 0 &&
      creneau.alerte_niveau,
  )
}

/**
 * Retourne l'alerte effective d'un créneau, avec héritage de la source.
 *
 * Logique :
 *   1. Si le créneau a sa propre alerte → priorité
 *   2. Sinon, si soft-link vers un parent (source_creneau_id) ET le parent
 *      a une alerte → héritage visuel (signal "ce que je filme a un point
 *      d'attention sur la scène source")
 *   3. Sinon → null
 *
 * Le retour inclut `inheritedFrom` (id du parent) pour permettre à l'UI
 * de signaler que l'alerte vient d'ailleurs si besoin.
 *
 * @param {object} creneau - le créneau à inspecter
 * @param {Map<string, object>|null|undefined} creneauxById - index par id
 *   pour la lookup du parent. Si absent ou si pas de soft link, on ne
 *   tente pas l'héritage.
 * @returns {{ text: string, niveau: 'info'|'important', inheritedFrom: string|null }|null}
 */
export function effectiveAlerte(creneau, creneauxById) {
  if (!creneau) return null
  if (hasAlerte(creneau)) {
    return {
      text: creneau.alerte_text,
      niveau: creneau.alerte_niveau || 'important',
      inheritedFrom: null,
    }
  }
  if (!creneau.source_creneau_id || !creneauxById) return null
  const parent =
    (typeof creneauxById.get === 'function'
      ? creneauxById.get(creneau.source_creneau_id)
      : creneauxById[creneau.source_creneau_id]) || null
  if (!parent || !hasAlerte(parent)) return null
  return {
    text: parent.alerte_text,
    niveau: parent.alerte_niveau || 'important',
    inheritedFrom: parent.id,
  }
}

/** Statuts du déroulé global (synchronisé avec le CHECK SQL). */
export const DEROULE_STATUTS = ['planifie', 'valide', 'verrouille']

/** Libellés default des lanes (sort_order 0 = "Global", 1-4 = "Équipe X"). */
export const DEFAULT_LANE_LIBELLES = {
  0: 'Global',
  1: 'Équipe A',
  2: 'Équipe B',
  3: 'Équipe C',
  4: 'Équipe D',
}

/**
 * Types de lanes (FEST-1, 2026-06-04).
 *
 * - `global`   : lane transverse (brief, repas, rendu) — neutre, gris
 * - `equipe`   : lane équipe parallèle générique — default historique
 * - `lieu`     : scène / salle / plateau (festival) — code couleur violet
 * - `personne` : cadreur nominatif (festival) — code couleur perso liée
 *                au membre via `membre_id`
 *
 * Cf. CHANTIER_DEROULE_FESTIVAL.md pour la sémantique complète. Migration
 * SQL : 20260604_deroule_festival_lane_types.sql.
 */
export const LANE_TYPES = ['global', 'equipe', 'lieu', 'personne']

/** Couleur par défaut par type de lane (hex sans #). Cf. conventions visuelles
 *  CHANTIER_DEROULE_FESTIVAL.md. */
export const LANE_TYPE_DEFAULT_COLORS = {
  global: '5F5E5A',   // gray-600
  equipe: '888780',   // gray-500 (neutre)
  lieu: '7F77DD',     // purple-400 (scènes)
  personne: '378ADD', // blue-400 (fallback si pas de couleur perso)
}

/** Icônes Tabler par type de lane (sans préfixe `ti-`). */
export const LANE_TYPE_ICONS = {
  global: 'clipboard',
  equipe: 'users',
  lieu: 'map-pin',
  personne: 'camera',
}

/** Palette pour l'auto-assignation de couleur cadreur. Pioche dans l'ordre
 *  pour les nouveaux cadreurs (couleur stable basée sur sort_order ou hash
 *  du membre_id). Hex sans #. */
export const CADREUR_COLOR_PALETTE = [
  '378ADD', // blue
  'D85A30', // coral
  '1D9E75', // teal
  'D4537E', // pink
  'BA7517', // amber
  '639922', // green
  '7F77DD', // purple (dernier choix car réservé aux lieux)
]

/**
 * Max lanes recommandé en mode live (cap historique). Pour le festival,
 * pas de cap dur — le scroll horizontal gère N lanes (testé jusqu'à ~15).
 * Cette constante reste exposée pour les vues simples qui veulent
 * encourager une UI compacte.
 */
export const MAX_LANES_LIVE = 5
/** @deprecated Utiliser MAX_LANES_LIVE. Conservé pour compat. */
export const MAX_LANES = MAX_LANES_LIVE

/**
 * Limite max V0.5 pour les heures (en minutes depuis 00:00 du jour J).
 * 1680 min = 28h = 04:00 du jour J+1. Permet les créneaux nuit (live qui
 * déborde sur le lendemain) jusqu'à 4h du matin max.
 */
export const MAX_MIN = 1680

/**
 * Formate des minutes en string HH:MM, avec mention "+1j" si > 24h.
 *   formatMinHHMM(540)  → "09:00"
 *   formatMinHHMM(1500) → "01:00 +1j"
 *   formatMinHHMM(1560) → "02:00 +1j"
 */
export function formatMinHHMM(min) {
  if (typeof min !== 'number' || isNaN(min) || min < 0) return '00:00'
  const overflow = min >= 1440
  const m = overflow ? min - 1440 : min
  const h = Math.floor(m / 60)
  const mm = Math.floor(m % 60)
  const base = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  return overflow ? `${base} +1j` : base
}

/**
 * Formate des minutes en string HH:MM SANS suffixe — utile pour les inputs
 * `<input type="time">` qui ne supportent que 00:00-23:59. Pour les heures
 * > 23:59, on prend modulo et le caller doit gérer le toggle "lendemain".
 */
export function formatMinTimeInput(min) {
  if (typeof min !== 'number' || isNaN(min) || min < 0) return '00:00'
  const m = min >= 1440 ? min - 1440 : min
  const h = Math.floor(m / 60)
  const mm = Math.floor(m % 60)
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// ─── Helpers temps ──────────────────────────────────────────────────────────

/**
 * Convertit "HH:MM" ou "HH:MM:SS" en nombre de minutes depuis 00:00.
 * Retourne NaN si format invalide.
 *
 * @param {string} time
 * @returns {number}
 *
 * timeToMinutes('09:30')     → 570
 * timeToMinutes('09:30:45')  → 570 (secondes ignorées)
 * timeToMinutes('25:00')     → 1500 (pas de borne — laissez le caller filtrer)
 * timeToMinutes('foo')       → NaN
 */
export function timeToMinutes(time) {
  if (!time || typeof time !== 'string') return NaN
  const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return NaN
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  if (isNaN(h) || isNaN(m) || m >= 60) return NaN
  return h * 60 + m
}

/**
 * Convertit un nombre de minutes en "HH:MM" (zero-padded).
 *
 * @param {number} minutes
 * @returns {string}
 *
 * minutesToTime(570)  → "09:30"
 * minutesToTime(0)    → "00:00"
 * minutesToTime(1500) → "25:00"
 */
export function minutesToTime(minutes) {
  if (typeof minutes !== 'number' || isNaN(minutes) || minutes < 0) {
    return '00:00'
  }
  const h = Math.floor(minutes / 60)
  const m = Math.floor(minutes % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Snap une valeur en minutes au pas le plus proche (5 ou 15 min typiquement).
 * Utilisé pendant le drag-drop : sans Alt, snap à 15min ; avec Alt, snap à 5.
 *
 * @param {number} minutes
 * @param {number} step   pas en minutes (5, 10, 15, 30…)
 * @returns {number}
 *
 * snapToStep(577, 15) → 570 (= 09:30, distance 7 — plus proche que 585 distance 8)
 * snapToStep(578, 15) → 585 (= 09:45, on bascule au-delà de la moitié du step)
 * snapToStep(572, 5)  → 570 (= 09:30)
 */
export function snapToStep(minutes, step) {
  if (!Number.isFinite(minutes) || !Number.isFinite(step) || step <= 0) {
    return minutes
  }
  return Math.round(minutes / step) * step
}

/**
 * Durée d'un créneau en minutes. Retourne 0 si invalide.
 * V0.5 : lit heure_debut_min / heure_fin_min (INTEGER) directement.
 */
export function creneauDureeMin(creneau) {
  const debut = creneau?.heure_debut_min
  const fin = creneau?.heure_fin_min
  if (typeof debut !== 'number' || typeof fin !== 'number' || fin <= debut) {
    return 0
  }
  return fin - debut
}

// ─── Helpers métier ─────────────────────────────────────────────────────────

/**
 * Détecte si deux créneaux se chevauchent dans le temps.
 *
 * Définition d'overlap : intersection d'intervalles ouverts
 *   [debutA, finA[ ∩ [debutB, finB[ ≠ ∅
 *
 * Donc deux créneaux qui se touchent (finA == debutB) ne sont PAS en overlap.
 *
 * @param {Object} a   { heure_debut, heure_fin }
 * @param {Object} b   { heure_debut, heure_fin }
 * @returns {boolean}
 */
export function creneauxOverlap(a, b) {
  const aDebut = a?.heure_debut_min
  const aFin = a?.heure_fin_min
  const bDebut = b?.heure_debut_min
  const bFin = b?.heure_fin_min
  if (
    typeof aDebut !== 'number' || typeof aFin !== 'number' ||
    typeof bDebut !== 'number' || typeof bFin !== 'number'
  ) {
    return false
  }
  return aDebut < bFin && bDebut < aFin
}

/**
 * Détecte les conflits d'assignation pour un membre donné : trouve tous
 * les créneaux où il est assigné qui se chevauchent.
 *
 * @param {string} membreId
 * @param {Array}  creneaux        liste flatten avec assignation expandée
 *                                 (chaque row a member_ids: string[])
 * @returns {Array} pairs [creneauA, creneauB] qui overlappent
 */
export function findMembreOverlaps(membreId, creneaux) {
  if (!membreId || !Array.isArray(creneaux)) return []
  const membreCreneaux = creneaux.filter((c) =>
    Array.isArray(c.member_ids) && c.member_ids.includes(membreId),
  )
  const conflicts = []
  for (let i = 0; i < membreCreneaux.length; i++) {
    for (let j = i + 1; j < membreCreneaux.length; j++) {
      if (creneauxOverlap(membreCreneaux[i], membreCreneaux[j])) {
        conflicts.push([membreCreneaux[i], membreCreneaux[j]])
      }
    }
  }
  return conflicts
}

/**
 * Enrichit les créneaux avec les membres IMPLICITES déduits de leur lane :
 * si un créneau est dans une lane type='personne' avec `lane.membre_id`,
 * alors ce membre est implicitement assigné au créneau (sans avoir besoin
 * d'être dans `member_ids` explicite).
 *
 * Sert au calcul de conflits cadreur (FEST-4) : un cadreur a 2 créneaux
 * qui chevauchent même si la 2e n'est qu'une "mission lane perso" sans
 * member_ids explicite.
 *
 * Retourne une COPIE des créneaux avec `member_ids` enrichi (set unique).
 * Les créneaux d'entrée ne sont pas mutés.
 *
 * @param {Array} creneaux
 * @param {Array} lanes
 * @returns {Array} créneaux avec member_ids étendus
 */
export function enrichCreneauxWithImplicitMembers(creneaux, lanes) {
  if (!Array.isArray(creneaux) || !Array.isArray(lanes)) {
    return Array.isArray(creneaux) ? [...creneaux] : []
  }
  // Index : lane_id → membre implicite si lane.type='personne'
  const implicitByLaneId = new Map()
  for (const l of lanes) {
    if (l?.type === 'personne' && l.membre_id) {
      implicitByLaneId.set(l.id, l.membre_id)
    }
  }
  return creneaux.map((c) => {
    const explicit = Array.isArray(c.member_ids) ? c.member_ids : []
    const implicit = c.lane_id ? implicitByLaneId.get(c.lane_id) : null
    if (implicit && !explicit.includes(implicit)) {
      return { ...c, member_ids: [...explicit, implicit] }
    }
    return c
  })
}

/**
 * Renvoie la couleur effective d'un créneau :
 *   1. `creneau.couleur` override si défini
 *   2. Sinon : couleur du type CORE (CRENEAU_TYPE_COLORS)
 *   3. Sinon : couleur du type CUSTOM du projet (param projectTypes)
 *   4. Sinon : fallback gris (couleur du type 'autre')
 *
 * @param {object} creneau
 * @param {Array<{key, couleur}>} [projectTypes] - liste de types custom
 *   du projet (depuis projects.creneau_types). Optionnel pour rétrocompat.
 */
export function effectiveCouleurCreneau(creneau, projectTypes = null) {
  if (creneau?.couleur && /^#?[0-9a-f]{3,8}$/i.test(creneau.couleur)) {
    return creneau.couleur.startsWith('#') ? creneau.couleur : `#${creneau.couleur}`
  }
  // Type CORE ?
  if (creneau?.type && CRENEAU_TYPE_COLORS[creneau.type]) {
    return CRENEAU_TYPE_COLORS[creneau.type]
  }
  // Type CUSTOM ? (cherche dans la liste passée)
  if (Array.isArray(projectTypes) && creneau?.type) {
    const custom = projectTypes.find((t) => t.key === creneau.type)
    if (custom?.couleur) {
      return custom.couleur.startsWith('#') ? custom.couleur : `#${custom.couleur}`
    }
  }
  return CRENEAU_TYPE_COLORS.autre
}

/**
 * Tri stable des créneaux : par heure_debut_min croissante, puis sort_order.
 */
export function sortCreneauxByTime(creneaux) {
  if (!Array.isArray(creneaux)) return []
  return [...creneaux].sort((a, b) => {
    const aMin = a.heure_debut_min ?? 0
    const bMin = b.heure_debut_min ?? 0
    if (aMin !== bMin) return aMin - bMin
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
}

/**
 * Détermine le label par défaut d'une lane à partir de son sort_order.
 *
 * Note : pour les lanes typées (lieu / personne), ce fallback est rarement
 * utilisé — le libellé est saisi explicitement à la création (nom de scène,
 * nom du cadreur). Conservé pour la compat avec les déroulés live legacy.
 */
export function defaultLaneLibelle(sortOrder) {
  return DEFAULT_LANE_LIBELLES[sortOrder] ?? `Lane ${sortOrder + 1}`
}

/**
 * Résout la couleur effective d'une lane (hex sans #, sans le caractère #).
 *
 * Priorité : couleur stockée sur la lane > couleur par défaut du type.
 * Si type='personne' et qu'aucune couleur stockée, utilise la palette
 * cadreur indexée par sort_order pour assurer la stabilité visuelle entre
 * les cadreurs d'un même déroulé.
 *
 * @param {object} lane — { type, couleur, sort_order }
 * @returns {string} hex sans #, ex: "378ADD"
 */
export function effectiveLaneColor(lane) {
  if (!lane) return LANE_TYPE_DEFAULT_COLORS.equipe
  const stored = (lane.couleur || '').replace('#', '').trim()
  if (stored) return stored
  if (lane.type === 'personne') {
    // FEST-5.5.2 : couleur DÉTERMINISTE pour ce cadreur, dérivée du
    // membre_id (uuid stable du membre projet). Cela garantit que le
    // même cadreur a la même teinte sur TOUS les déroulés du projet.
    // Avant : sort_order modulo palette → couleur changeait selon
    // l'ordre d'ajout dans chaque déroulé.
    if (lane.membre_id) {
      return colorFromIdString(lane.membre_id, CADREUR_COLOR_PALETTE)
    }
    // Fallback si pas de membre_id (lane personne sans membre lié, cas
    // rare) : ancien comportement basé sur sort_order.
    const i = Math.max(0, (lane.sort_order ?? 0) - 1) % CADREUR_COLOR_PALETTE.length
    return CADREUR_COLOR_PALETTE[i]
  }
  return LANE_TYPE_DEFAULT_COLORS[lane.type] || LANE_TYPE_DEFAULT_COLORS.equipe
}

/**
 * Hash déterministe d'une string vers un index de palette.
 * Même logique que colorFromUserId (useProjectPresence) → garantit la
 * cohérence visuelle entre la pastille avatar et la lane d'un cadreur.
 */
function colorFromIdString(id, palette) {
  if (!id || !palette?.length) return palette?.[0] || '888888'
  let h = 0
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return palette[Math.abs(h) % palette.length]
}

/**
 * Retourne le nom Tabler de l'icône à afficher pour une lane selon son type.
 * Sans préfixe `ti-` — à utiliser comme `<i class="ti ti-{result}">`.
 */
export function laneTypeIcon(type) {
  return LANE_TYPE_ICONS[type] || LANE_TYPE_ICONS.equipe
}

/**
 * Tri canonique des lanes pour le rendu visuel.
 * Ordre : global → equipe → lieu → personne, puis sort_order ASC.
 * Permet d'afficher d'abord les transverses, puis les équipes, puis les
 * scènes festival, puis les cadreurs nominatifs.
 */
const LANE_TYPE_ORDER = { global: 0, equipe: 1, lieu: 2, personne: 3 }
export function sortLanesForDisplay(lanes) {
  if (!Array.isArray(lanes)) return []
  return [...lanes].sort((a, b) => {
    const ta = LANE_TYPE_ORDER[a?.type] ?? 1
    const tb = LANE_TYPE_ORDER[b?.type] ?? 1
    if (ta !== tb) return ta - tb
    return (a?.sort_order ?? 0) - (b?.sort_order ?? 0)
  })
}

/**
 * Filtre les membres techlist présents un jour donné.
 * Un membre est "présent" si sa date est dans son `presence_days` array.
 *
 * @param {Array}  membres   liste projet_membres (forme TechList)
 * @param {string} dateJour  format ISO 'YYYY-MM-DD'
 * @returns {Array}
 */
export function membresPresentsJour(membres, dateJour) {
  if (!Array.isArray(membres) || !dateJour) return []
  return membres.filter((m) => {
    const days = Array.isArray(m?.presence_days) ? m.presence_days : []
    return days.includes(dateJour)
  })
}

/**
 * Construit la suggestion de créneaux "Présence" à partir de la techlist :
 * pour chaque membre présent ce jour avec arrival_time/departure_time
 * définis, propose un créneau lane Global de arrival → departure.
 *
 * @param {Array}  membres   techlist du projet
 * @param {string} dateJour  date du déroulé
 * @param {string} laneId    id de la lane Global (sort_order = 0)
 * @returns {Array} créneaux suggérés (à insérer après validation user)
 */
export function suggestPresenceCreneaux(membres, dateJour, laneId) {
  const presents = membresPresentsJour(membres, dateJour)
  return presents
    .filter((m) => m.arrival_time || m.departure_time)
    .map((m) => ({
      // V0.5 : heure_debut_min / heure_fin_min (INTEGER minutes since 00:00)
      heure_debut_min: m.arrival_time ? timeToMinutes(m.arrival_time) : 540,    // 09:00
      heure_fin_min: m.departure_time ? timeToMinutes(m.departure_time) : 1080,  // 18:00
      lane_id: laneId,
      multi_lane: false,
      titre: `Présence ${m.prenom || ''} ${m.nom || ''}`.trim(),
      type: 'autre',
      member_ids: [m.id],
    }))
}

// ─── Fetch ─────────────────────────────────────────────────────────────────

/**
 * Charge tous les déroulés d'un projet (1 par jour). Tri par date croissante.
 */
export async function fetchProjectDeroules(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_deroules')
    .select('*')
    .eq('project_id', projectId)
    .order('date_jour', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Toutes les lanes du projet (tous jours confondus). Utile pour lier un POI
 * à une scène/lieu transversal (une scène existe en N lanes, une par jour).
 */
export async function fetchProjectLanes(projectId) {
  const deroules = await fetchProjectDeroules(projectId)
  const ids = deroules.map((d) => d.id)
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('projet_deroule_lanes')
    .select('*')
    .in('deroule_id', ids)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Charge un déroulé complet (header + lanes + créneaux + assignations).
 * Retourne shape unifié pour consommation directe par le hook.
 */
export async function fetchDerouleComplet(derouleId) {
  if (!derouleId) return null

  const [
    { data: deroule, error: e1 },
    { data: lanes, error: e2 },
    { data: creneaux, error: e3 },
    { data: assignations, error: e4 },
  ] = await Promise.all([
    supabase.from('projet_deroules').select('*').eq('id', derouleId).single(),
    supabase
      .from('projet_deroule_lanes')
      .select('*')
      .eq('deroule_id', derouleId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('projet_deroule_creneaux')
      .select('*')
      .eq('deroule_id', derouleId)
      .order('heure_debut_min', { ascending: true }),
    supabase
      .from('projet_deroule_creneau_membres')
      .select('*, creneau:projet_deroule_creneaux!inner(deroule_id)')
      .eq('creneau.deroule_id', derouleId),
  ])

  if (e1) throw e1
  if (e2) throw e2
  if (e3) throw e3
  if (e4) throw e4

  // Reshape : embed les member_ids dans chaque créneau pour faciliter la
  // consommation côté front (overlap detection, render avatars).
  const memberIdsByCreneau = new Map()
  for (const a of assignations || []) {
    const arr = memberIdsByCreneau.get(a.creneau_id) || []
    arr.push(a.membre_id)
    memberIdsByCreneau.set(a.creneau_id, arr)
  }
  const creneauxWithMembers = (creneaux || []).map((c) => ({
    ...c,
    member_ids: memberIdsByCreneau.get(c.id) || [],
  }))

  return {
    deroule,
    lanes: lanes || [],
    creneaux: creneauxWithMembers,
    assignations: assignations || [],
  }
}

// ─── CRUD déroulé ──────────────────────────────────────────────────────────

/**
 * FEST-5.5.3 : copie les lanes d'un déroulé source vers un déroulé
 * cible (sans les créneaux). Utile pour :
 *  - Création d'un nouveau jour d'un festival multi-jours → reprendre
 *    les mêmes cadreurs + scènes que la veille.
 *  - Import IA d'un nouveau jour : reprendre les cadreurs existants
 *    (l'import crée déjà les lanes scène détectées par Claude).
 *
 * @param {string} srcDerouleId
 * @param {string} destDerouleId
 * @param {Array<string>} [types] - types à copier. Défaut : tous sauf 'global'.
 * @returns {Promise<Array>} les lanes créées
 */
export async function copyLanesFromDeroule(srcDerouleId, destDerouleId, types) {
  if (!srcDerouleId || !destDerouleId) {
    throw new Error('copyLanesFromDeroule: srcDerouleId et destDerouleId requis')
  }
  if (srcDerouleId === destDerouleId) return []

  const allowed = Array.isArray(types) && types.length > 0
    ? types
    : ['personne', 'lieu', 'equipe']

  // 1. Récupère les lanes source filtrées par type
  const { data: srcLanes, error: e1 } = await supabase
    .from('projet_deroule_lanes')
    .select('*')
    .eq('deroule_id', srcDerouleId)
    .in('type', allowed)
    .order('sort_order', { ascending: true })
  if (e1) throw e1
  if (!srcLanes || srcLanes.length === 0) return []

  // 2. Récupère le sort_order max actuel du déroulé cible pour le décalage
  const { data: destExisting } = await supabase
    .from('projet_deroule_lanes')
    .select('sort_order, libelle, type, membre_id')
    .eq('deroule_id', destDerouleId)
    .order('sort_order', { ascending: false })
    .limit(50)
  let maxSortOrder = -1
  for (const l of destExisting || []) {
    if (typeof l.sort_order === 'number' && l.sort_order > maxSortOrder) {
      maxSortOrder = l.sort_order
    }
  }

  // 3. Filtre les lanes source qui auraient un duplicate côté cible
  //    Critère : même type + même membre_id (pour 'personne') OU même
  //    libelle normalisé (pour 'lieu' / 'equipe'). On évite de dupliquer.
  const existingKeys = new Set()
  for (const l of destExisting || []) {
    if (l.type === 'personne' && l.membre_id) {
      existingKeys.add(`personne|${l.membre_id}`)
    } else if (l.libelle) {
      existingKeys.add(
        `${l.type}|${l.libelle.trim().toLowerCase()}`,
      )
    }
  }

  // 4. Insert chaque lane avec un nouveau sort_order décalé
  const created = []
  let nextSort = maxSortOrder + 1
  for (const src of srcLanes) {
    const key =
      src.type === 'personne' && src.membre_id
        ? `personne|${src.membre_id}`
        : `${src.type}|${(src.libelle || '').trim().toLowerCase()}`
    if (existingKeys.has(key)) continue
    const payload = {
      deroule_id: destDerouleId,
      sort_order: nextSort,
      libelle: src.libelle,
      type: src.type,
    }
    if (src.membre_id) payload.membre_id = src.membre_id
    if (src.couleur) payload.couleur = src.couleur
    const { data, error } = await supabase
      .from('projet_deroule_lanes')
      .insert(payload)
      .select('*')
      .single()
    if (error) {
      console.warn('[copyLanesFromDeroule] insert error', src.libelle, error)
      continue
    }
    created.push(data)
    nextSort += 1
  }
  return created
}

/**
 * Crée un nouveau déroulé pour un projet à une date donnée. Crée
 * automatiquement la lane 0 "Global" (toujours présente).
 *
 * @param {Object} payload  { project_id, date_jour, titre?, ... }
 * @returns {Object} { deroule, lanes: [global_lane] }
 */
export async function createDeroule(payload) {
  if (!payload?.project_id) throw new Error('createDeroule: project_id manquant')
  if (!payload?.date_jour) throw new Error('createDeroule: date_jour manquant')

  // 1. Insert déroulé
  // V0.5 : heure_debut_min / heure_fin_min en INTEGER (minutes since 00:00).
  // Defaults : 0 (00:00) → 1439 (23:59). Range max : 1680 (04:00 J+1).
  const { data: deroule, error: e1 } = await supabase
    .from('projet_deroules')
    .insert({
      project_id: payload.project_id,
      date_jour: payload.date_jour,
      titre: payload.titre ?? null,
      granularite_min: payload.granularite_min ?? 5,
      display_step_min: payload.display_step_min ?? 15,
      heure_debut_min: payload.heure_debut_min ?? 0,
      heure_fin_min: payload.heure_fin_min ?? 1439,
      statut: 'planifie',
      notes: payload.notes ?? null,
    })
    .select('*')
    .single()
  if (e1) throw e1

  // 2. Auto-create lane 0 "Global" (type='global' — FEST-1)
  const { data: globalLane, error: e2 } = await supabase
    .from('projet_deroule_lanes')
    .insert({
      deroule_id: deroule.id,
      sort_order: 0,
      libelle: defaultLaneLibelle(0),
      type: 'global',
    })
    .select('*')
    .single()
  if (e2) throw e2

  return { deroule, lanes: [globalLane] }
}

/** Update partiel d'un déroulé. */
export async function updateDeroule(derouleId, fields) {
  if (!derouleId) throw new Error('updateDeroule: derouleId manquant')
  const { data, error } = await supabase
    .from('projet_deroules')
    .update(fields)
    .eq('id', derouleId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/** Suppression complète d'un déroulé (CASCADE sur lanes/creneaux/membres). */
export async function deleteDeroule(derouleId) {
  if (!derouleId) throw new Error('deleteDeroule: derouleId manquant')
  const { error } = await supabase
    .from('projet_deroules')
    .delete()
    .eq('id', derouleId)
  if (error) throw error
}

// ─── CRUD lanes ────────────────────────────────────────────────────────────

/**
 * Ajoute une lane à un déroulé. Le sort_order est calculé côté client à
 * MAX(sort_order)+1.
 *
 * FEST-1 (2026-06-04) : signature étendue pour supporter les types de lanes
 * festival. Backward compat : ancien usage `addLane(derouleId, "Régie son")`
 * crée une lane type='equipe' comme avant.
 *
 * @param {string} derouleId
 * @param {object|string} options — string = libelle (legacy) ;
 *   object = { libelle?, type?, membre_id?, couleur? }
 *   - type   : 'global' | 'equipe' | 'lieu' | 'personne' (default 'equipe')
 *   - membre_id : requis ssi type='personne' (FK projet_membres)
 *   - couleur : hex sans # (optionnel, override la couleur dérivée du type)
 *
 * Note : plus de cap dur 5 lanes (FEST-1, migration). Le scroll horizontal
 * côté UI gère N lanes. On garde un warning soft à 5+ pour les déroulés
 * live qui ne sont pas censés en avoir besoin.
 */
export async function addLane(derouleId, options = null) {
  if (!derouleId) throw new Error('addLane: derouleId manquant')

  // Compat ascendante : string = libelle
  const opts = typeof options === 'string' ? { libelle: options } : (options || {})
  const type = opts.type || 'equipe'
  if (!LANE_TYPES.includes(type)) {
    throw new Error(`addLane: type invalide "${type}"`)
  }
  if (type === 'personne' && !opts.membre_id) {
    throw new Error('addLane: membre_id requis pour type=personne')
  }
  if (type !== 'personne' && opts.membre_id) {
    throw new Error('addLane: membre_id interdit hors type=personne')
  }

  const { data: existingLanes } = await supabase
    .from('projet_deroule_lanes')
    .select('sort_order')
    .eq('deroule_id', derouleId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSortOrder = ((existingLanes?.[0]?.sort_order) ?? -1) + 1
  const finalLibelle = opts.libelle?.trim() || defaultLaneLibelle(nextSortOrder)

  const payload = {
    deroule_id: derouleId,
    sort_order: nextSortOrder,
    libelle: finalLibelle,
    type,
  }
  if (opts.membre_id) payload.membre_id = opts.membre_id
  if (opts.couleur) payload.couleur = String(opts.couleur).replace('#', '').trim()

  const { data, error } = await supabase
    .from('projet_deroule_lanes')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Échange le `sort_order` de 2 lanes (réordonnancement gauche/droite).
 *
 * Contrainte technique : UNIQUE (deroule_id, sort_order) empêche un swap
 * direct A↔B (collision intermédiaire). On passe par un sort_order
 * temporaire élevé pour A, puis on bascule B vers l'ancienne valeur de A,
 * puis A vers l'ancienne valeur de B. 3 UPDATE, pas atomique mais idempotent
 * en cas de retry (on relit l'état avant chaque update).
 *
 * @param {string} laneAId
 * @param {string} laneBId
 * @returns {Promise<void>}
 */
export async function swapLaneOrder(laneAId, laneBId) {
  if (!laneAId || !laneBId) throw new Error('swapLaneOrder: 2 laneId requis')
  if (laneAId === laneBId) return // no-op

  // 1. Récupère les sort_order actuels des 2 lanes (et leur deroule_id pour
  //    le calcul du tmp).
  const { data: lanes, error: e1 } = await supabase
    .from('projet_deroule_lanes')
    .select('id, sort_order, deroule_id')
    .in('id', [laneAId, laneBId])
  if (e1) throw e1
  if (!lanes || lanes.length !== 2) {
    throw new Error('swapLaneOrder: lanes introuvables')
  }
  const a = lanes.find((l) => l.id === laneAId)
  const b = lanes.find((l) => l.id === laneBId)
  if (a.deroule_id !== b.deroule_id) {
    throw new Error('swapLaneOrder: les 2 lanes doivent être du même déroulé')
  }

  // 2. Calcule un sort_order temporaire (max existant +100) pour éviter la
  //    collision UNIQUE pendant le swap.
  const { data: maxRow } = await supabase
    .from('projet_deroule_lanes')
    .select('sort_order')
    .eq('deroule_id', a.deroule_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()
  const tmpOrder = (maxRow?.sort_order ?? 0) + 100

  // 3. A → tmp
  const { error: e3 } = await supabase
    .from('projet_deroule_lanes')
    .update({ sort_order: tmpOrder })
    .eq('id', laneAId)
  if (e3) throw e3

  // 4. B → a.sort_order
  const { error: e4 } = await supabase
    .from('projet_deroule_lanes')
    .update({ sort_order: a.sort_order })
    .eq('id', laneBId)
  if (e4) throw e4

  // 5. A → b.sort_order
  const { error: e5 } = await supabase
    .from('projet_deroule_lanes')
    .update({ sort_order: b.sort_order })
    .eq('id', laneAId)
  if (e5) throw e5
}

/** Update partiel d'une lane (libelle uniquement en pratique). */
export async function updateLane(laneId, fields) {
  if (!laneId) throw new Error('updateLane: laneId manquant')
  const { data, error } = await supabase
    .from('projet_deroule_lanes')
    .update(fields)
    .eq('id', laneId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime une lane. Refuse si la lane contient des créneaux (sauf si
 * options.force=true, auquel cas les créneaux sont supprimés en CASCADE).
 *
 * FEST-5.5.1 : la lane Global est désormais supprimable comme les autres
 * (Hugo : "je n'ai pas besoin de la lane Global tout le temps"). En cas
 * de besoin transverse plus tard, l'utilisateur peut la re-créer via
 * addLane({ type: 'global', libelle: 'Global' }).
 *
 * @param {string} laneId
 * @param {{ force?: boolean }} [options] - force=true supprime aussi les
 *   créneaux contenus. Le caller doit avoir confirmé l'action côté UI.
 */
export async function deleteLane(laneId, options = {}) {
  if (!laneId) throw new Error('deleteLane: laneId manquant')

  const { count, error: e2 } = await supabase
    .from('projet_deroule_creneaux')
    .select('id', { count: 'exact', head: true })
    .eq('lane_id', laneId)
  if (e2) throw e2

  if (count && count > 0 && !options.force) {
    const err = new Error(
      `Impossible de supprimer cette lane : elle contient ${count} créneau(x). Déplacez-les d'abord ou passez force=true pour supprimer en cascade.`,
    )
    err.code = 'LANE_NOT_EMPTY'
    err.creneauxCount = count
    throw err
  }

  // CASCADE delete des créneaux si force=true
  if (count && count > 0 && options.force) {
    const { error: eDel } = await supabase
      .from('projet_deroule_creneaux')
      .delete()
      .eq('lane_id', laneId)
    if (eDel) throw eDel
  }

  const { error: e3 } = await supabase
    .from('projet_deroule_lanes')
    .delete()
    .eq('id', laneId)
  if (e3) throw e3
}

// ─── CRUD créneaux ─────────────────────────────────────────────────────────

/**
 * Crée un créneau. Si payload.member_ids est fourni, crée aussi les
 * assignations associées en une transaction logique (inserts séquentiels —
 * pas de transaction Postgres explicite côté supabase-js, on accepte le
 * léger risque de partial create en cas de crash réseau pendant les
 * inserts. La RLS garantit la cohérence d'accès.).
 */
export async function createCreneau(payload) {
  if (!payload?.deroule_id) throw new Error('createCreneau: deroule_id manquant')
  // V0.5 : heure_debut_min / heure_fin_min en INTEGER (minutes since 00:00).
  // Range valide : [0, MAX_MIN]. Range max 1680 = 28h = 04:00 J+1.
  const debutMin = payload.heure_debut_min
  const finMin = payload.heure_fin_min
  if (typeof debutMin !== 'number' || typeof finMin !== 'number') {
    throw new Error('createCreneau: heure_debut_min et heure_fin_min requis')
  }
  if (finMin <= debutMin) {
    throw new Error('createCreneau: heure_fin_min doit être > heure_debut_min')
  }
  if (debutMin < 0 || finMin > MAX_MIN) {
    throw new Error(`createCreneau: heures hors range [0, ${MAX_MIN}]`)
  }

  const memberIds = Array.isArray(payload.member_ids)
    ? payload.member_ids.filter(Boolean)
    : []

  // 1. Insert créneau (sort_order auto via trigger). FEST-3.2 : on accepte
  // source_creneau_id + source_anchor pour permettre la création directe
  // d'un créneau lié depuis QuickCreateMenu (workflow "Lié à ce moment").
  const { data: creneau, error: e1 } = await supabase
    .from('projet_deroule_creneaux')
    .insert({
      deroule_id: payload.deroule_id,
      heure_debut_min: debutMin,
      heure_fin_min: finMin,
      lane_id: payload.multi_lane ? null : payload.lane_id ?? null,
      multi_lane: payload.multi_lane === true,
      titre: payload.titre ?? '',
      description: payload.description ?? null,
      type: payload.type ?? 'autre',
      couleur: payload.couleur ?? null,
      lieu_text: payload.lieu_text ?? null,
      lieu_id: payload.lieu_id ?? null,
      artiste_id: payload.artiste_id ?? null,
      statut: 'planifie',
      notes: payload.notes ?? null,
      source_creneau_id: payload.source_creneau_id ?? null,
      source_anchor: payload.source_anchor ?? null,
    })
    .select('*')
    .single()
  if (e1) throw e1

  // 2. Insert assignations si nécessaire
  if (memberIds.length > 0) {
    const rows = memberIds.map((membreId) => ({
      creneau_id: creneau.id,
      membre_id: membreId,
      role: payload.member_role ?? null,
    }))
    const { error: e2 } = await supabase
      .from('projet_deroule_creneau_membres')
      .insert(rows)
    if (e2) throw e2
  }

  return { ...creneau, member_ids: memberIds }
}

/** Update partiel d'un créneau (sans toucher aux assignations). */
export async function updateCreneau(creneauId, fields) {
  if (!creneauId) throw new Error('updateCreneau: creneauId manquant')

  // Cohérence multi_lane / lane_id : si on toggle multi_lane=true, on
  // doit clear lane_id ; si on set lane_id, on force multi_lane=false.
  const safeFields = { ...fields }
  if (safeFields.multi_lane === true) safeFields.lane_id = null
  else if (safeFields.lane_id) safeFields.multi_lane = false

  const { data, error } = await supabase
    .from('projet_deroule_creneaux')
    .update(safeFields)
    .eq('id', creneauId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/** Suppression d'un créneau (CASCADE sur les assignations). */
export async function deleteCreneau(creneauId) {
  if (!creneauId) throw new Error('deleteCreneau: creneauId manquant')
  const { error } = await supabase
    .from('projet_deroule_creneaux')
    .delete()
    .eq('id', creneauId)
  if (error) throw error
}

// ─── Assignations membre / créneau ─────────────────────────────────────────

/**
 * Set la liste complète des membres assignés à un créneau (replace).
 * Diff intelligent : delete les retirés, insert les ajoutés, no-op les
 * inchangés. Le rôle reste le même pour les inchangés.
 */
export async function setCreneauMembres(creneauId, membreIds, role = null) {
  if (!creneauId) throw new Error('setCreneauMembres: creneauId manquant')
  const target = Array.isArray(membreIds) ? membreIds.filter(Boolean) : []

  const { data: current, error: e1 } = await supabase
    .from('projet_deroule_creneau_membres')
    .select('membre_id')
    .eq('creneau_id', creneauId)
  if (e1) throw e1

  const currentSet = new Set((current || []).map((r) => r.membre_id))
  const targetSet = new Set(target)

  const toRemove = [...currentSet].filter((id) => !targetSet.has(id))
  const toAdd = [...targetSet].filter((id) => !currentSet.has(id))

  if (toRemove.length > 0) {
    const { error: e2 } = await supabase
      .from('projet_deroule_creneau_membres')
      .delete()
      .eq('creneau_id', creneauId)
      .in('membre_id', toRemove)
    if (e2) throw e2
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map((membreId) => ({
      creneau_id: creneauId,
      membre_id: membreId,
      role,
    }))
    const { error: e3 } = await supabase
      .from('projet_deroule_creneau_membres')
      .insert(rows)
    if (e3) throw e3
  }
}

// ─── Import présences depuis techlist ──────────────────────────────────────

/**
 * Import en masse : pour chaque membre présent ce jour avec arrival/departure
 * définis, crée un créneau "Présence" sur la lane Global. Idempotent : ne
 * recrée pas un créneau qui existe déjà pour ce membre (détection sur
 * member_id + heure_debut + lane_id).
 *
 * @returns {Array} créneaux créés (pour feedback UI)
 */
export async function importPresencesFromTechlist(derouleId, membres) {
  if (!derouleId) throw new Error('importPresencesFromTechlist: derouleId manquant')
  if (!Array.isArray(membres) || membres.length === 0) return []

  // Récupère le déroulé pour la date_jour et la lane Global
  const { data: deroule, error: e1 } = await supabase
    .from('projet_deroules')
    .select('id, date_jour')
    .eq('id', derouleId)
    .single()
  if (e1) throw e1

  const { data: lanes, error: e2 } = await supabase
    .from('projet_deroule_lanes')
    .select('id, sort_order')
    .eq('deroule_id', derouleId)
    .order('sort_order', { ascending: true })
    .limit(1)
  if (e2) throw e2

  const globalLane = lanes?.[0]
  if (!globalLane || globalLane.sort_order !== 0) {
    throw new Error('Lane Global introuvable — corruption ?')
  }

  // Suggestion via helper pur
  const suggestions = suggestPresenceCreneaux(
    membres,
    deroule.date_jour,
    globalLane.id,
  )
  if (suggestions.length === 0) return []

  // Insert chaque créneau séquentiellement (pour récupérer les IDs et
  // pour pouvoir gérer les duplicatas — on ne peut pas faire un upsert
  // simple ici car on n'a pas de clé naturelle).
  const created = []
  for (const sugg of suggestions) {
    const creneau = await createCreneau({
      deroule_id: derouleId,
      ...sugg,
    })
    created.push(creneau)
  }
  return created
}
