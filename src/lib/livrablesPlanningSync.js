// ════════════════════════════════════════════════════════════════════════════
// livrablesPlanningSync.js — Sync bidirectionnelle LIV ↔ planning (LIV-4)
// ════════════════════════════════════════════════════════════════════════════
//
// **Principe fondateur** (roadmap §4.3) :
//   - L'étape (ou la phase projet) est PROPRIÉTAIRE.
//   - L'event planning est une PROJECTION identifiée par
//     `events.source in ('livrable_etape', 'projet_phase')` + FK
//     `livrable_etape_id` / `projet_phase_id`.
//   - Le lien est stocké dans les DEUX sens :
//       étape.event_id → events.id
//       events.livrable_etape_id → étape.id (UNIQUE)
//     Idem phases.
//
// **Contrat d'appel** :
//   - Forward (LIV → planning) : `livrables.js` appelle `syncEtapeOnCreate`,
//     `syncEtapeOnUpdate`, `syncEtapeOnDelete` (et pendants phases) dans ses
//     mutations. Ce module fait la tambouille events.
//   - Reverse (planning → LIV) : le planning détecte
//     `event.source === 'livrable_etape'`, utilise `eventPatchToEtapePatch` et
//     route vers `updateEtape`. La sync forward re-sync l'event en retour.
//
// **Suppression** :
//   - Étape supprimée → event miroir supprimé AVANT (sinon le CHECK
//     `events_source_fk_consistency` vs ON DELETE SET NULL fait violation).
//   - Event supprimé depuis le planning → étape conservée, `event_id`
//     nullifié automatiquement (FK ON DELETE SET NULL sur étape.event_id).
//     Pas d'action requise côté LIV.
//
// **Convention events all_day** (cf. migration PL-1 + ical.test.js) :
//   - starts_at = `date_debut + 'T00:00:00Z'`
//   - ends_at   = `date_fin+1jour + 'T00:00:00Z'` (exclusive)
//   - all_day   = true
//   Les conversions sont faites par les helpers purs plus bas.
//
// Tous les helpers purs sont testables sans Supabase (cf.
// `livrablesPlanningSync.test.js`). Les fonctions I/O sont séparées.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import { LIVRABLE_ETAPE_KINDS, PROJET_PHASE_KINDS } from './livrablesHelpers'

// ═══ Constantes ═══════════════════════════════════════════════════════════

export const EVENT_SOURCE_MANUAL         = 'manual'
export const EVENT_SOURCE_LIVRABLE_ETAPE = 'livrable_etape'
export const EVENT_SOURCE_PROJET_PHASE   = 'projet_phase'

/**
 * Champs d'une étape qui impactent l'event miroir. Si une update ne touche
 * aucun de ces champs (ex : on change `notes` uniquement), inutile de
 * re-syncer le planning — c'est le fast path.
 */
export const ETAPE_SYNCED_FIELDS = ['nom', 'kind', 'date_debut', 'date_fin', 'couleur']

/** Idem pour les phases. */
export const PHASE_SYNCED_FIELDS = ['nom', 'kind', 'date_debut', 'date_fin', 'couleur']

// ═══ Helpers purs — Dates ═════════════════════════════════════════════════

/**
 * Convertit une date "YYYY-MM-DD" en ISO timestamp UTC au début de la journée.
 *   "2026-04-20" → "2026-04-20T00:00:00.000Z"
 */
export function dateToDayStartIso(dateStr) {
  if (!dateStr) return null
  // Accepte "YYYY-MM-DD" ou "YYYY-MM-DD..." (DB peut renvoyer un timestamp)
  const day = String(dateStr).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return `${day}T00:00:00.000Z`
}

/**
 * Convertit une date "YYYY-MM-DD" en ISO timestamp UTC début du jour SUIVANT
 * (convention all_day exclusive — cf. PL-1 et ical.test.js).
 *   "2026-04-20" → "2026-04-21T00:00:00.000Z"
 */
export function dateToDayEndExclusiveIso(dateStr) {
  if (!dateStr) return null
  const day = String(dateStr).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  // On ajoute 24h pile — pas de souci DST puisque notre convention est en UTC.
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

/**
 * Reverse : ISO timestamp → "YYYY-MM-DD" (garde uniquement la date, UTC).
 */
export function isoToDate(iso) {
  if (!iso) return null
  const s = String(iso)
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  return s.slice(0, 10)
}

/**
 * Reverse : ISO timestamp de fin exclusive → "YYYY-MM-DD" inclus.
 *   "2026-04-21T00:00:00Z" (exclusive) → "2026-04-20" (date_fin inclus)
 *   Si l'event n'est pas all_day (ends_at pas sur 00:00:00), on garde la date
 *   telle quelle (plus robuste que planter).
 */
export function isoExclusiveToDateInclusive(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  // Si c'est exactement 00:00:00.000Z → soustraire 1 jour pour avoir la date
  // inclusive. Sinon on garde la date telle quelle (event non-all_day ou
  // convention divergente).
  const isMidnightUtc =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  if (isMidnightUtc) {
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return d.toISOString().slice(0, 10)
}

// ═══ Helpers purs — Détection / classification events ═════════════════════

/** L'event est-il miroir d'une étape ou d'une phase ? */
export function isEventMirror(event) {
  if (!event) return false
  return (
    event.source === EVENT_SOURCE_LIVRABLE_ETAPE ||
    event.source === EVENT_SOURCE_PROJET_PHASE
  )
}

export function isEtapeMirrorEvent(event) {
  return Boolean(event) && event.source === EVENT_SOURCE_LIVRABLE_ETAPE
}

export function isPhaseMirrorEvent(event) {
  return Boolean(event) && event.source === EVENT_SOURCE_PROJET_PHASE
}

// ═══ Helpers purs — Couleur ═══════════════════════════════════════════════

/**
 * Résout la couleur finale à poser sur l'event miroir d'une étape :
 *   1. étape.couleur (override explicite)
 *   2. couleur du kind (LIVRABLE_ETAPE_KINDS)
 *   3. fallback slate
 */
export function etapeEventColor(etape) {
  if (etape?.couleur) return etape.couleur
  const kind = LIVRABLE_ETAPE_KINDS[etape?.kind]
  return kind?.color || '#94a3b8'
}

export function phaseEventColor(phase) {
  if (phase?.couleur) return phase.couleur
  const kind = PROJET_PHASE_KINDS[phase?.kind]
  return kind?.color || '#64748b'
}

// ═══ Helpers purs — Build payloads ════════════════════════════════════════

/**
 * Construit le payload d'INSERT pour l'event miroir d'une étape.
 * Retourne null si l'étape n'a pas les dates requises.
 */
export function buildEtapeEventPayload(etape, projectId) {
  if (!etape || !projectId) return null
  if (!etape.date_debut || !etape.date_fin) return null
  return {
    project_id:        projectId,
    title:             etape.nom || 'Étape livrable',
    starts_at:         dateToDayStartIso(etape.date_debut),
    ends_at:           dateToDayEndExclusiveIso(etape.date_fin),
    all_day:           true,
    source:            EVENT_SOURCE_LIVRABLE_ETAPE,
    livrable_etape_id: etape.id,
    color_override:    etapeEventColor(etape),
  }
}

export function buildPhaseEventPayload(phase, projectId) {
  if (!phase || !projectId) return null
  if (!phase.date_debut || !phase.date_fin) return null
  return {
    project_id:        projectId,
    title:             phase.nom || 'Phase projet',
    starts_at:         dateToDayStartIso(phase.date_debut),
    ends_at:           dateToDayEndExclusiveIso(phase.date_fin),
    all_day:           true,
    source:            EVENT_SOURCE_PROJET_PHASE,
    projet_phase_id:   phase.id,
    color_override:    phaseEventColor(phase),
  }
}

/**
 * Construit le patch UPDATE pour l'event miroir à partir du nouvel état de
 * l'étape. Seuls les champs "sync-able" sont produits — pour laisser les
 * champs hors-scope (external_url, notes, rrule…) intacts côté planning.
 */
export function buildEtapeEventPatch(etape) {
  if (!etape) return {}
  const patch = {}
  if (etape.nom !== undefined)        patch.title          = etape.nom || 'Étape livrable'
  if (etape.date_debut !== undefined) patch.starts_at      = dateToDayStartIso(etape.date_debut)
  if (etape.date_fin !== undefined)   patch.ends_at        = dateToDayEndExclusiveIso(etape.date_fin)
  if (etape.kind !== undefined || etape.couleur !== undefined) {
    patch.color_override = etapeEventColor(etape)
  }
  return patch
}

export function buildPhaseEventPatch(phase) {
  if (!phase) return {}
  const patch = {}
  if (phase.nom !== undefined)        patch.title          = phase.nom || 'Phase projet'
  if (phase.date_debut !== undefined) patch.starts_at      = dateToDayStartIso(phase.date_debut)
  if (phase.date_fin !== undefined)   patch.ends_at        = dateToDayEndExclusiveIso(phase.date_fin)
  if (phase.kind !== undefined || phase.couleur !== undefined) {
    patch.color_override = phaseEventColor(phase)
  }
  return patch
}

// ═══ Helpers purs — Reverse (planning → LIV) ═══════════════════════════════

/**
 * Convertit un patch d'event (drag du planning) en patch d'étape utilisable
 * par `updateEtape`. Garde uniquement les champs relevants.
 *
 *   { starts_at: '2026-04-20T00:00:00Z', ends_at: '2026-04-23T00:00:00Z', title: 'Edit' }
 *   → { date_debut: '2026-04-20', date_fin: '2026-04-22', nom: 'Edit' }
 *
 * Note : ends_at est interprété comme exclusive (convention all_day). Si
 * l'event n'est pas all_day, la date_fin peut être décalée — c'est
 * acceptable puisque le planning all_day est la convention établie pour
 * les miroirs.
 */
export function eventPatchToEtapePatch(eventPatch = {}) {
  const patch = {}
  if ('starts_at' in eventPatch) {
    const d = isoToDate(eventPatch.starts_at)
    if (d) patch.date_debut = d
  }
  if ('ends_at' in eventPatch) {
    const d = isoExclusiveToDateInclusive(eventPatch.ends_at)
    if (d) patch.date_fin = d
  }
  if ('title' in eventPatch && eventPatch.title != null) {
    patch.nom = eventPatch.title
  }
  if ('color_override' in eventPatch) {
    patch.couleur = eventPatch.color_override || null
  }
  return patch
}

export function eventPatchToPhasePatch(eventPatch = {}) {
  const patch = {}
  if ('starts_at' in eventPatch) {
    const d = isoToDate(eventPatch.starts_at)
    if (d) patch.date_debut = d
  }
  if ('ends_at' in eventPatch) {
    const d = isoExclusiveToDateInclusive(eventPatch.ends_at)
    if (d) patch.date_fin = d
  }
  if ('title' in eventPatch && eventPatch.title != null) {
    patch.nom = eventPatch.title
  }
  if ('color_override' in eventPatch) {
    patch.couleur = eventPatch.color_override || null
  }
  return patch
}

// ═══ Helpers purs — Diff detection ═════════════════════════════════════════

/**
 * Le patch d'étape contient-il au moins un champ qui impacte l'event miroir ?
 *
 *   { nom: 'x' }       → true
 *   { notes: 'y' }     → false
 *   { is_event: true } → false (traité par shouldCreateEventForEtape)
 */
export function etapePatchAffectsEvent(patch = {}) {
  return ETAPE_SYNCED_FIELDS.some((f) => f in patch)
}

export function phasePatchAffectsEvent(patch = {}) {
  return PHASE_SYNCED_FIELDS.some((f) => f in patch)
}

/**
 * L'étape doit-elle avoir un event miroir ? (is_event=true + dates valides)
 */
export function shouldEtapeHaveEvent(etape) {
  return Boolean(etape) && etape.is_event === true && Boolean(etape.date_debut) && Boolean(etape.date_fin)
}

/**
 * La phase doit-elle avoir un event miroir ? Une phase a TOUJOURS un event
 * miroir si ses dates sont valides (pas de flag is_event sur les phases —
 * elles sont toujours visibles sur le planning).
 */
export function shouldPhaseHaveEvent(phase) {
  return Boolean(phase) && Boolean(phase.date_debut) && Boolean(phase.date_fin)
}

// ═══ I/O — Étapes ═════════════════════════════════════════════════════════

/**
 * Crée l'event miroir d'une étape + pose `etape.event_id`. Retourne l'event.
 * Idempotent : si l'étape a déjà un event_id, on update au lieu de créer
 * (gère les race conditions + rentre dans le flow de reconciliation).
 */
export async function createEventForEtape({ etape, projectId }) {
  if (!etape || !projectId) return null
  const payload = buildEtapeEventPayload(etape, projectId)
  if (!payload) return null

  // Garde-fou : l'étape a déjà un event ? on update plutôt que créer.
  if (etape.event_id) {
    return updateEventForEtape(etape)
  }

  // INSERT events
  const { data: event, error } = await supabase
    .from('events')
    .insert(payload)
    .select()
    .single()
  if (error) throw error

  // Pose etape.event_id → lien symétrique
  const { error: linkErr } = await supabase
    .from('livrable_etapes')
    .update({ event_id: event.id })
    .eq('id', etape.id)
  if (linkErr) throw linkErr

  return event
}

/**
 * Met à jour l'event miroir d'une étape. On filtre par `livrable_etape_id`
 * (UNIQUE) plutôt que par event_id — plus robuste si `etape.event_id` n'est
 * pas à jour côté caller.
 */
export async function updateEventForEtape(etape) {
  if (!etape?.id) return null
  const patch = buildEtapeEventPatch(etape)
  if (!Object.keys(patch).length) return null
  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('livrable_etape_id', etape.id)
    .select()
    .maybeSingle()
  if (error) throw error
  return data || null
}

/**
 * Supprime l'event miroir d'une étape. À appeler AVANT de supprimer l'étape
 * pour respecter le CHECK `events_source_fk_consistency` (cf. doc en tête).
 */
export async function deleteEventForEtape(etapeId) {
  if (!etapeId) return
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('livrable_etape_id', etapeId)
  if (error) throw error
}

// ═══ I/O — Phases ═════════════════════════════════════════════════════════

export async function createEventForPhase({ phase, projectId }) {
  if (!phase || !projectId) return null
  const payload = buildPhaseEventPayload(phase, projectId)
  if (!payload) return null

  if (phase.event_id) {
    return updateEventForPhase(phase)
  }

  const { data: event, error } = await supabase
    .from('events')
    .insert(payload)
    .select()
    .single()
  if (error) throw error

  const { error: linkErr } = await supabase
    .from('projet_phases')
    .update({ event_id: event.id })
    .eq('id', phase.id)
  if (linkErr) throw linkErr

  return event
}

export async function updateEventForPhase(phase) {
  if (!phase?.id) return null
  const patch = buildPhaseEventPatch(phase)
  if (!Object.keys(patch).length) return null
  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('projet_phase_id', phase.id)
    .select()
    .maybeSingle()
  if (error) throw error
  return data || null
}

export async function deleteEventForPhase(phaseId) {
  if (!phaseId) return
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('projet_phase_id', phaseId)
  if (error) throw error
}

// ═══ Orchestration — Étapes ═══════════════════════════════════════════════

/**
 * À appeler après un INSERT étape réussi. Si l'étape doit avoir un event
 * (is_event=true + dates), crée l'event miroir et pose l'event_id.
 * Retourne l'event créé (ou null).
 *
 * NB : les erreurs sync sont LOG mais ne remontent pas — l'étape est déjà
 * créée et la réconciliation pourra rattraper au prochain passage.
 * (Optionnel : on pourrait relancer via `backfillMirrorEvents`.)
 */
export async function syncEtapeOnCreate(etape, projectId) {
  if (!shouldEtapeHaveEvent(etape)) return null
  try {
    return await createEventForEtape({ etape, projectId })
  } catch (err) {
    console.warn('[livrablesPlanningSync] syncEtapeOnCreate échec:', err)
    return null
  }
}

/**
 * À appeler après un UPDATE étape réussi. Gère les 4 cas :
 *   1. Passe à is_event=true (alors qu'il n'y avait pas d'event) → create
 *   2. Passe à is_event=false (alors qu'il y avait un event)     → delete
 *   3. Reste is_event=true, champs synced changés                → update
 *   4. Reste is_event=false                                       → noop
 *
 * Cas 3 optimisé : si le patch ne touche PAS aux champs synced, skip
 * (fast path pour l'édition de `notes` ou `assignee_profile_id`).
 */
export async function syncEtapeOnUpdate({ etape, patch = {}, projectId }) {
  if (!etape || !projectId) return null

  const shouldHave = shouldEtapeHaveEvent(etape)
  const hasEvent = Boolean(etape.event_id)
  const flipToOn  = shouldHave && !hasEvent
  const flipToOff = !shouldHave && hasEvent

  try {
    if (flipToOn) {
      return await createEventForEtape({ etape, projectId })
    }
    if (flipToOff) {
      await deleteEventForEtape(etape.id)
      // Nullifier etape.event_id pour cohérence locale.
      await supabase
        .from('livrable_etapes')
        .update({ event_id: null })
        .eq('id', etape.id)
      return null
    }
    if (shouldHave && etapePatchAffectsEvent(patch)) {
      return await updateEventForEtape(etape)
    }
    return null
  } catch (err) {
    console.warn('[livrablesPlanningSync] syncEtapeOnUpdate échec:', err)
    return null
  }
}

/**
 * À appeler AVANT le DELETE étape. Supprime l'event miroir s'il existe.
 * (Obligatoire pour respecter le CHECK DB — cf. doc de tête.)
 */
export async function syncEtapeOnDelete(etapeId) {
  if (!etapeId) return
  try {
    await deleteEventForEtape(etapeId)
  } catch (err) {
    console.warn('[livrablesPlanningSync] syncEtapeOnDelete échec:', err)
    // On laisse le DELETE étape tenter quand même — si l'event n'existait
    // pas, la cascade ON DELETE SET NULL le transformera en event normal.
  }
}

// ═══ Orchestration — Phases ═══════════════════════════════════════════════

export async function syncPhaseOnCreate(phase, projectId) {
  if (!shouldPhaseHaveEvent(phase)) return null
  try {
    return await createEventForPhase({ phase, projectId })
  } catch (err) {
    console.warn('[livrablesPlanningSync] syncPhaseOnCreate échec:', err)
    return null
  }
}

export async function syncPhaseOnUpdate({ phase, patch = {}, projectId }) {
  if (!phase || !projectId) return null

  const shouldHave = shouldPhaseHaveEvent(phase)
  const hasEvent   = Boolean(phase.event_id)

  try {
    if (shouldHave && !hasEvent) {
      return await createEventForPhase({ phase, projectId })
    }
    if (!shouldHave && hasEvent) {
      await deleteEventForPhase(phase.id)
      await supabase
        .from('projet_phases')
        .update({ event_id: null })
        .eq('id', phase.id)
      return null
    }
    if (shouldHave && phasePatchAffectsEvent(patch)) {
      return await updateEventForPhase(phase)
    }
    return null
  } catch (err) {
    console.warn('[livrablesPlanningSync] syncPhaseOnUpdate échec:', err)
    return null
  }
}

export async function syncPhaseOnDelete(phaseId) {
  if (!phaseId) return
  try {
    await deleteEventForPhase(phaseId)
  } catch (err) {
    console.warn('[livrablesPlanningSync] syncPhaseOnDelete échec:', err)
  }
}

// ═══ Backfill — réconciliation one-shot ═══════════════════════════════════

/**
 * Crée les events manquants pour toutes les étapes (is_event=true,
 * event_id=null, dates valides) et phases (event_id=null, dates valides)
 * d'un projet. Utile :
 *   - Au premier passage après déploiement de LIV-4 (étapes créées sous
 *     LIV-3 avec event_id=null).
 *   - En cas de désync détectée (bouton "Réconcilier" dans l'UI admin,
 *     pas exposé en V1 mais disponible si besoin).
 *
 * Retourne `{ etapes: N, phases: M }` = nombre d'events créés.
 */
export async function backfillMirrorEvents(projectId) {
  if (!projectId) return { etapes: 0, phases: 0 }

  // 1. Étapes orphelines du projet (jointure via livrables.project_id).
  const { data: livrables, error: lErr } = await supabase
    .from('livrables')
    .select('id')
    .eq('project_id', projectId)
    .is('deleted_at', null)
  if (lErr) throw lErr
  const livrableIds = (livrables || []).map((l) => l.id)

  let etapesCount = 0
  if (livrableIds.length) {
    const { data: etapes, error: eErr } = await supabase
      .from('livrable_etapes')
      .select('*')
      .in('livrable_id', livrableIds)
      .eq('is_event', true)
      .is('event_id', null)
    if (eErr) throw eErr
    for (const etape of etapes || []) {
      if (!shouldEtapeHaveEvent(etape)) continue
      try {
        const ev = await createEventForEtape({ etape, projectId })
        if (ev) etapesCount += 1
      } catch (err) {
        console.warn('[backfillMirrorEvents] étape', etape.id, ':', err)
      }
    }
  }

  // 2. Phases orphelines.
  const { data: phases, error: pErr } = await supabase
    .from('projet_phases')
    .select('*')
    .eq('project_id', projectId)
    .is('event_id', null)
  if (pErr) throw pErr

  let phasesCount = 0
  for (const phase of phases || []) {
    if (!shouldPhaseHaveEvent(phase)) continue
    try {
      const ev = await createEventForPhase({ phase, projectId })
      if (ev) phasesCount += 1
    } catch (err) {
      console.warn('[backfillMirrorEvents] phase', phase.id, ':', err)
    }
  }

  return { etapes: etapesCount, phases: phasesCount }
}
