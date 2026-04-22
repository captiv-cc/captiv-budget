// ════════════════════════════════════════════════════════════════════════════
// matosBilanData.js — Agrégation pure du bilan de fin d'essais (MAT-12)
// ════════════════════════════════════════════════════════════════════════════
//
// Construit une structure normalisée à partir du `session` renvoyé par
// `check_session_fetch`, prête à être rendue par le builder PDF. Pas de React,
// pas de Supabase, pas de jsPDF : que de la transformation de données.
//
// La structure retournée sépare :
//
//   • LE BILAN GLOBAL (stats + tous les blocs/items confondus)
//   • LES BILANS PAR LOUEUR (1 entrée par loueur affecté + 1 entrée spéciale
//     "Sans loueur" pour les items non taggués, si pertinent).
//
// Sémantique des buckets par loueur
// ──────────────────────────────────
// Pour chaque loueur :
//   - Un item apparaît si :
//       * il est taggué avec ce loueur (inclusion via matos_item_loueurs)
//   - Un item qui a plusieurs loueurs apparaît dans chaque bucket correspondant.
//   - Un item sans AUCUN loueur → va dans le bucket `{ loueur: null, ... }`
//     (label "Sans loueur"). Si aucun item n'est concerné, le bucket n'est pas
//     créé.
//   - Un ADDITIF (added_during_check) suit la même règle : si on ne l'a pas
//     taggué avec un loueur, il tombe dans "Sans loueur". Sinon, il est dans
//     le bucket du loueur.
//   - Un item RETIRÉ (removed_at) est inclus dans le bilan (avec sa raison)
//     car c'est un événement de tournage qu'on veut tracer — mais il est
//     exclu des compteurs "checked/total" (sémantique alignée avec
//     matosCheckFilter.computeBlockProgress).
//
// Stats (global + par loueur)
// ───────────────────────────
//   total          : items actifs (non-retirés)
//   checked        : items actifs cochés
//   removed        : items retirés
//   additifs       : items added_during_check (actifs OU retirés)
//   byFlag         : { ok, attention, probleme, none } sur les items actifs
//   ratio          : checked / total (0 si total=0)
//
// Un item retiré est compté dans `removed` ET pas dans `total` ; il peut aussi
// être un additif (on veut le tracer 2x : "3 additifs dont 1 retiré").
// ════════════════════════════════════════════════════════════════════════════

// Sentinelle pour le bucket "Sans loueur" — id stable et reconnaissable.
export const NO_LOUEUR_BUCKET_ID = '__no_loueur__'

// ─── API principale ────────────────────────────────────────────────────────

/**
 * Construit un snapshot bilan à partir d'une `session` `check_session_fetch`.
 *
 * @param {object} session - Bundle { version, project, blocks, items, loueurs,
 *                           item_loueurs, comments, attachments }
 * @returns {{
 *   project:    object,
 *   version:    object,
 *   global:     { blocks: Array, stats: object, closedAt: ?string, closedByName: ?string },
 *   byLoueur:   Array<{ loueur: object|null, blocks: Array, stats: object }>,
 * }}
 */
export function aggregateBilanData(session) {
  if (!session || typeof session !== 'object') {
    return {
      project: null,
      version: null,
      global: { blocks: [], stats: emptyStats(), closedAt: null, closedByName: null },
      byLoueur: [],
    }
  }

  const project = session.project || null
  const version = session.version || null
  const blocks = Array.isArray(session.blocks) ? session.blocks : []
  const items = Array.isArray(session.items) ? session.items : []
  const loueurs = Array.isArray(session.loueurs) ? session.loueurs : []
  const itemLoueurs = Array.isArray(session.item_loueurs) ? session.item_loueurs : []
  const comments = Array.isArray(session.comments) ? session.comments : []

  // ─── Index auxiliaires ────────────────────────────────────────────────
  const loueurById = new Map(loueurs.map((l) => [l.id, l]))

  // item_id → [loueur résolu]
  const loueursByItem = new Map()
  for (const il of itemLoueurs) {
    const l = loueurById.get(il.loueur_id)
    if (!l) continue
    if (!loueursByItem.has(il.item_id)) loueursByItem.set(il.item_id, [])
    loueursByItem.get(il.item_id).push(l)
  }

  // item_id → [commentaires triés asc]
  const commentsByItem = new Map()
  for (const c of comments) {
    if (!commentsByItem.has(c.item_id)) commentsByItem.set(c.item_id, [])
    commentsByItem.get(c.item_id).push(c)
  }
  for (const arr of commentsByItem.values()) {
    arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  }

  // block_id → [items triés]
  const itemsByBlock = new Map()
  for (const it of items) {
    if (!itemsByBlock.has(it.block_id)) itemsByBlock.set(it.block_id, [])
    itemsByBlock.get(it.block_id).push(it)
  }
  for (const arr of itemsByBlock.values()) {
    arr.sort((a, b) => {
      const so = (a.sort_order ?? 0) - (b.sort_order ?? 0)
      if (so !== 0) return so
      return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    })
  }

  // ─── Enrichissement des items (loueurs + comments collés) ───────────
  const enrichItem = (it) => ({
    ...it,
    loueurs: loueursByItem.get(it.id) || [],
    comments: commentsByItem.get(it.id) || [],
  })

  // ─── Construction du bilan GLOBAL ────────────────────────────────────
  const globalBlocks = blocks.map((block) => {
    const arr = (itemsByBlock.get(block.id) || []).map(enrichItem)
    return { block, items: arr, stats: computeStats(arr) }
  })
  const globalStats = computeStats(items.map(enrichItem))

  const globalSection = {
    blocks: globalBlocks,
    stats: globalStats,
    closedAt: version?.closed_at ?? null,
    closedByName: version?.closed_by_name ?? null,
  }

  // ─── Construction des bilans PAR LOUEUR ───────────────────────────────
  // On itère sur les loueurs connus + on détecte si un bucket "Sans loueur"
  // est nécessaire (au moins un item qui n'a aucun tag).
  const byLoueur = []

  // Ordre : l'ordre des loueurs tel que fourni par la RPC (déjà cohérent avec
  // l'UI /check/:token). On ne re-trie pas.
  for (const loueur of loueurs) {
    const section = buildLoueurSection({
      loueur,
      blocks,
      itemsByBlock,
      enrichItem,
      predicate: (it) =>
        (loueursByItem.get(it.id) || []).some((l) => l?.id === loueur.id),
    })
    // Ne pas pousser un bucket vide (loueur sans aucun item) — ça arrive si
    // le loueur a été créé dans la BDD mais jamais assigné.
    if (section.blocks.some((b) => b.items.length > 0)) {
      byLoueur.push(section)
    }
  }

  // Bucket "Sans loueur" : items qui n'ont AUCUN tag.
  const noLoueurSection = buildLoueurSection({
    loueur: null,
    blocks,
    itemsByBlock,
    enrichItem,
    predicate: (it) => (loueursByItem.get(it.id) || []).length === 0,
  })
  if (noLoueurSection.blocks.some((b) => b.items.length > 0)) {
    byLoueur.push(noLoueurSection)
  }

  return {
    project,
    version,
    global: globalSection,
    byLoueur,
  }
}

// ─── Helpers internes ──────────────────────────────────────────────────────

function buildLoueurSection({ loueur, blocks, itemsByBlock, enrichItem, predicate }) {
  const sectionBlocks = []
  const flatItems = []
  for (const block of blocks) {
    const arr = (itemsByBlock.get(block.id) || [])
      .filter(predicate)
      .map(enrichItem)
    sectionBlocks.push({ block, items: arr, stats: computeStats(arr) })
    for (const it of arr) flatItems.push(it)
  }
  return {
    loueur, // null pour "Sans loueur"
    blocks: sectionBlocks,
    stats: computeStats(flatItems),
  }
}

function computeStats(items) {
  const stats = emptyStats()
  for (const it of items || []) {
    const isRemoved = Boolean(it?.removed_at)
    const isAdditif = Boolean(it?.added_during_check)
    if (isAdditif) stats.additifs += 1
    if (isRemoved) {
      stats.removed += 1
      continue
    }
    stats.total += 1
    if (it?.pre_check_at) stats.checked += 1
    const flag = it?.flag
    if (flag === 'ok') stats.byFlag.ok += 1
    else if (flag === 'attention') stats.byFlag.attention += 1
    else if (flag === 'probleme') stats.byFlag.probleme += 1
    else stats.byFlag.none += 1
  }
  stats.ratio = stats.total > 0 ? stats.checked / stats.total : 0
  return stats
}

function emptyStats() {
  return {
    total: 0,
    checked: 0,
    removed: 0,
    additifs: 0,
    ratio: 0,
    byFlag: { ok: 0, attention: 0, probleme: 0, none: 0 },
  }
}

// ─── Utilitaires exportés (filenames, labels) ─────────────────────────────

/**
 * Construit un label version lisible : "V1" ou "V1 — Essais plateau".
 */
export function versionLabel(version) {
  if (!version) return ''
  const num = `V${version.numero ?? version.version_number ?? '?'}`
  return version.label ? `${num} — ${version.label}` : num
}

/**
 * Slugifie un texte (ASCII lowercase, tirets). Utilisé pour les filenames.
 */
export function slug(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/**
 * Construit un filename pour un PDF bilan.
 *   ex. "MTX-2026-03_v1_bilan.pdf"
 *       "MTX-2026-03_v1_bilan_loueur-lux-camera.pdf"
 */
export function bilanPdfFilename({ project, version, loueur = null }) {
  const parts = [
    project?.ref_projet || slug(project?.title || 'projet'),
    version ? `v${version.numero ?? version.version_number ?? 1}` : null,
    'bilan',
    loueur ? `loueur-${slug(loueur.nom)}` : null,
  ].filter(Boolean)
  return `${parts.join('_')}.pdf`
}

/**
 * Construit un filename pour le ZIP d'archive bilan.
 *   ex. "MTX-2026-03_v1_bilan.zip"
 */
export function bilanZipFilename({ project, version }) {
  const parts = [
    project?.ref_projet || slug(project?.title || 'projet'),
    version ? `v${version.numero ?? version.version_number ?? 1}` : null,
    'bilan',
  ].filter(Boolean)
  return `${parts.join('_')}.zip`
}
