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

/** Types sémantiques de créneau (synchronisé avec le CHECK SQL). */
export const CRENEAU_TYPES = [
  'install',
  'repas',
  'prise',
  'pause',
  'transport',
  'brief',
  'live',
  'autre',
]

/**
 * Couleur hex par défaut par type de créneau (utilisée si `creneau.couleur`
 * est NULL — ce qui est le cas par défaut).
 *
 * Choisies pour cohérence avec la palette interne Captiv :
 *   install   = blue 600   (technique/setup)
 *   repas     = amber 400  (chaud/convivial)
 *   prise     = green 600  (action/réussite)
 *   pause     = gray 400   (neutre)
 *   transport = coral 400  (mouvement)
 *   brief     = purple 600 (info/réflexion)
 *   live      = green 800  (action+intensité)
 *   autre     = gray 400   (fallback)
 */
export const CRENEAU_TYPE_COLORS = {
  install: '#185FA5',
  repas: '#EF9F27',
  prise: '#639922',
  pause: '#888780',
  transport: '#D85A30',
  brief: '#534AB7',
  live: '#27500A',
  autre: '#888780',
}

/** Statuts opérationnels (synchronisé avec le CHECK SQL). */
export const CRENEAU_STATUTS = ['planifie', 'en_cours', 'fait', 'annule']

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

/** Max lanes (lane 0 + lanes 1..4). */
export const MAX_LANES = 5

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
 * snapToStep(577, 15) → 585 (= 09:45, plus proche que 570)
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
 */
export function creneauDureeMin(creneau) {
  const debut = timeToMinutes(creneau?.heure_debut)
  const fin = timeToMinutes(creneau?.heure_fin)
  if (isNaN(debut) || isNaN(fin) || fin <= debut) return 0
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
  const aDebut = timeToMinutes(a?.heure_debut)
  const aFin = timeToMinutes(a?.heure_fin)
  const bDebut = timeToMinutes(b?.heure_debut)
  const bFin = timeToMinutes(b?.heure_fin)
  if (isNaN(aDebut) || isNaN(aFin) || isNaN(bDebut) || isNaN(bFin)) {
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
 * Renvoie la couleur effective d'un créneau : `couleur` override si présent,
 * sinon mapping CRENEAU_TYPE_COLORS sur le type, sinon fallback gray.
 */
export function effectiveCouleurCreneau(creneau) {
  if (creneau?.couleur && /^#?[0-9a-f]{3,8}$/i.test(creneau.couleur)) {
    return creneau.couleur.startsWith('#') ? creneau.couleur : `#${creneau.couleur}`
  }
  return CRENEAU_TYPE_COLORS[creneau?.type] || CRENEAU_TYPE_COLORS.autre
}

/**
 * Tri stable des créneaux : par heure_debut croissante, puis sort_order.
 */
export function sortCreneauxByTime(creneaux) {
  if (!Array.isArray(creneaux)) return []
  return [...creneaux].sort((a, b) => {
    const aMin = timeToMinutes(a.heure_debut)
    const bMin = timeToMinutes(b.heure_debut)
    if (aMin !== bMin) return aMin - bMin
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
}

/**
 * Détermine le label par défaut d'une lane à partir de son sort_order.
 */
export function defaultLaneLibelle(sortOrder) {
  return DEFAULT_LANE_LIBELLES[sortOrder] ?? `Lane ${sortOrder + 1}`
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
      heure_debut: m.arrival_time || '09:00',
      heure_fin: m.departure_time || '18:00',
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
      .order('heure_debut', { ascending: true }),
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
  const { data: deroule, error: e1 } = await supabase
    .from('projet_deroules')
    .insert({
      project_id: payload.project_id,
      date_jour: payload.date_jour,
      titre: payload.titre ?? null,
      granularite_min: payload.granularite_min ?? 5,
      display_step_min: payload.display_step_min ?? 15,
      heure_debut: payload.heure_debut ?? '06:00',
      heure_fin: payload.heure_fin ?? '23:00',
      statut: 'planifie',
      notes: payload.notes ?? null,
    })
    .select('*')
    .single()
  if (e1) throw e1

  // 2. Auto-create lane 0 "Global"
  const { data: globalLane, error: e2 } = await supabase
    .from('projet_deroule_lanes')
    .insert({
      deroule_id: deroule.id,
      sort_order: 0,
      libelle: defaultLaneLibelle(0),
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
 * MAX(sort_order)+1 (avec garde MAX_LANES). Pas de retry — on peut accepter
 * une race rare ici (création de lane par 2 admins simultanément).
 */
export async function addLane(derouleId, libelle = null) {
  if (!derouleId) throw new Error('addLane: derouleId manquant')

  const { data: existingLanes } = await supabase
    .from('projet_deroule_lanes')
    .select('sort_order')
    .eq('deroule_id', derouleId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSortOrder = ((existingLanes?.[0]?.sort_order) ?? -1) + 1
  if (nextSortOrder >= MAX_LANES) {
    throw new Error(`Maximum ${MAX_LANES} lanes atteint`)
  }

  const finalLibelle = libelle?.trim() || defaultLaneLibelle(nextSortOrder)

  const { data, error } = await supabase
    .from('projet_deroule_lanes')
    .insert({
      deroule_id: derouleId,
      sort_order: nextSortOrder,
      libelle: finalLibelle,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
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
 * Supprime une lane. Refuse si sort_order = 0 (lane "Global" non
 * supprimable). Refuse aussi si la lane contient encore des créneaux
 * (l'admin doit d'abord les déplacer ou supprimer).
 */
export async function deleteLane(laneId) {
  if (!laneId) throw new Error('deleteLane: laneId manquant')

  const { data: lane, error: e1 } = await supabase
    .from('projet_deroule_lanes')
    .select('sort_order')
    .eq('id', laneId)
    .single()
  if (e1) throw e1

  if (lane.sort_order === 0) {
    throw new Error('La lane Global ne peut pas être supprimée')
  }

  const { count, error: e2 } = await supabase
    .from('projet_deroule_creneaux')
    .select('id', { count: 'exact', head: true })
    .eq('lane_id', laneId)
  if (e2) throw e2

  if (count && count > 0) {
    throw new Error(
      `Impossible de supprimer cette lane : elle contient ${count} créneau(x). Déplacez-les d'abord.`,
    )
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
  if (!payload?.heure_debut || !payload?.heure_fin) {
    throw new Error('createCreneau: heure_debut et heure_fin requis')
  }
  if (timeToMinutes(payload.heure_fin) <= timeToMinutes(payload.heure_debut)) {
    throw new Error('createCreneau: heure_fin doit être après heure_debut')
  }

  const memberIds = Array.isArray(payload.member_ids)
    ? payload.member_ids.filter(Boolean)
    : []

  // 1. Insert créneau (sort_order auto via trigger)
  const { data: creneau, error: e1 } = await supabase
    .from('projet_deroule_creneaux')
    .insert({
      deroule_id: payload.deroule_id,
      heure_debut: payload.heure_debut,
      heure_fin: payload.heure_fin,
      lane_id: payload.multi_lane ? null : payload.lane_id ?? null,
      multi_lane: payload.multi_lane === true,
      titre: payload.titre ?? '',
      description: payload.description ?? null,
      type: payload.type ?? 'autre',
      couleur: payload.couleur ?? null,
      lieu_text: payload.lieu_text ?? null,
      lieu_id: payload.lieu_id ?? null,
      statut: 'planifie',
      notes: payload.notes ?? null,
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
