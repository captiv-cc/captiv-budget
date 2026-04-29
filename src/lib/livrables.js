// ════════════════════════════════════════════════════════════════════════════
// livrables.js — Data layer pour l'Outil Livrables (LIV-3)
// ════════════════════════════════════════════════════════════════════════════
//
// Architecture DB (miroir migration 20260424_liv1_livrables_schema.sql) :
//   projet_livrable_config  (1-1 projet, en-tête)
//   livrable_blocks         (regroupement, soft delete)
//     └ livrables           (entité principale, soft delete)
//         ├ livrable_versions   (historique V0/V1/VDEF + feedback)
//         └ livrable_etapes     (pipeline + event miroir — voir LIV-4)
//   projet_phases           (phases globales + event multi-jours — LIV-4)
//
// Principes :
//   - Toutes les mutations passent par `supabase.from(...)` → la RLS
//     `can_read_outil(project_id, 'livrables')` / `can_edit_outil(...)` fait
//     le gating DB. On peut donc rester naïf côté lib (pas de check user).
//   - Soft delete via `deleted_at` sur `livrable_blocks` et `livrables`. Les
//     fetchs filtrent par défaut `deleted_at IS NULL`.
//   - LIV-3 N'INSTAURE PAS LA SYNC PLANNING. Les fonctions create/update/delete
//     d'étapes et de phases laissent `event_id` à NULL — c'est `LIV-4` qui
//     ajoutera `livrablesPlanningSync.js` pour gérer le miroir bidirectionnel.
//
// Convention helpers purs : tout ce qui est "in-memory only" vit dans
// `livrablesHelpers.js`. Ici on ne garde que les fonctions qui touchent
// Supabase (ou les couples helper + I/O type `getProjectIdForLivrable`).
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import {
  LIVRABLE_EDITABLE_FIELDS,
  nextLivrableNumero,
  pickAllowed,
  sortBySortOrder,
} from './livrablesHelpers'
import {
  syncEtapeOnCreate,
  syncEtapeOnUpdate,
  syncEtapeOnDelete,
  syncPhaseOnCreate,
  syncPhaseOnUpdate,
  syncPhaseOnDelete,
} from './livrablesPlanningSync'

// Re-export des constantes UI pour faciliter l'import depuis les composants
// (`import { LIVRABLE_STATUTS } from 'src/lib/livrables'`).
export {
  LIVRABLE_STATUTS,
  LIVRABLE_STATUTS_TERMINES,
  LIVRABLE_STATUTS_ACTIFS,
  LIVRABLE_VERSION_STATUTS,
  LIVRABLE_ETAPE_KINDS,
  PROJET_PHASE_KINDS,
  LIVRABLE_BLOCK_COLOR_PRESETS,
  LIVRABLE_EDITABLE_FIELDS,
} from './livrablesHelpers'

// ═══ Fetch helpers ═══════════════════════════════════════════════════════════

/**
 * Charge la config (en-tête) de l'outil Livrables d'un projet.
 * Renvoie null si pas encore créée. La création a lieu paresseusement à la
 * première édition (cf. `upsertConfig`).
 */
export async function fetchConfig(projectId) {
  if (!projectId) return null
  const { data, error } = await supabase
    .from('projet_livrable_config')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

/**
 * Charge tous les blocs d'un projet (non supprimés), triés par sort_order.
 */
export async function fetchBlocks(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('livrable_blocks')
    .select('*')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Charge tous les livrables d'un projet (non supprimés).
 * project_id étant dénormalisé sur la table, on peut filtrer directement.
 */
export async function fetchLivrables(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('livrables')
    .select('*')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Charge toutes les versions historisées des livrables passés.
 * On fait UN appel `.in('livrable_id', [...])` au lieu de N appels en parallèle.
 */
export async function fetchVersions(livrableIds = []) {
  if (!livrableIds.length) return []
  const { data, error } = await supabase
    .from('livrable_versions')
    .select('*')
    .in('livrable_id', livrableIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Charge toutes les étapes pipeline des livrables passés.
 */
export async function fetchEtapes(livrableIds = []) {
  if (!livrableIds.length) return []
  const { data, error } = await supabase
    .from('livrable_etapes')
    .select('*')
    .in('livrable_id', livrableIds)
    .order('date_debut', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Charge toutes les phases d'un projet (triées par date_debut puis date_fin).
 */
export async function fetchPhases(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_phases')
    .select('*')
    .eq('project_id', projectId)
    .order('date_debut', { ascending: true })
    .order('date_fin', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Bundle de chargement complet pour un projet, en parallèle dans la mesure
 * du possible. Hook entry point : 4 round-trips au lieu de 6 en chaînant.
 *
 *   1. Promise.all : config, blocks, livrables, phases
 *   2. Sur retour, déduit livrableIds → Promise.all(versions, etapes)
 */
export async function fetchProjectLivrablesBundle(projectId) {
  if (!projectId) {
    return {
      config:    null,
      blocks:    [],
      livrables: [],
      versions:  [],
      etapes:    [],
      phases:    [],
    }
  }
  const [config, blocks, livrables, phases] = await Promise.all([
    fetchConfig(projectId),
    fetchBlocks(projectId),
    fetchLivrables(projectId),
    fetchPhases(projectId),
  ])
  const livrableIds = livrables.map((l) => l.id)
  const [versions, etapes] = await Promise.all([
    fetchVersions(livrableIds),
    fetchEtapes(livrableIds),
  ])
  return { config, blocks, livrables, versions, etapes, phases }
}

// ═══ Mutations — Config ═════════════════════════════════════════════════════

const CONFIG_EDITABLE_FIELDS = [
  'client_nom',
  'client_logo_url',
  'producteur_postprod',
  'tournage_label',
  'version_numero',
  'notes',
]

/**
 * Upsert la config (en-tête) d'un projet. Crée la ligne si absente.
 * On utilise `onConflict: 'project_id'` (UNIQUE constraint) pour rester
 * idempotent — appel safe peu importe l'état actuel.
 */
export async function upsertConfig(projectId, fields = {}) {
  if (!projectId) throw new Error('upsertConfig: projectId requis')
  const payload = pickAllowed(fields, CONFIG_EDITABLE_FIELDS)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('projet_livrable_config')
    .upsert(
      { project_id: projectId, ...payload, updated_by: user?.id || null },
      { onConflict: 'project_id' },
    )
    .select()
    .single()
  if (error) throw error
  return data
}

// ═══ Mutations — Blocks ═════════════════════════════════════════════════════

const BLOCK_EDITABLE_FIELDS = ['nom', 'prefixe', 'couleur', 'sort_order', 'devis_lot_id']

export async function createBlock({ projectId, nom, prefixe = null, couleur = null, sortOrder }) {
  if (!projectId) throw new Error('createBlock: projectId requis')
  if (!nom?.trim()) throw new Error('createBlock: nom requis')
  // Si pas de sortOrder fourni, on calcule max+1 pour ce projet (1 round-trip
  // de plus, mais reste rare — les actions UI passent leur propre sortOrder).
  let resolvedSort = sortOrder
  if (resolvedSort === undefined || resolvedSort === null) {
    const { data: siblings, error: sErr } = await supabase
      .from('livrable_blocks')
      .select('sort_order')
      .eq('project_id', projectId)
      .is('deleted_at', null)
    if (sErr) throw sErr
    resolvedSort =
      (siblings || []).reduce((max, b) => Math.max(max, b.sort_order || 0), 0) + 1
  }
  const { data, error } = await supabase
    .from('livrable_blocks')
    .insert({
      project_id: projectId,
      nom: nom.trim(),
      prefixe: prefixe ? prefixe.trim().slice(0, 4) : null,
      couleur,
      sort_order: resolvedSort,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateBlock(blockId, fields) {
  const payload = pickAllowed(fields, BLOCK_EDITABLE_FIELDS)
  if (!Object.keys(payload).length) return null
  // Tronque le préfixe si fourni (CHECK contraint à 1-4 caractères côté DB).
  if ('prefixe' in payload && payload.prefixe) {
    payload.prefixe = String(payload.prefixe).trim().slice(0, 4) || null
  }
  const { data, error } = await supabase
    .from('livrable_blocks')
    .update(payload)
    .eq('id', blockId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Soft delete d'un bloc — flag `deleted_at` à now() + cascade applicative
 * sur les livrables du bloc (pour que la corbeille les retrouve groupés).
 */
export async function deleteBlock(blockId) {
  const nowIso = new Date().toISOString()
  // 1. Soft delete des livrables du bloc (sans toucher aux déjà supprimés).
  const { error: lErr } = await supabase
    .from('livrables')
    .update({ deleted_at: nowIso })
    .eq('block_id', blockId)
    .is('deleted_at', null)
  if (lErr) throw lErr
  // 2. Soft delete du bloc lui-même.
  const { error } = await supabase
    .from('livrable_blocks')
    .update({ deleted_at: nowIso })
    .eq('id', blockId)
  if (error) throw error
}

/**
 * Restaure un bloc et ses livrables (cascade applicative inverse).
 * Note : les livrables NON supprimés au moment du soft delete remontent ; ceux
 * supprimés indépendamment avant restent dans la corbeille (`deleted_at`
 * différent). On compare donc le `deleted_at` du bloc à celui de chaque
 * livrable pour ne restaurer que les "tombés ensemble".
 */
export async function restoreBlock(blockId) {
  // 1. Récupère le deleted_at du bloc avant restauration.
  const { data: block, error: rErr } = await supabase
    .from('livrable_blocks')
    .select('id, deleted_at')
    .eq('id', blockId)
    .single()
  if (rErr) throw rErr
  if (!block?.deleted_at) return // déjà actif

  // 2. Restaure le bloc.
  const { error: bErr } = await supabase
    .from('livrable_blocks')
    .update({ deleted_at: null })
    .eq('id', blockId)
  if (bErr) throw bErr

  // 3. Restaure les livrables tombés EN MÊME TEMPS (à la seconde près).
  // On accepte une fenêtre de 5 secondes pour absorber les latences réseau
  // entre les 2 UPDATE de deleteBlock.
  const tDeleted = new Date(block.deleted_at)
  const lo = new Date(tDeleted.getTime() - 5000).toISOString()
  const hi = new Date(tDeleted.getTime() + 5000).toISOString()
  const { error: lErr } = await supabase
    .from('livrables')
    .update({ deleted_at: null })
    .eq('block_id', blockId)
    .gte('deleted_at', lo)
    .lte('deleted_at', hi)
  if (lErr) throw lErr
}

export async function reorderBlocks(orderedIds = []) {
  // Comme MAT-9D : N updates en parallèle. RLS gate côté DB.
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('livrable_blocks').update({ sort_order: idx }).eq('id', id),
    ),
  )
}

// ═══ Mutations — Livrables ══════════════════════════════════════════════════

/**
 * Crée un livrable. Si `numero` n'est pas fourni, il est calculé en
 * lisant les livrables existants du bloc et en cherchant le prochain index
 * libre via `nextLivrableNumero` (helper pur).
 *
 * `block_id` ET `project_id` sont insérés tous les deux (project_id est
 * dénormalisé pour les RLS / queries rapides — voir migration LIV-1).
 */
export async function createLivrable({
  blockId,
  projectId,
  data: input = {},
}) {
  if (!blockId) throw new Error('createLivrable: blockId requis')
  if (!projectId) throw new Error('createLivrable: projectId requis')

  let { numero, sort_order } = input

  // Auto-numero si absent : on lit les livrables actifs du bloc.
  if (!numero) {
    const { data: rows, error: rErr } = await supabase
      .from('livrables')
      .select('numero')
      .eq('block_id', blockId)
      .is('deleted_at', null)
    if (rErr) throw rErr
    const { data: blockRow, error: bErr } = await supabase
      .from('livrable_blocks')
      .select('prefixe')
      .eq('id', blockId)
      .single()
    if (bErr) throw bErr
    numero = nextLivrableNumero(blockRow, rows || [])
  }

  // Auto sort_order si absent : on calcule max+1 pour le bloc.
  if (sort_order === undefined || sort_order === null) {
    const { data: siblings, error: sErr } = await supabase
      .from('livrables')
      .select('sort_order')
      .eq('block_id', blockId)
      .is('deleted_at', null)
    if (sErr) throw sErr
    sort_order =
      (siblings || []).reduce((max, l) => Math.max(max, l.sort_order || 0), 0) + 1
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const payload = {
    block_id: blockId,
    project_id: projectId,
    numero,
    nom: input.nom?.trim() || 'Nouveau livrable',
    format: input.format || null,
    duree: input.duree || null,
    version_label: input.version_label || null,
    statut: input.statut || 'brief',
    projet_dav: input.projet_dav || null,
    assignee_profile_id: input.assignee_profile_id || null,
    assignee_external: input.assignee_external || null,
    date_livraison: input.date_livraison || null,
    lien_frame: input.lien_frame || null,
    lien_drive: input.lien_drive || null,
    devis_lot_id: input.devis_lot_id || null,
    notes: input.notes || null,
    sort_order,
    updated_by: user?.id || null,
  }

  const { data: inserted, error } = await supabase
    .from('livrables')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return inserted
}

export async function updateLivrable(livrableId, fields) {
  const payload = pickAllowed(fields, LIVRABLE_EDITABLE_FIELDS)
  if (!Object.keys(payload).length) return null
  const {
    data: { user },
  } = await supabase.auth.getUser()
  payload.updated_by = user?.id || null
  const { data, error } = await supabase
    .from('livrables')
    .update(payload)
    .eq('id', livrableId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Bulk update : applique le même patch sur N livrables en une seule requête
 * UPDATE … IN (…). C'est la primitive utilisée par `LivrableBulkEditBar`
 * (LIV-14). Whitelist appliquée pour éviter les écritures hors-champ.
 */
export async function bulkUpdateLivrables(livrableIds = [], fields = {}) {
  if (!livrableIds.length) return []
  const payload = pickAllowed(fields, LIVRABLE_EDITABLE_FIELDS)
  if (!Object.keys(payload).length) return []
  const {
    data: { user },
  } = await supabase.auth.getUser()
  payload.updated_by = user?.id || null
  const { data, error } = await supabase
    .from('livrables')
    .update(payload)
    .in('id', livrableIds)
    .select()
  if (error) throw error
  return data || []
}

export async function deleteLivrable(livrableId) {
  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('livrables')
    .update({ deleted_at: nowIso })
    .eq('id', livrableId)
  if (error) throw error
}

export async function restoreLivrable(livrableId) {
  const { error } = await supabase
    .from('livrables')
    .update({ deleted_at: null })
    .eq('id', livrableId)
  if (error) throw error
}

export async function reorderLivrables(orderedIds = []) {
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('livrables').update({ sort_order: idx }).eq('id', id),
    ),
  )
}

/**
 * Duplique un livrable (variante dans le même bloc). Copie tous les champs
 * éditables sauf `numero` (auto-incrémenté), `sort_order` (mis en queue),
 * et le statut (toujours rebascule à 'brief' — c'est une nouvelle item).
 *
 * Les versions historisées et les étapes pipeline ne sont PAS dupliquées :
 * un nouveau livrable repart d'une feuille blanche côté production.
 */
export async function duplicateLivrable(livrableId) {
  // 1. Source.
  const { data: src, error: srcErr } = await supabase
    .from('livrables')
    .select('*')
    .eq('id', livrableId)
    .single()
  if (srcErr) throw srcErr

  // 2. Numero auto + sort en queue.
  return createLivrable({
    blockId: src.block_id,
    projectId: src.project_id,
    data: {
      nom: `${src.nom} (copie)`,
      format: src.format,
      duree: src.duree,
      version_label: null, // nouvelle ligne, pas de version courante
      statut: 'brief',
      projet_dav: src.projet_dav,
      assignee_profile_id: src.assignee_profile_id,
      assignee_external: src.assignee_external,
      date_livraison: null, // l'utilisateur fixe la nouvelle deadline
      lien_frame: null,
      lien_drive: null,
      devis_lot_id: src.devis_lot_id,
      notes: src.notes,
    },
  })
}

// ═══ LIV-13 — Duplication cross-project ════════════════════════════════════

/**
 * Liste les projets de l'org auxquels l'utilisateur a accès en lecture.
 * RLS filtre côté DB — pas besoin de check perm côté client.
 *
 * @param {Object} opts
 * @param {string} opts.orgId             - org courante
 * @param {string} [opts.excludeProjectId] - exclure ce projet (souvent le projet courant)
 * @returns {Promise<Array<{id, title, status, types_projet}>>}
 */
export async function listAccessibleProjects({ orgId, excludeProjectId } = {}) {
  if (!orgId) throw new Error('listAccessibleProjects: orgId requis')
  let q = supabase
    .from('projects')
    .select('id, title, status, types_projet')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
  if (excludeProjectId) q = q.neq('id', excludeProjectId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Liste les blocs livrables (non supprimés) d'un projet — utile pour le
 * sélecteur de bloc cible dans la modal de duplication cross-project.
 */
export async function listBlocksForProject(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('livrable_blocks')
    .select('id, nom, prefixe, couleur, sort_order')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Duplique un livrable vers un autre projet.
 * Reset feuille blanche : statut → brief, version_label/date/liens → null,
 * versions et étapes NON dupliquées (cohérent avec duplicateLivrable
 * same-project). Le devis_lot_id N'est PAS copié — il pointerait sur un lot
 * d'un autre projet, ce qui n'a pas de sens métier.
 *
 * @param {string} srcLivrableId
 * @param {string} targetProjectId
 * @param {Object} [opts]
 * @param {string} [opts.targetBlockId] - bloc cible. Si absent : 1er bloc actif
 *                                        du projet, ou bloc "Importé" auto-créé.
 */
export async function duplicateLivrableToProject(
  srcLivrableId,
  targetProjectId,
  { targetBlockId } = {},
) {
  if (!srcLivrableId) throw new Error('duplicateLivrableToProject: srcLivrableId requis')
  if (!targetProjectId) throw new Error('duplicateLivrableToProject: targetProjectId requis')

  // 1. Source.
  const { data: src, error: srcErr } = await supabase
    .from('livrables')
    .select('*')
    .eq('id', srcLivrableId)
    .single()
  if (srcErr) throw srcErr

  // 2. Bloc cible : si fourni, vérifie qu'il appartient au projet cible.
  let blockId = targetBlockId
  if (blockId) {
    const { data: blk, error: bErr } = await supabase
      .from('livrable_blocks')
      .select('id, project_id')
      .eq('id', blockId)
      .single()
    if (bErr) throw bErr
    if (blk.project_id !== targetProjectId) {
      throw new Error('targetBlockId n\'appartient pas au projet cible')
    }
  } else {
    // Pas de bloc fourni → premier bloc actif, sinon on crée "Importé".
    const { data: existing } = await supabase
      .from('livrable_blocks')
      .select('id')
      .eq('project_id', targetProjectId)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .limit(1)
    if (existing && existing.length > 0) {
      blockId = existing[0].id
    } else {
      const newBlock = await createBlock({
        projectId: targetProjectId,
        nom: 'Importé',
        couleur: '#94a3b8', // slate-400 neutre
      })
      blockId = newBlock.id
    }
  }

  // 3. Crée le livrable dans le bloc cible (feuille blanche).
  return createLivrable({
    blockId,
    projectId: targetProjectId,
    data: {
      nom: `${src.nom} (copie)`,
      format: src.format,
      duree: src.duree,
      version_label: null,
      statut: 'brief',
      projet_dav: src.projet_dav,
      assignee_profile_id: src.assignee_profile_id,
      assignee_external: src.assignee_external,
      date_livraison: null,
      lien_frame: null,
      lien_drive: null,
      // devis_lot_id NON copié — pas pertinent cross-project.
      notes: src.notes,
    },
  })
}

/**
 * Duplique un bloc entier vers un autre projet : crée le nouveau bloc + tous
 * ses livrables actifs (chacun en feuille blanche). Si le nom du bloc est
 * déjà pris dans le projet cible, on suffixe avec "(copie)" ou "(copie N)".
 *
 * @param {string} srcBlockId
 * @param {string} targetProjectId
 * @returns {Promise<{block, livrablesCount}>}
 */
export async function duplicateBlockToProject(srcBlockId, targetProjectId) {
  if (!srcBlockId) throw new Error('duplicateBlockToProject: srcBlockId requis')
  if (!targetProjectId) throw new Error('duplicateBlockToProject: targetProjectId requis')

  // 1. Source bloc.
  const { data: src, error: bErr } = await supabase
    .from('livrable_blocks')
    .select('*')
    .eq('id', srcBlockId)
    .single()
  if (bErr) throw bErr

  // 2. Détermine un nom non-conflictuel dans le projet cible.
  const { data: existing } = await supabase
    .from('livrable_blocks')
    .select('nom')
    .eq('project_id', targetProjectId)
    .is('deleted_at', null)
  const existingNames = new Set((existing || []).map((b) => b.nom))
  let nom = src.nom || 'Sans nom'
  if (existingNames.has(nom)) {
    let candidate = `${nom} (copie)`
    let i = 2
    while (existingNames.has(candidate)) {
      candidate = `${nom} (copie ${i++})`
    }
    nom = candidate
  }

  // 3. Crée le nouveau bloc avec mêmes préfixe/couleur.
  const newBlock = await createBlock({
    projectId: targetProjectId,
    nom,
    prefixe: src.prefixe,
    couleur: src.couleur,
  })

  // 4. Récupère les livrables actifs du bloc source, ordonnés.
  const { data: livrables, error: lErr } = await supabase
    .from('livrables')
    .select('*')
    .eq('block_id', srcBlockId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
  if (lErr) throw lErr

  // 5. Crée chaque livrable dans le nouveau bloc (feuille blanche).
  // Boucle séquentielle pour éviter les conflits de numérotation auto.
  for (const liv of livrables || []) {
    await createLivrable({
      blockId: newBlock.id,
      projectId: targetProjectId,
      data: {
        nom: liv.nom, // pas de "(copie)" — bloc différent, pas de conflit
        format: liv.format,
        duree: liv.duree,
        version_label: null,
        statut: 'brief',
        projet_dav: liv.projet_dav,
        assignee_profile_id: liv.assignee_profile_id,
        assignee_external: liv.assignee_external,
        date_livraison: null,
        lien_frame: null,
        lien_drive: null,
        // devis_lot_id NON copié — cross-project.
        notes: liv.notes,
      },
    })
  }

  return { block: newBlock, livrablesCount: (livrables || []).length }
}

// ═══ Mutations — Versions historisées ═══════════════════════════════════════

const VERSION_EDITABLE_FIELDS = [
  'numero_label',
  'date_envoi',
  'lien_frame',
  'statut_validation',
  'feedback_client',
  'sort_order',
]

export async function addVersion({ livrableId, data: input = {} }) {
  if (!livrableId) throw new Error('addVersion: livrableId requis')
  // sort_order auto en queue.
  const { data: siblings, error: sErr } = await supabase
    .from('livrable_versions')
    .select('sort_order')
    .eq('livrable_id', livrableId)
  if (sErr) throw sErr
  const nextOrder =
    (siblings || []).reduce((max, v) => Math.max(max, v.sort_order || 0), 0) + 1

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const payload = {
    livrable_id: livrableId,
    numero_label: input.numero_label?.trim() || `V${nextOrder}`,
    date_envoi: input.date_envoi || null,
    lien_frame: input.lien_frame || null,
    statut_validation: input.statut_validation || 'en_attente',
    feedback_client: input.feedback_client || null,
    sort_order: input.sort_order ?? nextOrder,
    updated_by: user?.id || null,
  }
  const { data, error } = await supabase
    .from('livrable_versions')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateVersion(versionId, fields) {
  const payload = pickAllowed(fields, VERSION_EDITABLE_FIELDS)
  if (!Object.keys(payload).length) return null
  const {
    data: { user },
  } = await supabase.auth.getUser()
  payload.updated_by = user?.id || null
  const { data, error } = await supabase
    .from('livrable_versions')
    .update(payload)
    .eq('id', versionId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteVersion(versionId) {
  const { error } = await supabase
    .from('livrable_versions')
    .delete()
    .eq('id', versionId)
  if (error) throw error
}

// ═══ Mutations — Étapes pipeline ════════════════════════════════════════════
// Depuis LIV-4 : chaque mutation appelle `livrablesPlanningSync` pour tenir
// à jour l'event miroir (insert/update/delete selon is_event et le diff).
// La sync ne throw JAMAIS : si elle échoue, on log et on continue — l'étape
// est cohérente côté DB, c'est juste l'event planning qui peut être désynchro,
// rattrapé par `backfillMirrorEvents` à l'initialisation suivante.

const ETAPE_EDITABLE_FIELDS = [
  'nom',
  'kind',
  'event_type_id',     // LIV-9 — type planning (remplace l'enum kind côté UI)
  'date_debut',
  'date_fin',
  'assignee_profile_id',
  'assignee_external', // LIV-9 — pendant texte libre du `assignee_profile_id`
  'couleur',
  'notes',
  'sort_order',
  'is_event',
]

export async function addEtape({ livrableId, data: input = {} }) {
  if (!livrableId) throw new Error('addEtape: livrableId requis')
  if (!input.date_debut || !input.date_fin) {
    throw new Error('addEtape: date_debut et date_fin requis')
  }
  // On doit connaître le project_id de l'étape pour créer l'event miroir.
  // Le livrable_id permet de le récupérer (1 round-trip — mineure).
  const { data: livrable, error: lErr } = await supabase
    .from('livrables')
    .select('project_id')
    .eq('id', livrableId)
    .single()
  if (lErr) throw lErr
  const projectId = livrable?.project_id

  // sort_order auto en queue.
  const { data: siblings, error: sErr } = await supabase
    .from('livrable_etapes')
    .select('sort_order')
    .eq('livrable_id', livrableId)
  if (sErr) throw sErr
  const nextOrder =
    (siblings || []).reduce((max, e) => Math.max(max, e.sort_order || 0), 0) + 1

  const payload = {
    livrable_id: livrableId,
    nom: input.nom?.trim() || 'Nouvelle étape',
    kind: input.kind || 'autre',
    event_type_id: input.event_type_id || null, // LIV-9
    date_debut: input.date_debut,
    date_fin: input.date_fin,
    assignee_profile_id: input.assignee_profile_id || null,
    assignee_external: input.assignee_external?.trim() || null, // LIV-9
    couleur: input.couleur || null,
    notes: input.notes || null,
    sort_order: input.sort_order ?? nextOrder,
    is_event: input.is_event !== false, // default true
    // event_id omis → NULL. La sync le posera après création de l'event.
  }
  const { data, error } = await supabase
    .from('livrable_etapes')
    .insert(payload)
    .select()
    .single()
  if (error) throw error

  // Forward sync → INSERT events + pose etape.event_id.
  // NB : la fonction recharge data après sync pour renvoyer un objet à jour.
  if (projectId) {
    await syncEtapeOnCreate(data, projectId)
    const { data: refreshed } = await supabase
      .from('livrable_etapes')
      .select('*')
      .eq('id', data.id)
      .single()
    return refreshed || data
  }
  return data
}

export async function updateEtape(etapeId, fields) {
  const payload = pickAllowed(fields, ETAPE_EDITABLE_FIELDS)
  if (!Object.keys(payload).length) return null
  const { data, error } = await supabase
    .from('livrable_etapes')
    .update(payload)
    .eq('id', etapeId)
    .select()
    .single()
  if (error) throw error

  // Forward sync → update / create / delete event miroir selon diff.
  // Pour connaître le projectId, on remonte via livrable_id (étape → livrable).
  const { data: livrable } = await supabase
    .from('livrables')
    .select('project_id')
    .eq('id', data.livrable_id)
    .single()
  const projectId = livrable?.project_id
  if (projectId) {
    await syncEtapeOnUpdate({ etape: data, patch: payload, projectId })
    // Re-fetch pour renvoyer l'éventuel event_id fraîchement posé.
    const { data: refreshed } = await supabase
      .from('livrable_etapes')
      .select('*')
      .eq('id', etapeId)
      .single()
    return refreshed || data
  }
  return data
}

export async function deleteEtape(etapeId) {
  // Forward sync → supprime AVANT l'event miroir pour ne pas violer le CHECK
  // `events_source_fk_consistency` (cf. doc de `livrablesPlanningSync`).
  await syncEtapeOnDelete(etapeId)
  const { error } = await supabase
    .from('livrable_etapes')
    .delete()
    .eq('id', etapeId)
  if (error) throw error
}

// ═══ Mutations — Phases projet ══════════════════════════════════════════════

const PHASE_EDITABLE_FIELDS = [
  'nom',
  'kind',
  'date_debut',
  'date_fin',
  'couleur',
  'notes',
]

export async function addPhase({ projectId, data: input = {} }) {
  if (!projectId) throw new Error('addPhase: projectId requis')
  if (!input.date_debut || !input.date_fin) {
    throw new Error('addPhase: date_debut et date_fin requis')
  }
  const payload = {
    project_id: projectId,
    nom: input.nom?.trim() || 'Nouvelle phase',
    kind: input.kind || 'autre',
    date_debut: input.date_debut,
    date_fin: input.date_fin,
    couleur: input.couleur || null,
    notes: input.notes || null,
    // event_id omis → NULL. La sync le posera après création de l'event.
  }
  const { data, error } = await supabase
    .from('projet_phases')
    .insert(payload)
    .select()
    .single()
  if (error) throw error

  // Forward sync : toujours créer l'event miroir pour une phase (pas de
  // flag is_event — voir shouldPhaseHaveEvent dans livrablesPlanningSync).
  await syncPhaseOnCreate(data, projectId)
  const { data: refreshed } = await supabase
    .from('projet_phases')
    .select('*')
    .eq('id', data.id)
    .single()
  return refreshed || data
}

export async function updatePhase(phaseId, fields) {
  const payload = pickAllowed(fields, PHASE_EDITABLE_FIELDS)
  if (!Object.keys(payload).length) return null
  const { data, error } = await supabase
    .from('projet_phases')
    .update(payload)
    .eq('id', phaseId)
    .select()
    .single()
  if (error) throw error

  // Forward sync event miroir.
  if (data?.project_id) {
    await syncPhaseOnUpdate({ phase: data, patch: payload, projectId: data.project_id })
    const { data: refreshed } = await supabase
      .from('projet_phases')
      .select('*')
      .eq('id', phaseId)
      .single()
    return refreshed || data
  }
  return data
}

export async function deletePhase(phaseId) {
  // Forward sync : supprime l'event miroir AVANT pour respecter le CHECK DB.
  await syncPhaseOnDelete(phaseId)
  const { error } = await supabase
    .from('projet_phases')
    .delete()
    .eq('id', phaseId)
  if (error) throw error
}

// ═══ Duplication cross-project (LIV-13 — primitive utilisée par modal) ══════

/**
 * Duplique blocs + livrables + phases d'un projet source vers un projet
 * destination. Les versions historisées et étapes pipeline ne sont PAS
 * propagées (un nouveau projet repart de zéro côté post-prod).
 *
 * Les options permettent de choisir quoi importer (cas typique : "blocs +
 * structure mais pas les phases").
 *
 * @returns {{ blockIdMap, livrableIdMap, phaseIds }} - mappings pour audit.
 */
export async function duplicateFromProject({
  sourceProjectId,
  targetProjectId,
  includeBlocks = true,
  includeLivrables = true,
  includePhases = true,
}) {
  if (!sourceProjectId || !targetProjectId) {
    throw new Error('duplicateFromProject: sourceProjectId et targetProjectId requis')
  }
  if (sourceProjectId === targetProjectId) {
    throw new Error('duplicateFromProject: source et destination identiques')
  }

  const blockIdMap = new Map()
  const livrableIdMap = new Map()
  const phaseIds = []

  // 1. Blocks
  if (includeBlocks || includeLivrables) {
    const srcBlocks = await fetchBlocks(sourceProjectId)
    if (srcBlocks.length) {
      const sortedBlocks = sortBySortOrder(srcBlocks)
      for (const b of sortedBlocks) {
        const newBlock = await createBlock({
          projectId: targetProjectId,
          nom: b.nom,
          prefixe: b.prefixe,
          couleur: b.couleur,
          sortOrder: b.sort_order,
        })
        blockIdMap.set(b.id, newBlock.id)
      }
    }
  }

  // 2. Livrables (uniquement si on a copié les blocs).
  if (includeLivrables && blockIdMap.size > 0) {
    const srcLivrables = await fetchLivrables(sourceProjectId)
    for (const l of sortBySortOrder(srcLivrables)) {
      const newBlockId = blockIdMap.get(l.block_id)
      if (!newBlockId) continue
      const newL = await createLivrable({
        blockId: newBlockId,
        projectId: targetProjectId,
        data: {
          numero: l.numero, // on conserve le numero source — pas de collision puisque scopé bloc
          nom: l.nom,
          format: l.format,
          duree: l.duree,
          version_label: null, // version courante reset
          statut: 'brief',
          projet_dav: l.projet_dav,
          assignee_profile_id: null, // on ne copie PAS l'assignee (équipe différente)
          assignee_external: l.assignee_external,
          date_livraison: null, // deadline à refixer
          lien_frame: null,
          lien_drive: null,
          devis_lot_id: null, // les lots du devis source ne sont pas dans le projet dest
          notes: l.notes,
          sort_order: l.sort_order,
        },
      })
      livrableIdMap.set(l.id, newL.id)
    }
  }

  // 3. Phases.
  if (includePhases) {
    const srcPhases = await fetchPhases(sourceProjectId)
    for (const p of srcPhases) {
      const newPhase = await addPhase({
        projectId: targetProjectId,
        data: {
          nom: p.nom,
          kind: p.kind,
          date_debut: p.date_debut,
          date_fin: p.date_fin,
          couleur: p.couleur,
          notes: p.notes,
        },
      })
      phaseIds.push(newPhase.id)
    }
  }

  return { blockIdMap, livrableIdMap, phaseIds }
}

// ════════════════════════════════════════════════════════════════════════════
// LIV-18 — Index global (HomePage)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Liste les livrables non terminés tous projets confondus, dont la
 * `date_livraison` est dans la fenêtre [today - ∞ ; today + daysAhead].
 *
 * Inclut les livrables EN RETARD (date passée + statut non terminé) — c'est
 * voulu, ils sont mis en avant côté UI avec une couleur rouge.
 *
 * RLS gère l'accessibilité : on ne récupère que les livrables des projets
 * auxquels l'utilisateur courant a accès. Le scope `org_id` est joint via
 * `projects` pour éviter les fuites cross-org.
 *
 * Le résultat inclut le titre du projet (jointure `projects(id, title)`)
 * pour l'afficher à côté du livrable dans le widget.
 *
 * @param {Object} params
 * @param {string} params.orgId      - id de l'organisation (obligatoire)
 * @param {number} [params.daysAhead=14] - fenêtre future (jours)
 * @param {number} [params.limit=8]      - nombre max de résultats retournés
 * @returns {Promise<Array<{
 *   id: string,
 *   numero: string|null,
 *   nom: string|null,
 *   statut: string,
 *   date_livraison: string|null,
 *   assignee_profile_id: string|null,
 *   assignee_external: string|null,
 *   project_id: string,
 *   project_title: string|null,
 * }>>}
 */
export async function listUpcomingLivrables({
  orgId,
  daysAhead = 14,
  limit = 8,
} = {}) {
  if (!orgId) return []
  // Borne sup : today + daysAhead. Pas de borne inf — on inclut les en retard.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const upper = new Date(today)
  upper.setDate(upper.getDate() + daysAhead)
  const upperISO = upper.toISOString().slice(0, 10)

  // Statuts considérés "actifs" (cf. LIVRABLE_STATUTS_ACTIFS dans helpers).
  // On garde la liste explicitement ici pour rester découplé du helper.
  const ACTIFS = ['brief', 'en_cours', 'a_valider', 'valide']

  const { data, error } = await supabase
    .from('livrables')
    .select(`
      id, numero, nom, statut, date_livraison,
      assignee_profile_id, assignee_external, project_id,
      projects!inner ( id, title, org_id )
    `)
    .is('deleted_at', null)
    .in('statut', ACTIFS)
    .not('date_livraison', 'is', null)
    .lte('date_livraison', upperISO)
    .eq('projects.org_id', orgId)
    .order('date_livraison', { ascending: true })
    .limit(limit)

  if (error) throw error
  return (data || []).map((l) => ({
    id: l.id,
    numero: l.numero,
    nom: l.nom,
    statut: l.statut,
    date_livraison: l.date_livraison,
    assignee_profile_id: l.assignee_profile_id,
    assignee_external: l.assignee_external,
    project_id: l.project_id,
    project_title: l.projects?.title || null,
  }))
}

// ════════════════════════════════════════════════════════════════════════════
// LIV-19 — Lien devis Niveau 1 (pointeur livrable.devis_lot_id)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Liste les lots d'un projet pour le sélecteur "Lier à un lot…" dans le menu
 * livrable. On exclut les lots archivés (l'utilisateur ne devrait plus
 * pointer vers eux). Tri par `sort_order` ASC.
 *
 * @param {string} projectId
 * @returns {Promise<Array<{ id, title, sort_order, archived }>>}
 */
export async function listProjectLots(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('devis_lots')
    .select('id, title, sort_order, archived')
    .eq('project_id', projectId)
    .or('archived.is.null,archived.eq.false')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Pour la génération du PDF d'un devis : récupère les livrables du projet
 * qui doivent apparaître dans la section "Livrable(s) :" du PDF.
 *
 * Règle (cf. LIV-19B) — filtrage **au niveau du bloc** (un bloc = un thème
 * commercial = un lot, tous ses livrables partagent le même rattachement) :
 *   - livrables des blocs avec `block.devis_lot_id === lotId`  → spécifiques
 *   - livrables des blocs avec `block.devis_lot_id IS NULL`    → génériques,
 *                                                                  apparaissent sur
 *                                                                  tous les devis
 *   - livrables des autres blocs (lié à un autre lot)          → exclus
 *
 * On exclut les supprimés (`deleted_at IS NULL`) et les archivés
 * (`statut !== 'archive'`). On garde les `livre` car ils restent légitimes
 * comme livrables vendus, même si déjà délivrés à la signature du devis.
 *
 * Tri : par `numero` en mode naturel (gère bien `A1 < A2 < A10`, les
 * livrables sans numero atterrissent à la fin). Cohérent avec ce que le
 * client lira sur le PDF : 1, 2, 3 dans l'ordre numérique, pas l'ordre
 * d'affichage interne LIV (qui peut être réorganisé via drag & drop).
 *
 * @param {string} projectId
 * @param {string|null} lotId   - id du lot du devis (peut être null en mono-lot
 *                                ou si le devis est non rattaché)
 * @returns {Promise<Array>}
 */
export async function listLivrablesForDevisPdf(projectId, lotId = null) {
  if (!projectId) return []

  // 1. Récupère tous les blocs du projet pour identifier ceux qui matchent.
  const { data: blocks, error: errBlocks } = await supabase
    .from('livrable_blocks')
    .select('id, devis_lot_id')
    .eq('project_id', projectId)
    .is('deleted_at', null)
  if (errBlocks) throw errBlocks

  const validBlockIds = new Set(
    (blocks || [])
      .filter((b) => !b.devis_lot_id || (lotId && b.devis_lot_id === lotId))
      .map((b) => b.id),
  )
  if (!validBlockIds.size) return []

  // 2. Liste les livrables des blocs valides.
  const { data: livs, error: errLivs } = await supabase
    .from('livrables')
    .select('id, numero, nom, format, duree, statut, sort_order, block_id')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .neq('statut', 'archive')
    .in('block_id', Array.from(validBlockIds))
  if (errLivs) throw errLivs

  const filtered = livs || []
  if (!filtered.length) return []

  // Tri par numero, ordre naturel ("A1" < "A2" < "A10"). Sans-numero à la fin.
  filtered.sort((a, b) => {
    const na = (a.numero || '').trim()
    const nb = (b.numero || '').trim()
    if (!na && !nb) return (a.sort_order ?? 0) - (b.sort_order ?? 0)
    if (!na) return 1
    if (!nb) return -1
    return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' })
  })
  return filtered
}


