// ════════════════════════════════════════════════════════════════════════════
// logistique.js — Logistique V1 : trajets, repas, nuits, hébergements
// ════════════════════════════════════════════════════════════════════════════
//
// P1 de la refonte (plan validé Hugo 2026-07-29). Principe : les dates de
// présence / arrivée / départ restent dans l'Équipe (lib/crew.js) — ces
// helpers ne gèrent QUE les couches logistiques par-dessus :
//   - repas   : 1 row = 1 repas pris en charge (client/production/defraye),
//               absence de row = « — »
//   - nuits   : 1 row = 1 nuit cochée (hebergement_id optionnel)
//   - trajets : déplacements à N étapes ordonnées (jsonb)
//   - hébergements : lieux du projet + infos par personne (P2)
//
// La V0 (textes libres, logistiqueV0.js) coexiste jusqu'à P2.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

export const REPAS_STATUTS = ['client', 'production', 'defraye']
export const REPAS_LABELS = {
  client: 'Client',
  production: 'Production',
  defraye: 'Défrayé',
}
export const TRAJET_MODES = ['train', 'minibus', 'voiture', 'avion', 'autre']

// ═══ Fetch global ════════════════════════════════════════════════════════════

/**
 * Charge tout l'état logistique V1 d'un projet en 1 aller-retour.
 * @returns {{ hebergements, hebergementMembres, trajets, repas, nuits }}
 */
export async function fetchLogistique(projectId) {
  const empty = {
    hebergements: [],
    hebergementMembres: [],
    trajets: [],
    repas: [],
    nuits: [],
  }
  if (!projectId) return empty
  const [hRes, hmRes, tRes, rRes, nRes] = await Promise.all([
    supabase
      .from('projet_logistique_hebergements')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('projet_logistique_hebergement_membres')
      .select('*')
      .eq('project_id', projectId),
    supabase
      .from('projet_logistique_trajets')
      .select('*')
      .eq('project_id', projectId)
      .order('date_trajet', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('projet_logistique_repas')
      .select('*')
      .eq('project_id', projectId),
    supabase
      .from('projet_logistique_nuits')
      .select('*')
      .eq('project_id', projectId),
  ])
  for (const res of [hRes, hmRes, tRes, rRes, nRes]) {
    if (res.error) throw res.error
  }
  return {
    hebergements: hRes.data || [],
    hebergementMembres: hmRes.data || [],
    trajets: tRes.data || [],
    repas: rRes.data || [],
    nuits: nRes.data || [],
  }
}

// ═══ Repas ═══════════════════════════════════════════════════════════════════

/**
 * Pose / change / retire un repas. statut null → suppression (« — »).
 * Upsert sur la clé (membre_id, date_repas, service).
 */
export async function setRepas({ projectId, membreId, date, service, statut }) {
  if (!statut) {
    const { error } = await supabase
      .from('projet_logistique_repas')
      .delete()
      .eq('membre_id', membreId)
      .eq('date_repas', date)
      .eq('service', service)
    if (error) throw error
    return null
  }
  const { data, error } = await supabase
    .from('projet_logistique_repas')
    .upsert(
      {
        project_id: projectId,
        membre_id: membreId,
        date_repas: date,
        service,
        statut,
      },
      { onConflict: 'membre_id,date_repas,service' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data
}

// ═══ Nuits ═══════════════════════════════════════════════════════════════════

/** Coche une nuit (upsert — passe aussi l'hébergement si connu). */
export async function setNuit({ projectId, membreId, date, hebergementId = null }) {
  const { data, error } = await supabase
    .from('projet_logistique_nuits')
    .upsert(
      {
        project_id: projectId,
        membre_id: membreId,
        date_nuit: date,
        hebergement_id: hebergementId,
      },
      { onConflict: 'membre_id,date_nuit' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data
}

/** Décoche une nuit. */
export async function deleteNuit({ membreId, date }) {
  const { error } = await supabase
    .from('projet_logistique_nuits')
    .delete()
    .eq('membre_id', membreId)
    .eq('date_nuit', date)
  if (error) throw error
}

// ═══ Trajets ═════════════════════════════════════════════════════════════════

/**
 * Crée un trajet. etapes = [{ mode, heure, depart, arrivee, note }].
 */
export async function createTrajet({
  projectId,
  membreId,
  sens = 'aller',
  dateTrajet = null,
  etapes = [],
  cout = null,
  notes = null,
}) {
  const { data, error } = await supabase
    .from('projet_logistique_trajets')
    .insert({
      project_id: projectId,
      membre_id: membreId,
      sens,
      date_trajet: dateTrajet,
      etapes,
      cout,
      notes,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateTrajet(trajetId, patch) {
  const allowed = {}
  for (const k of ['sens', 'date_trajet', 'etapes', 'cout', 'notes', 'sort_order']) {
    if (patch[k] !== undefined) allowed[k] = patch[k]
  }
  const { data, error } = await supabase
    .from('projet_logistique_trajets')
    .update(allowed)
    .eq('id', trajetId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function deleteTrajet(trajetId) {
  const { error } = await supabase
    .from('projet_logistique_trajets')
    .delete()
    .eq('id', trajetId)
  if (error) throw error
}

// ═══ Hébergements (CRUD de base — UI complète en P2) ═════════════════════════

export async function createHebergement({ projectId, nom, type = null, adresse = null, notes = null }) {
  const { data: last } = await supabase
    .from('projet_logistique_hebergements')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data, error } = await supabase
    .from('projet_logistique_hebergements')
    .insert({
      project_id: projectId,
      nom,
      type,
      adresse,
      notes,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateHebergement(hebergementId, patch) {
  const allowed = {}
  for (const k of ['nom', 'type', 'adresse', 'notes', 'sort_order']) {
    if (patch[k] !== undefined) allowed[k] = patch[k]
  }
  const { data, error } = await supabase
    .from('projet_logistique_hebergements')
    .update(allowed)
    .eq('id', hebergementId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function deleteHebergement(hebergementId) {
  const { error } = await supabase
    .from('projet_logistique_hebergements')
    .delete()
    .eq('id', hebergementId)
  if (error) throw error
}

// ═══ Initialisation depuis l'Équipe ══════════════════════════════════════════

/**
 * Pose les défauts logistiques depuis les présences Équipe, SANS toucher à
 * l'existant (upsert ignoreDuplicates) :
 *   - présent le jour J → repas midi + soir 'client'
 *   - nuit cochée pour chaque jour de présence SAUF le dernier du séjour
 *     de la personne (on dort sur place entre deux jours de présence)
 *
 * @param {string} projectId
 * @param {Array} participations shape unifié crew.js (membre_id, presence_days)
 * @returns {{ repas: number, nuits: number }} nombre de rows créées (approx.)
 */
export async function initFromEquipe(projectId, participations = []) {
  // Union des jours de présence par membre (toutes sessions confondues).
  const daysByMembre = new Map()
  for (const p of participations) {
    if (!p?.membre_id) continue
    const set = daysByMembre.get(p.membre_id) || new Set()
    for (const d of p.presence_days || []) set.add(d)
    daysByMembre.set(p.membre_id, set)
  }

  const repasRows = []
  const nuitRows = []
  for (const [membreId, daySet] of daysByMembre.entries()) {
    const days = Array.from(daySet).sort()
    if (!days.length) continue
    const lastDay = days[days.length - 1]
    for (const d of days) {
      repasRows.push(
        { project_id: projectId, membre_id: membreId, date_repas: d, service: 'midi', statut: 'client' },
        { project_id: projectId, membre_id: membreId, date_repas: d, service: 'soir', statut: 'client' },
      )
      if (d !== lastDay) {
        nuitRows.push({ project_id: projectId, membre_id: membreId, date_nuit: d, hebergement_id: null })
      }
    }
  }

  // ignoreDuplicates : ne réécrit JAMAIS un repas/nuit déjà posé (l'admin a
  // pu passer un repas en 'defraye' ou décocher une nuit — on respecte).
  let repasCount = 0
  let nuitCount = 0
  if (repasRows.length) {
    const { data, error } = await supabase
      .from('projet_logistique_repas')
      .upsert(repasRows, { onConflict: 'membre_id,date_repas,service', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    repasCount = data?.length ?? 0
  }
  if (nuitRows.length) {
    const { data, error } = await supabase
      .from('projet_logistique_nuits')
      .upsert(nuitRows, { onConflict: 'membre_id,date_nuit', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    nuitCount = data?.length ?? 0
  }
  return { repas: repasCount, nuits: nuitCount }
}
