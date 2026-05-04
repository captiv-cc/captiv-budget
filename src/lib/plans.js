/**
 * plans.js — Couche d'accès données pour les plans techniques (PLANS V1).
 *
 * Tab "Plans" : stocke des plans techniques d'un projet (caméra, lumière,
 * son, plateau, …) consultables facilement en terrain depuis mobile.
 *
 * Tables :
 *   - plans              : plan principal (1 fichier courant)
 *   - plan_versions      : archive auto des fichiers précédents
 *   - plan_categories    : 10 cats par défaut + perso par admin org
 *
 * Storage :
 *   - bucket privé `plans`
 *   - path : <project_id>/<plan_id>/<filename>             (version courante)
 *   - path : <project_id>/<plan_id>/v<N>-<filename>        (versions archivées)
 *   - signed URLs (createSignedUrl) — validité ~10 min, renouvelée à chaque
 *     ouverture côté front.
 *
 * RLS : pattern aligné sur matos — can_read_outil / can_edit_outil('plans').
 * Pas de RPC SECURITY DEFINER en V1 (CRUD direct via supabase client).
 */

import { supabase } from './supabase'
import { generateThumbnail } from './plansThumbnail'

const BUCKET = 'plans'
const SIGNED_URL_TTL_SEC = 10 * 60 // 10 minutes
const THUMBNAIL_FILENAME = '_thumb.jpg'

/* ─── Constantes ────────────────────────────────────────────────────────── */

export const ALLOWED_FILE_TYPES = Object.freeze(['pdf', 'png', 'jpg'])
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB (cf. bucket policy)

/**
 * Map MIME type → extension stockée dans `file_type` (CHECK constraint en DB).
 * On normalise jpeg → jpg pour rester cohérent côté UI.
 */
export function mimeTypeToFileType(mime) {
  if (!mime) return null
  const m = mime.toLowerCase()
  if (m === 'application/pdf') return 'pdf'
  if (m === 'image/png') return 'png'
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg'
  return null
}

/* ─── Helpers internes ──────────────────────────────────────────────────── */

/**
 * Construit le path Storage pour un plan.
 * - currentVersion (default) : <project>/<plan>/<filename>
 * - archived version         : <project>/<plan>/v<N>-<filename>
 */
function buildStoragePath({ projectId, planId, filename, versionNum = null }) {
  const safeName = sanitizeFilename(filename)
  const prefix = versionNum != null ? `v${versionNum}-` : ''
  return `${projectId}/${planId}/${prefix}${safeName}`
}

/**
 * Construit le path Storage du thumbnail JPG d'un plan.
 * Convention : <project_id>/<plan_id>/_thumb.jpg
 */
function buildThumbnailPath({ projectId, planId }) {
  return `${projectId}/${planId}/${THUMBNAIL_FILENAME}`
}

/**
 * Génère + upload le thumbnail si possible. Best-effort : ne throw jamais.
 * Renvoie le path Storage si OK, null sinon.
 */
async function generateAndUploadThumbnail({ projectId, planId, file }) {
  try {
    const blob = await generateThumbnail(file)
    if (!blob) return null
    const path = buildThumbnailPath({ projectId, planId })
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true, // overwrite si déjà existe (cas du replace)
    })
    if (error) {
      console.warn('[plans] thumbnail upload échoué', error)
      return null
    }
    return path
  } catch (err) {
    console.warn('[plans] generateAndUploadThumbnail erreur', err)
    return null
  }
}

/**
 * Nettoie un nom de fichier pour qu'il soit safe en URL (Supabase Storage
 * accepte assez large mais on évite les espaces / accents qui posent
 * problème dans les signed URLs).
 */
function sanitizeFilename(name = 'file') {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 200) || 'file'
}

/* ─── Catégories ────────────────────────────────────────────────────────── */

const CATEGORY_COLS =
  'id, org_id, key, label, color, sort_order, is_default, is_archived, created_at, updated_at'

export async function listPlanCategories(orgId, { includeArchived = false } = {}) {
  if (!orgId) throw new Error('listPlanCategories : orgId requis')
  let q = supabase
    .from('plan_categories')
    .select(CATEGORY_COLS)
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
  if (!includeArchived) q = q.eq('is_archived', false)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Slugifie un label en `key` stable.
 * Exemple : "Plan masse" → "plan-masse"
 */
export function slugifyCategoryKey(label) {
  return (label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'cat'
}

export async function createPlanCategory({
  orgId,
  label,
  color = '#5c5c5c',
  key = null,
}) {
  if (!orgId || !label) {
    throw new Error('createPlanCategory : orgId + label requis')
  }
  // Détermine sort_order = max + 10 pour insérer en fin de liste.
  const { data: maxRow } = await supabase
    .from('plan_categories')
    .select('sort_order')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextSort = (maxRow?.sort_order ?? 0) + 10

  const finalKey = key || slugifyCategoryKey(label)

  const { data, error } = await supabase
    .from('plan_categories')
    .insert([
      {
        org_id: orgId,
        key: finalKey,
        label: label.trim(),
        color,
        sort_order: nextSort,
        is_default: false,
      },
    ])
    .select(CATEGORY_COLS)
    .single()
  if (error) throw error
  return data
}

export async function updatePlanCategory(catId, fields = {}) {
  if (!catId) throw new Error('updatePlanCategory : catId requis')
  const patch = {}
  if (fields.label !== undefined) patch.label = fields.label?.trim() || null
  if (fields.color !== undefined) patch.color = fields.color
  if (fields.sort_order !== undefined) patch.sort_order = fields.sort_order
  if (fields.is_archived !== undefined) patch.is_archived = Boolean(fields.is_archived)
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('plan_categories')
    .update(patch)
    .eq('id', catId)
    .select(CATEGORY_COLS)
    .single()
  if (error) throw error
  return data
}

export async function archivePlanCategory(catId) {
  return updatePlanCategory(catId, { is_archived: true })
}

export async function restorePlanCategory(catId) {
  return updatePlanCategory(catId, { is_archived: false })
}

export async function reorderPlanCategories(orderedIds = []) {
  // Inspecte les erreurs (pattern aligné sur matos/reorderBlocks) — supabase-js
  // ne throw pas sur erreur RLS, il faut vérifier res.error.
  const results = await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('plan_categories').update({ sort_order: idx * 10 }).eq('id', id),
    ),
  )
  for (const res of results) {
    if (res?.error) throw res.error
  }
}

/* ─── Plans (CRUD) ──────────────────────────────────────────────────────── */

const PLAN_COLS =
  'id, project_id, category_id, name, description, tags, storage_path, thumbnail_path, file_type, file_size, page_count, applicable_dates, current_version, sort_order, is_archived, created_at, created_by, updated_at, updated_by'

export async function listPlans({ projectId, includeArchived = false } = {}) {
  if (!projectId) throw new Error('listPlans : projectId requis')
  let q = supabase
    .from('plans')
    .select(PLAN_COLS)
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (!includeArchived) q = q.eq('is_archived', false)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function getPlan(planId) {
  if (!planId) throw new Error('getPlan : planId requis')
  const { data, error } = await supabase
    .from('plans')
    .select(PLAN_COLS)
    .eq('id', planId)
    .single()
  if (error) throw error
  return data
}

/**
 * Crée un plan + uploade le fichier.
 *
 * Stratégie pour avoir un path qui inclut le plan_id (pour le RLS storage) :
 *   1. INSERT plans avec storage_path='' (placeholder), récupère plan.id
 *   2. Upload file au path <project>/<plan_id>/<filename>
 *   3. UPDATE plans SET storage_path = computed_path
 *
 * On accepte un risque mineur d'orphelin DB si l'upload échoue après le
 * INSERT (trace dans la table sans fichier). Le front gère ça via try/catch :
 * si upload fail, on supprime le plan créé.
 */
export async function createPlan({
  projectId,
  categoryId = null,
  name,
  description = null,
  tags = [],
  applicableDates = [],
  file,
}) {
  if (!projectId) throw new Error('createPlan : projectId requis')
  if (!name?.trim()) throw new Error('createPlan : name requis')
  if (!file) throw new Error('createPlan : file requis')

  const fileType = mimeTypeToFileType(file.type)
  if (!fileType) {
    throw new Error('Format non supporté (PDF, PNG ou JPG uniquement)')
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Fichier trop volumineux (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)`)
  }

  // 1. Insère le plan avec storage_path placeholder.
  const { data: planRow, error: insertErr } = await supabase
    .from('plans')
    .insert([
      {
        project_id: projectId,
        category_id: categoryId,
        name: name.trim(),
        description: description?.trim() || null,
        tags: Array.isArray(tags) ? tags : [],
        storage_path: 'pending', // overwrite après upload
        file_type: fileType,
        file_size: file.size,
        page_count: null, // calculé côté front pour PDF (pdf.js), null pour images
        applicable_dates: Array.isArray(applicableDates) ? applicableDates : [],
        current_version: 1,
      },
    ])
    .select(PLAN_COLS)
    .single()
  if (insertErr) throw insertErr

  // 2. Upload le fichier au path final.
  const storagePath = buildStoragePath({
    projectId,
    planId: planRow.id,
    filename: file.name,
  })

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })
  if (uploadErr) {
    // Cleanup : supprime la ligne créée (best-effort).
    await supabase.from('plans').delete().eq('id', planRow.id)
    throw uploadErr
  }

  // 3. Génération + upload du thumbnail (best-effort, parallèle au update final).
  const thumbnailPath = await generateAndUploadThumbnail({
    projectId,
    planId: planRow.id,
    file,
  })

  // 4. Update le storage_path + thumbnail_path.
  const { data: updated, error: updateErr } = await supabase
    .from('plans')
    .update({
      storage_path: storagePath,
      thumbnail_path: thumbnailPath, // null si génération a échoué
    })
    .eq('id', planRow.id)
    .select(PLAN_COLS)
    .single()
  if (updateErr) {
    // Cleanup : supprime la ligne + le fichier uploadé (+ thumb si OK).
    const toRemove = [storagePath]
    if (thumbnailPath) toRemove.push(thumbnailPath)
    await supabase.storage.from(BUCKET).remove(toRemove)
    await supabase.from('plans').delete().eq('id', planRow.id)
    throw updateErr
  }
  return updated
}

/**
 * Met à jour les métadonnées d'un plan (sans toucher au fichier).
 * Pour remplacer le fichier, voir replacePlanFile().
 */
export async function updatePlan(planId, fields = {}) {
  if (!planId) throw new Error('updatePlan : planId requis')
  const patch = {}
  if (fields.name !== undefined) patch.name = fields.name?.trim() || null
  if (fields.description !== undefined) {
    patch.description = fields.description?.trim() || null
  }
  if (fields.category_id !== undefined) patch.category_id = fields.category_id || null
  if (fields.tags !== undefined) {
    patch.tags = Array.isArray(fields.tags) ? fields.tags : []
  }
  if (fields.applicable_dates !== undefined) {
    patch.applicable_dates = Array.isArray(fields.applicable_dates)
      ? fields.applicable_dates
      : []
  }
  if (fields.sort_order !== undefined) patch.sort_order = fields.sort_order
  if (fields.is_archived !== undefined) {
    patch.is_archived = Boolean(fields.is_archived)
  }
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('plans')
    .update(patch)
    .eq('id', planId)
    .select(PLAN_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Remplace le fichier d'un plan en archivant l'ancien dans plan_versions.
 *
 * Étapes :
 *   1. Récupère le plan courant (storage_path, current_version, …)
 *   2. Renomme le fichier courant : <path> → v<N>-<filename> (Storage move)
 *   3. INSERT plan_versions avec l'ancien path
 *   4. Upload le nouveau fichier au path <project>/<plan>/<newFilename>
 *   5. UPDATE plans : storage_path + current_version+1 + autres meta
 *
 * Si étape 4 échoue après 2 et 3, l'ancien fichier reste accessible via
 * plan_versions — pas de perte de données. L'UI re-tentera proprement.
 */
export async function replacePlanFile(planId, file, { comment = null } = {}) {
  if (!planId) throw new Error('replacePlanFile : planId requis')
  if (!file) throw new Error('replacePlanFile : file requis')

  const fileType = mimeTypeToFileType(file.type)
  if (!fileType) {
    throw new Error('Format non supporté (PDF, PNG ou JPG uniquement)')
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Fichier trop volumineux (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)`)
  }

  const plan = await getPlan(planId)
  const oldPath = plan.storage_path
  const oldVersion = plan.current_version
  const oldFilename = oldPath?.split('/').pop() || 'file'

  // Path archive : <project>/<plan>/v<N>-<filename>
  const archivedPath = buildStoragePath({
    projectId: plan.project_id,
    planId: plan.id,
    filename: oldFilename,
    versionNum: oldVersion,
  })

  // 1. Move l'ancien fichier vers son path d'archive.
  if (oldPath && oldPath !== 'pending') {
    const { error: moveErr } = await supabase.storage
      .from(BUCKET)
      .move(oldPath, archivedPath)
    if (moveErr) throw moveErr
  }

  // 2. Insert plan_versions (snapshot de l'ancien fichier).
  if (oldPath && oldPath !== 'pending') {
    const { error: insertVerErr } = await supabase.from('plan_versions').insert([
      {
        plan_id: plan.id,
        version_num: oldVersion,
        storage_path: archivedPath,
        file_type: plan.file_type,
        file_size: plan.file_size,
        page_count: plan.page_count,
        comment: comment?.trim() || null,
      },
    ])
    if (insertVerErr) throw insertVerErr
  }

  // 3. Upload le nouveau fichier au path "courant".
  const newPath = buildStoragePath({
    projectId: plan.project_id,
    planId: plan.id,
    filename: file.name,
  })
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(newPath, file, {
      contentType: file.type,
      upsert: false,
    })
  if (uploadErr) throw uploadErr

  // 4. Régénère le thumbnail (overwrite l'ancien au même path via upsert).
  const thumbnailPath = await generateAndUploadThumbnail({
    projectId: plan.project_id,
    planId: plan.id,
    file,
  })

  // 5. Update le plan.
  const { data: updated, error: updateErr } = await supabase
    .from('plans')
    .update({
      storage_path: newPath,
      thumbnail_path: thumbnailPath, // null si génération a échoué
      file_type: fileType,
      file_size: file.size,
      page_count: null, // recalculé côté front si PDF
      current_version: oldVersion + 1,
    })
    .eq('id', plan.id)
    .select(PLAN_COLS)
    .single()
  if (updateErr) throw updateErr
  return updated
}

/**
 * Soft delete : archive le plan (is_archived=true).
 * Pour suppression définitive, voir hardDeletePlan().
 */
export async function archivePlan(planId) {
  return updatePlan(planId, { is_archived: true })
}

export async function restorePlan(planId) {
  return updatePlan(planId, { is_archived: false })
}

/**
 * Suppression définitive : delete row + fichiers Storage (courant + versions).
 * Réservé à la corbeille / cleanup.
 */
export async function hardDeletePlan(planId) {
  if (!planId) throw new Error('hardDeletePlan : planId requis')
  const plan = await getPlan(planId)
  // 1. Liste tous les paths à supprimer (courant + archives + thumbnail).
  const paths = []
  if (plan.storage_path && plan.storage_path !== 'pending') {
    paths.push(plan.storage_path)
  }
  if (plan.thumbnail_path) {
    paths.push(plan.thumbnail_path)
  }
  const { data: versions } = await supabase
    .from('plan_versions')
    .select('storage_path')
    .eq('plan_id', planId)
  for (const v of versions || []) {
    if (v.storage_path) paths.push(v.storage_path)
  }
  // 2. Supprime les fichiers Storage (best-effort, on ne throw pas si ça
  //    échoue — on veut que le DELETE DB passe).
  if (paths.length) {
    await supabase.storage.from(BUCKET).remove(paths)
  }
  // 3. DELETE row plans (cascade vers plan_versions via FK).
  const { error } = await supabase.from('plans').delete().eq('id', planId)
  if (error) throw error
}

export async function reorderPlans(orderedIds = []) {
  const results = await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('plans').update({ sort_order: idx * 10 }).eq('id', id),
    ),
  )
  for (const res of results) {
    if (res?.error) throw res.error
  }
}

/* ─── Versions (lecture seule) ──────────────────────────────────────────── */

const VERSION_COLS =
  'id, plan_id, version_num, storage_path, file_type, file_size, page_count, comment, created_at, created_by'

export async function listPlanVersions(planId) {
  if (!planId) throw new Error('listPlanVersions : planId requis')
  const { data, error } = await supabase
    .from('plan_versions')
    .select(VERSION_COLS)
    .eq('plan_id', planId)
    .order('version_num', { ascending: false })
  if (error) throw error
  return data || []
}

/* ─── Storage : signed URLs ─────────────────────────────────────────────── */

/**
 * Génère une signed URL pour un fichier du bucket plans.
 * Validité par défaut : 10 minutes. Le front renouvelle à chaque ouverture
 * de la modale viewer.
 */
export async function getSignedUrl(storagePath, expiresIn = SIGNED_URL_TTL_SEC) {
  if (!storagePath) throw new Error('getSignedUrl : storagePath requis')
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn)
  if (error) throw error
  return data?.signedUrl || null
}

/* ─── Helpers de présentation ───────────────────────────────────────────── */

/**
 * Renvoie un format human-readable pour la taille du fichier.
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * Renvoie une icône Lucide adaptée au file_type.
 * (Le front fait l'import dynamique selon le retour.)
 */
export function getFileTypeIconName(fileType) {
  if (fileType === 'pdf') return 'FileText'
  if (fileType === 'png' || fileType === 'jpg') return 'Image'
  return 'File'
}

/**
 * Normalise une chaîne pour la recherche : lowercase + retrait des accents
 * (NFD + suppression diacritiques). Permet à un user qui tape "camera" de
 * trouver un plan "Caméra" et inversement.
 *
 * Utilisé par le filtre de recherche de PlansTab et de PlansShareSession.
 */
export function normalizeSearch(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
