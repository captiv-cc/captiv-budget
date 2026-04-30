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
 * les infos du livrable parent (numero, nom, block_id) et — depuis LIV-9 —
 * l'event_type configuré par l'utilisateur (label, couleur), pour faciliter
 * le regroupement / l'affichage.
 *
 * Priorité d'affichage côté composant :
 *   1. `event_type` (libre, configuré dans le drawer LIV-9) — vérité actuelle
 *   2. `kind` (enum figé, legacy) — fallback rétro-compat
 *
 * @param {Array} etapes
 * @param {Map<string, Object>} [livrablesById] - Map id → livrable
 * @param {Map<string, Object>} [eventTypesById] - Map id → event_type ({ id, label, color, slug })
 * @returns {Array<{
 *   id: string,
 *   starts_at: string,
 *   ends_at: string,
 *   kind: string,
 *   event_type: { id: string, label: string, color: string }|null,
 *   livrable_id: string,
 *   livrable_numero: string|null,
 *   livrable_nom: string|null,
 *   livrable_block_id: string|null,
 *   livrable_sort_order: number,
 *   _etape: Object,
 * }>}
 */
export function etapesToTimelineEvents(
  etapes = [],
  livrablesById = new Map(),
  eventTypesById = new Map(),
) {
  const out = []
  for (const e of etapes) {
    if (!e || !e.date_debut) continue
    const starts_at = dateToStartIso(e.date_debut)
    const endDate = e.date_fin || e.date_debut
    const ends_at = dateToExclusiveEndIso(endDate)
    if (!starts_at || !ends_at) continue
    const liv = livrablesById.get(e.livrable_id) || null
    const et = e.event_type_id ? eventTypesById.get(e.event_type_id) || null : null
    out.push({
      id: e.id,
      starts_at,
      ends_at,
      kind: e.kind || 'autre',
      event_type: et
        ? { id: et.id, label: et.label || et.slug || '', color: et.color || null }
        : null,
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
 * Convertit une date 'YYYY-MM-DD' (ou Date) en timestamp local 00:00:00, ou
 * null si invalide. Utilisé pour normaliser des dates supplémentaires (ex :
 * date_livraison de livrable, today) à inclure dans la fenêtre.
 */
function dateLikeToTs(value) {
  if (!value) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const d = new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0)
    return d.getTime()
  }
  if (typeof value === 'string') {
    const sIso = dateToStartIso(value)
    if (!sIso) return null
    return new Date(sIso).getTime()
  }
  return null
}

/**
 * Calcule la fenêtre temporelle à afficher pour englober toutes les étapes
 * + un padding (défaut 7 jours de chaque côté).
 *
 * Options :
 *   - `extraDates` : dates supplémentaires (Date | 'YYYY-MM-DD') qui doivent
 *     être englobées dans la fenêtre. Sert à inclure les `date_livraison` des
 *     livrables et/ou `today` même quand aucune étape ne les couvre. Le
 *     padding s'applique aussi à ces dates.
 *   - `includeToday` : si true, ajoute `now` aux extraDates (raccourci).
 *
 * Si rien à englober → fenêtre par défaut centrée sur "today" :
 * [today - 7j ; today + 30j].
 *
 * @param {Array} etapes
 * @param {Object} [opts]
 * @param {number} [opts.paddingDays=7]
 * @param {Date}   [opts.now=new Date()]
 * @param {Array<Date|string>} [opts.extraDates=[]]
 * @param {boolean} [opts.includeToday=false]
 * @returns {{ start: Date, end: Date, daysCount: number }}
 */
export function computeWindowFromEtapes(
  etapes = [],
  { paddingDays = 7, now = new Date(), extraDates = [], includeToday = false } = {},
) {
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

  // Inclure les dates supplémentaires (deadlines livrables, today, etc.).
  // Pour les étendre dans la fenêtre, on traite chaque date comme une étape
  // de durée 1 jour : tsStart = date 00:00, tsEnd = lendemain 00:00.
  const extras = [...extraDates]
  if (includeToday) extras.push(now)
  for (const d of extras) {
    const ts = dateLikeToTs(d)
    if (ts == null) continue
    if (ts < minTs) minTs = ts
    const tsEnd = ts + MS_PER_DAY
    if (tsEnd > maxTs) maxTs = tsEnd
  }

  // Rien à englober → fenêtre par défaut centrée sur today.
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
 * Construit le label d'une lane livrable : `{prefixe}{numero} · {nom}`.
 *
 * Le `numero` stocké en base peut contenir ou non le préfixe du bloc
 * (héritage : les anciens livrables ont juste "1", les nouveaux ont déjà
 * "A1"). On déduplique : si le numero commence déjà par le préfixe, on ne
 * le rajoute pas. Sinon on concatène — pour que le Pipeline (qui n'affiche
 * pas de header de bloc) lève l'ambiguïté entre 1·Teaser (bloc A) et
 * 1·Teaser (bloc B).
 *
 * @param {Object} livrable
 * @param {Object|null} block
 * @returns {string}
 */
function buildLivrableLaneLabel(livrable, block) {
  const numero = (livrable.numero || '').toString().trim()
  const nom = (livrable.nom || '').toString().trim() || 'Sans nom'
  const prefix = (block?.prefixe || '').toString().trim()
  let displayedNumero = numero
  if (prefix && numero && !numero.startsWith(prefix)) {
    displayedNumero = `${prefix}${numero}`
  } else if (prefix && !numero) {
    // Cas marginal : pas de numero mais préfixe → afficher juste le préfixe.
    displayedNumero = prefix
  }
  return displayedNumero ? `${displayedNumero} · ${nom}` : nom
}

/**
 * Groupe les events timeline par livrable_id.
 *
 * Comportement par défaut (includeEmpty=false, V1) : 1 lane par livrable
 * AYANT au moins 1 étape (les livrables sans étape sont exclus).
 *
 * Avec `includeEmpty: true` (LIV-22b polish) : 1 lane par livrable, qu'il
 * ait des étapes ou pas. Permet de visualiser tous les livrables du projet
 * dans le Gantt — même ceux pas encore planifiés (lane vide → CTA "À planifier").
 *
 * Tri des lanes : par `block.sort_order` puis `livrable.sort_order` —
 * cohérent avec l'ordre de la table LIV.
 *
 * @param {Array} timelineEvents - issus de `etapesToTimelineEvents`
 * @param {Array} livrables      - tableau plat de tous les livrables (pour l'ordre)
 * @param {Map<string, number>} [blockOrderById] - Map blockId → sort_order
 * @param {Object} [opts]
 * @param {boolean} [opts.includeEmpty=false] - inclure aussi les livrables sans étape
 * @param {Map<string, Object>} [opts.blocksById] - Map blockId → block (pour le préfixe dans le label)
 * @returns {Array<{
 *   key: string,         // livrable_id
 *   label: string,       // "{prefixe}{numero} · {nom}"
 *   livrable: Object,    // ref vers le livrable original
 *   events: Array,       // events de ce livrable (peut être vide si includeEmpty)
 * }>}
 */
export function groupEtapesByLivrable(
  timelineEvents = [],
  livrables = [],
  blockOrderById = new Map(),
  { includeEmpty = false, blocksById = new Map() } = {},
) {
  const byLivrable = new Map()
  for (const ev of timelineEvents) {
    if (!ev?.livrable_id) continue
    if (!byLivrable.has(ev.livrable_id)) byLivrable.set(ev.livrable_id, [])
    byLivrable.get(ev.livrable_id).push(ev)
  }

  const lanes = []
  if (includeEmpty) {
    // On itère sur tous les livrables fournis → toutes les lanes, même vides.
    for (const liv of livrables) {
      if (!liv?.id) continue
      const events = byLivrable.get(liv.id) || []
      const block = blocksById.get(liv.block_id) || null
      const label = buildLivrableLaneLabel(liv, block)
      lanes.push({ key: liv.id, label, livrable: liv, events })
    }
  } else {
    // Comportement V1 : seulement les livrables avec au moins 1 étape.
    const livrablesById = new Map(livrables.map((l) => [l.id, l]))
    for (const [livrableId, events] of byLivrable.entries()) {
      const liv = livrablesById.get(livrableId)
      if (!liv) continue // étape orpheline (livrable supprimé)
      const block = blocksById.get(liv.block_id) || null
      const label = buildLivrableLaneLabel(liv, block)
      lanes.push({ key: livrableId, label, livrable: liv, events })
    }
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

// ─── groupEtapesByEventType (vue A focus — depuis LIV-22c) ─────────────────

/**
 * Groupe les events par `event_type_id` — successeur de `groupEtapesByKind`
 * depuis LIV-22c. Le mode Focus (vue A) montre 1 lane par event_type
 * effectivement utilisé sur le livrable focus, plutôt que les 7 kinds figés
 * de l'enum legacy (qui ne correspondent plus à la réalité user depuis LIV-9).
 *
 * Tri : par première apparition (date_debut min ascendant). Étapes sans
 * event_type → lane "Sans type" toujours en queue.
 *
 * @param {Array} timelineEvents - issus de `etapesToTimelineEvents` (events
 *                                  enrichis avec event_type)
 * @param {Map<string, Object>} [eventTypesById] - Map id → event_type
 *                                                  (fallback : utilise
 *                                                  ev.event_type embarqué)
 * @returns {Array<{ key: string, label: string, color: string, events: Array }>}
 */
export function groupEtapesByEventType(timelineEvents = [], eventTypesById = new Map()) {
  // key === event_type_id si défini, sinon 'untyped'
  const byTypeKey = new Map()
  for (const ev of timelineEvents) {
    const typeId = ev?.event_type?.id || ev?._etape?.event_type_id || null
    const key = typeId || 'untyped'
    const startMs = new Date(ev.starts_at).getTime()
    if (!byTypeKey.has(key)) {
      let eventType = null
      if (typeId) {
        // Préfère la version embarquée dans l'event (déjà enrichie par
        // etapesToTimelineEvents), sinon retombe sur la Map.
        eventType = ev?.event_type || eventTypesById.get(typeId) || null
      }
      byTypeKey.set(key, { events: [], minDate: Infinity, eventType })
    }
    const bucket = byTypeKey.get(key)
    bucket.events.push(ev)
    if (startMs < bucket.minDate) bucket.minDate = startMs
  }

  // Construction des lanes avec label + couleur depuis eventType.
  const lanes = []
  for (const [key, bucket] of byTypeKey.entries()) {
    if (key === 'untyped') {
      lanes.push({
        key: 'untyped',
        label: 'Sans type',
        color: '#94a3b8',
        events: bucket.events,
        minDate: bucket.minDate,
      })
    } else {
      const et = bucket.eventType
      lanes.push({
        key,
        label: et?.label || et?.slug || 'Type',
        color: et?.color || '#94a3b8',
        events: bucket.events,
        minDate: bucket.minDate,
      })
    }
  }

  // Tri : 1ère apparition asc, "untyped" toujours en queue.
  lanes.sort((a, b) => {
    if (a.key === 'untyped') return 1
    if (b.key === 'untyped') return -1
    return a.minDate - b.minDate
  })

  // Retire minDate de la sortie (utile uniquement pour le tri).
  return lanes.map(({ minDate: _ignored, ...rest }) => rest)
}

// ─── addDaysToISO (drag/resize barres — LIV-22d) ────────────────────────────

/**
 * Ajoute N jours à une date 'YYYY-MM-DD' et renvoie le résultat sous le
 * même format. Utilise le constructeur Date local qui gère les overflow
 * mois/an. Renvoie null si la date d'entrée est invalide.
 *
 * Exemples :
 *   addDaysToISO('2026-05-12', 3)   → '2026-05-15'
 *   addDaysToISO('2026-05-30', 5)   → '2026-06-04'
 *   addDaysToISO('2026-05-12', -2)  → '2026-05-10'
 *   addDaysToISO(null, 3)           → null
 */
export function addDaysToISO(dateStr, n) {
  if (!dateStr) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const days = Number.isFinite(n) ? Math.trunc(n) : 0
  const d = new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10) + days,
    0, 0, 0, 0,
  )
  if (Number.isNaN(d.getTime())) return null
  const yyyy = String(d.getFullYear()).padStart(4, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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
