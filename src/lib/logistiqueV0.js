// ════════════════════════════════════════════════════════════════════════════
// logistiqueV0.js — Helpers CRUD pour l'outil Logistique V0 (provisoire)
// ════════════════════════════════════════════════════════════════════════════
//
// Outil minimal de gestion logistique : 1 entrée par couple (projet, membre),
// 3 sous-blocs texte libre (transport / hébergement / repas), N documents
// (PDF / PNG / JPG) par sous-bloc. Sera remplacé par Logistique V1/V2/V3.
//
// Architecture :
//   - Métadonnées entries  : table `projet_logistique_v0_entries`   (RLS classique)
//   - Métadonnées docs     : table `projet_logistique_v0_documents` (RLS héritée)
//   - Fichiers Storage     : bucket `projet-logistique-v0-docs` (privé)
//   - Path Storage         : `<entry_id>/<uuid>.<ext>`
//
// Pattern aligné sur matosAttachments.js (MAT-10J).
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

const BUCKET = 'projet-logistique-v0-docs'

// 25 Mo : couvre PDF de réservation, billet de train, screenshot, photo HD.
// Au-delà, on refuse côté client pour éviter de saturer le storage.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

// 3 sous-blocs autorisés (miroir CHECK constraint SQL).
export const LOGISTIQUE_KINDS = ['transport', 'hebergement', 'repas']

// Format autorisés (PDF / PNG / JPG / JPEG). On reste strict en V0 — pas
// d'Office, pas de HEIC. Les billets de train numérisés sont quasi toujours
// dans ces 3 formats.
export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]
export const ACCEPTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg']

const KIND_TO_TEXT_COLUMN = {
  transport: 'transport_text',
  hebergement: 'hebergement_text',
  repas: 'repas_text',
}

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
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function buildStoragePath(entryId, filename) {
  const ext = extractExtension(filename)
  const uuid = generateUuid()
  return ext ? `${entryId}/${uuid}.${ext}` : `${entryId}/${uuid}`
}

function isValidKind(kind) {
  return LOGISTIQUE_KINDS.includes(kind)
}

// ═══ Entries CRUD ════════════════════════════════════════════════════════════

/**
 * Liste les entrées logistiques d'un projet (sans jointure membre — le caller
 * fait le mapping côté UI avec `fetchProjectMembers(projectId)` pour rester
 * cohérent avec le reste du code Équipe). Tri par date de création pour un
 * ordre stable.
 *
 * @param {string} projectId
 * @returns {Promise<Array>} Liste d'objets {
 *   id, project_id, membre_id, transport_text, hebergement_text, repas_text,
 *   created_at, updated_at, created_by
 * }
 */
export async function listEntries(projectId) {
  if (!projectId) throw new Error('listEntries : projectId requis')

  const { data, error } = await supabase
    .from('projet_logistique_v0_entries')
    .select(
      'id, project_id, membre_id, transport_text, hebergement_text, repas_text, hidden_kinds, created_at, updated_at, created_by',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Ajoute une nouvelle entrée logistique pour un membre du projet. Le couple
 * (project_id, membre_id) est UNIQUE en base — duplicate génère une erreur
 * 23505 que le caller doit gérer.
 *
 * @returns la ligne entry insérée (sans jointure membre).
 */
export async function addEntry({ projectId, membreId }) {
  if (!projectId) throw new Error('addEntry : projectId requis')
  if (!membreId) throw new Error('addEntry : membreId requis')

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id || null

  const { data, error } = await supabase
    .from('projet_logistique_v0_entries')
    .insert([
      {
        project_id: projectId,
        membre_id: membreId,
        created_by: userId,
      },
    ])
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Supprime une entrée logistique. CASCADE en SQL supprime les rows
 * documents. Les fichiers Storage sont supprimés explicitement avant
 * pour éviter les orphelins (Postgres ne sait pas vider le bucket).
 */
export async function removeEntry(entryId) {
  if (!entryId) throw new Error('removeEntry : entryId requis')

  // 1. Récupérer les storage_paths des documents avant la cascade DELETE
  const { data: docs, error: listErr } = await supabase
    .from('projet_logistique_v0_documents')
    .select('storage_path')
    .eq('entry_id', entryId)
  if (listErr) throw listErr

  const paths = (docs || []).map((d) => d.storage_path).filter(Boolean)

  // 2. DELETE entry (CASCADE supprime les rows docs)
  const { error: delErr } = await supabase
    .from('projet_logistique_v0_entries')
    .delete()
    .eq('id', entryId)
  if (delErr) throw delErr

  // 3. Cleanup Storage (best-effort, on log si échec mais on ne throw pas —
  //    l'entry est déjà supprimée côté DB, c'est l'essentiel pour l'UX)
  if (paths.length > 0) {
    const { error: storageErr } = await supabase.storage.from(BUCKET).remove(paths)
    if (storageErr) {
       
      console.warn('[logistiqueV0] Cleanup Storage partiel après removeEntry :', storageErr)
    }
  }
}

/**
 * Met à jour la liste des sous-blocs masqués pour une entry. Les kinds présents
 * dans hidden_kinds sont absents de l'UI (admin + share). On peut les restaurer
 * en les retirant de la liste.
 *
 * @param {string} entryId
 * @param {Array<'transport'|'hebergement'|'repas'>} hiddenKinds
 */
export async function setEntryHiddenKinds(entryId, hiddenKinds) {
  if (!entryId) throw new Error('setEntryHiddenKinds : entryId requis')
  // Normalise + valide : on garde uniquement les kinds connus, on dédup.
  const normalized = [...new Set((hiddenKinds || []).filter(isValidKind))]
  const { data, error } = await supabase
    .from('projet_logistique_v0_entries')
    .update({ hidden_kinds: normalized })
    .eq('id', entryId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour le texte d'un sous-bloc (transport / hébergement / repas).
 * Passer null ou '' efface le champ.
 *
 * @param {string} entryId
 * @param {'transport'|'hebergement'|'repas'} kind
 * @param {string|null} text
 */
export async function updateEntryText(entryId, kind, text) {
  if (!entryId) throw new Error('updateEntryText : entryId requis')
  if (!isValidKind(kind)) {
    throw new Error(
      `updateEntryText : kind invalide "${kind}", attendu transport / hebergement / repas`,
    )
  }

  const column = KIND_TO_TEXT_COLUMN[kind]
  const normalized = text == null || text === '' ? null : String(text)

  const { data, error } = await supabase
    .from('projet_logistique_v0_entries')
    .update({ [column]: normalized })
    .eq('id', entryId)
    .select()
    .single()

  if (error) throw error
  return data
}

// ═══ Documents CRUD ══════════════════════════════════════════════════════════

/**
 * Liste tous les documents d'une entry (tous sous-blocs confondus).
 * Le caller filtre par `kind` côté UI pour afficher chaque sous-bloc.
 */
export async function listDocuments(entryId) {
  if (!entryId) throw new Error('listDocuments : entryId requis')
  const { data, error } = await supabase
    .from('projet_logistique_v0_documents')
    .select(
      'id, entry_id, kind, storage_path, filename, mime_type, size_bytes, uploaded_by_name, created_at',
    )
    .eq('entry_id', entryId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Upload un fichier + crée la row metadata. Atomique côté client : si
 * l'INSERT DB échoue, on supprime le fichier Storage pour éviter un orphelin.
 *
 * @param {object} opts
 * @param {string} opts.entryId          — entrée logistique cible
 * @param {'transport'|'hebergement'|'repas'} opts.kind — sous-bloc
 * @param {File}   opts.file             — File object (input type=file)
 * @param {string} [opts.uploadedByName] — facultatif, le nom pour affichage UI
 *
 * @returns la ligne projet_logistique_v0_documents insérée.
 */
export async function uploadDocument({ entryId, kind, file, uploadedByName = null }) {
  if (!entryId) throw new Error('uploadDocument : entryId requis')
  if (!isValidKind(kind)) {
    throw new Error(
      `uploadDocument : kind invalide "${kind}", attendu transport / hebergement / repas`,
    )
  }
  if (!file) throw new Error('uploadDocument : file requis')

  // ─── Garde-fous côté client ─────────────────────────────────────────────
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    const maxMb = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)
    throw new Error(`Fichier trop volumineux (${mb} Mo, max ${maxMb} Mo)`)
  }

  const ext = extractExtension(file.name)
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Format .${ext || '?'} non autorisé. Formats acceptés : ${ACCEPTED_EXTENSIONS.join(', ')}`,
    )
  }
  if (file.type && !ACCEPTED_MIME_TYPES.includes(file.type.toLowerCase())) {
    // Certains navigateurs envoient un MIME vide ou générique — on vérifie
    // surtout l'extension. Si MIME présent ET inattendu, on warning mais
    // on laisse passer (extension a la priorité).
     
    console.warn(`[logistiqueV0] MIME inattendu "${file.type}" (.${ext})`)
  }

  // ─── 1. Upload Storage ──────────────────────────────────────────────────
  const storagePath = buildStoragePath(entryId, file.name)
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    })
  if (uploadError) throw uploadError

  // ─── 2. INSERT DB (rollback Storage si KO) ─────────────────────────────
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id || null

  const { data, error: insertError } = await supabase
    .from('projet_logistique_v0_documents')
    .insert([
      {
        entry_id: entryId,
        kind,
        storage_path: storagePath,
        filename: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userId,
        uploaded_by_name: uploadedByName,
      },
    ])
    .select()
    .single()

  if (insertError) {
    // Rollback : on remove le fichier Storage pour éviter l'orphelin
    await supabase.storage.from(BUCKET).remove([storagePath])
    throw insertError
  }

  return data
}

/**
 * Supprime un document : DB row + fichier Storage. Le storage_path est
 * récupéré depuis la row avant DELETE (le cleanup Storage se fait après
 * le DELETE DB pour éviter qu'une erreur Storage bloque l'UX).
 */
export async function deleteDocument(documentId) {
  if (!documentId) throw new Error('deleteDocument : documentId requis')

  const { data: doc, error: fetchErr } = await supabase
    .from('projet_logistique_v0_documents')
    .select('id, storage_path')
    .eq('id', documentId)
    .single()
  if (fetchErr) throw fetchErr

  const { error: delErr } = await supabase
    .from('projet_logistique_v0_documents')
    .delete()
    .eq('id', documentId)
  if (delErr) throw delErr

  if (doc?.storage_path) {
    const { error: storageErr } = await supabase.storage
      .from(BUCKET)
      .remove([doc.storage_path])
    if (storageErr) {
       
      console.warn('[logistiqueV0] Cleanup Storage partiel après deleteDocument :', storageErr)
    }
  }
}

// ═══ Signed URLs ═════════════════════════════════════════════════════════════

/**
 * Génère une URL signée pour ouvrir un document inline (preview / view).
 * TTL par défaut : 1h.
 */
export async function getDocumentSignedUrl(storagePath, expiresIn = 3600) {
  if (!storagePath) throw new Error('getDocumentSignedUrl : storagePath requis')
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn)
  if (error) throw error
  return data?.signedUrl || null
}

/**
 * Génère une URL signée avec `download=filename` qui force le téléchargement
 * (au lieu d'ouvrir dans le navigateur). TTL par défaut : 1h.
 */
export async function getDocumentDownloadUrl(storagePath, { filename, expiresIn = 3600 } = {}) {
  if (!storagePath) throw new Error('getDocumentDownloadUrl : storagePath requis')
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn, {
      download: filename || true,
    })
  if (error) throw error
  return data?.signedUrl || null
}

// ═══ Helpers UI ══════════════════════════════════════════════════════════════

/**
 * Formate une taille en bytes en chaîne lisible (ex. "2,3 Mo").
 */
export function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

/**
 * Détermine si un document est un PDF ou une image selon son MIME-type.
 * Sert pour décider du mode preview (iframe vs <img>).
 */
export function previewKind(doc) {
  const mime = (doc?.mime_type || '').toLowerCase()
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  // Fallback : déduire de l'extension du filename
  const ext = extractExtension(doc?.filename || '')
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg'].includes(ext)) return 'image'
  return null
}

/**
 * Label affiché pour un sous-bloc (UI strings).
 */
export function labelForKind(kind) {
  const labels = {
    transport: 'Transport',
    hebergement: 'Hébergement',
    repas: 'Repas',
  }
  return labels[kind] || kind
}

/**
 * Nom complet d'un membre (utilisé partout dans l'UI).
 *
 * IMPORTANT : projet_membres.prenom/nom sont des SURCHARGES, NULL par défaut
 * si la personne vient de l'annuaire (contact_id rempli). Le vrai nom est
 * alors sur membre.contact.prenom/nom. On fallback sur le contact comme dans
 * computeInitials et le reste du codebase équipe.
 */
export function membreFullName(membre) {
  if (!membre) return '—'
  const prenom = membre.prenom || membre.contact?.prenom || ''
  const nom = membre.nom || membre.contact?.nom || ''
  const full = `${prenom} ${nom}`.trim()
  return full || '—'
}
