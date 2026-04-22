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
  createCheckToken,
  fetchCheckSession,
  revokeCheckToken,
} from './matosCheckToken'
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
 *   - pas d'appel RPC `check_action_close_essais`
 *   - pas de ligne `matos_version_attachments`
 *
 * Même pipeline que `closeEssaisAsAdmin` (token éphémère → fetch session →
 * agrégation → build ZIP) mais on s'arrête à la sortie du builder. L'appelant
 * récupère `{ blob, url, filename, isZip: true, download, revoke }` compatible
 * avec le `PdfPreviewModal` existant (runExport de MaterielTab).
 *
 * Le token éphémère est quand même créé (5 min, labellisé "Admin aperçu")
 * parce que `fetch_check_session` passe par le token ; il est révoqué dans
 * le `finally`.
 *
 * @param {object} opts
 * @param {string} opts.versionId
 * @param {object} [opts.pdfOptions]  — passé à buildBilanZip ({org})
 * @returns {Promise<object>}  shape PDF/ZIP standard
 */
export async function previewBilanAsAdmin({ versionId, pdfOptions = {} }) {
  if (!versionId) throw new Error('previewBilanAsAdmin : versionId requis')

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const tokenRow = await createCheckToken({
    versionId,
    label: 'Admin aperçu (usage unique)',
    expiresAt,
  })
  const adminToken = tokenRow?.token
  const adminTokenId = tokenRow?.id
  if (!adminToken) throw new Error('Création du token admin échouée')

  try {
    const session = await fetchCheckSession(adminToken)
    const snapshot = aggregateBilanData(session)
    if (!snapshot.version?.id) throw new Error('Version introuvable dans la session')

    const { buildBilanZip } = await import('../features/materiel/matosBilanPdf')
    const zip = await buildBilanZip(snapshot, pdfOptions)
    return zip
  } finally {
    if (adminTokenId) {
      try {
        await revokeCheckToken(adminTokenId)
      } catch {
        /* silencieux — audit trail préservé */
      }
    }
  }
}

// ─── Clôture côté admin (authenticated) ───────────────────────────────────

/**
 * Clôture depuis l'onglet Matériel (admin authenticated).
 *
 * Contrairement au flow /check/:token (qui a déjà un token en mains), l'admin
 * n'en a pas forcément : on crée donc un token éphémère "Admin clôture
 * (usage unique)" expirant dans 5 minutes, on l'utilise pour fetcher la
 * session + closer, puis on le révoque en "best effort" dans le finally.
 *
 * Avantage : on réutilise tout le pipeline existant (aggregate → ZIP → upload
 * → RPC), sans dupliquer la logique d'agrégation côté authenticated.
 *
 * Rationale : la RPC `check_action_close_essais` impose un token (cf. migration
 * MAT-12) ; un authenticated RPC sans token demanderait une nouvelle migration.
 * Le token jetable est un compromis acceptable (audit trail : `matos_check_tokens`
 * conservera la ligne avec `revoked_at` posée).
 *
 * @param {object} opts
 * @param {string} opts.versionId
 * @param {string} opts.userName                      — prénom/nom visible dans le bilan
 * @param {object} [opts.pdfOptions]                   — passé à buildBilanZip ({org})
 * @returns {Promise<{ payload: object, zip: object, adminTokenId: string }>}
 */
export async function closeEssaisAsAdmin({ versionId, userName, pdfOptions = {} }) {
  if (!versionId) throw new Error('closeEssaisAsAdmin : versionId requis')
  if (!userName?.trim()) throw new Error('closeEssaisAsAdmin : userName requis')

  // 1. Crée un token éphémère (5 min) labellisé "Admin clôture".
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const tokenRow = await createCheckToken({
    versionId,
    label: 'Admin clôture (usage unique)',
    expiresAt,
  })
  const adminToken = tokenRow?.token
  const adminTokenId = tokenRow?.id
  if (!adminToken) throw new Error('Création du token admin échouée')

  try {
    // 2. Fetch la session via le token (comme /check/:token).
    const session = await fetchCheckSession(adminToken)
    const snapshot = aggregateBilanData(session)
    if (!snapshot.version?.id) throw new Error('Version introuvable dans la session')

    // 3. Build ZIP (lazy import pour garder matosCloture léger).
    const { buildBilanZip } = await import('../features/materiel/matosBilanPdf')
    const zip = await buildBilanZip(snapshot, pdfOptions)

    // 4. Upload + RPC close.
    const payload = await closeEssaisWithArchive({
      token: adminToken,
      versionId: snapshot.version.id,
      userName: userName.trim(),
      zipBlob: zip.blob,
      zipFilename: bilanZipFilename({
        project: snapshot.project,
        version: snapshot.version,
      }),
    })

    return { payload, zip, adminTokenId }
  } finally {
    // 5. Révoque le token admin, best effort (ne bloque pas le retour).
    if (adminTokenId) {
      try {
        await revokeCheckToken(adminTokenId)
      } catch {
        /* silencieux — audit trail préservé */
      }
    }
  }
}
