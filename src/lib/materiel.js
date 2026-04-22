// ════════════════════════════════════════════════════════════════════════════
// materiel.js — Helpers pour l'Outil Matériel (refonte "blocs simples")
// ════════════════════════════════════════════════════════════════════════════
//
// Architecture DB (miroir de la migration 20260421_mat_refonte_blocs.sql) :
//   matos_versions (project_id, numero, label, is_active, archived_at...)
//     └ matos_blocks (version_id, titre, couleur, affichage, sort_order)
//         └ matos_items (block_id, label?, designation, qte, materiel_bdd_id,
//                        flag, triple checklist, remarques, sort_order)
//             └ matos_item_loueurs (pivot multi-loueurs)
//
//   materiel_bdd       (catalogue autonome, org-scoped)
//   fournisseurs       (loueurs = fournisseurs avec is_loueur_matos=true)
//
// Principes :
//   - Toutes les mutations passent par `supabase.from(...)` → les RLS
//     `can_read_outil / can_edit_outil` font le gating DB.
//   - Un seul type d'item polymorphe (label optionnel). Si label est rempli,
//     la ligne rend en mode "config caméra" côté UI.
//   - Clé d'agrégation du récap loueurs : materiel_bdd_id (fallback sur
//     texte normalisé de la désignation si NULL).
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// ═══ Constantes ═════════════════════════════════════════════════════════════

export const MATOS_FLAGS = {
  ok: {
    key: 'ok',
    label: 'OK',
    color: 'var(--green)',
    bg: 'var(--green-bg)',
  },
  attention: {
    key: 'attention',
    label: 'À vérifier',
    color: 'var(--orange, #f59e0b)',
    bg: 'var(--orange-bg, rgba(245,158,11,.12))',
  },
  probleme: {
    key: 'probleme',
    label: 'Problème',
    color: 'var(--red)',
    bg: 'var(--red-bg)',
  },
}

// Les 3 types de check : utilisés par toggleCheck et l'UI.
export const MATOS_CHECK_TYPES = ['pre', 'post', 'prod']

// Modes d'affichage d'un bloc (valeurs DB).
export const MATOS_BLOCK_AFFICHAGES = {
  liste: { key: 'liste', label: 'Liste' },
  config: { key: 'config', label: 'Config caméra' },
}

// Suggestions de titres pour un nouveau bloc vierge (empty state / menu rapide).
// N'inclut que des blocs en mode "liste" (départements). Les configs caméra
// sont dans MATOS_BLOCK_TEMPLATES ci-dessous (pré-remplies).
export const MATOS_BLOCK_SUGGESTIONS = [
  { titre: 'CAMÉRA', affichage: 'liste' },
  { titre: 'MACHINERIE', affichage: 'liste' },
  { titre: 'LUMIÈRE', affichage: 'liste' },
  { titre: 'SON', affichage: 'liste' },
  { titre: 'RÉGIE', affichage: 'liste' },
]

// ─── Templates de blocs config (pré-remplis à la création) ─────────────────
//
// Chaque template crée un bloc `affichage='config'` avec un titre auto-
// incrémenté (CAM LIVE 1, 2, 3…) et insère des items dont le `label` est
// pré-rempli. La `designation` reste vide, l'utilisateur la tape après.
// Les items sont éditables/supprimables individuellement.
export const MATOS_BLOCK_TEMPLATES = {
  cam_live: {
    key: 'cam_live',
    displayName: 'Cam live',
    titrePrefix: 'CAM LIVE',
    affichage: 'config',
    itemLabels: [
      'Corps caméra',
      'Optique',
      'Bague',
      'Machinerie',
      'FIZ',
      'Moniteur',
      'Batteries',
      'Liaison',
      'RCP',
      'Accessoire',
    ],
  },
  cam_pub: {
    key: 'cam_pub',
    displayName: 'Cam pub',
    titrePrefix: 'CAM PUB',
    affichage: 'config',
    itemLabels: [
      'Corps caméra',
      'Optique',
      'Bague',
      'Moniteur',
      'Batteries',
      'Data',
      'Machinerie',
      'Accessoires',
    ],
  },
}

/**
 * Calcule le prochain titre auto-incrémenté pour un template donné.
 * Ex. avec `prefix="CAM LIVE"` et des blocs ["CAM LIVE 1", "CAM LIVE 2"] → "CAM LIVE 3".
 * Ignore la casse et accepte un espace ou non après le préfixe.
 */
export function nextTemplateTitle(blocks = [], prefix) {
  if (!prefix) return 'Nouveau bloc'
  const re = new RegExp(`^\\s*${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*(\\d+)\\b`, 'i')
  let max = 0
  for (const b of blocks) {
    const m = re.exec(b.titre || '')
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix} ${max + 1}`
}

// Couleurs par défaut proposées lors de la création d'un loueur.
export const LOUEUR_COLOR_PRESETS = [
  '#22c55e', // vert
  '#eab308', // jaune
  '#3b82f6', // bleu
  '#ec4899', // rose
  '#8b5cf6', // violet
  '#ef4444', // rouge
  '#64748b', // gris
  '#f97316', // orange
]

// ═══ Fetch helpers ═══════════════════════════════════════════════════════════

/**
 * Charge toutes les versions d'un projet (triées par numéro).
 */
export async function fetchVersions(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('matos_versions')
    .select(
      'id, project_id, numero, label, is_active, archived_at, notes, created_at, created_by',
    )
    .eq('project_id', projectId)
    .order('numero', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Charge le détail complet d'une version : blocs + items + pivots loueurs.
 */
export async function fetchVersionDetails(versionId) {
  if (!versionId) return { blocks: [], items: [], itemLoueurs: [] }

  // 1. Blocs
  const { data: blocks, error: bErr } = await supabase
    .from('matos_blocks')
    .select('*')
    .eq('version_id', versionId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (bErr) throw bErr
  if (!blocks?.length) return { blocks: [], items: [], itemLoueurs: [] }

  // 2. Items des blocs
  const blockIds = blocks.map((b) => b.id)
  const { data: items, error: iErr } = await supabase
    .from('matos_items')
    .select('*')
    .in('block_id', blockIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (iErr) throw iErr

  // 3. Pivots loueurs des items
  let itemLoueurs = []
  const itemIds = (items || []).map((i) => i.id)
  if (itemIds.length) {
    const { data: ils, error: lErr } = await supabase
      .from('matos_item_loueurs')
      .select('*')
      .in('item_id', itemIds)
      .order('sort_order', { ascending: true })
    if (lErr) throw lErr
    itemLoueurs = ils || []
  }

  return { blocks, items: items || [], itemLoueurs }
}

/**
 * Charge le catalogue materiel_bdd de l'org courante (RLS l'isole).
 */
export async function fetchMaterielBdd() {
  const { data, error } = await supabase
    .from('materiel_bdd')
    .select('*')
    .eq('actif', true)
    .order('nom', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Charge la liste des loueurs matos (= fournisseurs avec is_loueur_matos=true).
 */
export async function fetchLoueurs() {
  const { data, error } = await supabase
    .from('fournisseurs')
    .select('id, nom, couleur, is_loueur_matos, actif, org_id')
    .eq('is_loueur_matos', true)
    .eq('actif', true)
    .order('nom', { ascending: true })
  if (error) throw error
  return data || []
}

// ═══ Mutations — Versions ═══════════════════════════════════════════════════

/**
 * Crée une nouvelle version vide. Devient automatiquement la version active ;
 * les autres actives du projet passent en archivées (une seule active à la fois).
 */
export async function createVersion({ projectId, label = null }) {
  // 1. Calcule le prochain numero pour ce projet.
  const { data: existing, error: exErr } = await supabase
    .from('matos_versions')
    .select('numero')
    .eq('project_id', projectId)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (exErr) throw exErr
  const nextNumero = (existing?.numero || 0) + 1

  // 2. Archive la version active (s'il y en a une).
  await supabase
    .from('matos_versions')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('is_active', true)

  // 3. Crée la nouvelle version active.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: newVersion, error: insErr } = await supabase
    .from('matos_versions')
    .insert({
      project_id: projectId,
      numero: nextNumero,
      label,
      is_active: true,
      created_by: user?.id || null,
    })
    .select()
    .single()
  if (insErr) throw insErr

  return newVersion
}

/**
 * Duplique une version existante (blocs + items + pivots loueurs).
 * Pattern miroir de duplicateDevis : clone tout sauf les timestamps de
 * checklist (une nouvelle version = checks vierges).
 * La version source reste active ; la nouvelle version devient la nouvelle active.
 */
export async function duplicateVersion({ sourceVersionId }) {
  // 1. Récupère la source + ses détails.
  const { data: src, error: srcErr } = await supabase
    .from('matos_versions')
    .select('*')
    .eq('id', sourceVersionId)
    .single()
  if (srcErr) throw srcErr

  const { blocks, items, itemLoueurs } = await fetchVersionDetails(sourceVersionId)

  // 2. Calcule le prochain numero sur ce projet.
  const { data: existing, error: exErr } = await supabase
    .from('matos_versions')
    .select('numero')
    .eq('project_id', src.project_id)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (exErr) throw exErr
  const nextNumero = (existing?.numero || 0) + 1

  // 3. Archive la version active courante (pas nécessairement la source).
  await supabase
    .from('matos_versions')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('project_id', src.project_id)
    .eq('is_active', true)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 4. Insère la nouvelle version.
  const { data: newVersion, error: vErr } = await supabase
    .from('matos_versions')
    .insert({
      project_id: src.project_id,
      numero: nextNumero,
      label: src.label ? `${src.label} (copie)` : null,
      is_active: true,
      notes: src.notes,
      created_by: user?.id || null,
    })
    .select()
    .single()
  if (vErr) throw vErr

  // 5. Clone les blocs avec mapping oldBlockId → newBlockId.
  const blockIdMap = new Map()
  if (blocks.length) {
    const rows = blocks.map((b) => ({
      version_id: newVersion.id,
      titre: b.titre,
      couleur: b.couleur,
      affichage: b.affichage,
      sort_order: b.sort_order,
    }))
    const { data: inserted, error: bErr } = await supabase
      .from('matos_blocks')
      .insert(rows)
      .select('id, sort_order')
    if (bErr) throw bErr
    blocks.forEach((orig, idx) => blockIdMap.set(orig.id, inserted[idx].id))
  }

  // 6. Clone les items avec mapping oldItemId → newItemId.
  // Les timestamps de checklist ne sont PAS reportés (checks vierges).
  const itemIdMap = new Map()
  if (items.length) {
    const rows = items.map((i) => ({
      block_id: blockIdMap.get(i.block_id),
      materiel_bdd_id: i.materiel_bdd_id,
      label: i.label,
      designation: i.designation,
      quantite: i.quantite,
      remarques: i.remarques,
      flag: i.flag,
      sort_order: i.sort_order,
    }))
    const { data: inserted, error: iErr } = await supabase
      .from('matos_items')
      .insert(rows)
      .select('id, sort_order')
    if (iErr) throw iErr
    items.forEach((orig, idx) => itemIdMap.set(orig.id, inserted[idx].id))
  }

  // 7. Clone les pivots loueurs.
  if (itemLoueurs.length) {
    const rows = itemLoueurs
      .map((il) => ({
        item_id: itemIdMap.get(il.item_id),
        loueur_id: il.loueur_id,
        numero_reference: il.numero_reference,
        sort_order: il.sort_order,
      }))
      .filter((r) => r.item_id)
    if (rows.length) {
      const { error: lErr } = await supabase.from('matos_item_loueurs').insert(rows)
      if (lErr) throw lErr
    }
  }

  return newVersion
}

export async function archiveVersion(versionId) {
  const { data, error } = await supabase
    .from('matos_versions')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('id', versionId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Restaure une version archivée : elle redevient active. Si une autre version
 * du même projet est active, elle est archivée automatiquement.
 */
export async function restoreVersion(versionId) {
  const { data: target, error: tErr } = await supabase
    .from('matos_versions')
    .select('project_id')
    .eq('id', versionId)
    .single()
  if (tErr) throw tErr

  // Archive toutes les autres actives du même projet.
  await supabase
    .from('matos_versions')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('project_id', target.project_id)
    .eq('is_active', true)
    .neq('id', versionId)

  const { data, error } = await supabase
    .from('matos_versions')
    .update({ is_active: true, archived_at: null })
    .eq('id', versionId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateVersion(versionId, fields) {
  const allowed = ['label', 'notes']
  const payload = {}
  for (const k of allowed) if (k in fields) payload[k] = fields[k]
  if (!Object.keys(payload).length) return null
  const { data, error } = await supabase
    .from('matos_versions')
    .update(payload)
    .eq('id', versionId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteVersion(versionId) {
  const { error } = await supabase.from('matos_versions').delete().eq('id', versionId)
  if (error) throw error
}

// ═══ Mutations — Blocks ═════════════════════════════════════════════════════

export async function createBlock({
  versionId,
  titre,
  affichage = 'liste',
  sortOrder = 0,
  couleur = null,
  description = null,
}) {
  const { data, error } = await supabase
    .from('matos_blocks')
    .insert({
      version_id: versionId,
      titre,
      affichage,
      sort_order: sortOrder,
      couleur,
      description,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateBlock(blockId, fields) {
  const allowed = ['titre', 'affichage', 'couleur', 'sort_order', 'description']
  const payload = {}
  for (const k of allowed) if (k in fields) payload[k] = fields[k]
  if (!Object.keys(payload).length) return null
  const { data, error } = await supabase
    .from('matos_blocks')
    .update(payload)
    .eq('id', blockId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Duplique un bloc entier (items + loueurs attachés), dans la même version.
 * - Le nouveau bloc est placé en fin de version (sort_order = max + 1).
 * - Titre = "<titre source> (copie)".
 * - `description`, `couleur` et `affichage` sont copiés tels quels.
 * - Items copiés : label, designation, quantite, remarques, flag, sort_order.
 * - **Loueurs attachés copiés** (numero_reference inclus).
 * - **Checklist NON copiée** (pre/post/prod_check_at et _by repartent à null).
 */
export async function duplicateBlock(blockId) {
  // 1. Bloc source
  const { data: src, error: srcErr } = await supabase
    .from('matos_blocks')
    .select('*')
    .eq('id', blockId)
    .single()
  if (srcErr) throw srcErr

  // 2. Items source + pivots loueurs
  const { data: items, error: iErr } = await supabase
    .from('matos_items')
    .select('*')
    .eq('block_id', blockId)
    .order('sort_order', { ascending: true })
  if (iErr) throw iErr

  const itemIds = (items || []).map((i) => i.id)
  let itemLoueurs = []
  if (itemIds.length) {
    const { data, error } = await supabase
      .from('matos_item_loueurs')
      .select('*')
      .in('item_id', itemIds)
      .order('sort_order', { ascending: true })
    if (error) throw error
    itemLoueurs = data || []
  }

  // 3. Calcule le sort_order du nouveau bloc (fin de la version)
  const { data: siblings, error: sErr } = await supabase
    .from('matos_blocks')
    .select('sort_order')
    .eq('version_id', src.version_id)
  if (sErr) throw sErr
  const maxOrder = (siblings || []).reduce(
    (max, b) => Math.max(max, b.sort_order || 0),
    0,
  )

  // 4. Insère le nouveau bloc
  const { data: newBlock, error: bErr } = await supabase
    .from('matos_blocks')
    .insert({
      version_id: src.version_id,
      titre: `${src.titre} (copie)`,
      affichage: src.affichage,
      couleur: src.couleur,
      description: src.description,
      sort_order: maxOrder + 1,
    })
    .select()
    .single()
  if (bErr) throw bErr

  // 5. Insère les items dupliqués (checks vierges, pas de timestamps)
  const itemIdMap = new Map()
  if (items.length) {
    const rows = items.map((i) => ({
      block_id: newBlock.id,
      materiel_bdd_id: i.materiel_bdd_id,
      label: i.label,
      designation: i.designation,
      quantite: i.quantite,
      remarques: i.remarques,
      flag: i.flag,
      sort_order: i.sort_order,
      // pre/post/prod_check_at et _by volontairement omis → null
    }))
    const { data: inserted, error: insErr } = await supabase
      .from('matos_items')
      .insert(rows)
      .select('id, sort_order')
    if (insErr) throw insErr
    items.forEach((orig, idx) => itemIdMap.set(orig.id, inserted[idx].id))
  }

  // 6. Duplique les pivots loueurs (via itemIdMap)
  if (itemLoueurs.length) {
    const rows = itemLoueurs
      .map((il) => ({
        item_id: itemIdMap.get(il.item_id),
        loueur_id: il.loueur_id,
        numero_reference: il.numero_reference,
        sort_order: il.sort_order,
      }))
      .filter((r) => r.item_id)
    if (rows.length) {
      const { error: lErr } = await supabase.from('matos_item_loueurs').insert(rows)
      if (lErr) throw lErr
    }
  }

  return newBlock
}

export async function reorderBlocks(orderedIds) {
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('matos_blocks').update({ sort_order: idx }).eq('id', id),
    ),
  )
}

export async function deleteBlock(blockId) {
  // Les items du bloc sont supprimés en cascade (FK ON DELETE CASCADE).
  const { error } = await supabase.from('matos_blocks').delete().eq('id', blockId)
  if (error) throw error
}

// ═══ Mutations — Items ══════════════════════════════════════════════════════

export async function createItem({ blockId, data = {} }) {
  // NB: `designation` peut être une chaîne vide — le rendu affiche alors
  // un placeholder cliquable (cf. DesignationAutocomplete). On utilise donc
  // `??` (pas `||`) pour ne PAS remplacer '' par un texte pré-rempli.
  const payload = {
    block_id: blockId,
    label: data.label || null,
    designation: data.designation ?? '',
    quantite: data.quantite ?? 1,
    remarques: data.remarques || null,
    flag: data.flag || 'ok',
    materiel_bdd_id: data.materiel_bdd_id || null,
    sort_order: data.sort_order ?? 0,
  }
  const { data: inserted, error } = await supabase
    .from('matos_items')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return inserted
}

export async function updateItem(itemId, fields) {
  // Champs éditables (hors checks, gérés par toggleCheck).
  const allowed = [
    'label',
    'designation',
    'quantite',
    'remarques',
    'flag',
    'materiel_bdd_id',
    'block_id',
    'sort_order',
  ]
  const payload = {}
  for (const k of allowed) if (k in fields) payload[k] = fields[k]
  if (!Object.keys(payload).length) return null
  const { data, error } = await supabase
    .from('matos_items')
    .update(payload)
    .eq('id', itemId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function reorderItems(orderedIds) {
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('matos_items').update({ sort_order: idx }).eq('id', id),
    ),
  )
}

export async function deleteItem(itemId) {
  const { error } = await supabase.from('matos_items').delete().eq('id', itemId)
  if (error) throw error
}

/**
 * Coche/décoche un check d'item. Si déjà coché → reset à null.
 * Sinon → timestamp now() + user courant.
 * @param {'pre'|'post'|'prod'} type
 */
export async function toggleCheck(itemId, type) {
  if (!MATOS_CHECK_TYPES.includes(type)) {
    throw new Error(`toggleCheck: type invalide ${type}`)
  }
  const atCol = `${type}_check_at`
  const byCol = `${type}_check_by`

  const { data: item, error: rErr } = await supabase
    .from('matos_items')
    .select(`id, ${atCol}`)
    .eq('id', itemId)
    .single()
  if (rErr) throw rErr

  const currentlyChecked = Boolean(item[atCol])
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const payload = currentlyChecked
    ? { [atCol]: null, [byCol]: null }
    : { [atCol]: new Date().toISOString(), [byCol]: user?.id || null }

  const { data, error } = await supabase
    .from('matos_items')
    .update(payload)
    .eq('id', itemId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function setItemFlag(itemId, flag) {
  if (!MATOS_FLAGS[flag]) throw new Error(`setItemFlag: flag invalide ${flag}`)
  const { data, error } = await supabase
    .from('matos_items')
    .update({ flag })
    .eq('id', itemId)
    .select()
    .single()
  if (error) throw error
  return data
}

// ═══ Mutations — Loueurs sur item ═══════════════════════════════════════════

export async function addLoueurToItem({ itemId, loueurId, numeroReference = null, sortOrder = 0 }) {
  const { data, error } = await supabase
    .from('matos_item_loueurs')
    .insert({
      item_id: itemId,
      loueur_id: loueurId,
      numero_reference: numeroReference,
      sort_order: sortOrder,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateItemLoueur(itemLoueurId, fields) {
  const allowed = ['numero_reference', 'sort_order']
  const payload = {}
  for (const k of allowed) if (k in fields) payload[k] = fields[k]
  if (!Object.keys(payload).length) return null
  const { data, error } = await supabase
    .from('matos_item_loueurs')
    .update(payload)
    .eq('id', itemLoueurId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function removeLoueurFromItem(itemLoueurId) {
  const { error } = await supabase
    .from('matos_item_loueurs')
    .delete()
    .eq('id', itemLoueurId)
  if (error) throw error
}

// ═══ Mutations — Fournisseurs (loueurs matos) ══════════════════════════════

export async function createLoueur({ orgId, nom, couleur = null }) {
  const { data, error } = await supabase
    .from('fournisseurs')
    .insert({
      org_id: orgId,
      nom,
      couleur,
      is_loueur_matos: true,
      actif: true,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateLoueurCouleur(fournisseurId, couleur) {
  const { data, error } = await supabase
    .from('fournisseurs')
    .update({ couleur })
    .eq('id', fournisseurId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function toggleLoueurActif(fournisseurId, actif) {
  const { data, error } = await supabase
    .from('fournisseurs')
    .update({ actif })
    .eq('id', fournisseurId)
    .select()
    .single()
  if (error) throw error
  return data
}

// ═══ Mutations — materiel_bdd (catalogue) ══════════════════════════════════

export async function createMaterielBdd({
  orgId,
  nom,
  categorieSuggeree = null,
  sousCategorieSuggeree = null,
  description = null,
  tags = [],
}) {
  const { data, error } = await supabase
    .from('materiel_bdd')
    .insert({
      org_id: orgId,
      nom,
      categorie_suggeree: categorieSuggeree,
      sous_categorie_suggeree: sousCategorieSuggeree,
      description,
      tags,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMaterielBdd(id, fields) {
  const allowed = [
    'nom',
    'categorie_suggeree',
    'sous_categorie_suggeree',
    'description',
    'tags',
    'actif',
  ]
  const payload = {}
  for (const k of allowed) if (k in fields) payload[k] = fields[k]
  if (!Object.keys(payload).length) return null
  const { data, error } = await supabase
    .from('materiel_bdd')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteMaterielBdd(id) {
  // Soft delete.
  return updateMaterielBdd(id, { actif: false })
}

// ═══ Helpers dérivés (pure, pas d'I/O) ══════════════════════════════════════

/**
 * Renvoie la version active d'un projet, ou null si toutes archivées.
 */
export function getActiveVersion(versions = []) {
  return versions.find((v) => v.is_active && !v.archived_at) || null
}

/**
 * Groupe les items par block_id. Retourne un Map(blockId -> items[]).
 */
export function groupItemsByBlock(items = []) {
  const map = new Map()
  for (const item of items) {
    const key = item.block_id
    const arr = map.get(key) || []
    arr.push(item)
    map.set(key, arr)
  }
  return map
}

/**
 * Compte les items par flag : { ok, attention, probleme, total }.
 */
export function countFlags(items = []) {
  const counts = { ok: 0, attention: 0, probleme: 0, total: items.length }
  for (const item of items) {
    if (counts[item.flag] !== undefined) counts[item.flag]++
  }
  return counts
}

/**
 * Compte l'avancement de la checklist sur une liste d'items.
 * @returns { pre: {done, total}, post: {done, total}, prod: {done, total} }
 */
export function computeChecklistProgress(items = []) {
  const res = {
    pre: { done: 0, total: items.length },
    post: { done: 0, total: items.length },
    prod: { done: 0, total: items.length },
  }
  for (const item of items) {
    if (item.pre_check_at) res.pre.done++
    if (item.post_check_at) res.post.done++
    if (item.prod_check_at) res.prod.done++
  }
  return res
}

/**
 * Groupe matos_item_loueurs par item_id → Map(itemId -> Array).
 */
export function groupLoueursByItem(itemLoueurs = []) {
  const map = new Map()
  for (const il of itemLoueurs) {
    const arr = map.get(il.item_id) || []
    arr.push(il)
    map.set(il.item_id, arr)
  }
  return map
}

/**
 * Normalise une désignation pour l'agrégation par texte (fallback quand
 * materiel_bdd_id est NULL). Trim + lowercase + espaces consécutifs réduits.
 */
function normalizeDesignation(text = '') {
  return String(text).trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Calcule le récap loueurs de la version active.
 *
 * Algorithme :
 *   1. Parcourt tous les pivots matos_item_loueurs
 *   2. Pour chaque pivot, retrouve l'item → récupère designation, quantite, materiel_bdd_id
 *   3. Groupe par loueur_id puis par clé (materiel_bdd_id si présent, sinon "text:<designation_normalisée>")
 *   4. Somme les quantités
 *
 * @param {Object} args
 * @param {Array} args.items
 * @param {Array} args.itemLoueurs
 * @param {Array} args.loueurs
 * @returns {Array<{ loueur, lignes: Array<{ designation, label, qte, materielBddId, key }> }>}
 *
 * MAT-17 : le `label` est désormais propagé dans les lignes agrégées et
 * participe à la clé d'agrégation. Deux items avec même désignation mais
 * labels différents ("Body" vs "Optique") restent donc distincts dans le
 * récap, ce qui donne du contexte visuel au loueur.
 */
export function computeRecapByLoueur({ items = [], itemLoueurs = [], loueurs = [] }) {
  if (!itemLoueurs.length) return []

  const itemById = new Map()
  for (const item of items) itemById.set(item.id, item)

  const loueurById = new Map()
  for (const l of loueurs) loueurById.set(l.id, l)

  // Structure intermédiaire : Map<loueur_id, Map<aggKey, { designation, label, qte, materielBddId }>>
  const perLoueur = new Map()

  for (const il of itemLoueurs) {
    const item = itemById.get(il.item_id)
    if (!item) continue
    const loueurKey = il.loueur_id
    const labelPart = item.label ? `|l:${item.label.trim().toLowerCase()}` : ''
    const aggKey = item.materiel_bdd_id
      ? `bdd:${item.materiel_bdd_id}${labelPart}`
      : `text:${normalizeDesignation(item.designation)}${labelPart}`

    let byAgg = perLoueur.get(loueurKey)
    if (!byAgg) {
      byAgg = new Map()
      perLoueur.set(loueurKey, byAgg)
    }

    const existing = byAgg.get(aggKey)
    const qty = Number(item.quantite) || 0
    if (existing) {
      existing.qte += qty
    } else {
      byAgg.set(aggKey, {
        key: aggKey,
        designation: item.designation,
        label: item.label || null,
        qte: qty,
        materielBddId: item.materiel_bdd_id || null,
      })
    }
  }

  // Sérialisation triée : par nom de loueur puis par (label, désignation).
  // Les lignes sans label remontent en bas pour grouper visuellement les
  // items étiquetés.
  const result = []
  for (const [loueurId, byAgg] of perLoueur.entries()) {
    const loueur = loueurById.get(loueurId)
    if (!loueur) continue
    const lignes = Array.from(byAgg.values()).sort((a, b) => {
      const la = (a.label || '').toLowerCase()
      const lb = (b.label || '').toLowerCase()
      if (la && !lb) return -1
      if (!la && lb) return 1
      if (la !== lb) return la.localeCompare(lb, 'fr', { sensitivity: 'base' })
      return a.designation.localeCompare(b.designation, 'fr', { sensitivity: 'base' })
    })
    result.push({ loueur, lignes })
  }
  result.sort((a, b) =>
    (a.loueur.nom || '').localeCompare(b.loueur.nom || '', 'fr', { sensitivity: 'base' }),
  )
  return result
}
