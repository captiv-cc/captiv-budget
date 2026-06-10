// ════════════════════════════════════════════════════════════════════════════
// projectPeriodSync.js — sync période projet → events planning (PROJ-PERIODES)
// ════════════════════════════════════════════════════════════════════════════
//
// Pour le moment, seule la période **tournage** est propagée vers le planning
// global sous forme d'events all-day READ-ONLY.
//
// **Principe** :
//   - Le projet est PROPRIÉTAIRE de la période (saisie dans ProjetTab)
//   - Les events planning sont des PROJECTIONS, identifiés par
//     `events.metadata.source === 'project_periode_tournage'`
//   - Convention all_day exclusive (cf. PL-FIX-1) : starts_at = J 00:00 UTC,
//     ends_at = J+1 00:00 UTC pour 1 jour, ou J_fin+1 00:00 UTC pour un range
//
// **Algorithme du sync** :
//   1. Lister les events existants du projet ayant `metadata.source` = tournage
//   2. Calculer les events souhaités à partir de `tournage.ranges`
//   3. DELETE tout (les events sourcés projet) puis INSERT les nouveaux
//      (approche batch, simple et fiable — pas de matching fragile)
//
// **Read-only côté planning** : EventEditorModal détecte le flag metadata
// et bascule en lecture seule + bouton "Modifier dans le projet".
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import { hasAnyRange } from './projectPeriodes'

/** Marqueur unique des events sourcés période tournage projet. */
export const SOURCE_PROJECT_PERIODE_TOURNAGE = 'project_periode_tournage'

/**
 * Convertit YYYY-MM-DD en ISO début de jour UTC.
 *   "2026-04-20" → "2026-04-20T00:00:00.000Z"
 */
function dateToDayStartIso(dateStr) {
  if (!dateStr) return null
  const day = String(dateStr).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return `${day}T00:00:00.000Z`
}

/**
 * Convertit YYYY-MM-DD en ISO début du jour SUIVANT UTC (convention all_day
 * exclusive — cf. PL-FIX-1).
 *   "2026-04-20" → "2026-04-21T00:00:00.000Z"
 */
function dateToDayEndExclusiveIso(dateStr) {
  if (!dateStr) return null
  const day = String(dateStr).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

/**
 * Trouve l'event_type "Tournage" (slug='tournage'). Renvoie null si absent
 * (l'org n'a peut-être pas encore seedé les types système).
 */
async function findTournageEventType() {
  const { data, error } = await supabase
    .from('event_types')
    .select('id, slug, label, color, category')
    .eq('slug', 'tournage')
    .eq('archived', false)
    .maybeSingle()
  if (error) {
    console.warn('[projectPeriodSync] findTournageEventType erreur:', error)
    return null
  }
  return data || null
}

/**
 * Sync les events planning de type "Tournage" sourcés d'un projet, à partir
 * de la période tournage stockée dans le projet.
 *
 * @param {Object} opts
 * @param {string} opts.projectId
 * @param {Object} opts.tournage — { ranges: [{ start, end }] }
 *
 * Stratégie : delete tous les events sourcés projet de ce projet, puis
 * insert les nouveaux. Simple, idempotent, robuste face à des renommages
 * de ranges côté projet.
 */
export async function syncTournagePeriodToPlanning({ projectId, tournage }) {
  if (!projectId) return { deleted: 0, created: 0 }

  // 1. Suppression de tous les events tournage sourcés projet pour ce projet.
  //    Filtre exact sur `source` (CHECK constraint accepte project_periode_*
  //    depuis la migration 20260502) pour ne pas toucher aux events manuels
  //    de tournage que l'utilisateur aurait créés à la main.
  const { error: delErr } = await supabase
    .from('events')
    .delete()
    .eq('project_id', projectId)
    .eq('source', SOURCE_PROJECT_PERIODE_TOURNAGE)
  if (delErr) {
    // Non bloquant : on log et on continue. Si le delete échoue, on aura
    // potentiellement des doublons jusqu'au prochain save propre.
    console.warn('[projectPeriodSync] delete echec:', delErr)
  }

  // 2. Si aucune période, rien à créer.
  if (!hasAnyRange(tournage)) {
    return { deleted: -1, created: 0 }
  }

  // 3. Trouve l'event_type Tournage (sinon on continue sans type → couleur
  //    par défaut côté planning).
  const eventType = await findTournageEventType()
  const eventTypeId = eventType?.id || null

  // 4. Construit le payload pour chaque range.
  // NB : on pose `source = 'project_periode_tournage'` (CHECK constraint
  // élargi par la migration 20260502 — accepte le préfixe project_periode_).
  // `metadata` jsonb stocke les détails de la projection.
  const ranges = (tournage.ranges || []).filter((r) => r?.start && r?.end)
  const payloads = ranges.map((range, idx) => ({
    project_id: projectId,
    title: 'Tournage',
    type_id: eventTypeId,
    starts_at: dateToDayStartIso(range.start),
    ends_at: dateToDayEndExclusiveIso(range.end),
    all_day: true,
    source: SOURCE_PROJECT_PERIODE_TOURNAGE,
    metadata: {
      source: SOURCE_PROJECT_PERIODE_TOURNAGE,
      range_index: idx,
      range_start: range.start,
      range_end: range.end,
      readonly_reason:
        'Cette période est gérée depuis les paramètres du projet.',
    },
  }))

  if (payloads.length === 0) {
    return { deleted: -1, created: 0 }
  }

  const { error: insErr } = await supabase.from('events').insert(payloads)
  if (insErr) throw insErr

  return { deleted: -1, created: payloads.length }
}

/**
 * Détecte si un event est une projection sourcée projet (donc read-only).
 * Renvoie le `source` ('project_periode_tournage'…) ou null.
 *
 * Helper simple pour les composants UI (EventEditorModal, planning).
 * Lit `event.source` (préfixe `project_periode_`), avec fallback sur
 * `event.metadata.source` au cas où la migration n'est pas encore appliquée.
 */
export function getProjectPeriodSource(event) {
  const src = event?.source || event?.metadata?.source
  if (typeof src !== 'string') return null
  if (src.startsWith('project_periode_')) return src
  return null
}

/** True si l'event vient d'une période projet (read-only). */
export function isProjectPeriodEvent(event) {
  return getProjectPeriodSource(event) !== null
}
