// ════════════════════════════════════════════════════════════════════════════
// matosRendu.js — Wrappers Supabase pour la clôture du rendu loueur (MAT-13)
// ════════════════════════════════════════════════════════════════════════════
//
// Miroir fonctionnel de `matosCloture.js` (essais) mais pour la phase rendu :
//
//   1. Front : agrégation data     (aggregateRenduData — à écrire en MAT-13E)
//   2. Front : build PDF bon-retour (buildBonRetourPdf — MAT-13E)  → Blob
//   3. Front : upload PDF vers Storage sous `<version_id>/bon-retour/<filename>.pdf`
//              (policies anon INSERT/UPDATE ajoutées par MAT-13A, gatées par
//              la présence d'un token phase='rendu' actif sur la version)
//   4. Front : appel RPC `check_action_close_rendu(p_token, p_user_name,
//              p_archive_path, p_archive_filename, p_archive_size_bytes,
//              p_archive_mime)` qui :
//              - valide le token ET vérifie qu'il est phase='rendu'
//              - pose rendu_closed_at + rendu_closed_by_name +
//                bon_retour_archive_path sur la version
//              - insère une ligne matos_version_attachments titrée
//                "Bon de retour V{n}" pour exposer le PDF dans le viewer docs
//
// Ré-ouverture rendu (admin authenticated uniquement) :
//   - RPC `reopen_matos_version_rendu(p_version_id)` → efface rendu_closed_*.
//     Les anciennes archives PDF restent comme audit trail dans attachments.
//
// Pourquoi un fichier séparé vs. matosCloture.js ? Symétrie avec la séparation
// essais/rendu côté SQL + permet d'évoluer les deux pipelines indépendamment
// (ex. format d'archive différent : ZIP pour le bilan, PDF simple pour le bon
// de retour).
//
// Voir supabase/migrations/20260424_mat13_rendu_phase.sql.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

const BUCKET = 'matos-attachments'

// ─── Upload Storage (anon via token phase='rendu' OU auth) ────────────────

/**
 * Upload le PDF bon-retour dans le bucket matos-attachments sous le préfixe
 * `<version_id>/bon-retour/`. Retourne le `storage_path` persisté. Si un
 * fichier existe déjà au même path (re-clôture avec même nom), on remplace
 * (upsert: true).
 *
 * Le path doit impérativement commencer par `<version_id>/bon-retour/` pour
 * passer les policies anon MAT-13A (cf. §4 de la migration). Les authenticated
 * ont aussi accès grâce à la policy MAT-10J existante.
 *
 * @param {object} opts
 * @param {string} opts.versionId — UUID de la version rendue
 * @param {Blob}   opts.blob      — Blob PDF (sortie de buildBonRetourPdf)
 * @param {string} opts.filename  — nom lisible, servira aussi de segment path
 * @param {string} [opts.mimeType='application/pdf']
 * @returns {Promise<{ storagePath: string, sizeBytes: number, mimeType: string }>}
 */
export async function uploadBonRetourArchive({
  versionId,
  blob,
  filename,
  mimeType = 'application/pdf',
}) {
  if (!versionId) throw new Error('uploadBonRetourArchive : versionId requis')
  if (!blob) throw new Error('uploadBonRetourArchive : blob requis')
  if (!filename) throw new Error('uploadBonRetourArchive : filename requis')

  // Path format : `<version_id>/bon-retour/<filename>`. Cohérent avec
  // l'approche essais (upsert sur re-clôture, historique via attachments).
  const storagePath = `${versionId}/bon-retour/${filename}`

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, blob, {
    cacheControl: '3600',
    upsert: true,
    contentType: mimeType,
  })
  if (error) throw error

  return {
    storagePath,
    sizeBytes: blob.size,
    mimeType,
  }
}

// ─── RPC anon (via token phase='rendu') : clôturer le rendu ───────────────

/**
 * Appelle la RPC `check_action_close_rendu` — valide le token (doit être
 * phase='rendu' sinon SQLSTATE 42501), pose les flags de clôture rendu sur
 * la version, insère l'attachment "Bon de retour V{n}".
 *
 * Utilisable côté anon (/rendu/:token) ou authenticated (admin, si on veut
 * réutiliser le chemin token par commodité ; en pratique les admins passent
 * par `closeCheckRenduAuthed`).
 *
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.userName        — prénom/nom de celui qui clôture
 * @param {string} opts.archivePath     — path Storage PDF
 * @param {string} opts.archiveFilename — nom lisible du PDF
 * @param {number} opts.archiveSize     — taille en octets
 * @param {string} [opts.archiveMime]   — defaults to 'application/pdf'
 * @returns {Promise<object>} payload { version_id, rendu_closed_at,
 *                                      rendu_closed_by_name,
 *                                      bon_retour_archive_path, attachment_id }
 */
export async function closeCheckRendu({
  token,
  userName,
  archivePath,
  archiveFilename,
  archiveSize,
  archiveMime = 'application/pdf',
}) {
  if (!token) throw new Error('closeCheckRendu : token requis')
  if (!userName?.trim()) throw new Error('closeCheckRendu : userName requis')
  if (!archivePath) throw new Error('closeCheckRendu : archivePath requis')

  const { data, error } = await supabase.rpc('check_action_close_rendu', {
    p_token: token,
    p_user_name: userName.trim(),
    p_archive_path: archivePath,
    p_archive_filename: archiveFilename || 'bon-retour.pdf',
    p_archive_size_bytes: archiveSize || 0,
    p_archive_mime: archiveMime,
  })
  if (error) throw error
  return data
}

// ─── RPC authed : clôturer le rendu en mode admin ────────────────────────

/**
 * Clôture rendu en mode authenticated (sans token). `rendu_closed_by` =
 * auth.uid(), `rendu_closed_by_name` = profiles.full_name côté serveur.
 *
 * Shape payload aligné sur `check_action_close_rendu` (chemin token).
 *
 * @param {object} opts
 * @param {string} opts.versionId
 * @param {string} opts.archivePath     — path Storage PDF (upload préalable)
 * @param {string} opts.archiveFilename — nom lisible du PDF
 * @param {number} opts.archiveSize     — taille en octets
 * @param {string} [opts.archiveMime]   — defaults to 'application/pdf'
 */
export async function closeCheckRenduAuthed({
  versionId,
  archivePath,
  archiveFilename,
  archiveSize,
  archiveMime = 'application/pdf',
}) {
  if (!versionId) throw new Error('closeCheckRenduAuthed : versionId requis')
  if (!archivePath) throw new Error('closeCheckRenduAuthed : archivePath requis')
  const { data, error } = await supabase.rpc('check_action_close_rendu_authed', {
    p_version_id: versionId,
    p_archive_path: archivePath,
    p_archive_filename: archiveFilename || 'bon-retour.pdf',
    p_archive_size_bytes: archiveSize || 0,
    p_archive_mime: archiveMime,
  })
  if (error) throw error
  return data
}

// ─── RPC authenticated : ré-ouvrir une version clôturée (rendu) ──────────

/**
 * Ré-ouvre une version dont le rendu avait été clôturé. Réservé aux admins
 * ayant `can_edit_outil(project, 'materiel')` — gate côté SQL.
 *
 * N'efface PAS les attachments bon-retour précédemment archivés (audit).
 *
 * @param {string} versionId
 * @returns {Promise<{ version_id: string, reopened: boolean }>}
 */
export async function reopenMatosVersionRendu(versionId) {
  if (!versionId) throw new Error('reopenMatosVersionRendu : versionId requis')
  const { data, error } = await supabase.rpc('reopen_matos_version_rendu', {
    p_version_id: versionId,
  })
  if (error) throw error
  return data
}

// ─── Helpers dérivés ──────────────────────────────────────────────────────

/**
 * Helper d'orchestration : upload le PDF + appelle la RPC de clôture rendu.
 * Simplifie l'UI (un seul await depuis RenduSession + MaterielHeader).
 *
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.versionId
 * @param {string} opts.userName
 * @param {Blob}   opts.pdfBlob
 * @param {string} opts.pdfFilename
 * @returns {Promise<object>} payload de `check_action_close_rendu`
 */
export async function closeRenduWithArchive({
  token,
  versionId,
  userName,
  pdfBlob,
  pdfFilename,
}) {
  const upload = await uploadBonRetourArchive({
    versionId,
    blob: pdfBlob,
    filename: pdfFilename,
  })
  return closeCheckRendu({
    token,
    userName,
    archivePath: upload.storagePath,
    archiveFilename: pdfFilename,
    archiveSize: upload.sizeBytes,
    archiveMime: upload.mimeType,
  })
}

// ─── MAT-13G : Feedback rendu (global + par loueur) ──────────────────────
//
// Champ libre en tête de la checklist retour (+ par loueur). Écriture autorisée
// à tous (token phase='rendu' + authed can_edit_outil) via RPC dédiées —
// l'écriture directe est bloquée par RLS MAT-20 pour les anon.
//
// Côté SQL : cf. supabase/migrations/20260425_mat13g_rendu_feedback.sql.
// Les 4 RPC exposent un payload minimal { version_id, rendu_feedback } pour
// le global, { id, version_id, loueur_id, rendu_feedback } pour le loueur —
// suffisant pour la reconciliation optimiste côté hooks (useRendu*Session).

/**
 * Set du feedback global (texte libre en tête de checklist retour) via token.
 *
 * @param {object} opts
 * @param {string} opts.token      — token phase='rendu' actif
 * @param {string} [opts.userName] — accepté mais non persisté (homogénéité API)
 * @param {string} opts.body       — texte libre (peut être vide)
 * @returns {Promise<{ version_id: string, rendu_feedback: string }>}
 */
export async function setRenduFeedback({ token, userName = '', body }) {
  if (!token) throw new Error('setRenduFeedback : token requis')
  const { data, error } = await supabase.rpc('check_action_set_rendu_feedback', {
    p_token: token,
    p_user_name: (userName || '').trim(),
    p_body: body ?? '',
  })
  if (error) throw error
  return data
}

/**
 * Set du feedback global en mode authenticated (sans token).
 *
 * @param {object} opts
 * @param {string} opts.versionId
 * @param {string} opts.body
 * @returns {Promise<{ version_id: string, rendu_feedback: string }>}
 */
export async function setRenduFeedbackAuthed({ versionId, body }) {
  if (!versionId) throw new Error('setRenduFeedbackAuthed : versionId requis')
  const { data, error } = await supabase.rpc('check_action_set_rendu_feedback_authed', {
    p_version_id: versionId,
    p_body: body ?? '',
  })
  if (error) throw error
  return data
}

/**
 * Set du feedback par loueur (upsert dans matos_version_loueur_infos) via token.
 *
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} [opts.userName]
 * @param {string} opts.loueurId — UUID du fournisseur (doit exister)
 * @param {string} opts.body
 * @returns {Promise<{ id: string, version_id: string, loueur_id: string, rendu_feedback: string }>}
 */
export async function setRenduFeedbackLoueur({ token, userName = '', loueurId, body }) {
  if (!token) throw new Error('setRenduFeedbackLoueur : token requis')
  if (!loueurId) throw new Error('setRenduFeedbackLoueur : loueurId requis')
  const { data, error } = await supabase.rpc('check_action_set_rendu_feedback_loueur', {
    p_token: token,
    p_user_name: (userName || '').trim(),
    p_loueur_id: loueurId,
    p_body: body ?? '',
  })
  if (error) throw error
  return data
}

/**
 * Set du feedback par loueur en mode authenticated.
 *
 * @param {object} opts
 * @param {string} opts.versionId
 * @param {string} opts.loueurId
 * @param {string} opts.body
 */
export async function setRenduFeedbackLoueurAuthed({ versionId, loueurId, body }) {
  if (!versionId) throw new Error('setRenduFeedbackLoueurAuthed : versionId requis')
  if (!loueurId) throw new Error('setRenduFeedbackLoueurAuthed : loueurId requis')
  const { data, error } = await supabase.rpc('check_action_set_rendu_feedback_loueur_authed', {
    p_version_id: versionId,
    p_loueur_id: loueurId,
    p_body: body ?? '',
  })
  if (error) throw error
  return data
}


// ─── Nom de fichier PDF bon-retour ────────────────────────────────────────
//
// Aligné avec `bilanZipFilename` pour cohérence de nommage des archives entre
// les deux phases. Format : "Bon-retour-{ref_projet ou title}-V{n}.pdf".

/**
 * Construit un nom de fichier stable pour le PDF bon-retour. Évite les
 * caractères problématiques pour Storage (/ \ ?) et limite la longueur.
 *
 * @param {object} opts
 * @param {object} opts.project — { title, ref_projet }
 * @param {object} opts.version — { numero, label }
 * @returns {string}
 */
export function bonRetourPdfFilename({ project, version }) {
  const ref = _slugFilename(project?.ref_projet) || _slugFilename(project?.title) || 'projet'
  const n = version?.numero ?? '?'
  return `Bon-retour-${ref}-V${n}.pdf`
}

/**
 * Variante "par loueur" — suffixée avec le nom du loueur slugifié. Utilisée
 * pour les PDFs individuels d'un ZIP ou l'export mode "loueur" depuis la
 * modale BonRetourExportModal (MAT-13H).
 *
 * @param {object} opts
 * @param {object} opts.project — { title, ref_projet }
 * @param {object} opts.version — { numero, label }
 * @param {object} opts.loueur  — { nom } ou null pour "Sans loueur"
 * @returns {string}
 */
export function bonRetourLoueurPdfFilename({ project, version, loueur = null }) {
  const ref = _slugFilename(project?.ref_projet) || _slugFilename(project?.title) || 'projet'
  const n = version?.numero ?? '?'
  const nom = loueur?.nom ? _slugFilename(loueur.nom) : 'sans-loueur'
  return `Bon-retour-${ref}-V${n}-${nom}.pdf`
}

/**
 * Filename pour le ZIP global + PDFs par loueur (MAT-13H).
 *   ex. "Bon-retour-MTX-2026-03-V1.zip"
 */
export function bonRetourZipFilename({ project, version }) {
  const ref = _slugFilename(project?.ref_projet) || _slugFilename(project?.title) || 'projet'
  const n = version?.numero ?? '?'
  return `Bon-retour-${ref}-V${n}.zip`
}

// Slugifieur interne partagé entre les trois helpers ci-dessus.
function _slugFilename(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
