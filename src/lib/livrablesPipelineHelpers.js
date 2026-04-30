// ════════════════════════════════════════════════════════════════════════════
// livrablesPipelineHelpers — Helpers PURS pour la vue Pipeline / Gantt (LIV-22)
// ════════════════════════════════════════════════════════════════════════════
//
// 100 % synchrone, 0 dépendance Supabase / DOM. Tout est testable unitairement
// avec Vitest. Sert de base aux composants `LivrablePipelineView`.
//
// Les étapes sont stockées avec des dates (`date_debut` / `date_fin` au format
// 'YYYY-MM-DD'). Pour réutiliser `layoutTimelineLanes` (lib/planning.js) qui
// raisonne en `starts_at` / `ends_at` ISO timestamp, on convertit en
// timestamps "all-day exclusive" (cf. PL-PLANNING) :
//   - `starts_at` = date_debut à 00:00:00 local
//   - `ends_at`   = (date_fin + 1 jour) à 00:00:00 local — exclusive
//
// Règles métier (cf. LIV-22 paris validés 2026-04-30) :
//   - Étape sans `date_debut`  → exclue (rien à afficher)
//   - Étape sans `date_fin`    → date_fin = date_debut (durée 1 jour)
//   - Étape soft-deleted       → fournis-en filtrées EN AMONT (ce helper
//                                 n'a pas connaissance de `deleted_at`)
// ════════════════════════════════════════════════════════════════════════════

import { LIVRABLE_ETAPE_KINDS } from './livrablesHelpers'

// Ordre canonique des swimlanes "par kind" — miroir du pipeline post-prod :
// brief → DA → montage → son → livraison → feedback → autre.
export const PIPELINE_KIND_ORDER = [
  'production',
  'da',
  'montage',
  'sound',
  'delivery',
  'feedback',
  'autre',
]

// ─── Conversion date → ISO timestamp (convention all-day exclusive) ────────

/**
 * Convertit une date 'YYYY-MM-DD' en ISO timestamp local 00:00:00.
 * Ne dépend pas de la timezone du runtime (on construit un Date local).
 *
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {string|null} - ISO timestamp ou null si invalide
 */
function dateToStartIso(dateStr) {
  if (!dateStr) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 0, 0, 0, 0)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * Convertit une date 'YYYY-MM-DD' en ISO timestamp pour `ends_at` exclusif :
 * minuit du JOUR SUIVANT (cf. convention LIV-9). Pour une étape qui finit le
 * 03/05, `ends_at = 04/05 00:00:00` — la durée 1 jour est correctement
 * représentée en `ends_at - starts_at`.
 *
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {string|null}
 */
function dateToExclusiveEndIso(dateStr) {
  if (!dateStr) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  // +1 jour → utilise le constructeur Date qui gère les overflow mois/an.
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10) + 1, 0, 0, 0, 0)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

// ─── etapesToTimelineEvents ─────────────────────────────────────────────────

/**
 * Mappe une liste de `livrable_etapes` vers la shape "event" attendue par
 * `layoutTimelineLanes` du module planning.js. Enrichit chaque entrée avec
 * les infos du livrable parent (numero, nom, block_id) pour faciliter le
 * regroupement / l'affichage.
 *
 * @param {Array} etapes
 * @param {Map<string, Object>} [livrablesById] - Map id → livrable
 * @returns {Array<{
 *   id: string,
 *   starts_at: string,
 *   ends_at: string,
 *   kind: string,
 *   livrable_id: string,
 *   livrable_numero: string|null,
 *   livrable_nom: string|null,
 *   livrable_block_id: string|null,
 *   livrable_sort_order: number,
 *   _etape: Object,
 * }>}
 */
export function etapesToTimelineEvents(etapes = [], livrablesById = new Map()) {
  const out = []
  for (const e of etapes) {
    if (!e || !e.date_debut) continue
    const starts_at = dateToStartIso(e.date_debut)
    const endDate = e.date_fin || e.date_debut
    const ends_at = dateToExclusiveEndIso(endDate)
    if (!starts_at || !ends_at) continue
    const liv = livrablesById.get(e.livrable_id) || null
    out.push({
      id: e.id,
      starts_at,
      ends_at,
      kind: e.kind || 'autre',
      livrable_id: e.livrable_id || null,
      livrable_numero: liv?.numero || null,
      livrable_nom: liv?.nom || null,
      livrable_block_id: liv?.block_id || null,
      livrable_sort_order: liv?.sort_order ?? 0,
      _etape: e,
    })
  }
  return out
}

// ─── computeWindowFromEtapes ────────────────────────────────────────────────

const MS_PER_DAY = 24 * 3600 * 1000

/**
 * Calcule la fenêtre temporelle à afficher pour englober toutes les étapes
 * + un padding (défaut 7 jours de chaque côté).
 *
 * Si vide ou tout invalide → fenêtre par défaut centrée sur "today" :
 * [today - 7j ; today + 30j].
 *
 * @param {Array} etapes
 * @param {Object} [opts]
 * @param {number} [opts.paddingDays=7] - jours de marge avant/après
 * @param {Date}   [opts.now=new Date()]
 * @returns {{ start: Date, end: Date, daysCount: number }}
 */
export function computeWindowFromEtapes(etapes = [], { paddingDays = 7, now = new Date() } = {}) {
  let minTs = Infinity
  let maxTs = -Infinity
  for (const e of etapes) {
    if (!e?.date_debut) continue
    const sStart = dateToStartIso(e.date_debut)
    const sEnd = dateToExclusiveEndIso(e.date_fin || e.date_debut)
    if (!sStart || !sEnd) continue
    const tsStart = new Date(sStart).getTime()
    const tsEnd = new Date(sEnd).getTime()
    if (tsStart < minTs) minTs = tsStart
    if (tsEnd > maxTs) maxTs = tsEnd
  }

  // Aucune étape valide → fenêtre par défaut centrée sur today.
  if (!isFinite(minTs) || !isFinite(maxTs)) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const start = new Date(today.getTime() - 7 * MS_PER_DAY)
    const end = new Date(today.getTime() + 30 * MS_PER_DAY)
    return {
      start,
      end,
      daysCount: Math.round((end.getTime() - start.getTime()) / MS_PER_DAY),
    }
  }

  // Avec padding.
  const start = new Date(minTs - paddingDays * MS_PER_DAY)
  const end = new Date(maxTs + paddingDays * MS_PER_DAY)
  // Normalisation à minuit local (les dates étapes sont déjà à 00:00).
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  const daysCount = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)
  return { start, end, daysCount }
}

// ─── groupEtapesByLivrable (vue B — ensemble projet) ────────────────────────

/**
 * Groupe les events timeline par livrable_id. Renvoie 1 lane par livrable
 * AYANT au moins 1 étape (les livrables sans étapes sont exclus).
 *
 * Tri des lanes : par `block.sort_order` puis `livrable.sort_order` —
 * cohérent avec l'ordre de la table LIV.
 *
 * @param {Array} timelineEvents - issus de `etapesToTimelineEvents`
 * @param {Array} livrables      - tableau plat de tous les livrables (pour l'ordre)
 * @param {Map<string, number>} [blockOrderById] - Map blockId → sort_order
 * @returns {Array<{
 *   key: string,         // livrable_id
 *   label: string,       // "{numero} {nom}"
 *   livrable: Object,    // ref vers le livrable original
 *   events: Array,       // events de ce livrable
 * }>}
 */
export function groupEtapesByLivrable(timelineEvents = [], livrables = [], blockOrderById = new Map()) {
  const byLivrable = new Map()
  for (const ev of timelineEvents) {
    if (!ev?.livrable_id) continue
    if (!byLivrable.has(ev.livrable_id)) byLivrable.set(ev.livrable_id, [])
    byLivrable.get(ev.livrable_id).push(ev)
  }
  const livrablesById = new Map(livrables.map((l) => [l.id, l]))
  const lanes = []
  for (const [livrableId, events] of byLivrable.entries()) {
    const liv = livrablesById.get(livrableId)
    if (!liv) continue // étape orpheline (livrable supprimé) → on skip
    const numero = (liv.numero || '').toString().trim()
    const nom = (liv.nom || '').toString().trim() || 'Sans nom'
    const label = numero ? `${numero} · ${nom}` : nom
    lanes.push({
      key: livrableId,
      label,
      livrable: liv,
      events,
    })
  }
  lanes.sort((a, b) => {
    const blockA = blockOrderById.get(a.livrable.block_id) ?? 0
    const blockB = blockOrderById.get(b.livrable.block_id) ?? 0
    if (blockA !== blockB) return blockA - blockB
    return (a.livrable.sort_order ?? 0) - (b.livrable.sort_order ?? 0)
  })
  return lanes
}

// ─── groupEtapesByKind (vue A — focus 1 livrable) ───────────────────────────

/**
 * Groupe les events par `kind` selon l'ordre canonique du pipeline. Renvoie
 * uniquement les kinds qui ont AU MOINS 1 étape (lanes vides exclues).
 *
 * Pas de tri par bloc — typiquement appelé sur les events d'UN SEUL livrable
 * (vue A focus). Si appelé sur plusieurs livrables, tous les kinds sont
 * mélangés dans la même lane.
 *
 * @param {Array} timelineEvents - issus de `etapesToTimelineEvents`
 * @returns {Array<{ key: string, label: string, color: string, events: Array }>}
 */
export function groupEtapesByKind(timelineEvents = []) {
  const byKind = new Map()
  for (const ev of timelineEvents) {
    const kind = ev.kind || 'autre'
    if (!byKind.has(kind)) byKind.set(kind, [])
    byKind.get(kind).push(ev)
  }
  const lanes = []
  for (const kind of PIPELINE_KIND_ORDER) {
    const events = byKind.get(kind)
    if (!events || events.length === 0) continue
    const meta = LIVRABLE_ETAPE_KINDS[kind] || { label: kind, color: '#94a3b8' }
    lanes.push({
      key: kind,
      label: meta.label,
      color: meta.color,
      events,
    })
  }
  // Si des kinds non canoniques apparaissent (defensive), les ajouter à la fin.
  for (const [kind, events] of byKind.entries()) {
    if (PIPELINE_KIND_ORDER.includes(kind)) continue
    const meta = LIVRABLE_ETAPE_KINDS[kind] || { label: kind, color: '#94a3b8' }
    lanes.push({ key: kind, label: meta.label, color: meta.color, events })
  }
  return lanes
}

// ─── filterEtapesForLivrable (vue A focus) ──────────────────────────────────

/**
 * Filtre les events timeline pour ne garder que ceux d'un livrable précis.
 * Helper trivial mais explicite pour la lisibilité côté composant.
 *
 * @param {Array} timelineEvents
 * @param {string} livrableId
 * @returns {Array}
 */
export function filterEtapesForLivrable(timelineEvents = [], livrableId) {
  if (!livrableId) return []
  return timelineEvents.filter((ev) => ev.livrable_id === livrableId)
}
