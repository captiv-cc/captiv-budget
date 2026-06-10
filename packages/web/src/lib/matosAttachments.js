// ════════════════════════════════════════════════════════════════════════════
// matosAttachments.js — Helpers CRUD pour les docs loueur (MAT-10J)
// ════════════════════════════════════════════════════════════════════════════
//
// Les "documents loueur" sont des fichiers (PDF, photos, fiches pack…) attachés
// à une version matériel. Exemples typiques : devis VDEF du loueur, BL, fiches
// de réglage optique, checklist usine… On veut pouvoir :
//   - les uploader/lister/supprimer depuis l'UI Matériel (authenticated)
//   - les consulter (SELECT + download) depuis la checklist terrain via token
//     anonyme `/check/:token` — sans compte CAPTIV
//
// Architecture :
//   - Métadonnées dans `matos_version_attachments` (RLS classique par project)
//   - Fichiers dans bucket Storage `matos-attachments` (private)
//   - Path Storage : `<version_id>/<uuid>.<ext>` — permet :
//       1. cleanup simple au drop d'une version (préfixe unique)
//       2. policies RLS qui vérifient l'appartenance via le path
//
// Accès anon :
//   - Les métadonnées transitent via la RPC `check_session_fetch(token)`
//     qui renvoie le payload `attachments: [...]` (voir migration MAT-10J §4).
//   - Pour le fichier lui-même, on génère une signed URL côté client
//     (authenticated) ou côté anon (grâce à la storage policy conditionnelle
//     "matos-attachments read anon" qui valide qu'au moins 1 token actif
//     existe pour la version).
//
// Taille max upload :
//   - Hard-coded à 25 Mo côté client (check avant upload). Supabase par défaut
//     accepte jusqu'à 50 Mo, mais 25 couvre largement les PDFs de devis et
//     les fiches. Si besoin, on assouplira dans un second temps.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

const BUCKET = 'matos-attachments'

// 25 Mo : couvre PDFs de devis, fiches techniques, photos HQ. Au-delà, on
// refuse côté client pour éviter de saturer le storage sur un oubli (ex. un
// .mov de 500 Mo uploadé par erreur).
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

// MIME-types acceptés — on reste large (PDF, images, Office) car les loueurs
// envoient parfois des XLS ou DOCX. On bloque explicitement les binaires
// exécutables (.exe, .dmg) au cas où.
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'dmg', 'pkg', 'app', 'bat', 'cmd', 'sh',
  'ps1', 'com', 'scr', 'vbs', 'js', 'jar',
])

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
  // Fallback non-crypto : suffisant pour un path, pas pour un secret.
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function buildStoragePath(versionId, filename) {
  const ext = extractExtension(filename)
  const uuid = generateUuid()
  // `<version_id>/<uuid>.<ext>` — cf. policies storage.objects (split_part).
  return ext ? `${versionId}/${uuid}.${ext}` : `${versionId}/${uuid}`
}

// ═══ CRUD (authenticated) ════════════════════════════════════════════════════

/**
 * Liste les pièces jointes d'une version. Tri chronologique ASC (premier
 * upload en haut — l'utilisateur retrouve l'ordre où il les a ajoutées).
 */
export async function listAttachments(versionId) {
  if (!versionId) throw new Error('listAttachments : versionId requis')
  const { data, error } = await supabase
    .from('matos_version_attachments')
    .select(
      'id, version_id, title, filename, storage_path, size_bytes, mime_type, uploaded_by_name, created_at',
    )
    .eq('version_id', versionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Upload un fichier + crée la ligne métadonnées. Atomique côté client :
 * si l'insert DB foire, on supprime le fichier Storage pour éviter un orphelin.
 *
 * @param {object} opts
 * @param {string} opts.versionId — version cible
 * @param {File}   opts.file      — File object (input type=file)
 * @param {string} [opts.title]   — libellé libre (ex. "Devis VDEF LoueurA").
 *                                   Si vide → null (l'UI fallback sur filename).
 * @param {string} [opts.uploadedByName] — facultatif (le nom auth est déjà
 *                                          en base via uploaded_by/profiles).
 *
 * @returns la ligne matos_version_attachments insérée.
 */
export async function uploadAttachment({ versionId, file, title = null, uploadedByName = null }) {
  if (!versionId) throw new Error('uploadAttachment : versionId requis')
  if (!file) throw new Error('uploadAttachment : file requis')

  // ─── Garde-fous côté client ─────────────────────────────────────────────
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    const maxMb = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)
    throw new Error(`Fichier trop volumineux (${mb} Mo, max ${maxMb} Mo)`)
  }

  const ext = extractExtension(file.name)
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Extension .${ext} non autorisée`)
  }

  const storagePath = buildStoragePath(versionId, file.name)

  // ─── 1. Upload Storage ─────────────────────────────────────────────────
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })
  if (uploadError) throw uploadError

  // ─── 2. Insert métadonnées ─────────────────────────────────────────────
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id || null

  const payload = {
    version_id: versionId,
    title: (title || '').trim() || null,
    filename: file.name,
    storage_path: storagePath,
    size_bytes: file.size,
    mime_type: file.type || null,
    uploaded_by: userId,
    uploaded_by_name: uploadedByName?.trim() || null,
  }

  const { data, error } = await supabase
    .from('matos_version_attachments')
    .insert([payload])
    .select(
      'id, version_id, title, filename, storage_path, size_bytes, mime_type, uploaded_by_name, created_at',
    )
    .single()

  if (error) {
    // Rollback : on supprime le fichier uploadé pour éviter l'orphelin.
    try {
      await supabase.storage.from(BUCKET).remove([storagePath])
    } catch {
      /* best effort */
    }
    throw error
  }

  return data
}

/**
 * Renomme le `title` d'une pièce jointe (édition in-place). Passer une chaîne
 * vide ou null pour effacer (l'UI fallback sur `filename`).
 */
export async function renameAttachment(attachmentId, newTitle) {
  if (!attachmentId) throw new Error('renameAttachment : attachmentId requis')
  const cleaned = (newTitle || '').trim() || null
  const { data, error } = await supabase
    .from('matos_version_attachments')
    .update({ title: cleaned })
    .eq('id', attachmentId)
    .select(
      'id, version_id, title, filename, storage_path, size_bytes, mime_type, uploaded_by_name, created_at',
    )
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime une pièce jointe : fichier Storage + ligne DB. Non-atomique côté
 * client (2 appels séparés), mais on supprime dans l'ordre Storage → DB : si
 * Storage fail on n'efface pas la DB et on affiche l'erreur ; si DB fail
 * après Storage, la ligne DB devient orpheline (pas grave, on a un index
 * de cleanup côté DB côté batch ; pratique négligeable).
 */
export async function deleteAttachment(attachment) {
  if (!attachment?.id) throw new Error('deleteAttachment : attachment avec id requis')

  // ─── 1. Storage ────────────────────────────────────────────────────────
  if (attachment.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([attachment.storage_path])
    // On tolère "Object not found" (déjà supprimé manuellement côté dashboard)
    // mais on remonte les autres erreurs (permissions, réseau…).
    if (storageError && !/not.*found/i.test(storageError.message || '')) {
      throw storageError
    }
  }

  // ─── 2. DB ─────────────────────────────────────────────────────────────
  const { error: dbError } = await supabase
    .from('matos_version_attachments')
    .delete()
    .eq('id', attachment.id)
  if (dbError) throw dbError
}

// ═══ Signed URLs (read) ══════════════════════════════════════════════════════
//
// Note : les policies storage.objects autorisent SELECT à anon si au moins un
// token actif existe pour la version. Donc la MÊME fonction `createSignedUrl`
// fonctionne pour authenticated ET anon — on n'a pas besoin d'un RPC dédié
// côté anon. On garde deux wrappers pour la clarté d'intention seulement.

/**
 * Génère une URL signée pour afficher un fichier inline (PDF dans iframe,
 * image dans <img>, etc.). Valide 1h par défaut.
 *
 * Même helper pour auth et anon — la policy storage filtre l'accès.
 *
 * @param {string} storagePath
 * @param {number} [expiresIn=3600] — durée en secondes (défaut 1h)
 */
export async function getAttachmentUrl(storagePath, expiresIn = 3600) {
  if (!storagePath) throw new Error('getAttachmentUrl : storagePath requis')
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn)
  if (error) throw error
  return data?.signedUrl || null
}

/**
 * Génère une URL signée avec l'entête `Content-Disposition: attachment` pour
 * forcer le téléchargement (le navigateur ne tente pas de l'ouvrir inline).
 *
 * Utilisé pour le bouton "Télécharger" à côté de la prévisualisation —
 * l'utilisateur peut vouloir récupérer le fichier même s'il est affichable
 * dans le viewer.
 *
 * Note Supabase : l'option `download` peut être :
 *   - true              → force le download avec le nom original
 *   - 'custom.pdf'      → force le download avec un nom custom
 * On passe le filename original si fourni, sinon `true`.
 *
 * @param {string}  storagePath
 * @param {object}  [opts]
 * @param {string}  [opts.filename] — nom proposé au téléchargement
 * @param {number}  [opts.expiresIn=3600]
 */
export async function getAttachmentDownloadUrl(storagePath, { filename, expiresIn = 3600 } = {}) {
  if (!storagePath) throw new Error('getAttachmentDownloadUrl : storagePath requis')
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn, {
      download: filename ? filename : true,
    })
  if (error) throw error
  return data?.signedUrl || null
}

// ═══ Utilitaires UI ══════════════════════════════════════════════════════════

/**
 * Formatte une taille en octets vers une chaîne lisible ("1.2 Mo", "345 Ko").
 * Utile pour l'UI sans dépendance externe.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`
}

/**
 * Retourne le label d'affichage : `title` si défini, sinon `filename`.
 * Jamais vide (au pire "Fichier sans nom").
 */
export function displayLabel(att) {
  if (!att) return 'Fichier sans nom'
  const t = (att.title || '').trim()
  if (t) return t
  return att.filename || 'Fichier sans nom'
}

/**
 * Détecte si un fichier est prévisualisable inline dans le navigateur
 * (PDF via iframe PDFium, image via <img>). Les autres formats (xlsx, docx,
 * zip…) ne le sont pas et tombent en fallback "télécharger".
 *
 * Retourne une string :
 *   - 'pdf'   → PDF (iframe)
 *   - 'image' → image raster (img src)
 *   - null    → non prévisualisable
 */
export function previewKind(att) {
  if (!att) return null
  const mime = (att.mime_type || '').toLowerCase()
  const ext = (att.filename || '').toLowerCase().split('.').pop() || ''
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (
    mime.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'].includes(ext)
  ) {
    return 'image'
  }
  return null
}
