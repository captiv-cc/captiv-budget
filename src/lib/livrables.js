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

const BLOCK_EDITABLE_FIELDS = ['nom', 'prefixe', 'couleur', 'sort_order']

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
// Note : LIV-3 ne crée PAS encore les events miroirs. La sync planning
// bidirectionnelle est l'objet de LIV-4 (lib `livrablesPlanningSync.js`).
// Les étapes créées ici ont donc `event_id = NULL` même si `is_event=true` ;
// LIV-4 réconciliera lors de son passage initial.

const ETAPE_EDITABLE_FIELDS = [
  'nom',
  'kind',
  'date_debut',
  'date_fin',
  'assignee_profile_id',
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
    date_debut: input.date_debut,
    date_fin: input.date_fin,
    assignee_profile_id: input.assignee_profile_id || null,
    couleur: input.couleur || null,
    notes: input.notes || null,
    sort_order: input.sort_order ?? nextOrder,
    is_event: input.is_event !== false, // default true
    // event_id volontairement omis → NULL. LIV-4 cablera la création miroir.
  }
  const { data, error } = await supabase
    .from('livrable_etapes')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
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
  return data
}

export async function deleteEtape(etapeId) {
  // LIV-4 ajoutera la suppression cascade de l'event miroir. Pour LIV-3 on
  // se contente du DELETE de la ligne ; les RLS sur events feront le reste
  // si jamais l'event_id est posé manuellement (highly unlikely en V1).
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
    // event_id omis → NULL. LIV-4 ajoutera la création miroir multi-jours.
  }
  const { data, error } = await supabase
    .from('projet_phases')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
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
  return data
}

export async function deletePhase(phaseId) {
  // Idem étape : LIV-4 cablera la cascade event miroir. LIV-3 = simple DELETE.
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
