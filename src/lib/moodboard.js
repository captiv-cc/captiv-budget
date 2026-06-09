// ════════════════════════════════════════════════════════════════════════════
// moodboard.js — Helpers module Moodboard (MOD-1.3)
// ════════════════════════════════════════════════════════════════════════════
//
// Couvre les 4 tables BDD du module Moodboard :
//   - projet_moodboard_sections   (sections nommées)
//   - projet_moodboard_cards      (cartes link/image/video/note)
//   - projet_moodboard_comments   (fil de discussion par carte)
//   - projet_moodboard_reactions  (emoji 👍 ❤️ 🔥 ⚡)
//
// Plus :
//   - Storage uploads (bucket 'moodboard', path <project_id>/<card_id>.<ext>)
//   - Edge Function og-fetch (résolution metadata URL)
//   - Helpers paste-anywhere (extraction URLs depuis du texte)
//   - Realtime subscriptions (4 tables)
//
// API publique :
//
//   Constants :
//     - REACTIONS, REACTION_EMOJI, REACTION_LABELS
//     - CARD_TYPES
//
//   Sections :
//     - listSections(projectId)
//     - createSection(projectId, fields)
//     - updateSection(id, patch)
//     - deleteSection(id)
//     - ensureDefaultSection(projectId)
//
//   Cards :
//     - listCardsForSection(sectionId)
//     - listCardsForProject(projectId)
//     - createCard(sectionId, fields, options)
//     - updateCard(id, patch)
//     - deleteCard(id, opts)         // opts.removeFile = true cleanup Storage
//     - calcSortOrderBetween(b, a)   // fractional ordering
//
//   Comments :
//     - listCommentsForCard(cardId)
//     - listAllComments(projectId)
//     - addComment(cardId, body)
//     - updateComment(id, body)
//     - removeComment(id)
//
//   Reactions :
//     - listReactionsForCard(cardId)
//     - listAllReactions(projectId)
//     - toggleReaction(cardId, emoji)
//     - aggregateReactions(rows, currentUserId)
//
//   Storage :
//     - uploadCardFile(projectId, cardId, file)
//     - removeCardFile(filePath)
//     - getPublicUrl(filePath)
//
//   og-fetch :
//     - fetchUrlMetadata(url)
//     - refreshLinkCard(card)        // rafraîchit oembed_html + image_url
//
//   Paste-anywhere :
//     - extractUrlsFromText(text)
//     - isLikelyUrl(s)
//
//   Realtime :
//     - subscribeToProject(projectId, callbacks)
//
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// ─── Constants ──────────────────────────────────────────────────────────────

export const CARD_TYPES = ['link', 'image', 'video', 'note']

// 4 emojis fixes en V1. Si on en rajoute il faudra ALSO patcher le CHECK
// constraint en BDD.
export const REACTIONS = ['thumbs_up', 'heart', 'fire', 'zap']

export const REACTION_EMOJI = {
  thumbs_up: '👍',
  heart: '❤️',
  fire: '🔥',
  zap: '⚡',
}

export const REACTION_LABELS = {
  thumbs_up: 'J’aime',
  heart: 'Coup de cœur',
  fire: 'Banger',
  zap: 'Inspirant',
}

const STORAGE_BUCKET = 'moodboard'

// ─── Sections ──────────────────────────────────────────────────────────────

/**
 * Liste les sections d'un projet, triées par sort_order ASC.
 * @param {string} projectId
 */
export async function listSections(projectId) {
  const { data, error } = await supabase
    .from('projet_moodboard_sections')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Crée une section. Le sort_order par défaut = (max actuel + 1000).
 * @param {string} projectId
 * @param {object} fields { nom, color?, sort_order? }
 */
export async function createSection(projectId, fields = {}) {
  if (!fields?.nom?.trim()) throw new Error('nom requis')
  let sortOrder = fields.sort_order
  if (sortOrder == null) {
    // Cherche le max courant pour append en fin
    const { data: maxRow } = await supabase
      .from('projet_moodboard_sections')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    sortOrder = (maxRow?.sort_order ?? 0) + 1000
  }
  const { data, error } = await supabase
    .from('projet_moodboard_sections')
    .insert({
      project_id: projectId,
      nom: fields.nom.trim(),
      color: fields.color || null,
      sort_order: sortOrder,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Patch partiel d'une section. Champs permis : nom, color, sort_order.
 */
export async function updateSection(id, patch = {}) {
  const clean = {}
  if (patch.nom !== undefined) clean.nom = patch.nom.trim()
  if (patch.color !== undefined) clean.color = patch.color || null
  if (patch.sort_order !== undefined) clean.sort_order = patch.sort_order
  const { data, error } = await supabase
    .from('projet_moodboard_sections')
    .update(clean)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime une section (cascade sur ses cartes via FK ON DELETE CASCADE).
 * ⚠ Les fichiers Storage des cartes ne sont PAS supprimés automatiquement —
 * c'est au caller de les cleanup s'il veut (ou laisser le bucket pour
 * archive). À utiliser avec discernement.
 */
export async function deleteSection(id) {
  const { error } = await supabase
    .from('projet_moodboard_sections')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/**
 * Garantit qu'au moins une section "Vrac" existe pour le projet. À appeler
 * au mount de la page Moodboard quand on découvre une liste vide.
 */
export async function ensureDefaultSection(projectId) {
  const sections = await listSections(projectId)
  if (sections.length > 0) return sections
  const first = await createSection(projectId, { nom: 'Vrac', sort_order: 0 })
  return [first]
}

// ─── Cards ─────────────────────────────────────────────────────────────────

/**
 * Liste les cartes d'une section, triées par sort_order ASC.
 */
export async function listCardsForSection(sectionId) {
  const { data, error } = await supabase
    .from('projet_moodboard_cards')
    .select(`
      *,
      creator:created_by (id, full_name, avatar_url, email)
    `)
    .eq('section_id', sectionId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Liste TOUTES les cartes d'un projet (via JOIN section → project).
 * Utilisé pour calculer les comptes globaux et pour le rendu global du
 * Moodboard quand on charge la page (1 fetch plutôt que N).
 */
export async function listCardsForProject(projectId) {
  const { data, error } = await supabase
    .from('projet_moodboard_cards')
    .select(`
      *,
      creator:created_by (id, full_name, avatar_url, email),
      section:section_id!inner (id, project_id)
    `)
    .eq('section.project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Crée une carte dans une section. Calcule le sort_order par défaut en
 * append (max courant + 1000).
 *
 * @param {string} sectionId
 * @param {object} fields {
 *   type:      'link'|'image'|'video'|'note',
 *   url?:      string,                  // pour type='link'
 *   title?:    string,
 *   description?: string,
 *   image_url?: string,                 // OG image / vignette / Storage URL
 *   oembed_html?: string,               // providers connus uniquement
 *   provider?: string,
 *   file_path?: string,                 // pour type='image'/'video'
 *   content_json?: object,              // pour type='note' (Tiptap)
 *   sort_order?: number,
 * }
 */
export async function createCard(sectionId, fields = {}) {
  if (!CARD_TYPES.includes(fields.type)) {
    throw new Error(`type invalide : ${fields.type}`)
  }
  // Validation cohérence type/champs (BDD CHECK le revalide mais on échoue
  // plus tôt côté JS)
  if (fields.type === 'link' && !fields.url) {
    throw new Error('type=link requiert url')
  }
  if (
    (fields.type === 'image' || fields.type === 'video') &&
    !fields.file_path
  ) {
    throw new Error(`type=${fields.type} requiert file_path`)
  }
  if (fields.type === 'note' && fields.content_json == null) {
    throw new Error('type=note requiert content_json')
  }

  let sortOrder = fields.sort_order
  if (sortOrder == null) {
    const { data: maxRow } = await supabase
      .from('projet_moodboard_cards')
      .select('sort_order')
      .eq('section_id', sectionId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    sortOrder = (maxRow?.sort_order ?? 0) + 1000
  }

  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id || null

  const { data, error } = await supabase
    .from('projet_moodboard_cards')
    .insert({
      section_id: sectionId,
      type: fields.type,
      url: fields.url || null,
      title: fields.title || null,
      description: fields.description || null,
      image_url: fields.image_url || null,
      oembed_html: fields.oembed_html || null,
      provider: fields.provider || null,
      file_path: fields.file_path || null,
      content_json: fields.content_json || null,
      sort_order: sortOrder,
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Patch partiel d'une carte. Champs permis : title, description, image_url,
 * oembed_html, content_json, url, section_id, sort_order.
 * (Pas de changement de type — supprimer + recréer si besoin.)
 */
export async function updateCard(id, patch = {}) {
  const clean = {}
  for (const k of [
    'title',
    'description',
    'image_url',
    'oembed_html',
    'content_json',
    'url',
    'section_id',
    'sort_order',
  ]) {
    if (patch[k] !== undefined) clean[k] = patch[k]
  }
  if (Object.keys(clean).length === 0) {
    // No-op : on retourne la row courante
    const { data } = await supabase
      .from('projet_moodboard_cards')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    return data
  }
  const { data, error } = await supabase
    .from('projet_moodboard_cards')
    .update(clean)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime une carte. Si opts.removeFile et que la carte est image/video,
 * on cleanup le fichier Storage (best effort, ignore les erreurs).
 */
export async function deleteCard(id, opts = {}) {
  // On récupère d'abord le file_path pour cleanup avant le DELETE BDD
  let filePath = null
  if (opts.removeFile) {
    const { data } = await supabase
      .from('projet_moodboard_cards')
      .select('file_path')
      .eq('id', id)
      .maybeSingle()
    filePath = data?.file_path || null
  }
  const { error } = await supabase
    .from('projet_moodboard_cards')
    .delete()
    .eq('id', id)
  if (error) throw error
  if (filePath) {
    // Best effort, ignore erreur (la row BDD est déjà partie)
    try {
      await removeCardFile(filePath)
    } catch (e) {
      console.warn('[moodboard] cleanup Storage KO', filePath, e)
    }
  }
}

/**
 * Calcule un sort_order pour insérer entre deux voisins.
 * Cf. la même logique que dans lib/musiques.js.
 */
export function calcSortOrderBetween(beforeOrder, afterOrder) {
  const b =
    typeof beforeOrder === 'number' && !Number.isNaN(beforeOrder)
      ? beforeOrder
      : null
  const a =
    typeof afterOrder === 'number' && !Number.isNaN(afterOrder) ? afterOrder : null
  if (b == null && a == null) return 0
  if (b == null) return a - 1
  if (a == null) return b + 1
  return (b + a) / 2
}

// ─── Comments ──────────────────────────────────────────────────────────────

/**
 * Liste les commentaires d'une carte (DESC = plus récents en premier).
 * Inclut les infos auteur (jointure profiles).
 */
export async function listCommentsForCard(cardId) {
  const { data, error } = await supabase
    .from('projet_moodboard_comments')
    .select(`
      *,
      author:user_id (id, full_name, avatar_url, email)
    `)
    .eq('card_id', cardId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Liste TOUS les commentaires d'un projet via 2 JOIN. Utile pour les
 * compteurs agrégés "N commentaires" affichés sur les cartes en vue liste.
 */
export async function listAllComments(projectId) {
  const { data, error } = await supabase
    .from('projet_moodboard_comments')
    .select(`
      id, card_id, user_id, body, created_at,
      card:card_id!inner (
        id,
        section:section_id!inner (project_id)
      )
    `)
    .eq('card.section.project_id', projectId)
  if (error) throw error
  return data || []
}

/**
 * Ajoute un commentaire. user_id auto-rempli par RLS via auth.uid().
 */
export async function addComment(cardId, body) {
  const trimmed = (body || '').trim()
  if (!trimmed) throw new Error('Commentaire vide')
  if (trimmed.length > 2000) throw new Error('Max 2000 caractères')
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id
  if (!userId) throw new Error('non authentifié')
  const { data, error } = await supabase
    .from('projet_moodboard_comments')
    .insert({ card_id: cardId, user_id: userId, body: trimmed })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateComment(commentId, body) {
  const trimmed = (body || '').trim()
  if (!trimmed) throw new Error('Commentaire vide')
  if (trimmed.length > 2000) throw new Error('Max 2000 caractères')
  const { data, error } = await supabase
    .from('projet_moodboard_comments')
    .update({ body: trimmed })
    .eq('id', commentId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function removeComment(commentId) {
  const { error } = await supabase
    .from('projet_moodboard_comments')
    .delete()
    .eq('id', commentId)
  if (error) throw error
}

// ─── Reactions ─────────────────────────────────────────────────────────────

/**
 * Liste les réactions d'une carte (toutes users).
 */
export async function listReactionsForCard(cardId) {
  const { data, error } = await supabase
    .from('projet_moodboard_reactions')
    .select('*')
    .eq('card_id', cardId)
  if (error) throw error
  return data || []
}

/**
 * Liste TOUTES les réactions d'un projet pour l'agrégation par carte.
 */
export async function listAllReactions(projectId) {
  const { data, error } = await supabase
    .from('projet_moodboard_reactions')
    .select(`
      id, card_id, user_id, emoji,
      card:card_id!inner (
        id,
        section:section_id!inner (project_id)
      )
    `)
    .eq('card.section.project_id', projectId)
  if (error) throw error
  return data || []
}

/**
 * Toggle une réaction emoji pour l'utilisateur courant sur une carte.
 * Si la réaction existe déjà → DELETE. Sinon → INSERT.
 *
 * @returns {Promise<{ action: 'added'|'removed' }>}
 */
export async function toggleReaction(cardId, emoji) {
  if (!REACTIONS.includes(emoji)) {
    throw new Error(`emoji invalide : ${emoji}`)
  }
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id
  if (!userId) throw new Error('non authentifié')

  // Cherche l'existence
  const { data: existing } = await supabase
    .from('projet_moodboard_reactions')
    .select('id')
    .eq('card_id', cardId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('projet_moodboard_reactions')
      .delete()
      .eq('id', existing.id)
    if (error) throw error
    return { action: 'removed' }
  }
  const { error } = await supabase
    .from('projet_moodboard_reactions')
    .insert({ card_id: cardId, user_id: userId, emoji })
  if (error) throw error
  return { action: 'added' }
}

/**
 * Agrège les réactions par carte. Renvoie une Map<cardId, { counts, mine }>
 * où counts est { thumbs_up: N, heart: N, ... } et mine est un Set des
 * emojis posés par l'utilisateur courant.
 *
 * @param {Array} rows Toutes les rows de projet_moodboard_reactions du projet
 * @param {string|null} currentUserId
 * @returns {Map<string, { counts: object, mine: Set<string> }>}
 */
export function aggregateReactions(rows, currentUserId) {
  const out = new Map()
  function ensure(cardId) {
    if (!out.has(cardId)) {
      out.set(cardId, {
        counts: { thumbs_up: 0, heart: 0, fire: 0, zap: 0 },
        mine: new Set(),
      })
    }
    return out.get(cardId)
  }
  for (const r of rows || []) {
    const agg = ensure(r.card_id)
    if (agg.counts[r.emoji] === undefined) {
      agg.counts[r.emoji] = 0
    }
    agg.counts[r.emoji] += 1
    if (currentUserId && r.user_id === currentUserId) {
      agg.mine.add(r.emoji)
    }
  }
  return out
}

// ─── Storage upload ────────────────────────────────────────────────────────

/**
 * Upload un fichier dans le bucket moodboard.
 * Path = <project_id>/<card_id>.<ext>
 *
 * Important : la carte BDD doit être créée AVANT (pour avoir un cardId).
 * Pattern recommandé : créer la card avec file_path déterminé, upload après,
 * et patcher l'URL si besoin (notre pattern image_url = getPublicUrl(path)).
 *
 * @param {string} projectId
 * @param {string} cardId
 * @param {File|Blob} file
 * @returns {Promise<{ file_path: string, public_url: string }>}
 */
export async function uploadCardFile(projectId, cardId, file) {
  if (!projectId || !cardId || !file) {
    throw new Error('projectId, cardId, file requis')
  }
  // Extension détectée depuis le name ou le type MIME
  const ext = guessExtension(file)
  const filePath = `${projectId}/${cardId}${ext ? `.${ext}` : ''}`

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || undefined,
    })
  if (error) throw error

  const { data: pubData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath)
  return { file_path: filePath, public_url: pubData?.publicUrl || '' }
}

export async function removeCardFile(filePath) {
  if (!filePath) return
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([filePath])
  if (error) throw error
}

export function getPublicUrl(filePath) {
  if (!filePath) return ''
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)
  return data?.publicUrl || ''
}

function guessExtension(file) {
  // 1. Depuis le name si présent
  if (file?.name) {
    const m = file.name.match(/\.([a-z0-9]{1,5})$/i)
    if (m) return m[1].toLowerCase()
  }
  // 2. Depuis le MIME
  const mime = (file?.type || '').toLowerCase()
  const mapMime = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  }
  return mapMime[mime] || ''
}

// ─── og-fetch wrapper ──────────────────────────────────────────────────────

/**
 * Appelle l'Edge Function og-fetch pour résoudre les metadata d'une URL.
 * Best-effort : renvoie toujours un objet (avec fields null si rien trouvé)
 * sauf erreur réseau/serveur.
 *
 * @param {string} url
 * @returns {Promise<{
 *   url: string,
 *   title: string,
 *   description: string|null,
 *   image_url: string|null,
 *   provider: 'youtube'|'tiktok'|'vimeo'|'twitter'|'instagram'|null,
 *   oembed_html: string|null,
 *   source: 'oembed'|'og'|'fallback'
 * }>}
 */
export async function fetchUrlMetadata(url) {
  if (!url) throw new Error('url requise')
  const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || ''
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL manquant — config front incomplète')
  }
  const { data: sessionResult } = await supabase.auth.getSession()
  const accessToken = sessionResult?.session?.access_token
  if (!accessToken) throw new Error('non authentifié')

  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/og-fetch`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`og-fetch HTTP ${res.status}: ${text}`)
  }
  return await res.json()
}

/**
 * Rafraîchit le preview d'une carte type 'link' : ré-appelle og-fetch sur
 * son URL et patch image_url + oembed_html + provider + title si vide.
 *
 * Utile après un changement côté Edge Function (nouveau provider supporté)
 * pour mettre à jour les cartes existantes sans les supprimer/recréer.
 *
 * @param {object} card  La carte (au minimum { id, url, type, title })
 * @returns {Promise<object>} La carte mise à jour
 */
export async function refreshLinkCard(card) {
  if (!card?.url) throw new Error('Pas d\'URL à rafraîchir')
  if (card.type !== 'link') throw new Error('Seules les cartes link sont rafraîchissables')
  const meta = await fetchUrlMetadata(card.url)
  const patch = {
    image_url: meta?.image_url || null,
    oembed_html: meta?.oembed_html || null,
    provider: meta?.provider || null,
  }
  // On ne overwrite le title que s'il était identique à l'URL (= jamais
  // édité par l'utilisateur). Sinon on garde son édition manuelle.
  if (meta?.title && (!card.title || card.title === card.url)) {
    patch.title = meta.title
  }
  if (meta?.description && !card.description) {
    patch.description = meta.description
  }
  return await updateCard(card.id, patch)
}

// ─── Paste-anywhere helpers ───────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi

/**
 * Extrait toutes les URLs d'un texte (paste multi-URL). Retourne un Array
 * dédoublé en préservant l'ordre.
 */
export function extractUrlsFromText(text) {
  if (typeof text !== 'string') return []
  const matches = text.match(URL_REGEX) || []
  const seen = new Set()
  const out = []
  for (const raw of matches) {
    // Trim trailing punctuation typique copy/paste (",", ".", ")")
    const cleaned = raw.replace(/[),.;:!?]+$/, '')
    if (!seen.has(cleaned)) {
      seen.add(cleaned)
      out.push(cleaned)
    }
  }
  return out
}

/**
 * Heuristique rapide : est-ce que la string ressemble à une URL ?
 * Utilisé pour détecter au paste si on doit appeler og-fetch.
 */
export function isLikelyUrl(s) {
  if (typeof s !== 'string') return false
  const trimmed = s.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    new URL(trimmed)
    return true
  } catch {
    return false
  }
}

// ─── Realtime subscriptions ────────────────────────────────────────────────

/**
 * S'abonne aux changements des 4 tables du module pour un projet.
 * Note : sections est filtré par project_id (colonne directe). Les 3 autres
 * tables (cards/comments/reactions) ne sont PAS filtrées côté Realtime
 * (postgres_changes ne supporte pas le filtre via JOIN). La RLS filtre déjà
 * les events au niveau row → le client recevra uniquement les events visibles.
 * Le caller peut faire un re-check sur project_id si besoin (en pratique
 * pas nécessaire car la page Moodboard est scopée sur 1 projet).
 *
 * Renvoie un objet avec une méthode .unsubscribe() pour le cleanup.
 *
 * @param {string} projectId
 * @param {object} callbacks
 * @param {(payload) => void} [callbacks.onSectionChange]
 * @param {(payload) => void} [callbacks.onCardChange]
 * @param {(payload) => void} [callbacks.onCommentChange]
 * @param {(payload) => void} [callbacks.onReactionChange]
 * @returns {{ unsubscribe: () => void }}
 */
export function subscribeToProject(projectId, callbacks = {}) {
  const channel = supabase
    .channel(`moodboard:${projectId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_moodboard_sections',
        filter: `project_id=eq.${projectId}`,
      },
      (payload) => callbacks.onSectionChange?.(payload),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_moodboard_cards',
      },
      (payload) => callbacks.onCardChange?.(payload),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_moodboard_comments',
      },
      (payload) => callbacks.onCommentChange?.(payload),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_moodboard_reactions',
      },
      (payload) => callbacks.onReactionChange?.(payload),
    )
    .subscribe()
  return {
    unsubscribe: () => supabase.removeChannel(channel),
  }
}
