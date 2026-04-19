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
 *
 * Les masters récurrents (rrule NON NULL) sont toujours renvoyés, qu'ils
 * tombent ou non dans la fenêtre : c'est au caller d'étendre la série
 * (via expandEvents) pour ne garder que les occurrences qui matchent.
 *
 * Attention : l'expansion de récurrence n'est PAS faite ici — on renvoie la
 * "source" (ligne unique par série récurrente) ; le caller devra la gérer.
 */
export async function listEventsByProject(projectId, { from, to } = {}) {
  let q = supabase
    .from('events')
    .select(EVENT_SELECT)
    .eq('project_id', projectId)
    .order('starts_at', { ascending: true })

  if (from && to) {
    // OR( fenêtre intersectée, rrule non null )
    //   fenêtre intersectée = starts_at <= to AND ends_at >= from
    q = q.or(
      `and(starts_at.lte.${to},ends_at.gte.${from}),rrule.not.is.null`,
    )
  } else if (from) {
    q = q.or(`ends_at.gte.${from},rrule.not.is.null`)
  } else if (to) {
    q = q.or(`starts_at.lte.${to},rrule.not.is.null`)
  }

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

// ─── Récurrence : exdates & détachement d'occurrences ────────────────────────

/**
 * Ajoute une clé d'exdate ("YYYY-MM-DD") à la liste des exdates d'un événement
 * récurrent. Utilisé quand on supprime UNE seule occurrence d'une série.
 *
 * @param {string} eventId - id du master event
 * @param {string} dateKey - clé d'occurrence "YYYY-MM-DD" (voir rrule.occurrenceKey)
 */
export async function addExdate(eventId, dateKey) {
  const { data: current, error: fetchErr } = await supabase
    .from('events')
    .select('id, rrule_exdates')
    .eq('id', eventId)
    .single()
  if (fetchErr) throw fetchErr

  const existing = Array.isArray(current?.rrule_exdates) ? current.rrule_exdates : []
  if (existing.includes(dateKey)) return current // déjà exclue
  const next = [...existing, dateKey]

  const { data, error } = await supabase
    .from('events')
    .update({ rrule_exdates: next })
    .eq('id', eventId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Détache UNE occurrence d'une série récurrente :
 *   1) crée un nouvel événement autonome (sans rrule) avec les champs du master
 *      surchargés par `overrides` (starts_at / ends_at / title / …)
 *   2) ajoute la clé d'occurrence originale aux exdates du master, pour que
 *      la série ne réémette plus cette date.
 *
 * @param {Object} masterEvent   - événement master (avec project_id, rrule…)
 * @param {string} occurrenceKey - clé "YYYY-MM-DD" de l'occurrence à détacher
 * @param {Object} [overrides]   - patch à appliquer (starts_at, ends_at, title, description, location_id, lot_id, type_id, all_day…)
 * @returns {Promise<{master: Object, detached: Object}>}
 */
export async function detachOccurrence(masterEvent, occurrenceKey, overrides = {}) {
  if (!masterEvent?.id) throw new Error('detachOccurrence: masterEvent.id requis')
  if (!occurrenceKey)   throw new Error('detachOccurrence: occurrenceKey requis')

  // Payload du nouvel événement (copie du master, sans les métadonnées
  // de récurrence ni les champs qu'on ne veut pas dupliquer).
  const payload = {
    project_id:  masterEvent.project_id,
    lot_id:      masterEvent.lot_id ?? null,
    type_id:     masterEvent.type_id,
    location_id: masterEvent.location_id ?? null,
    title:       masterEvent.title,
    description: masterEvent.description ?? null,
    all_day:     Boolean(masterEvent.all_day),
    starts_at:   masterEvent.starts_at,
    ends_at:     masterEvent.ends_at,
    color_override: masterEvent.color_override ?? null,
    // Pas de rrule : c'est un événement autonome détaché
    rrule: null,
    rrule_exdates: null,
    ...overrides,
  }

  const detached = await createEvent(payload)
  const master   = await addExdate(masterEvent.id, occurrenceKey)

  return { master, detached }
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

/**
 * Retourne la liste des identités-membre (profile_id ou crew_member_id)
 * présentes sur un événement. Une identité est encodée en string :
 *   - `p:<uuid>` pour un profil interne
 *   - `c:<uuid>` pour un intervenant projet
 *
 * Les membres dont le statut est "declined" sont exclus (ils ne sont plus
 * considérés comme engagés sur l'événement).
 */
export function memberIdentitiesOf(event) {
  const out = []
  for (const m of event?.members || []) {
    if (m.status === 'declined') continue
    if (m.profile_id)     out.push(`p:${m.profile_id}`)
    if (m.crew_member_id) out.push(`c:${m.crew_member_id}`)
  }
  return out
}

/**
 * Construit un index { 'p:<uuid>' → name, 'c:<uuid>' → name } à partir d'une
 * liste d'événements (avec `members[]` joint depuis Supabase via EVENT_SELECT).
 *
 * Utile pour les vues swimlanes équipe : on n'a pas besoin de fetcher en plus
 * la table profiles/crew_members puisque les données sont déjà embarquées
 * dans chaque event.member.profile / .crew. Les declined sont ignorés
 * (cohérence avec memberIdentitiesOf).
 *
 * Retourne un Map (ordre d'insertion préservé pour itération stable).
 */
export function buildMemberMap(events) {
  const map = new Map()
  if (!Array.isArray(events)) return map
  for (const ev of events) {
    for (const m of ev?.members || []) {
      if (m.status === 'declined') continue
      if (m.profile_id) {
        const key = `p:${m.profile_id}`
        if (!map.has(key)) {
          map.set(key, m.profile?.full_name || 'Profil sans nom')
        }
      }
      if (m.crew_member_id) {
        const key = `c:${m.crew_member_id}`
        if (!map.has(key)) {
          map.set(key, m.crew?.person_name || 'Intervenant sans nom')
        }
      }
    }
  }
  return map
}

/**
 * Clé stable identifiant un événement (ou une occurrence virtuelle).
 * Les occurrences partagent le même `id` que leur master mais ont des
 * `_occurrence_key` distinctes ; il faut combiner les deux.
 */
export function eventKey(event) {
  if (!event) return null
  return event._occurrence_key ? `${event.id}|${event._occurrence_key}` : event.id
}

/**
 * Détecte les conflits entre membres convoqués sur un ensemble d'événements
 * déjà étendus (récurrence incluse). Deux événements sont en conflit quand :
 *   1) leurs plages temporelles se chevauchent (eventsOverlap)
 *   2) ils partagent au moins une identité-membre (profile ou crew)
 *
 * Les membres au statut "declined" sont ignorés. Les événements sans membre
 * ne génèrent pas de conflit.
 *
 * @param {Array<Object>} events - événements (expanded)
 * @returns {Map<string, Array<{ other: Object, sharedIdentities: string[] }>>}
 *          clé = eventKey(event), valeur = liste de conflits
 */
export function findEventConflicts(events) {
  const result = new Map()
  const list   = Array.isArray(events) ? events : []
  if (list.length < 2) return result

  // Pré-calcul : identités + timestamps pour éviter Date parsing N×N.
  const prepared = list.map((ev) => ({
    ev,
    key:   eventKey(ev),
    start: new Date(ev.starts_at).getTime(),
    end:   new Date(ev.ends_at).getTime(),
    ids:   new Set(memberIdentitiesOf(ev)),
  }))

  for (let i = 0; i < prepared.length; i++) {
    const A = prepared[i]
    if (!A.ids.size) continue
    for (let j = i + 1; j < prepared.length; j++) {
      const B = prepared[j]
      if (!B.ids.size) continue
      if (!(A.start < B.end && B.start < A.end)) continue // pas de chevauchement

      const shared = []
      for (const id of A.ids) if (B.ids.has(id)) shared.push(id)
      if (!shared.length) continue

      if (!result.has(A.key)) result.set(A.key, [])
      if (!result.has(B.key)) result.set(B.key, [])
      result.get(A.key).push({ other: B.ev, sharedIdentities: shared })
      result.get(B.key).push({ other: A.ev, sharedIdentities: shared })
    }
  }

  return result
}

/**
 * Version spécialisée : retourne, parmi les autres événements, ceux qui
 * chevauchent `target` et partagent au moins un membre. Utile pour l'édition
 * d'un événement en cours (on veut juste savoir s'il crée un conflit).
 *
 * @param {Object} target - événement (potentiellement non sauvegardé)
 * @param {Array<Object>} others - autres événements (expanded)
 */
export function findConflictsForEvent(target, others) {
  if (!target) return []
  const targetIds = new Set(memberIdentitiesOf(target))
  if (!targetIds.size) return []
  const tStart = new Date(target.starts_at).getTime()
  const tEnd   = new Date(target.ends_at).getTime()
  const targetKey = eventKey(target)

  const out = []
  for (const ev of others || []) {
    if (eventKey(ev) === targetKey) continue
    const oStart = new Date(ev.starts_at).getTime()
    const oEnd   = new Date(ev.ends_at).getTime()
    if (!(tStart < oEnd && oStart < tEnd)) continue
    const evIds = memberIdentitiesOf(ev)
    const shared = evIds.filter((id) => targetIds.has(id))
    if (shared.length) out.push({ other: ev, sharedIdentities: shared })
  }
  return out
}

// ─── Vues multi-lentilles (PL-3.5) ───────────────────────────────────────────

/**
 * Kinds de vues supportés.
 * Les 3 premiers (calendar_*) sont livrés en Phase 1 (existants).
 * Les 4 autres seront livrés par paliers :
 *   timeline  → Gantt horizontal par lot/projet
 *   table     → tableau triable (Notion-like)
 *   kanban    → Board par type/statut/lot
 *   swimlanes → Swimlanes par membre (planning équipe)
 */
export const PLANNING_VIEW_KINDS = {
  calendar_month: {
    key:   'calendar_month',
    label: 'Mois',
    icon:  'Calendar',
    group: 'calendar',
    implemented: true,
  },
  calendar_week:  {
    key:   'calendar_week',
    label: 'Semaine',
    icon:  'CalendarDays',
    group: 'calendar',
    implemented: true,
  },
  calendar_day:   {
    key:   'calendar_day',
    label: 'Jour',
    icon:  'CalendarClock',
    group: 'calendar',
    implemented: true,
  },
  timeline:       {
    key:   'timeline',
    label: 'Timeline (Gantt)',
    icon:  'GanttChart',
    group: 'advanced',
    implemented: true,
  },
  table:          {
    key:   'table',
    label: 'Tableau',
    icon:  'Table2',
    group: 'advanced',
    implemented: true,
  },
  kanban:         {
    key:   'kanban',
    label: 'Kanban',
    icon:  'LayoutGrid',
    group: 'advanced',
    implemented: true,
  },
  swimlanes:      {
    key:   'swimlanes',
    label: 'Swimlanes équipe',
    icon:  'Rows3',
    group: 'advanced',
    implemented: true,
  },
}

export const PLANNING_VIEW_KINDS_LIST = Object.values(PLANNING_VIEW_KINDS)

/**
 * Presets PL-5 — configurations préenregistrées pour matérialiser les 4 vues
 * spécialisées décrites dans le roadmap §5.3 (Production / Prévisionnelle /
 * Tournage / Post-production).
 *
 * Pas de nouveaux composants : chaque preset est juste un tuple
 * { kind, config } qui réutilise l'infra PL-3.5. Les presets sont
 * proposés dans le menu "+" du sélecteur, comme des templates ; cliquer
 * crée une vue persistée avec cette config, que l'utilisateur peut
 * ensuite personnaliser librement (le preset n'est pas un lien vivant
 * vers une config centrale, c'est un point de départ).
 *
 * Les filtres utilisent `typeCategories` pour rester stables cross-org
 * (la catégorie est une valeur système ∈ {pre_prod, tournage, post_prod,
 * autre}, alors que les UUIDs type_id varient d'une org à l'autre).
 *
 * À noter :
 *   - "Prévisionnelle" est simplifiée : la notion "dates planifiées vs
 *     confirmées + écarts" nécessite une extension du modèle d'event
 *     (colonnes planned_* et confirmed_*). Pour l'instant on livre un
 *     tableau trié par starts_at ASC groupé par lot.
 *   - "Tournage" rattache aussi pre_prod (repérages, casting, essais)
 *     car dans le pipeline réel ces étapes précèdent directement le
 *     tournage et concernent la même équipe.
 *   - "Post-production" groupe par type pour que montage / étalonnage /
 *     mix / VFX / livraison se lisent en colonnes distinctes.
 */
export const PLANNING_VIEW_PRESETS = [
  {
    key:         'production_macro',
    label:       'Production',
    description: 'Timeline globale par lot, vue macro sur 90 jours',
    icon:        'GanttChart',
    kind:        'timeline',
    config: {
      filters: {
        typeIds: [], typeCategories: [], typeSlugs: [],
        lotIds: [], memberIds: [], statusMember: [], search: '',
      },
      groupBy: 'lot',
      sortBy:  { field: 'starts_at', direction: 'asc' },
      hiddenFields: [],
      showWeekends: true,
      windowDays:  90,
      zoomLevel:   'week',
      density:     'compact',
      showTodayLine: true,
    },
  },
  {
    key:         'previsionnel',
    label:       'Prévisionnelle',
    description: 'Tableau chronologique groupé par lot (plan vs confirmé : bientôt)',
    icon:        'Table2',
    kind:        'table',
    config: {
      filters: {
        typeIds: [], typeCategories: [], typeSlugs: [],
        lotIds: [], memberIds: [], statusMember: [], search: '',
      },
      groupBy: 'lot',
      sortBy:  { field: 'starts_at', direction: 'asc' },
      hiddenFields: [],
      showWeekends: true,
    },
  },
  {
    key:         'tournage_equipe',
    label:       'Tournage',
    description: 'Swimlanes équipe sur repérages, casting, essais et tournage',
    icon:        'Rows3',
    kind:        'swimlanes',
    config: {
      filters: {
        typeIds: [], typeSlugs: [],
        typeCategories: ['pre_prod', 'tournage'],
        lotIds: [], memberIds: [], statusMember: [], search: '',
      },
      groupBy: 'member',
      sortBy:  { field: 'starts_at', direction: 'asc' },
      hiddenFields: [],
      showWeekends: true,
      windowDays:  30,
      zoomLevel:   'day',
      density:     'comfortable',
      showTodayLine: true,
    },
  },
  {
    key:         'post_production',
    label:       'Post-production',
    description: 'Timeline des étapes post (montage, étalonnage, mix, VFX, livraison)',
    icon:        'GanttChart',
    kind:        'timeline',
    config: {
      filters: {
        typeIds: [], typeSlugs: [],
        typeCategories: ['post_prod'],
        lotIds: [], memberIds: [], statusMember: [], search: '',
      },
      groupBy: 'type',
      sortBy:  { field: 'starts_at', direction: 'asc' },
      hiddenFields: [],
      showWeekends: true,
      windowDays:  60,
      zoomLevel:   'week',
      density:     'comfortable',
      showTodayLine: true,
    },
  },
]

/** Lookup O(1) par clé de preset. */
export const PLANNING_VIEW_PRESETS_BY_KEY = Object.fromEntries(
  PLANNING_VIEW_PRESETS.map((p) => [p.key, p]),
)

/**
 * Presets pour PlanningGlobal (vue cross-projets à /planning).
 * Contrairement aux PLANNING_VIEW_PRESETS par projet, ces presets sont pensés
 * pour un usage multi-projets : agrégation, comparaison, plan macro org-wide.
 *
 * Notes de design :
 *   - `projectIds: []` = tous les projets visibles (par RLS). Les filtres
 *     sont laissés ouverts pour que chaque utilisateur puisse les préciser.
 *   - `groupBy: 'project'` n'est pas implémenté dans la v1 ; on utilise
 *     'lot' / 'type' / 'member' en attendant. Les vues globales se
 *     différencient surtout par windowDays/zoomLevel.
 *   - Ces presets sont cohérents avec PLANNING_VIEW_PRESETS_BY_KEY pour
 *     permettre à terme une unification (shape identique, scope différent).
 */
export const PLANNING_VIEW_PRESETS_GLOBAL = [
  {
    key:         'global_mois',
    label:       'Mois — tous projets',
    description: 'Calendrier mois avec tous les projets agrégés',
    icon:        'Calendar',
    kind:        'calendar_month',
    config: {
      filters: {
        typeIds: [], typeCategories: [], typeSlugs: [],
        lotIds: [], memberIds: [], statusMember: [],
        projectIds: [], search: '',
      },
      groupBy: null,
      sortBy:  { field: 'starts_at', direction: 'asc' },
      hiddenFields: [],
      showWeekends: true,
    },
  },
  {
    key:         'global_gantt_3m',
    label:       'Gantt 3 mois',
    description: 'Timeline par lot sur 90 jours, tous projets confondus',
    icon:        'GanttChart',
    kind:        'timeline',
    config: {
      filters: {
        typeIds: [], typeCategories: [], typeSlugs: [],
        lotIds: [], memberIds: [], statusMember: [],
        projectIds: [], search: '',
      },
      groupBy: 'lot',
      sortBy:  { field: 'starts_at', direction: 'asc' },
      hiddenFields: [],
      showWeekends: true,
      windowDays:  90,
      zoomLevel:   'week',
      density:     'compact',
      showTodayLine: true,
    },
  },
  {
    key:         'global_tournages',
    label:       'Tournages à venir',
    description: 'Timeline des tournages sur 60 jours (tous projets)',
    icon:        'GanttChart',
    kind:        'timeline',
    config: {
      filters: {
        typeIds: [], typeSlugs: [],
        typeCategories: ['tournage'],
        lotIds: [], memberIds: [], statusMember: [],
        projectIds: [], search: '',
      },
      groupBy: 'member',
      sortBy:  { field: 'starts_at', direction: 'asc' },
      hiddenFields: [],
      showWeekends: true,
      windowDays:  60,
      zoomLevel:   'day',
      density:     'comfortable',
      showTodayLine: true,
    },
  },
  {
    key:         'global_kanban_type',
    label:       'Kanban par type',
    description: 'Kanban multi-projets groupé par type d\u2019événement',
    icon:        'Kanban',
    kind:        'kanban',
    config: {
      filters: {
        typeIds: [], typeCategories: [], typeSlugs: [],
        lotIds: [], memberIds: [], statusMember: [],
        projectIds: [], search: '',
      },
      groupBy: 'type',
      sortBy:  { field: 'starts_at', direction: 'asc' },
      hiddenFields: [],
      showWeekends: true,
    },
  },
]

/** Lookup O(1) par clé de preset global. */
export const PLANNING_VIEW_PRESETS_GLOBAL_BY_KEY = Object.fromEntries(
  PLANNING_VIEW_PRESETS_GLOBAL.map((p) => [p.key, p]),
)

/**
 * Retourne la config par défaut pour un kind donné.
 * Shape non strict — les champs inconnus sont conservés tels quels.
 */
export function defaultViewConfig(kind) {
  const base = {
    filters: {
      typeIds: [],
      typeCategories: [],
      typeSlugs: [],
      lotIds: [],
      memberIds: [],
      statusMember: [],
      // Filtre par projet (PG-3). N'a d'effet que pour les vues où les events
      // peuvent venir de plusieurs projets (typiquement PlanningGlobal). Au
      // niveau d'un PlanningTab de projet, tous les events ont le même
      // project_id donc ce filtre est neutre.
      projectIds: [],
      search: '',
    },
    groupBy: null,
    sortBy:  { field: 'starts_at', direction: 'asc' },
    hiddenFields: [],
    showWeekends: true,
  }
  if (kind === 'kanban') return { ...base, groupBy: 'type' }
  if (kind === 'swimlanes') return { ...base, groupBy: 'member' }
  if (kind === 'table') return { ...base, sortBy: { field: 'starts_at', direction: 'asc' } }
  if (kind === 'timeline') return {
    ...base,
    groupBy: 'lot',
    windowDays: 30,
    zoomLevel: 'day',          // 'day' | 'week' | 'month'
    density: 'comfortable',    // 'comfortable' | 'compact'
    showTodayLine: true,
  }
  return base
}

/**
 * Vues "builtin" utilisées comme fallback tant qu'aucune vue DB n'existe.
 * Exposées au front pour permettre un rendu instantané à l'ouverture du
 * planning d'un projet vierge.
 *
 * Les ids sont préfixés `builtin:` pour ne pas entrer en collision avec des
 * UUIDs DB et pour signaler qu'elles ne sont pas modifiables (clone requis).
 */
export const BUILTIN_PLANNING_VIEWS = [
  {
    id: 'builtin:calendar_month',
    name: 'Mois',
    kind: 'calendar_month',
    icon: 'Calendar',
    sort_order: 10,
    is_default: true,
    is_shared: true,
    _builtin: true,
    config: defaultViewConfig('calendar_month'),
  },
  {
    id: 'builtin:calendar_week',
    name: 'Semaine',
    kind: 'calendar_week',
    icon: 'CalendarDays',
    sort_order: 20,
    is_default: false,
    is_shared: true,
    _builtin: true,
    config: defaultViewConfig('calendar_week'),
  },
  {
    id: 'builtin:calendar_day',
    name: 'Jour',
    kind: 'calendar_day',
    icon: 'CalendarClock',
    sort_order: 30,
    is_default: false,
    is_shared: true,
    _builtin: true,
    config: defaultViewConfig('calendar_day'),
  },
]

/**
 * Liste les vues planning accessibles pour un projet donné.
 * - Scope strictement **projet** : on ne remonte QUE les vues de `project_id`.
 *   Les vues globales (project_id NULL) vivent sur `/planning` depuis PG-4 et
 *   ne doivent pas polluer la liste des vues projet (sinon : doublons
 *   « Mois + Mois », « Jour + Jour », etc. quand l'utilisateur a déjà créé
 *   des vues globales de même nom via /planning — régression 2026-04-19).
 * - Le RLS filtre déjà les vues privées (seul le créateur les voit).
 * - Si aucune vue DB n'existe pour le projet, renvoie les BUILTIN_PLANNING_VIEWS
 *   (Mois / Semaine / Jour non persistés ; la première personnalisation
 *   déclenche une création DB côté appelant via createPlanningView).
 *
 * @param {string} projectId
 * @returns {Promise<Array<Object>>}
 */
export async function listPlanningViews(projectId) {
  if (!projectId) return [...BUILTIN_PLANNING_VIEWS]
  const { data, error } = await supabase
    .from('planning_views')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  const list = data || []
  // Aucune vue DB pour ce projet → fallback builtin (non persisté).
  if (list.length === 0) return [...BUILTIN_PLANNING_VIEWS]
  return list
}

/**
 * Liste les vues planning globales de l'org (scope=global, project_id NULL).
 * Utilisé par PlanningGlobal (vue cross-projets à /planning).
 * Si aucune vue globale DB n'existe, renvoie les BUILTIN_PLANNING_VIEWS.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function listGlobalPlanningViews() {
  const { data, error } = await supabase
    .from('planning_views')
    .select('*')
    .is('project_id', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  const list = data || []
  // Aucune vue globale en DB → fallback builtin (non persisté ; la première
  // personnalisation crée la vue en DB côté appelant).
  if (list.length === 0) return [...BUILTIN_PLANNING_VIEWS]
  return list
}

/**
 * Crée une nouvelle vue pour un projet ou globale.
 * - `project_id` peut être `null` pour une vue globale (scope org).
 * - `is_shared` par défaut à true (visible par toute l'org).
 * - `config` fusionné avec la config par défaut du kind pour éviter les trous.
 *
 * @param {Object} payload
 * @param {string|null} payload.project_id  null = vue globale
 * @param {string} payload.org_id
 * @param {string} payload.name
 * @param {string} payload.kind
 * @param {Object} [payload.config]
 * @param {string} [payload.icon]
 * @param {string} [payload.color]
 * @param {boolean} [payload.is_default]
 * @param {boolean} [payload.is_shared]
 * @param {number}  [payload.sort_order]
 */
export async function createPlanningView(payload) {
  // project_id est nullable (scope global), mais doit être présent dans le payload
  // pour distinguer "vue globale" (null explicite) d'"oubli" (undefined).
  if (!('project_id' in (payload || {}))) throw new Error('project_id requis (null pour vue globale)')
  if (!payload?.org_id)     throw new Error('org_id requis')
  if (!payload?.kind || !PLANNING_VIEW_KINDS[payload.kind]) {
    throw new Error(`kind invalide: ${payload?.kind}`)
  }
  const row = {
    org_id:     payload.org_id,
    project_id: payload.project_id ?? null,
    name:       payload.name || PLANNING_VIEW_KINDS[payload.kind].label,
    kind:       payload.kind,
    config:     { ...defaultViewConfig(payload.kind), ...(payload.config || {}) },
    icon:       payload.icon || PLANNING_VIEW_KINDS[payload.kind].icon || null,
    color:      payload.color || null,
    sort_order: Number.isFinite(payload.sort_order) ? payload.sort_order : 100,
    is_default: Boolean(payload.is_default),
    is_shared:  payload.is_shared !== false, // true par défaut
  }
  const { data, error } = await supabase
    .from('planning_views')
    .insert([row])
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour une vue existante. `config` est remplacée (pas mergée) si fournie.
 * Utiliser `patchPlanningViewConfig` pour un merge partiel.
 */
export async function updatePlanningView(id, patch) {
  if (!id) throw new Error('id requis')
  if (typeof id === 'string' && id.startsWith('builtin:')) {
    throw new Error('Vue built-in non modifiable — dupliquez-la d\u2019abord')
  }
  const { data, error } = await supabase
    .from('planning_views')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Merge partiel de la config d'une vue (évite les écrasements accidentels).
 * Lit la vue actuelle, merge superficiel sur config, puis update.
 */
export async function patchPlanningViewConfig(id, configPatch) {
  if (!id) throw new Error('id requis')
  const { data: current, error: readErr } = await supabase
    .from('planning_views')
    .select('config')
    .eq('id', id)
    .single()
  if (readErr) throw readErr
  const merged = { ...(current?.config || {}), ...(configPatch || {}) }
  return updatePlanningView(id, { config: merged })
}

/**
 * Supprime une vue. Les vues built-in ne peuvent pas être supprimées (stub).
 */
export async function deletePlanningView(id) {
  if (!id) throw new Error('id requis')
  if (typeof id === 'string' && id.startsWith('builtin:')) {
    throw new Error('Vue built-in non supprimable')
  }
  const { error } = await supabase
    .from('planning_views')
    .delete()
    .eq('id', id)
  if (error) throw error
  return true
}

/**
 * Duplique une vue (DB ou built-in) vers une nouvelle vue DB.
 * Le champ `is_default` est toujours mis à false sur la copie.
 * Pour les built-ins, on réutilise le payload tel quel ; pour les vues DB,
 * on lit la source et on recrée une nouvelle ligne.
 *
 * @param {Object} source - vue source (objet planning_view ou builtin)
 * @param {Object} overrides - champs à surcharger (project_id, org_id, name, ...)
 */
export async function duplicatePlanningView(source, overrides = {}) {
  if (!source) throw new Error('source requise')
  // Utiliser 'in' plutôt que ?? pour permettre un override explicite à null
  // (ex. duplicate builtin vers global : { project_id: null }).
  const payload = {
    project_id: 'project_id' in overrides ? overrides.project_id : (source.project_id ?? null),
    org_id:     overrides.org_id     ?? source.org_id,
    name:       overrides.name       ?? `${source.name || PLANNING_VIEW_KINDS[source.kind]?.label || 'Vue'} (copie)`,
    kind:       source.kind,
    config:     { ...(source.config || {}) },
    icon:       source.icon || null,
    color:      source.color || null,
    sort_order: Number.isFinite(overrides.sort_order) ? overrides.sort_order : 100,
    is_default: false,
    is_shared:  overrides.is_shared ?? source.is_shared ?? true,
  }
  return createPlanningView(payload)
}

/**
 * Marque une vue comme défaut (le trigger DB s'occupe d'unset les autres).
 */
export async function setPlanningViewAsDefault(id) {
  return updatePlanningView(id, { is_default: true })
}

/**
 * Seede les 3 vues calendrier par défaut pour un projet.
 * Utilise la fonction SQL `seed_default_planning_views_for_project(uuid)`.
 * Idempotent : ne crée rien si le projet a déjà au moins une vue.
 */
export async function seedDefaultPlanningViewsForProject(projectId) {
  if (!projectId) throw new Error('projectId requis')
  const { error } = await supabase.rpc('seed_default_planning_views_for_project', {
    p_project_id: projectId,
  })
  if (error) throw error
  return true
}

// ─── Filtres & groupement (PL-3.5 étape 2) ───────────────────────────────────

/**
 * Normalise un texte pour recherche insensible casse / accents.
 * Usage interne (search plein texte sur title/description).
 */
function normalizeSearch(s) {
  if (!s) return ''
  try {
    return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  } catch {
    return String(s).toLowerCase()
  }
}

/**
 * Applique les filtres d'une config de vue à une liste d'événements.
 * Fonction pure — n'accède pas à la DB. Tous les filtres sont en AND.
 *
 * Filtres supportés (tous optionnels, vide/null = pas de restriction) :
 *   - typeIds        : string[] — type_id exact (UUIDs)
 *   - typeCategories : string[] — ev.type.category ∈ {'pre_prod','tournage',
 *                                 'post_prod','autre'}. Utile pour les presets
 *                                 PL-5 (configs stables cross-org).
 *   - typeSlugs      : string[] — ev.type.slug (ex. 'tournage', 'montage').
 *                                 Plus fin que typeCategories ; utile pour
 *                                 cibler des types système précis.
 *   - lotIds         : string[] — lot_id exact (inclut null si 'none' est présent)
 *   - memberIds      : string[] — identités (`p:<uuid>` ou `c:<uuid>`), OR entre elles
 *   - statusMember   : string[] — statuts de convocation ('pending', ...), OR entre eux.
 *                                 Un event matche si au moins un membre a ce statut.
 *   - search         : string   — plein texte sur title + description (insensible)
 *
 * typeIds / typeCategories / typeSlugs sont additifs (OR) entre eux puis AND
 * avec le reste. Un event matche "le bloc type" s'il est dans typeIds OU si
 * sa catégorie est dans typeCategories OU si son slug est dans typeSlugs.
 * Ça permet de combiner un preset de catégorie ("tous les post_prod") avec
 * l'ajout d'un type spécifique ("+ les Réunions") sans filtre négatif.
 *
 * @param {Array<Object>} events - événements (éventuellement déjà expansés)
 * @param {Object}        config - view.config
 * @returns {Array<Object>} événements filtrés (même ordre)
 */
export function filterEventsByConfig(events, config) {
  const list = Array.isArray(events) ? events : []
  const filters = config?.filters || {}

  const typeIds        = Array.isArray(filters.typeIds) ? filters.typeIds : []
  const typeCategories = Array.isArray(filters.typeCategories) ? filters.typeCategories : []
  const typeSlugs      = Array.isArray(filters.typeSlugs) ? filters.typeSlugs : []
  const lotIds         = Array.isArray(filters.lotIds) ? filters.lotIds : []
  const memberIds      = Array.isArray(filters.memberIds) ? filters.memberIds : []
  const statuses       = Array.isArray(filters.statusMember) ? filters.statusMember : []
  const projectIds     = Array.isArray(filters.projectIds) ? filters.projectIds : []
  const search         = normalizeSearch(filters.search || '')

  // Tous les filtres sont "no-op" si leur liste est vide (ou search vide).
  const hasTypeIdFilter  = typeIds.length > 0
  const hasTypeCatFilter = typeCategories.length > 0
  const hasTypeSlugFilter = typeSlugs.length > 0
  // Un filtre "type" est actif si l'un des 3 sous-filtres est non vide.
  const hasAnyTypeFilter = hasTypeIdFilter || hasTypeCatFilter || hasTypeSlugFilter
  const hasLotFilter    = lotIds.length > 0
  const hasMemberFilter = memberIds.length > 0
  const hasStatusFilter = statuses.length > 0
  const hasProjectFilter = projectIds.length > 0
  const hasSearch       = search.length > 0

  if (
    !hasAnyTypeFilter &&
    !hasLotFilter &&
    !hasMemberFilter &&
    !hasStatusFilter &&
    !hasProjectFilter &&
    !hasSearch
  ) {
    return list
  }

  const typeIdSet   = new Set(typeIds)
  const typeCatSet  = new Set(typeCategories)
  const typeSlugSet = new Set(typeSlugs)
  const lotSet     = new Set(lotIds)
  const memberSet  = new Set(memberIds)
  const statusSet  = new Set(statuses)
  const projectSet = new Set(projectIds)
  // Convention : '__none__' dans lotIds = événements sans lot (lot_id null).
  const includeNullLot = lotSet.has('__none__')

  return list.filter((ev) => {
    if (hasProjectFilter) {
      // project_id est toujours défini (NOT NULL en base). On cherche soit sur
      // ev.project_id, soit sur ev.project?.id si la relation a été expansée
      // (listEventsAcrossOrg fait l'un OU l'autre selon la colonne DB).
      const projectId = ev.project_id ?? ev.project?.id ?? null
      if (!projectId || !projectSet.has(projectId)) return false
    }

    if (hasAnyTypeFilter) {
      // OR entre les 3 sous-filtres type : un match sur n'importe lequel suffit.
      const matchId   = hasTypeIdFilter   && typeIdSet.has(ev.type_id)
      const matchCat  = hasTypeCatFilter  && typeCatSet.has(ev.type?.category)
      const matchSlug = hasTypeSlugFilter && typeSlugSet.has(ev.type?.slug)
      if (!matchId && !matchCat && !matchSlug) return false
    }

    if (hasLotFilter) {
      if (ev.lot_id == null) {
        if (!includeNullLot) return false
      } else if (!lotSet.has(ev.lot_id)) {
        return false
      }
    }

    if (hasMemberFilter) {
      const ids = memberIdentitiesOf(ev)
      if (!ids.some((id) => memberSet.has(id))) return false
    }

    if (hasStatusFilter) {
      const members = ev.members || []
      if (!members.some((m) => statusSet.has(m.status))) return false
    }

    if (hasSearch) {
      const hay = normalizeSearch(`${ev.title || ''} ${ev.description || ''}`)
      if (!hay.includes(search)) return false
    }

    return true
  })
}

/**
 * Clés de groupement supportées.
 * Retournée sous forme de tableau pour alimenter un `<select>` simple.
 */
export const GROUP_BY_OPTIONS = [
  { key: null,         label: 'Aucun groupement' },
  { key: 'type',       label: 'Par type d\u2019événement' },
  { key: 'lot',        label: 'Par lot' },
  { key: 'member',     label: 'Par membre convoqué' },
  { key: 'status',     label: 'Par statut de convocation' },
  { key: 'location',   label: 'Par lieu' },
]

/**
 * Map groupBy → nom du champ events.* à muter lorsqu'une carte est déplacée
 * d'une colonne à une autre dans la vue Kanban.
 *
 * Un groupBy absent de cette map = colonnes non droppables (ex. 'member',
 * 'status' — mutation à travers event_members, hors scope drag&drop simple).
 * Pour 'lot'/'location', on autorise aussi la valeur `__null__` côté UI,
 * que le handler convertit en `null` avant l'update.
 */
export const GROUP_BY_FIELD_MAP = {
  type:     'type_id',
  lot:      'lot_id',
  location: 'location_id',
}

/**
 * Groupe les événements selon `config.groupBy`.
 * Utilisé par les vues table/kanban/swimlanes (step futur) ; exposé dès
 * maintenant pour les tests et pour permettre un affichage enrichi des
 * vues calendrier (ex. légende dynamique).
 *
 * Retourne Map<groupKey, Event[]>. `groupKey` est soit l'id (ex: type_id),
 * soit '__null__' pour les événements sans groupe.
 * Pour groupBy='member', un même event peut apparaître dans plusieurs
 * buckets (un par membre convoqué) — c'est le mode swimlanes.
 */
export function groupEventsByConfig(events, config) {
  const list = Array.isArray(events) ? events : []
  const groupBy = config?.groupBy || null
  const out = new Map()

  if (!groupBy) {
    out.set('__all__', list)
    return out
  }

  for (const ev of list) {
    if (groupBy === 'type') {
      const k = ev.type_id || '__null__'
      if (!out.has(k)) out.set(k, [])
      out.get(k).push(ev)
    } else if (groupBy === 'lot') {
      const k = ev.lot_id || '__null__'
      if (!out.has(k)) out.set(k, [])
      out.get(k).push(ev)
    } else if (groupBy === 'location') {
      const k = ev.location_id || '__null__'
      if (!out.has(k)) out.set(k, [])
      out.get(k).push(ev)
    } else if (groupBy === 'status') {
      // On groupe par statut dominant sur l'événement :
      //   confirmed > tentative > pending > declined > (aucun membre)
      const members = ev.members || []
      if (!members.length) {
        if (!out.has('__null__')) out.set('__null__', [])
        out.get('__null__').push(ev)
        continue
      }
      const ranks = { confirmed: 4, tentative: 3, pending: 2, declined: 1 }
      let best = null
      let bestRank = -1
      for (const m of members) {
        const r = ranks[m.status] || 0
        if (r > bestRank) { best = m.status; bestRank = r }
      }
      const k = best || '__null__'
      if (!out.has(k)) out.set(k, [])
      out.get(k).push(ev)
    } else if (groupBy === 'member') {
      const ids = memberIdentitiesOf(ev)
      if (!ids.length) {
        if (!out.has('__null__')) out.set('__null__', [])
        out.get('__null__').push(ev)
        continue
      }
      for (const id of ids) {
        if (!out.has(id)) out.set(id, [])
        out.get(id).push(ev)
      }
    } else {
      // groupBy inconnu → on retombe sur '__all__'
      if (!out.has('__all__')) out.set('__all__', [])
      out.get('__all__').push(ev)
    }
  }
  return out
}

// ─── Tri des événements (Table view — PL-3.5 étape 3) ────────────────────────

/**
 * Champs triables exposés dans la table view. Clé = champ logique, value =
 * libellé UI. La correspondance vers la valeur triable est gérée par
 * `eventSortValue` ci-dessous pour éviter de dupliquer la logique.
 */
export const SORTABLE_EVENT_FIELDS = [
  { key: 'title',        label: 'Titre' },
  { key: 'type',         label: 'Type' },
  { key: 'starts_at',    label: 'Début' },
  { key: 'ends_at',      label: 'Fin' },
  { key: 'duration',     label: 'Durée' },
  { key: 'lot',          label: 'Lot' },
  { key: 'location',     label: 'Lieu' },
  { key: 'member_count', label: 'Nb équipe' },
]

/**
 * Retourne la valeur triable d'un événement pour un champ donné.
 * Les maps passées en context permettent de résoudre les relations
 * (type_id → label, lot_id → title, location_id → name).
 *
 * Retourne `null` ou `''` pour les valeurs manquantes — la fonction
 * de tri les placera toujours après les valeurs présentes.
 */
export function eventSortValue(event, field, context = {}) {
  if (!event) return null
  switch (field) {
    case 'starts_at':
      return new Date(event.starts_at).getTime()
    case 'ends_at':
      return new Date(event.ends_at).getTime()
    case 'title':
      return (event.title || '').toLowerCase()
    case 'duration':
      return new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()
    case 'type': {
      const m = context.typeMap || {}
      return ((m[event.type_id]?.label) || '').toLowerCase()
    }
    case 'lot': {
      const m = context.lotMap || {}
      return ((m[event.lot_id]?.title) || '').toLowerCase()
    }
    case 'location': {
      const m = context.locationMap || {}
      return ((m[event.location_id]?.name) || '').toLowerCase()
    }
    case 'member_count':
      return (event.members || []).filter((mb) => mb.status !== 'declined').length
    default:
      return null
  }
}

/**
 * Tri stable d'un tableau d'événements selon un champ + direction.
 * Les valeurs absentes (null/'' / NaN) sont toujours placées en bas,
 * indépendamment de la direction (comportement Notion-like).
 *
 * @param {Array<Object>} events
 * @param {Object}        sortBy  - { field, direction: 'asc'|'desc' }
 * @param {Object}        [context] - { typeMap, lotMap, locationMap }
 * @returns {Array<Object>} nouveau tableau trié
 */
export function sortEventsByField(events, sortBy, context = {}) {
  const list = Array.isArray(events) ? [...events] : []
  if (!list.length || !sortBy?.field) return list
  const { field, direction = 'asc' } = sortBy
  const mult = direction === 'desc' ? -1 : 1

  // Décoration : pré-calcul pour éviter de retrier à chaque comparaison
  // + préservation de l'ordre original pour les égalités (tri stable).
  const decorated = list.map((ev, idx) => ({
    ev,
    idx,
    v: eventSortValue(ev, field, context),
  }))

  decorated.sort((a, b) => {
    const av = a.v
    const bv = b.v
    const aMissing = av === null || av === undefined || av === '' || Number.isNaN(av)
    const bMissing = bv === null || bv === undefined || bv === '' || Number.isNaN(bv)
    if (aMissing && bMissing) return a.idx - b.idx
    if (aMissing) return 1
    if (bMissing) return -1
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * mult || a.idx - b.idx
    }
    const cmp = String(av).localeCompare(String(bv))
    return cmp * mult || a.idx - b.idx
  })

  return decorated.map((d) => d.ev)
}

/**
 * Formate une durée (ms) en texte compact "1j 2h", "45min", "2h 30min", "3j".
 * Exposé ici car utilisé par la table view et potentiellement par le PDF.
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const totalMin = Math.round(ms / 60000)
  const days = Math.floor(totalMin / (60 * 24))
  const rest = totalMin - days * 60 * 24
  const hours = Math.floor(rest / 60)
  const minutes = rest - hours * 60
  const parts = []
  if (days) parts.push(`${days}j`)
  if (hours) parts.push(`${hours}h`)
  if (minutes && !days) parts.push(`${minutes}min`)
  return parts.join(' ') || '—'
}

// ─── Timeline / Gantt (PL-3.5 étape 5) ───────────────────────────────────────

/**
 * Packe un ensemble d'événements dans le minimum de "sub-rows" (lanes
 * internes) telles que deux événements d'une même sub-row ne se chevauchent
 * jamais. Algo classique "first-fit" après tri par starts_at : pour chaque
 * événement, on cherche la première sub-row dont le dernier event se
 * termine avant/pile au début de celui-ci ; sinon on ouvre une nouvelle row.
 *
 * La tolérance de 1ms d'écart évite les faux-négatifs de chevauchement sur
 * des événements adjacents (ex. un event finit à 10:00 pile quand le suivant
 * démarre à 10:00 — on ne veut pas les empiler sur deux rows).
 *
 * @param {Array<Object>} events
 * @returns {Array<Array<Object>>} — tableau de sub-rows, chacune triée par
 *   starts_at croissant.
 */
export function packEventIntervals(events) {
  const list = Array.isArray(events) ? events : []
  if (!list.length) return []
  const sorted = [...list].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  )
  const rows = [] // Array<{ lastEnd: number, events: Event[] }>
  for (const ev of sorted) {
    const start = new Date(ev.starts_at).getTime()
    const end   = new Date(ev.ends_at).getTime()
    let placed = false
    for (const row of rows) {
      if (row.lastEnd <= start) {
        row.events.push(ev)
        row.lastEnd = end
        placed = true
        break
      }
    }
    if (!placed) {
      rows.push({ lastEnd: end, events: [ev] })
    }
  }
  return rows.map((r) => r.events)
}

/**
 * Niveaux de zoom temporel pour la timeline / Gantt.
 * `dayWidth` = largeur d'une colonne "jour" en pixels à ce niveau de zoom.
 *
 * Au zoom 'month', la colonne fait 6px → on ne peut plus afficher de libellé
 * par jour ; le header bascule sur une bande hebdo / mensuelle (cf. vue).
 */
export const TIMELINE_ZOOMS = {
  day:   { key: 'day',   label: 'Jour',    dayWidth: 40 },
  week:  { key: 'week',  label: 'Semaine', dayWidth: 14 },
  month: { key: 'month', label: 'Mois',    dayWidth: 6  },
}

export const TIMELINE_ZOOM_ORDER = ['day', 'week', 'month']

/**
 * Densités de lignes (sub-rows) de la timeline.
 * `rowHeight` est la hauteur en pixels d'une sub-row dans une lane.
 */
export const TIMELINE_DENSITIES = {
  comfortable: { key: 'comfortable', label: 'Confortable', rowHeight: 30 },
  compact:     { key: 'compact',     label: 'Compact',     rowHeight: 22 },
}

/**
 * Durée ≤ à laquelle un événement est affiché sous forme de losange (jalon)
 * plutôt qu'une barre. Calé sur 5h : en dessous, la barre reste trop étroite
 * aux zooms semaine/mois pour être lisible — un losange marque la date de
 * façon plus claire.
 */
export const TIMELINE_MILESTONE_MAX_MS = 5 * 60 * 60 * 1000 // 5h

/**
 * Retourne true si `event` doit être rendu comme un jalon (milestone)
 * plutôt qu'une barre classique dans la timeline.
 */
export function isMilestone(event) {
  if (!event) return false
  const s = new Date(event.starts_at).getTime()
  const e = new Date(event.ends_at).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false
  return (e - s) <= TIMELINE_MILESTONE_MAX_MS
}

/**
 * Construit la structure de layout d'une timeline.
 * Groupe par `config.groupBy` (reprise de groupEventsByConfig) puis,
 * pour chaque groupe, packe les événements en sub-rows via
 * `packEventIntervals` pour éviter les chevauchements visuels.
 *
 * Note : le bucket '__null__' (événements sans groupe) est toujours
 * renvoyé en dernier ; les autres groupes restent dans l'ordre
 * d'apparition (à charge du caller de trier les labels si besoin).
 *
 * @param {Array<Object>} events   — événements pré-filtrés par le parent
 * @param {Object}        config   — { groupBy: 'lot' | 'type' | 'location' | ... }
 * @returns {Array<{ key: string, events: Event[], rows: Event[][] }>}
 */
export function layoutTimelineLanes(events, config) {
  const list = Array.isArray(events) ? events : []
  const groupBy = config?.groupBy || null
  const grouped = groupEventsByConfig(list, { groupBy })

  const lanes = []
  for (const [key, groupEvents] of grouped.entries()) {
    lanes.push({
      key,
      events: groupEvents,
      rows: packEventIntervals(groupEvents),
    })
  }
  // Stabilité d'affichage : "__null__" en fin de liste, le reste selon
  // l'ordre d'insertion (à surcharger côté vue avec le label résolu).
  lanes.sort((a, b) => {
    if (a.key === b.key) return 0
    if (a.key === '__null__') return 1
    if (b.key === '__null__') return -1
    return 0
  })
  return lanes
}

/**
 * layoutMonthBars — Calcule le layout des "barres" multi-jours dans une grille
 * mensuelle 6×7.
 *
 * Objectif : rendre un événement qui couvre plusieurs jours comme une SEULE
 * barre continue (même si le rendu se fait ligne par ligne — une barre par
 * semaine traversée, avec `continuesLeft` / `continuesRight` pour signaler la
 * coupe visuelle).
 *
 * Entrées :
 *   - cells    : tableau de 42 Date (00:00 local), issu de getMonthGrid()
 *   - events   : événements bruts (shape EVENT_SELECT, avec `starts_at` /
 *                `ends_at` ISO et, optionnellement, `_occurrence_key`)
 *   - maxLanes : nb max de barres empilées par semaine (overflow sinon)
 *
 * Sortie : tableau de 6 objets { rowIdx, bars, overflowByCol } où :
 *   - rowIdx        : 0..5 (numéro de semaine dans la grille)
 *   - bars          : [{ event, laneIndex, startCol (0..6), endCol (0..6),
 *                       continuesLeft, continuesRight }]
 *   - overflowByCol : number[7] → nombre d'événements masqués par jour
 *
 * Algo : greedy lane packing par semaine. Tri des segments par startCol
 * (gauche → droite), puis par durée descendante (longues barres en premier
 * pour stabilité), puis par date d'origine. Pour chaque segment, on cherche
 * la première lane libre ; si toutes les `maxLanes` sont occupées, on
 * incrémente `overflowByCol[col]` pour chaque colonne couverte.
 *
 * Pur : ne mute rien, ne touche pas au DOM.
 */
export function layoutMonthBars(cells, events, maxLanes = 3) {
  const safeCells = Array.isArray(cells) ? cells : []
  const safeEvents = Array.isArray(events) ? events : []
  if (safeCells.length < 42) {
    // Grille incomplète → on retourne 6 rows vides plutôt que crasher
    const rows = []
    for (let r = 0; r < 6; r += 1) {
      rows.push({ rowIdx: r, bars: [], overflowByCol: [0, 0, 0, 0, 0, 0, 0] })
    }
    return rows
  }

  // Normalisation : pour chaque event, calcule startDay & endDay (00:00 local)
  const norm = []
  for (const ev of safeEvents) {
    if (!ev?.starts_at || !ev?.ends_at) continue
    const s = new Date(ev.starts_at)
    const e = new Date(ev.ends_at)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue
    const sDay = new Date(s.getFullYear(), s.getMonth(), s.getDate())
    const eDay = new Date(e.getFullYear(), e.getMonth(), e.getDate())
    norm.push({ event: ev, startDay: sDay, endDay: eDay, startTs: s.getTime() })
  }

  const rows = []
  for (let r = 0; r < 6; r += 1) {
    const rowStart = safeCells[r * 7]
    const rowEnd = safeCells[r * 7 + 6]
    const rowStartMs = rowStart.getTime()
    const rowEndMs = rowEnd.getTime()

    // Segments traversant la semaine
    const segments = []
    for (const n of norm) {
      const sMs = n.startDay.getTime()
      const eMs = n.endDay.getTime()
      if (eMs < rowStartMs || sMs > rowEndMs) continue
      // Col indices : 0..6 inclus
      const startColRaw = Math.round((Math.max(sMs, rowStartMs) - rowStartMs) / 86400000)
      const endColRaw   = Math.round((Math.min(eMs, rowEndMs)   - rowStartMs) / 86400000)
      const startCol = Math.max(0, Math.min(6, startColRaw))
      const endCol   = Math.max(0, Math.min(6, endColRaw))
      segments.push({
        event: n.event,
        startCol,
        endCol,
        continuesLeft: sMs < rowStartMs,
        continuesRight: eMs > rowEndMs,
        startTs: n.startTs,
      })
    }

    // Tri déterministe : d'abord colonne de départ (gauche → droite),
    // puis longueur décroissante (barres longues packées tôt),
    // puis date absolue croissante pour stabilité.
    segments.sort((a, b) => {
      if (a.startCol !== b.startCol) return a.startCol - b.startCol
      const la = a.endCol - a.startCol
      const lb = b.endCol - b.startCol
      if (la !== lb) return lb - la
      return a.startTs - b.startTs
    })

    // Greedy lane packing
    const lanesEnd = [] // lanesEnd[i] = endCol de la dernière barre posée dans la lane i
    const bars = []
    const overflowByCol = [0, 0, 0, 0, 0, 0, 0]
    for (const seg of segments) {
      let lane = -1
      for (let i = 0; i < lanesEnd.length; i += 1) {
        if (lanesEnd[i] < seg.startCol) {
          lane = i
          break
        }
      }
      if (lane === -1) {
        if (lanesEnd.length < maxLanes) {
          lane = lanesEnd.length
          lanesEnd.push(-1)
        } else {
          // Overflow : on comptabilise chaque jour couvert
          for (let c = seg.startCol; c <= seg.endCol; c += 1) {
            overflowByCol[c] = (overflowByCol[c] || 0) + 1
          }
          continue
        }
      }
      lanesEnd[lane] = seg.endCol
      bars.push({
        event: seg.event,
        laneIndex: lane,
        startCol: seg.startCol,
        endCol: seg.endCol,
        continuesLeft: seg.continuesLeft,
        continuesRight: seg.continuesRight,
      })
    }

    rows.push({ rowIdx: r, bars, overflowByCol })
  }

  return rows
}
