// ════════════════════════════════════════════════════════════════════════════
// matosCloture.js — Wrappers Supabase pour la clôture des essais (MAT-12)
// ════════════════════════════════════════════════════════════════════════════
//
// Flow de clôture (depuis /check/:token OU depuis l'onglet Matériel admin) :
//
//   1. Front : agrégation data  (aggregateBilanData)
//   2. Front : build ZIP         (buildBilanZip) → Blob
//   3. Front : upload ZIP vers Storage sous `<version_id>/bilan/<filename>.zip`
//              (anon OU authenticated — les policies MAT-12 autorisent les deux
//              pour ce préfixe)
//   4. Front : appel RPC `check_action_close_essais(p_token, p_user_name,
//              p_archive_path, p_archive_filename, p_archive_size_bytes,
//              p_archive_mime)` qui :
//              - valide le token
//              - pose closed_at + closed_by_name + bilan_archive_path sur la
//                version
//              - insère une ligne matos_version_attachments (title = "Bilan
//                essais V{n}") pour exposer l'archive dans le viewer docs
//
// Ré-ouverture (admin authenticated uniquement) :
//   - RPC `reopen_matos_version(p_version_id)` → efface closed_*.
//     Les anciennes archives ZIP restent comme audit trail dans attachments.
//
// Pourquoi séparé de matosCheckToken.js ? Parce que la clôture implique Storage
// + RPC + build PDF — un workflow composite. On garde matosCheckToken pour les
// RPCs basiques (toggle/add/setFlag) et on isole ici le pipeline de clôture.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import {
  fetchCheckSessionAuthed,
  closeCheckEssaisAuthed,
} from './matosCheckAuthed'
import { aggregateBilanData, bilanZipFilename } from './matosBilanData'

const BUCKET = 'matos-attachments'

// ─── Upload Storage (anon OU auth, policies s'en chargent) ────────────────

/**
 * Upload le ZIP bilan dans le bucket matos-attachments sous le préfixe
 * `<version_id>/bilan/`. Retourne le `storage_path` persisté. Si un fichier
 * existe déjà au même path (re-clôture avec même nom), on remplace (upsert:true).
 *
 * Le path doit impérativement commencer par `<version_id>/bilan/` pour passer
 * la policy anon (cf. migration MAT-12 §2). Les authenticated ont aussi accès
 * grâce à la policy MAT-10J existante.
 *
 * @param {object} opts
 * @param {string} opts.versionId — UUID de la version clôturée
 * @param {Blob}   opts.blob      — Blob ZIP (sortie de buildBilanZip)
 * @param {string} opts.filename  — nom lisible, servira aussi de segment path
 * @returns {Promise<{ storagePath: string, sizeBytes: number, mimeType: string }>}
 */
export async function uploadBilanArchive({ versionId, blob, filename }) {
  if (!versionId) throw new Error('uploadBilanArchive : versionId requis')
  if (!blob) throw new Error('uploadBilanArchive : blob requis')
  if (!filename) throw new Error('uploadBilanArchive : filename requis')

  // Path format : `<version_id>/bilan/<filename>`. On n'ajoute PAS d'uuid
  // pour que le remplacement d'une re-clôture écrase la précédente archive
  // (si même nom). L'historique reste via matos_version_attachments.
  const storagePath = `${versionId}/bilan/${filename}`

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, blob, {
    cacheControl: '3600',
    upsert: true,
    contentType: 'application/zip',
  })
  if (error) throw error

  return {
    storagePath,
    sizeBytes: blob.size,
    mimeType: 'application/zip',
  }
}

// ─── RPC anon (via token) : clôturer les essais ──────────────────────────

/**
 * Appelle la RPC `check_action_close_essais` — valide le token, pose le flag
 * clôturé, insère l'attachment bilan.
 *
 * Utilisable côté anon (/check/:token) ou authenticated (admin sur Materiel).
 *
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.userName        — prénom/nom de celui qui clôture
 * @param {string} opts.archivePath     — path Storage ZIP
 * @param {string} opts.archiveFilename — nom lisible du ZIP
 * @param {number} opts.archiveSize     — taille en octets
 * @param {string} [opts.archiveMime]   — defaults to 'application/zip'
 * @returns {Promise<object>} payload { version_id, closed_at, closed_by_name,
 *                                       bilan_archive_path, attachment_id }
 */
export async function closeCheckEssais({
  token,
  userName,
  archivePath,
  archiveFilename,
  archiveSize,
  archiveMime = 'application/zip',
}) {
  if (!token) throw new Error('closeCheckEssais : token requis')
  if (!userName?.trim()) throw new Error('closeCheckEssais : userName requis')
  if (!archivePath) throw new Error('closeCheckEssais : archivePath requis')

  const { data, error } = await supabase.rpc('check_action_close_essais', {
    p_token: token,
    p_user_name: userName.trim(),
    p_archive_path: archivePath,
    p_archive_filename: archiveFilename || 'bilan.zip',
    p_archive_size_bytes: archiveSize || 0,
    p_archive_mime: archiveMime,
  })
  if (error) throw error
  return data
}

// ─── RPC authenticated : ré-ouvrir une version clôturée ──────────────────

/**
 * Ré-ouvre une version qui avait été clôturée. Réservé aux admins ayant le
 * droit `can_edit_outil(project, 'materiel')` — la RPC fait le check côté SQL.
 *
 * N'efface PAS les pièces jointes bilan précédemment archivées (audit trail).
 *
 * @param {string} versionId
 * @returns {Promise<{ version_id: string, reopened: boolean }>}
 */
export async function reopenMatosVersion(versionId) {
  if (!versionId) throw new Error('reopenMatosVersion : versionId requis')
  const { data, error } = await supabase.rpc('reopen_matos_version', {
    p_version_id: versionId,
  })
  if (error) throw error
  return data
}

// ─── Helpers dérivés ──────────────────────────────────────────────────────

/**
 * Helper d'orchestration : upload le ZIP + appelle la RPC de clôture.
 * Sert à simplifier l'UI (un seul await depuis CheckSession + MaterielHeader).
 *
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.versionId
 * @param {string} opts.userName
 * @param {Blob}   opts.zipBlob
 * @param {string} opts.zipFilename
 * @returns {Promise<object>} payload de `check_action_close_essais`
 */
export async function closeEssaisWithArchive({
  token,
  versionId,
  userName,
  zipBlob,
  zipFilename,
}) {
  const upload = await uploadBilanArchive({
    versionId,
    blob: zipBlob,
    filename: zipFilename,
  })
  return closeCheckEssais({
    token,
    userName,
    archivePath: upload.storagePath,
    archiveFilename: zipFilename,
    archiveSize: upload.sizeBytes,
    archiveMime: upload.mimeType,
  })
}

// ─── Prévisualisation bilan (aucune écriture, aucun upload) ───────────────

/**
 * Génère le ZIP bilan (PDF global + un PDF par loueur) **sans clôturer** :
 *   - pas d'upload Storage
 *   - pas d'appel RPC `check_action_close_essais*`
 *   - pas de ligne `matos_version_attachments`
 *
 * Depuis MAT-14, on passe directement par `check_session_fetch_authed`
 * (SECURITY DEFINER gated par `can_read_outil('materiel')`) — plus besoin
 * du token éphémère qui existait avant. L'historique matos_check_tokens
 * n'est donc plus pollué par des lignes "Admin aperçu (usage unique)".
 *
 * Retourne `{ blob, url, filename, isZip: true, download, revoke }` — shape
 * compatible avec le `PdfPreviewModal` existant (runExport de MaterielTab).
 *
 * @param {object} opts
 * @param {string} opts.versionId
 * @param {object} [opts.pdfOptions]  — passé à buildBilanZip ({org})
 * @returns {Promise<object>}  shape PDF/ZIP standard
 */
export async function previewBilanAsAdmin({ versionId, pdfOptions = {} }) {
  if (!versionId) throw new Error('previewBilanAsAdmin : versionId requis')

  const session = await fetchCheckSessionAuthed(versionId)
  const snapshot = aggregateBilanData(session)
  if (!snapshot.version?.id) throw new Error('Version introuvable dans la session')

  const { buildBilanZip } = await import('../features/materiel/matosBilanPdf')
  return buildBilanZip(snapshot, pdfOptions)
}

// ─── Clôture côté admin (authenticated) ───────────────────────────────────

/**
 * Clôture depuis l'onglet Matériel (admin authenticated).
 *
 * Depuis MAT-14, on appelle directement les RPC `check_*_authed` qui gèrent
 * l'authentification via `auth.uid()` + `can_edit_outil('materiel')`. Plus
 * besoin de créer un token éphémère pour contourner le fait que les anciennes
 * RPC exigeaient un token — la migration MAT-14A ajoute les wrappers
 * authenticated.
 *
 * Pipeline :
 *   1. Fetch session authed (SECURITY DEFINER, gated)
 *   2. Aggregate + build ZIP
 *   3. Upload ZIP dans Storage
 *   4. RPC `check_action_close_essais_authed` (pose closed_at + attachment)
 *
 * @param {object} opts
 * @param {string} opts.versionId
 * @param {string} opts.userName                      — prénom/nom visible dans le bilan
 *                                                     (fallback local uniquement ;
 *                                                     la vraie valeur vient de
 *                                                     profiles.full_name côté RPC)
 * @param {object} [opts.pdfOptions]                   — passé à buildBilanZip ({org})
 * @returns {Promise<{ payload: object, zip: object }>}
 */
export async function closeEssaisAsAdmin({ versionId, userName, pdfOptions = {} }) {
  if (!versionId) throw new Error('closeEssaisAsAdmin : versionId requis')
  if (!userName?.trim()) throw new Error('closeEssaisAsAdmin : userName requis')

  // 1. Fetch session via la RPC authed (SECURITY DEFINER, gated can_read_outil).
  const session = await fetchCheckSessionAuthed(versionId)
  const snapshot = aggregateBilanData(session)
  if (!snapshot.version?.id) throw new Error('Version introuvable dans la session')

  // 2. Build ZIP (lazy import pour garder matosCloture léger).
  const { buildBilanZip } = await import('../features/materiel/matosBilanPdf')
  const zip = await buildBilanZip(snapshot, pdfOptions)

  // 3. Upload dans Storage puis 4. RPC close authed.
  const zipFilename = bilanZipFilename({
    project: snapshot.project,
    version: snapshot.version,
  })
  const upload = await uploadBilanArchive({
    versionId: snapshot.version.id,
    blob: zip.blob,
    filename: zipFilename,
  })
  const payload = await closeCheckEssaisAuthed({
    versionId: snapshot.version.id,
    archivePath: upload.storagePath,
    archiveFilename: zipFilename,
    archiveSize: upload.sizeBytes,
    archiveMime: upload.mimeType,
  })

  return { payload, zip }
}
