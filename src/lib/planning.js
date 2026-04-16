/**
 * planning.js — Helpers & constantes pour le pilier Planning (PL-1+)
 *
 * Tables ciblées (migration 20260416_planning_pl1.sql) :
 *   - event_types           : types d'événements, org-scoped, personnalisables
 *   - locations             : repérages réutilisables, org-scoped (PL-9)
 *   - events                : événements, project-scoped, récurrence JSONB
 *   - event_members         : convocations équipe (profile OU crew XOR)
 *   - event_devis_lines     : lien N-N événement ↔ ligne de devis
 *
 * Ce module ne fait PAS d'expansion de récurrence (sera ajouté en PL-2 / PL-5
 * via date-fns / rrule). Il expose les CRUD de base et les constantes.
 */

import { supabase } from './supabase'

// ─── Constantes ──────────────────────────────────────────────────────────────

export const EVENT_TYPE_CATEGORIES = {
  pre_prod:  { key: 'pre_prod',  label: 'Pré-production' },
  tournage:  { key: 'tournage',  label: 'Tournage' },
  post_prod: { key: 'post_prod', label: 'Post-production' },
  autre:     { key: 'autre',     label: 'Autre' },
}

export const EVENT_MEMBER_STATUS = {
  pending:   { key: 'pending',   label: 'Invité',    color: 'var(--txt-3)' },
  confirmed: { key: 'confirmed', label: 'Confirmé',  color: 'var(--green)' },
  declined:  { key: 'declined',  label: 'Décliné',   color: 'var(--red)' },
  tentative: { key: 'tentative', label: 'Incertain', color: 'var(--orange)' },
}

// Clés slug des types "système" seedés par défaut. Ne pas les modifier sans
// migration SQL correspondante (contrainte UNIQUE (org_id, slug)).
export const SYSTEM_EVENT_TYPE_SLUGS = [
  'pre_production', 'reperages', 'casting', 'essais',
  'tournage',
  'montage', 'etalonnage', 'mix_sound', 'vfx_compo',
  'livraison', 'validation', 'reunion', 'autre',
]

// ─── Types d'événements (CRUD) ───────────────────────────────────────────────

/**
 * Liste les types d'événements de l'org (non archivés par défaut).
 * @param {Object} [opts]
 * @param {boolean} [opts.includeArchived=false]
 */
export async function listEventTypes({ includeArchived = false } = {}) {
  let q = supabase
    .from('event_types')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  if (!includeArchived) q = q.eq('archived', false)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createEventType(payload) {
  const { data, error } = await supabase
    .from('event_types')
    .insert([{ ...payload, is_system: false, archived: false }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateEventType(id, patch) {
  const { data, error } = await supabase
    .from('event_types')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Archive (plutôt que supprime) un type d'événement.
 * Les types système ne peuvent pas être supprimés ; l'UI doit forcer l'archivage.
 */
export async function archiveEventType(id) {
  return updateEventType(id, { archived: true })
}

export async function restoreEventType(id) {
  return updateEventType(id, { archived: false })
}

/** Suppression définitive (utilisable uniquement sur les types non-système, UI). */
export async function deleteEventType(id) {
  const { error } = await supabase.from('event_types').delete().eq('id', id)
  if (error) throw error
}

// ─── Locations (CRUD minimal, enrichi en PL-9) ───────────────────────────────

export async function listLocations({ includeArchived = false } = {}) {
  let q = supabase
    .from('locations')
    .select('*')
    .order('name', { ascending: true })
  if (!includeArchived) q = q.eq('archived', false)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createLocation(payload) {
  const { data, error } = await supabase
    .from('locations')
    .insert([{ ...payload, archived: false }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateLocation(id, patch) {
  const { data, error } = await supabase
    .from('locations').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

// ─── Events (CRUD) ───────────────────────────────────────────────────────────

const EVENT_SELECT = `
  *,
  type:event_types ( id, slug, label, color, icon, category ),
  location:locations ( id, name, address, city ),
  members:event_members (
    id, role, status, notes,
    profile_id, crew_member_id,
    profile:profiles ( id, full_name ),
    crew:crew_members ( id, person_name, email, crew_role )
  ),
  lines:event_devis_lines (
    id, quantity, devis_line_id,
    devis_line:devis_lines ( id, produit, description, regime )
  )
`

/**
 * Liste les événements d'un projet, éventuellement restreint à une plage
 * de dates. La plage inclut les événements qui se chevauchent partiellement.
 * Attention : l'expansion de récurrence n'est PAS faite ici — on renvoie la
 * "source" (ligne unique par série récurrente) ; le caller devra la gérer.
 */
export async function listEventsByProject(projectId, { from, to } = {}) {
  let q = supabase
    .from('events')
    .select(EVENT_SELECT)
    .eq('project_id', projectId)
    .order('starts_at', { ascending: true })

  if (from) q = q.gte('ends_at', from)
  if (to)   q = q.lte('starts_at', to)

  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Liste les événements multi-projets de l'org courante (pour vues transverses,
 * XC-2). On délègue le filtre org à la RLS.
 */
export async function listEventsAcrossOrg({ from, to, memberProfileId } = {}) {
  let q = supabase
    .from('events')
    .select(EVENT_SELECT + ', project:projects ( id, title, client_id )')
    .order('starts_at', { ascending: true })

  if (from) q = q.gte('ends_at', from)
  if (to)   q = q.lte('starts_at', to)

  const { data, error } = await q
  if (error) throw error

  // Filtre en mémoire si un memberProfileId est passé (évite jointure complexe)
  if (!memberProfileId) return data || []
  return (data || []).filter((ev) =>
    (ev.members || []).some((m) => m.profile_id === memberProfileId),
  )
}

export async function getEvent(id) {
  const { data, error } = await supabase
    .from('events').select(EVENT_SELECT).eq('id', id).single()
  if (error) throw error
  return data
}

/**
 * Crée un événement. Le payload doit contenir au minimum :
 *   { project_id, title, starts_at, ends_at }
 * Les autres champs (lot_id, type_id, location_id, all_day, rrule, notes…)
 * sont optionnels.
 */
export async function createEvent(payload) {
  const { data, error } = await supabase
    .from('events')
    .insert([payload])
    .select(EVENT_SELECT)
    .single()
  if (error) throw error
  return data
}

export async function updateEvent(id, patch) {
  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', id)
    .select(EVENT_SELECT)
    .single()
  if (error) throw error
  return data
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw error
}

// ─── Event members (convocations) ────────────────────────────────────────────

/**
 * Ajoute un membre à un événement. XOR strict :
 *   - soit profile_id (utilisateur de la plateforme),
 *   - soit crew_member_id (membre d'équipe projet, non utilisateur).
 */
export async function addEventMember(eventId, {
  profileId = null,
  crewMemberId = null,
  role = null,
  status = 'pending',
  notes = null,
}) {
  if ((profileId && crewMemberId) || (!profileId && !crewMemberId)) {
    throw new Error('addEventMember: fournir exactement un de profileId OU crewMemberId')
  }
  const { data, error } = await supabase
    .from('event_members')
    .insert([{
      event_id: eventId,
      profile_id: profileId,
      crew_member_id: crewMemberId,
      role, status, notes,
    }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateEventMember(id, patch) {
  const { data, error } = await supabase
    .from('event_members').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function removeEventMember(id) {
  const { error } = await supabase.from('event_members').delete().eq('id', id)
  if (error) throw error
}

// ─── Event ↔ devis_lines (traçabilité financière) ────────────────────────────

export async function linkEventToDevisLine(eventId, devisLineId, quantity = null) {
  const { data, error } = await supabase
    .from('event_devis_lines')
    .insert([{ event_id: eventId, devis_line_id: devisLineId, quantity }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function unlinkEventFromDevisLine(id) {
  const { error } = await supabase.from('event_devis_lines').delete().eq('id', id)
  if (error) throw error
}

// ─── Utilitaires UI ──────────────────────────────────────────────────────────

/** Couleur effective d'un événement (surcharge > couleur du type > fallback). */
export function resolveEventColor(event, fallback = 'var(--txt-3)') {
  if (event?.color_override) return event.color_override
  if (event?.type?.color)    return event.type.color
  return fallback
}

/** Détection basique de chevauchement entre deux événements (ignore la récurrence). */
export function eventsOverlap(a, b) {
  if (!a || !b) return false
  const aStart = new Date(a.starts_at).getTime()
  const aEnd   = new Date(a.ends_at).getTime()
  const bStart = new Date(b.starts_at).getTime()
  const bEnd   = new Date(b.ends_at).getTime()
  return aStart < bEnd && bStart < aEnd
}
