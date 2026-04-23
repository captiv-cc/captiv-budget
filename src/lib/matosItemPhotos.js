// ════════════════════════════════════════════════════════════════════════════
// matosItemPhotos.js — Helpers photos de checklist matériel (MAT-11)
// ════════════════════════════════════════════════════════════════════════════
//
// Deux usages des photos pendant les essais (cf. migration MAT-11A) :
//
//   - kind='probleme' → ancrée sur UN item (rayure sur optique, câble pété…).
//     Apparaît dans le bilan PDF envoyé au loueur comme justificatif.
//
//   - kind='pack'     → ancrée sur UN bloc (contenu d'un pelicase). Usage
//     interne remballe : "on remet tout comme sur la photo". Visible dans
//     /check/:token (read-only pour le loueur) mais PAS dans le PDF loueur.
//
// Deux flows côté client :
//
//   - anon (via token /check/:token) : upload Storage + RPC check_upload_photo
//     pour enregistrer la métadonnée + attribution uploaded_by_name (saisie
//     localStorage scopée par token). Soft-ownership : seul l'uploader peut
//     re-modifier/supprimer SA photo (matching case-insensitive du nom).
//
//   - authed (mode chantier connecté ou admin MaterielTab) : upload Storage +
//     RPC check_upload_photo_authed. L'identité vient de auth.uid() /
//     profiles.full_name côté serveur. L'admin peut supprimer toutes les
//     photos (gate can_edit_outil).
//
// Pipeline image (avant upload) :
//
//   1. HEIC/HEIF → JPEG (toujours, pour compat rendu cross-browser). Import
//      lazy de `heic2any` (bundle lourd, chargé à la demande).
//   2. Si compression activée (défaut) : resize max 2048px + JPEG q=0.8 via
//      `browser-image-compression`. Toggle "qualité originale" désactive
//      cette étape (mais la conversion HEIC reste).
//   3. Lecture width/height pour stocker les dimensions en DB (utile pour
//      réserver le slot layout côté UI sans loader).
//
// Suppression :
//   - La RPC delete DB ne touche pas le Storage — le client enchaîne avec
//     supabase.storage.remove(). Les policies Storage valident symétriquement
//     l'autorisation ; un fail à l'étape 2 laisse un orphelin storage sans
//     impact fonctionnel (pas référencé par la DB).
//
// Voir supabase/migrations/20260423_mat11_photos.sql.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

const BUCKET = 'matos-item-photos'

// 20 Mo : aligné avec la limite bucket côté SQL (file_size_limit). Couvre
// les originaux iPhone HEIC (~3-5 Mo) + les photos HD jpeg (~8-10 Mo).
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

// Limite hard côté DB (RPC _matos_photo_enforce_limit). Exposée ici pour
// que l'UI désactive le bouton d'upload avant même de tenter la RPC.
export const MAX_PHOTOS_PER_ANCHOR = 10

// MIME types acceptés (alignés bucket côté SQL). HEIC/HEIF seront transcodés
// en JPEG avant upload côté client, donc en pratique seul image/jpeg arrive
// côté Storage. On garde heic/heif dans la liste permise au cas où un client
// skip la transcodage (ex. Safari iOS qui peut uploader direct).
export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]

// ═══ Helpers internes ════════════════════════════════════════════════════════

function extractExtension(filename) {
  if (!filename || typeof filename !== 'string') return ''
  const idx = filename.lastIndexOf('.')
  if (idx < 0 || idx === filename.length - 1) return ''
  return filename.slice(idx + 1).toLowerCase()
}

function generateUuid() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `photo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Construit un storage path aligné avec les policies RLS :
 *   `<version_id>/<photo_uuid>.<ext>`
 * Le 1er segment est utilisé par split_part(name, '/', 1) dans les policies
 * pour rattacher le fichier à une version (cf. migration MAT-11A §4).
 */
function buildStoragePath(versionId, filename) {
  const ext = extractExtension(filename) || 'jpg'
  const uuid = generateUuid()
  return `${versionId}/${uuid}.${ext}`
}

function isHeicFile(file) {
  if (!file) return false
  const mime = (file.type || '').toLowerCase()
  if (mime === 'image/heic' || mime === 'image/heif') return true
  const ext = extractExtension(file.name)
  return ext === 'heic' || ext === 'heif'
}

/**
 * Lit les dimensions intrinsèques d'une image (File ou Blob) via createImageBitmap
 * si dispo (performant), fallback sur HTMLImageElement + ObjectURL. Retourne
 * `{ width, height }` ou `{ width: null, height: null }` si la lecture échoue
 * (on n'empêche pas l'upload pour autant).
 */
async function readImageDimensions(file) {
  if (!file) return { width: null, height: null }

  // Path privilégié : createImageBitmap (décodé hors thread UI).
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      const { width, height } = bitmap
      bitmap.close?.()
      return { width, height }
    } catch {
      // fallback
    }
  }

  // Fallback <img>.
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve({ width: null, height: null })
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

// ═══ Pipeline image (transcodage + compression) ══════════════════════════════

/**
 * Normalise un fichier image pour upload. Deux opérations conditionnelles :
 *
 *   1. HEIC/HEIF → JPEG : toujours, pour compat rendu cross-browser. Safari
 *      iOS peut afficher HEIC natif, mais Chrome/Firefox non — on transcode
 *      systématiquement pour garantir un aperçu cohérent. Lib `heic2any`
 *      chargée en dynamic import (bundle ~1 Mo → ne gonfle pas la route).
 *
 *   2. Compression : si `originalQuality=false` (défaut), resize max 2048px
 *      + JPEG q=0.8 via `browser-image-compression`. Divise typiquement la
 *      taille par 5-10 sans perte visible sur une photo de constat.
 *      Si `originalQuality=true`, cette étape est skippée — la photo
 *      reste à sa résolution native (max 20 Mo quand même).
 *
 * Retourne `{ file, width, height }` — le File final prêt à être uploadé,
 * et ses dimensions pour stockage en DB.
 *
 * @param {File}    input
 * @param {object}  [opts]
 * @param {boolean} [opts.originalQuality=false]
 * @param {number}  [opts.maxSizeMB=2]          (utilisé si compression ON)
 * @param {number}  [opts.maxDimension=2048]    (utilisé si compression ON)
 */
export async function processImageForUpload(
  input,
  { originalQuality = false, maxSizeMB = 2, maxDimension = 2048 } = {},
) {
  if (!input) throw new Error('processImageForUpload : File requis')

  let working = input

  // Flags indicatifs pour l'UI (ex. afficher un toast "image non compressée,
  // la taille peut être plus grande que prévu"). Ne bloque jamais l'upload.
  let heicFallback = false
  let compressionFallback = false

  // ── 1. Transcodage HEIC → JPEG ─────────────────────────────────────────
  if (isHeicFile(working)) {
    try {
      const mod = await import('heic2any')
      const heic2any = mod.default || mod
      const blob = await heic2any({
        blob: working,
        toType: 'image/jpeg',
        quality: originalQuality ? 0.95 : 0.85,
      })
      // heic2any peut retourner un Blob ou un array (si multi-frame) — on prend
      // la 1ère frame si tableau (JPEG ne gère pas le multi-image de toute façon).
      const finalBlob = Array.isArray(blob) ? blob[0] : blob
      const renamed = working.name.replace(/\.(heic|heif)$/i, '.jpg')
      working = new File([finalBlob], renamed || 'photo.jpg', {
        type: 'image/jpeg',
        lastModified: Date.now(),
      })
    } catch (err) {
      // Fallback HEIC : on remonte le fichier brut. Safari iOS sait afficher
      // HEIC nativement (même pour le uploader), donc le thumb se rendra sur
      // ces navigateurs. Chrome/Firefox afficheront un placeholder cassé mais
      // la photo reste stockée et sera visible sur le PDF (ImageRun côté jsPDF
      // gère HEIC via le CDN de transformation Supabase). L'UI peut signaler
      // via `_heicFallback` pour informer l'utilisateur.
      console.warn('[processImageForUpload] HEIC transcode failed, uploading raw:', err)
      heicFallback = true
    }
  }

  // ── 2. Compression (si toggle OFF) ─────────────────────────────────────
  if (!originalQuality) {
    try {
      const mod = await import('browser-image-compression')
      const imageCompression = mod.default || mod
      const compressed = await imageCompression(working, {
        maxSizeMB,
        maxWidthOrHeight: maxDimension,
        useWebWorker: true,
        fileType: 'image/jpeg',
        initialQuality: 0.8,
      })
      // browser-image-compression renvoie un File avec le bon type.
      working = compressed
    } catch (err) {
      // Fallback compression : on garde `working` tel quel (HEIC-transcodé
      // ou original). L'upload continue, la taille peut être plus grande
      // que prévu mais reste sous MAX_UPLOAD_BYTES (sinon la validation
      // initiale aurait bloqué). L'UI peut signaler via `_compressionFallback`.
      console.warn('[processImageForUpload] compression failed, uploading uncompressed:', err)
      compressionFallback = true
    }
  }

  // ── 3. Dimensions finales ──────────────────────────────────────────────
  const { width, height } = await readImageDimensions(working)

  return {
    file: working,
    width,
    height,
    _heicFallback: heicFallback,
    _compressionFallback: compressionFallback,
  }
}

// ═══ Validation pré-upload ═══════════════════════════════════════════════════

/**
 * Vérifie qu'un File est acceptable comme photo avant d'engager le pipeline.
 * Retourne null si OK, sinon une string d'erreur explicable pour l'UI.
 */
export function validatePhotoFile(file) {
  if (!file) return 'Aucun fichier fourni'

  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    const maxMb = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)
    return `Fichier trop volumineux (${mb} Mo, max ${maxMb} Mo)`
  }

  const mime = (file.type || '').toLowerCase()
  // Un File natif de l'iPhone peut avoir type='' (pas de MIME renseigné) —
  // on se rabat sur l'extension dans ce cas.
  if (mime) {
    if (!ACCEPTED_MIME_TYPES.includes(mime) && !mime.startsWith('image/')) {
      return `Format non supporté (${mime})`
    }
  } else {
    const ext = extractExtension(file.name)
    if (!['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) {
      return `Extension non supportée (.${ext})`
    }
  }

  return null
}

// ═══ Humanisation des erreurs ═══════════════════════════════════════════════
//
// Les erreurs qui remontent d'un upload photo peuvent venir de 3 couches :
//
//   - Supabase Storage (bucket policy, 413 payload too large, 403 RLS anon,
//     network timeout, CORS) — exposées comme `StorageError` avec `.message`
//     et parfois `.statusCode`.
//   - PostgREST / RPC (RAISE EXCEPTION côté SQL : limite 10, kind invalide,
//     anchor mismatch) — exposées comme `PostgrestError` avec `.message` et
//     souvent `.code` (PG SQLSTATE : 23514 check_violation, 22023 invalid_param,
//     42501 insufficient_privilege / RLS, P0001 RAISE sans code).
//   - Client (validatePhotoFile, processImageForUpload) — `new Error(...)`
//     classiques.
//
// Cette fonction centralise la traduction en français lisible, pour que
// l'UI (toast.error) n'expose pas "duplicate key value violates unique
// constraint" ou "new row violates check constraint _matos_photos_anchor".
//
// Retourne toujours une string (jamais null). Le 2e param permet d'ajouter
// un préfixe contextuel (ex. nom du fichier).

/**
 * Normalise et traduit une erreur d'upload/delete/caption en message
 * utilisateur lisible. Tolérant : accepte un Error, un objet Supabase, ou
 * une string.
 *
 * @param {unknown} err
 * @param {object}  [opts]
 * @param {string}  [opts.prefix] — ajouté en tête, ex. "photo.jpg"
 * @returns {string}
 */
export function humanizePhotoError(err, { prefix = null } = {}) {
  const rawMsg =
    typeof err === 'string'
      ? err
      : err?.message || err?.error_description || err?.details || ''
  const code = err?.code || err?.statusCode || ''
  const lower = String(rawMsg).toLowerCase()

  let out = null

  // ── Limite 10 photos atteinte ─────────────────────────────────────────
  if (
    lower.includes('limite de 10 photos') ||
    lower.includes('photos atteinte') ||
    code === '23514' ||
    lower.includes('check constraint') && lower.includes('photo')
  ) {
    out = 'Limite de 10 photos atteinte sur cet élément.'
  }
  // ── Payload too large (storage ou bucket 413) ────────────────────────
  else if (
    code === 413 ||
    String(code) === '413' ||
    lower.includes('payload too large') ||
    lower.includes('exceeded the maximum size') ||
    lower.includes('too large')
  ) {
    const maxMb = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)
    out = `Fichier trop volumineux (max ${maxMb} Mo).`
  }
  // ── Format rejeté (bucket MIME whitelist, validation client) ─────────
  else if (
    lower.includes('mime type') ||
    lower.includes('format non supporté') ||
    lower.includes('extension non supportée') ||
    lower.includes('invalid mime')
  ) {
    out = 'Format non supporté. Formats acceptés : JPG, PNG, WebP, HEIC.'
  }
  // ── Kind invalide (RAISE EXCEPTION côté RPC) ─────────────────────────
  else if (lower.includes('kind invalide')) {
    out = 'Type de photo invalide (erreur technique).'
  }
  // ── Anchor mismatch (item/block appartient pas à la version du token) ─
  else if (
    lower.includes('anchor') ||
    lower.includes('version_id') ||
    lower.includes('storage_path doit commencer')
  ) {
    out = 'La photo n’est pas rattachée à la bonne version. Rechargez la page.'
  }
  // ── RLS / Permissions (suppression sans ownership) ───────────────────
  else if (
    code === '42501' ||
    code === 401 ||
    String(code) === '401' ||
    code === 403 ||
    String(code) === '403' ||
    lower.includes('insufficient_privilege') ||
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('not authorized') ||
    lower.includes('unauthorized')
  ) {
    out =
      'Action refusée : vous n’êtes pas l’auteur de cette photo ou le lien a expiré.'
  }
  // ── Token expiré / invalide ──────────────────────────────────────────
  else if (
    lower.includes('token') &&
    (lower.includes('expire') || lower.includes('invalide') || lower.includes('invalid'))
  ) {
    out = 'Session expirée. Rechargez la page pour continuer.'
  }
  // ── Reseau / offline ─────────────────────────────────────────────────
  else if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('networkerror') ||
    lower.includes('offline') ||
    lower.includes('timeout')
  ) {
    out = 'Connexion réseau interrompue. Vérifiez votre connexion et réessayez.'
  }
  // ── Transcode HEIC impossible (heic2any a planté) ────────────────────
  else if (
    lower.includes('heic') ||
    lower.includes('heif') ||
    lower.includes('heic2any')
  ) {
    out =
      'Impossible de convertir le HEIC. Essayez d’envoyer en JPG depuis votre téléphone.'
  }
  // ── Fichier corrompu / pas une image ─────────────────────────────────
  else if (
    lower.includes('decoding') ||
    lower.includes('image/') && lower.includes('invalid') ||
    lower.includes('corrupted')
  ) {
    out = 'Fichier illisible. Essayez une autre photo.'
  }
  // ── Storage bucket manquant / mal configuré (erreur admin) ───────────
  else if (
    lower.includes('bucket not found') ||
    lower.includes('bucket') && lower.includes('does not exist')
  ) {
    out =
      'Erreur de configuration Storage. Contactez l’administrateur.'
  }
  // ── Duplicate (rare, mais au cas où le client resoumet 2x le même path) ─
  else if (
    code === '23505' ||
    lower.includes('duplicate key') ||
    lower.includes('already exists')
  ) {
    out = 'Cette photo a déjà été envoyée. Actualisez la page.'
  }

  // Fallback : on garde le message brut s'il est court et lisible, sinon
  // message générique.
  if (!out) {
    if (rawMsg && rawMsg.length <= 140) out = rawMsg
    else out = 'Opération échouée. Réessayez.'
  }

  return prefix ? `${prefix} · ${out}` : out
}


// ═══ Upload (flow unifié : storage + RPC) ═══════════════════════════════════

/**
 * Upload une photo côté anon via token. Pipeline complet :
 *   1. Valide le File
 *   2. Applique processImageForUpload (HEIC→JPEG, compression optionnelle)
 *   3. Upload sur le bucket Storage
 *   4. Appelle check_upload_photo pour enregistrer la métadonnée DB
 *   5. Rollback storage si la RPC échoue
 *
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.versionId
 * @param {string} [opts.itemId]   — XOR avec blockId
 * @param {string} [opts.blockId]  — XOR avec itemId
 * @param {string} opts.kind       — 'probleme' | 'pack' | 'retour' (MAT-13)
 * @param {File}   opts.file
 * @param {string} opts.userName
 * @param {string} [opts.caption]
 * @param {boolean} [opts.originalQuality=false]
 *
 * @returns {Promise<object>} la ligne photo insérée (shape payload RPC)
 */
export async function uploadPhotoToken({
  token,
  versionId,
  itemId = null,
  blockId = null,
  kind,
  file,
  userName,
  caption = null,
  originalQuality = false,
}) {
  if (!token) throw new Error('uploadPhotoToken : token requis')
  if (!versionId) throw new Error('uploadPhotoToken : versionId requis')
  if (!userName?.trim()) throw new Error('uploadPhotoToken : userName requis')
  if (!kind || !['probleme', 'pack', 'retour'].includes(kind)) {
    throw new Error('uploadPhotoToken : kind invalide (probleme|pack|retour)')
  }
  if (!itemId && !blockId) {
    throw new Error('uploadPhotoToken : itemId ou blockId requis')
  }
  if (itemId && blockId) {
    throw new Error('uploadPhotoToken : itemId ET blockId (un seul attendu)')
  }

  const validationError = validatePhotoFile(file)
  if (validationError) throw new Error(validationError)

  // Pipeline image (HEIC + compression).
  const { file: processed, width, height } = await processImageForUpload(file, {
    originalQuality,
  })

  // Path + upload Storage.
  const storagePath = buildStoragePath(versionId, processed.name)
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, processed, {
      cacheControl: '3600',
      upsert: false,
      contentType: processed.type || 'image/jpeg',
    })
  if (uploadError) throw uploadError

  // Enregistrement DB via RPC.
  try {
    const { data, error } = await supabase.rpc('check_upload_photo', {
      p_token: token,
      p_item_id: itemId,
      p_block_id: blockId,
      p_kind: kind,
      p_storage_path: storagePath,
      p_mime_type: processed.type || 'image/jpeg',
      p_size_bytes: processed.size,
      p_width: width,
      p_height: height,
      p_caption: (caption || '').trim() || null,
      p_user_name: userName.trim(),
    })
    if (error) throw error
    return data
  } catch (err) {
    // Rollback storage pour éviter l'orphelin.
    try {
      await supabase.storage.from(BUCKET).remove([storagePath])
    } catch {
      /* best effort */
    }
    throw err
  }
}

/**
 * Upload une photo côté authenticated. Miroir strict de `uploadPhotoToken`
 * mais passe par `check_upload_photo_authed` (gate can_edit_outil ;
 * uploaded_by/uploaded_by_name dérivés de auth.uid()).
 */
export async function uploadPhotoAuthed({
  versionId,
  itemId = null,
  blockId = null,
  kind,
  file,
  caption = null,
  originalQuality = false,
}) {
  if (!versionId) throw new Error('uploadPhotoAuthed : versionId requis')
  if (!kind || !['probleme', 'pack', 'retour'].includes(kind)) {
    throw new Error('uploadPhotoAuthed : kind invalide (probleme|pack|retour)')
  }
  if (!itemId && !blockId) {
    throw new Error('uploadPhotoAuthed : itemId ou blockId requis')
  }
  if (itemId && blockId) {
    throw new Error('uploadPhotoAuthed : itemId ET blockId (un seul attendu)')
  }

  const validationError = validatePhotoFile(file)
  if (validationError) throw new Error(validationError)

  const { file: processed, width, height } = await processImageForUpload(file, {
    originalQuality,
  })

  const storagePath = buildStoragePath(versionId, processed.name)
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, processed, {
      cacheControl: '3600',
      upsert: false,
      contentType: processed.type || 'image/jpeg',
    })
  if (uploadError) throw uploadError

  try {
    const { data, error } = await supabase.rpc('check_upload_photo_authed', {
      p_item_id: itemId,
      p_block_id: blockId,
      p_kind: kind,
      p_storage_path: storagePath,
      p_mime_type: processed.type || 'image/jpeg',
      p_size_bytes: processed.size,
      p_width: width,
      p_height: height,
      p_caption: (caption || '').trim() || null,
    })
    if (error) throw error
    return data
  } catch (err) {
    try {
      await supabase.storage.from(BUCKET).remove([storagePath])
    } catch {
      /* best effort */
    }
    throw err
  }
}

// ═══ Delete ══════════════════════════════════════════════════════════════════

/**
 * Supprime une photo côté anon (flow token). La RPC fait le match soft sur
 * uploaded_by_name et retourne le storage_path — le client enchaîne avec
 * supabase.storage.remove() pour virer le fichier.
 *
 * Non atomique : si le storage.remove échoue après que la RPC a delete la DB,
 * on laisse un orphelin storage (même pattern que matosAttachments).
 */
export async function deletePhotoToken({ token, photoId, userName }) {
  if (!token) throw new Error('deletePhotoToken : token requis')
  if (!photoId) throw new Error('deletePhotoToken : photoId requis')
  if (!userName?.trim()) throw new Error('deletePhotoToken : userName requis')

  const { data, error } = await supabase.rpc('check_delete_photo', {
    p_token: token,
    p_photo_id: photoId,
    p_user_name: userName.trim(),
  })
  if (error) throw error

  const storagePath = data?.storage_path
  if (storagePath) {
    try {
      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath])
      // Silence "not found" (file déjà zappé via dashboard) ; autres erreurs
      // remontent en console pour debug mais ne font PAS échouer le delete
      // (la DB est cohérente, seul l'objet storage est orphelin).
      if (storageError && !/not.*found/i.test(storageError.message || '')) {
        console.warn('[deletePhotoToken] storage orphan :', storageError)
      }
    } catch (err) {
      console.warn('[deletePhotoToken] storage cleanup failed :', err)
    }
  }

  return data
}

/** Miroir authed : gate can_edit_outil, pas de match uploader. */
export async function deletePhotoAuthed({ photoId }) {
  if (!photoId) throw new Error('deletePhotoAuthed : photoId requis')

  const { data, error } = await supabase.rpc('check_delete_photo_authed', {
    p_photo_id: photoId,
  })
  if (error) throw error

  const storagePath = data?.storage_path
  if (storagePath) {
    try {
      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath])
      if (storageError && !/not.*found/i.test(storageError.message || '')) {
        console.warn('[deletePhotoAuthed] storage orphan :', storageError)
      }
    } catch (err) {
      console.warn('[deletePhotoAuthed] storage cleanup failed :', err)
    }
  }

  return data
}

// ═══ Update caption ══════════════════════════════════════════════════════════

/** Met à jour la caption d'une photo (flow token — match uploader soft). */
export async function updatePhotoCaptionToken({ token, photoId, caption, userName }) {
  if (!token) throw new Error('updatePhotoCaptionToken : token requis')
  if (!photoId) throw new Error('updatePhotoCaptionToken : photoId requis')
  if (!userName?.trim()) throw new Error('updatePhotoCaptionToken : userName requis')

  const { data, error } = await supabase.rpc('check_update_photo_caption', {
    p_token: token,
    p_photo_id: photoId,
    p_caption: (caption || '').trim() || null,
    p_user_name: userName.trim(),
  })
  if (error) throw error
  return data
}

/** Miroir authed. */
export async function updatePhotoCaptionAuthed({ photoId, caption }) {
  if (!photoId) throw new Error('updatePhotoCaptionAuthed : photoId requis')

  const { data, error } = await supabase.rpc('check_update_photo_caption_authed', {
    p_photo_id: photoId,
    p_caption: (caption || '').trim() || null,
  })
  if (error) throw error
  return data
}

// ═══ Signed URLs ════════════════════════════════════════════════════════════
//
// Les policies storage.objects pour matos-item-photos autorisent SELECT à
// authenticated (via can_read_outil) ET à anon (via token actif). Donc la
// MÊME fonction `createSignedUrl` fonctionne pour les deux mondes — pas
// besoin de wrapper séparé. Les wrappers token/authed existent juste pour
// clarifier l'intention au point d'appel.

/**
 * Génère une URL signée d'affichage (inline) pour une photo. Valide 1h.
 * Fonctionne pour anon ET authed — la policy storage filtre côté serveur.
 */
export async function getPhotoUrl(storagePath, expiresIn = 3600) {
  if (!storagePath) throw new Error('getPhotoUrl : storagePath requis')
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn)
  if (error) throw error
  return data?.signedUrl || null
}

/**
 * Génère une URL signée avec transformation on-the-fly (thumbnail).
 * Supabase Storage expose un paramètre `transform` qui resize côté CDN.
 * On garde `resize='cover'` pour les thumbs carrées, et on passe quality=75
 * pour gagner du poids sur les aperçus.
 *
 * Fallback transparent vers createSignedUrl sans transform si la lib ne
 * supporte pas `transform` (vieille version du SDK).
 */
export async function getPhotoThumbnailUrl(storagePath, { size = 240, expiresIn = 3600 } = {}) {
  if (!storagePath) throw new Error('getPhotoThumbnailUrl : storagePath requis')
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresIn, {
        transform: {
          width: size,
          height: size,
          resize: 'cover',
          quality: 75,
        },
      })
    if (error) throw error
    return data?.signedUrl || null
  } catch {
    // Fallback : URL full-size (le <img> HTML redimensionnera en CSS).
    return getPhotoUrl(storagePath, expiresIn)
  }
}

/** Force le download (bouton "Enregistrer l'image"). */
export async function getPhotoDownloadUrl(storagePath, { filename, expiresIn = 3600 } = {}) {
  if (!storagePath) throw new Error('getPhotoDownloadUrl : storagePath requis')
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn, {
      download: filename ? filename : true,
    })
  if (error) throw error
  return data?.signedUrl || null
}

// ═══ Dérivés client (index par ancrage) ══════════════════════════════════════
//
// Helpers purs consommés par les hooks. Séparés en fonctions standalone pour
// faciliter les tests unitaires (useCheckTokenSession / useCheckAuthedSession
// les appellent dans des useMemo).

/**
 * Indexe les photos par `item_id` (uniquement celles avec un item_id non-null).
 * @param {Array} photos
 * @returns {Map<string, Array>}
 */
export function indexPhotosByItem(photos) {
  const map = new Map()
  if (!Array.isArray(photos)) return map
  for (const p of photos) {
    if (!p?.item_id) continue
    if (!map.has(p.item_id)) map.set(p.item_id, [])
    map.get(p.item_id).push(p)
  }
  // Tri chrono ascendant (première prise d'abord).
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  }
  return map
}

/** Indexe par `block_id` (pack photos). */
export function indexPhotosByBlock(photos) {
  const map = new Map()
  if (!Array.isArray(photos)) return map
  for (const p of photos) {
    if (!p?.block_id) continue
    if (!map.has(p.block_id)) map.set(p.block_id, [])
    map.get(p.block_id).push(p)
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  }
  return map
}

/**
 * True si l'utilisateur `userName` a uploadé la photo (matching soft,
 * case/trim-insensitive — miroir du check SQL côté RPC). Utile côté UI
 * pour afficher/masquer les boutons modifier/supprimer sur le flow token.
 */
export function isPhotoOwnedBy(photo, userName) {
  if (!photo) return false
  const a = (photo.uploaded_by_name || '').trim().toLowerCase()
  const b = (userName || '').trim().toLowerCase()
  return a.length > 0 && a === b
}

// ═══ Utilitaire UI : filename proposé au download ════════════════════════════

/**
 * Construit un nom de fichier lisible pour le téléchargement. Exemple :
 *   "photo-probleme-cam1-20260423-142305.jpg"
 */
export function suggestDownloadFilename(photo) {
  if (!photo) return 'photo.jpg'
  const ext = extractExtension(photo.storage_path || '') || 'jpg'
  const kindLabel = photo.kind === 'pack' ? 'pack' : 'probleme'
  const d = photo.created_at ? new Date(photo.created_at) : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `photo-${kindLabel}-${stamp}.${ext}`
}
