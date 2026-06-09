// ════════════════════════════════════════════════════════════════════════════
// feedback.js — Helpers module Retours / Idées (FBK-1.2)
// ════════════════════════════════════════════════════════════════════════════
//
// Outil GLOBAL (non lié à un projet) pour signaler bugs et proposer
// améliorations sur DESK lui-même.
//
// Couvre les 3 tables BDD :
//   - feedback_tickets   (bugs et idées)
//   - feedback_attachments (screenshots / refs)
//   - feedback_comments  (discussion par ticket)
//
// Plus :
//   - Storage uploads (bucket 'feedback' PRIVÉ, signed URLs à la demande)
//   - Auto-capture contexte technique (URL, user-agent, viewport, build)
//   - Export ticket en markdown pour Claude (avec liens images)
//   - Realtime subscriptions
//
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// ─── Constants ──────────────────────────────────────────────────────────────

export const TICKET_TYPES = ['bug', 'idea']
export const TICKET_STATUSES = ['proposed', 'in_progress', 'done']
export const TICKET_PRIORITIES = ['urgent', 'normal', 'nice_to_have']

export const TYPE_LABELS = {
  bug: 'Bug',
  idea: 'Idée',
}
export const STATUS_LABELS = {
  proposed: 'Proposé',
  in_progress: 'En cours',
  done: 'Terminé',
}
export const PRIORITY_LABELS = {
  urgent: 'Urgent',
  normal: 'Normal',
  nice_to_have: 'Confort',
}

// Couleurs par statut pour les badges UI
export const STATUS_COLORS = {
  proposed: { bg: 'rgba(148,163,184,0.18)', fg: 'var(--txt-2)' },
  in_progress: { bg: 'rgba(59,130,246,0.18)', fg: 'var(--blue, #3B82F6)' },
  done: { bg: 'rgba(34,197,94,0.20)', fg: '#16A34A' },
}

// Couleurs par priorité
export const PRIORITY_COLORS = {
  urgent: { bg: 'rgba(239,68,68,0.18)', fg: '#EF4444' },
  normal: { bg: 'rgba(148,163,184,0.18)', fg: 'var(--txt-2)' },
  nice_to_have: { bg: 'rgba(168,85,247,0.18)', fg: '#A855F7' },
}

const STORAGE_BUCKET = 'feedback'
const SIGNED_URL_EXPIRE_SECONDS = 60 * 60 * 24 * 7 // 7 jours par défaut
const EXPORT_URL_EXPIRE_SECONDS = 60 * 60 * 24 * 30 // 30 jours pour l'export Claude

// ─── Tickets CRUD ──────────────────────────────────────────────────────────

/**
 * Liste les tickets visibles par l'utilisateur courant.
 * La RLS filtre automatiquement : user voit les siens, admin voit tout.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.status]
 * @param {string|null} [opts.type]
 * @param {string|null} [opts.search]  Recherche LIKE sur title + description
 * @param {boolean} [opts.includeDone=true] Si false, exclut les tickets terminés
 */
export async function listTickets(opts = {}) {
  let q = supabase
    .from('feedback_tickets')
    .select(`
      *,
      author:user_id (id, full_name, avatar_url, email),
      duplicate_source:duplicate_of (id, title, status)
    `)
    .order('created_at', { ascending: false })

  if (opts.status) q = q.eq('status', opts.status)
  if (opts.type) q = q.eq('type', opts.type)
  if (opts.includeDone === false) q = q.neq('status', 'done')
  if (opts.search?.trim()) {
    const s = opts.search.trim()
    q = q.or(`title.ilike.%${s}%,description.ilike.%${s}%`)
  }

  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Récupère un ticket par ID avec ses détails.
 */
export async function getTicket(id) {
  const { data, error } = await supabase
    .from('feedback_tickets')
    .select(`
      *,
      author:user_id (id, full_name, avatar_url, email),
      duplicate_source:duplicate_of (id, title, status)
    `)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

/**
 * Crée un nouveau ticket. Auto-capture le contexte technique côté front
 * (URL, user-agent, viewport, version build) si pas fourni.
 *
 * @param {object} fields
 * @returns {Promise<object>} Le ticket créé
 */
export async function createTicket(fields = {}) {
  if (!TICKET_TYPES.includes(fields.type)) {
    throw new Error(`type invalide : ${fields.type}`)
  }
  if (!fields.title?.trim()) throw new Error('titre requis')
  if (!fields.description?.trim()) throw new Error('description requise')

  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id
  if (!userId) throw new Error('non authentifié')

  // Auto-capture si pas fourni (côté navigateur uniquement)
  const context_metadata =
    fields.context_metadata || captureContextMetadata()

  const payload = {
    type: fields.type,
    user_id: userId,
    page: fields.page?.trim() || null,
    category: fields.category?.trim() || null,
    title: fields.title.trim(),
    description: fields.description.trim(),
    steps_to_reproduce: fields.steps_to_reproduce?.trim() || null,
    priority: fields.priority || 'normal',
    status: 'proposed',
    context_metadata,
  }

  const { data, error } = await supabase
    .from('feedback_tickets')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Patch partiel d'un ticket. Réservé à l'auteur (limité) ou aux admins
 * (qui peuvent changer le statut, marquer duplicate_of, etc.).
 */
export async function updateTicket(id, patch = {}) {
  const clean = {}
  for (const k of [
    'title',
    'description',
    'steps_to_reproduce',
    'page',
    'category',
    'priority',
    'status',
    'duplicate_of',
    'type',
  ]) {
    if (patch[k] !== undefined) clean[k] = patch[k]
  }
  if (Object.keys(clean).length === 0) return await getTicket(id)
  const { data, error } = await supabase
    .from('feedback_tickets')
    .update(clean)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime un ticket (admin uniquement via RLS). Cascade vers attachments
 * et comments. ⚠ Les fichiers Storage ne sont PAS auto-supprimés — il faut
 * appeler `removeAttachment` ou cleanup manuel si besoin.
 */
export async function deleteTicket(id) {
  const { error } = await supabase
    .from('feedback_tickets')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ─── Attachments ───────────────────────────────────────────────────────────

/**
 * Liste les attachments d'un ticket.
 */
export async function listAttachmentsForTicket(ticketId) {
  const { data, error } = await supabase
    .from('feedback_attachments')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Upload un fichier dans le bucket feedback + crée la row attachment.
 * Path : <ticket_id>/<timestamp>-<sanitized_name>
 *
 * @param {string} ticketId
 * @param {File|Blob} file
 * @returns {Promise<object>} L'attachment créé
 */
export async function uploadAttachment(ticketId, file) {
  if (!ticketId || !file) {
    throw new Error('ticketId et file requis')
  }
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id
  if (!userId) throw new Error('non authentifié')

  // Sanitize le nom de fichier : retire caractères spéciaux, garde l'ext
  const safeName = (file.name || `file-${Date.now()}`)
    .replace(/[^\w.-]/g, '_')
    .slice(0, 100)
  const filePath = `${ticketId}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    })
  if (upErr) throw upErr

  // Crée la row BDD
  const { data, error } = await supabase
    .from('feedback_attachments')
    .insert({
      ticket_id: ticketId,
      file_path: filePath,
      file_name: file.name || safeName,
      mime_type: file.type || null,
      size_bytes: file.size || null,
      uploaded_by: userId,
    })
    .select('*')
    .single()
  if (error) {
    // Best effort cleanup si la row a échoué
    await supabase.storage.from(STORAGE_BUCKET).remove([filePath]).catch(() => {})
    throw error
  }
  return data
}

/**
 * Supprime un attachment (row BDD + fichier Storage).
 */
export async function removeAttachment(attachmentId) {
  // 1. Récupère le file_path avant DELETE
  const { data: row } = await supabase
    .from('feedback_attachments')
    .select('file_path')
    .eq('id', attachmentId)
    .maybeSingle()
  const filePath = row?.file_path || null

  // 2. DELETE row BDD (la RLS protège)
  const { error } = await supabase
    .from('feedback_attachments')
    .delete()
    .eq('id', attachmentId)
  if (error) throw error

  // 3. Cleanup Storage (best effort)
  if (filePath) {
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath])
    } catch (e) {
      console.warn('[feedback] cleanup Storage KO', filePath, e)
    }
  }
}

/**
 * Génère une signed URL pour un attachment (visualisation/download).
 *
 * @param {string} filePath
 * @param {number} [expiresIn] Secondes (défaut 7 jours)
 * @returns {Promise<string>}
 */
export async function getSignedUrl(filePath, expiresIn = SIGNED_URL_EXPIRE_SECONDS) {
  if (!filePath) return ''
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(filePath, expiresIn)
  if (error) {
    console.warn('[feedback] signed URL KO', filePath, error)
    return ''
  }
  return data?.signedUrl || ''
}

// ─── Comments ──────────────────────────────────────────────────────────────

/**
 * Liste les commentaires d'un ticket avec auteur joint.
 */
export async function listCommentsForTicket(ticketId) {
  const { data, error } = await supabase
    .from('feedback_comments')
    .select(`
      *,
      author:user_id (id, full_name, avatar_url, email)
    `)
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Ajoute un commentaire au ticket.
 */
export async function addComment(ticketId, body) {
  const trimmed = (body || '').trim()
  if (!trimmed) throw new Error('Commentaire vide')
  if (trimmed.length > 2000) throw new Error('Max 2000 caractères')
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id
  if (!userId) throw new Error('non authentifié')
  const { data, error } = await supabase
    .from('feedback_comments')
    .insert({ ticket_id: ticketId, user_id: userId, body: trimmed })
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
    .from('feedback_comments')
    .update({ body: trimmed })
    .eq('id', commentId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function removeComment(commentId) {
  const { error } = await supabase
    .from('feedback_comments')
    .delete()
    .eq('id', commentId)
  if (error) throw error
}

// ─── Auto-capture contexte technique ───────────────────────────────────────

/**
 * Capture le contexte technique courant du navigateur. Appelé
 * automatiquement par createTicket si pas fourni.
 *
 * @returns {object} Metadata structurée
 */
export function captureContextMetadata() {
  if (typeof window === 'undefined') return {}
  try {
    return {
      url: window.location?.href || null,
      pathname: window.location?.pathname || null,
      user_agent: navigator?.userAgent || null,
      viewport_w: window.innerWidth || null,
      viewport_h: window.innerHeight || null,
      device_pixel_ratio: window.devicePixelRatio || 1,
      language: navigator?.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      // Build : si Vite expose VITE_APP_VERSION via .env, sinon null.
      // À configurer côté CI plus tard si on veut un vrai numéro de build.
      build:
        import.meta.env?.VITE_APP_VERSION ||
        import.meta.env?.VITE_BUILD_ID ||
        null,
      captured_at: new Date().toISOString(),
    }
  } catch (e) {
    console.warn('[feedback] captureContextMetadata KO', e)
    return {}
  }
}

// ─── Export Markdown pour Claude ───────────────────────────────────────────

/**
 * Génère un markdown complet du ticket prêt à coller dans Claude
 * (Claude.ai / Claude Code). Inclut titre + type + statut + priorité +
 * contexte technique + description + steps + screenshots (signed URLs
 * avec expiration 30j) + commentaires.
 *
 * Retourne une string markdown.
 *
 * @param {object} ticket  Le ticket (avec author éventuel)
 * @param {Array}  attachments  Les attachments (file_path)
 * @param {Array}  comments     Les commentaires (avec author éventuel)
 * @returns {Promise<string>}
 */
export async function exportTicketAsMarkdown(ticket, attachments = [], comments = []) {
  if (!ticket) return ''

  const lines = []
  const emoji = ticket.type === 'bug' ? '🐞' : '💡'
  const typeLabel = TYPE_LABELS[ticket.type] || ticket.type

  lines.push(`# ${emoji} ${typeLabel} : ${ticket.title}`)
  lines.push('')

  // ─── Contexte ─────────────────────────────────────────────────────────
  lines.push('## Contexte')
  lines.push('')
  if (ticket.author) {
    const name =
      ticket.author.full_name ||
      ticket.author.email?.split('@')[0] ||
      '—'
    lines.push(`- **Auteur** : ${name}`)
  }
  lines.push(
    `- **Statut** : ${STATUS_LABELS[ticket.status] || ticket.status}`,
  )
  lines.push(
    `- **Priorité** : ${PRIORITY_LABELS[ticket.priority] || ticket.priority}`,
  )
  if (ticket.page) lines.push(`- **Page concernée** : ${ticket.page}`)
  if (ticket.category) lines.push(`- **Catégorie** : ${ticket.category}`)
  if (ticket.created_at) {
    const date = new Date(ticket.created_at).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    lines.push(`- **Créé le** : ${date}`)
  }

  // Contexte technique auto-capturé
  const ctx = ticket.context_metadata || {}
  if (Object.keys(ctx).length > 0) {
    lines.push('')
    lines.push('### Contexte technique (auto-capturé)')
    lines.push('')
    if (ctx.url) lines.push(`- URL exacte : \`${ctx.url}\``)
    if (ctx.user_agent) lines.push(`- User-Agent : \`${ctx.user_agent}\``)
    if (ctx.viewport_w && ctx.viewport_h) {
      lines.push(
        `- Viewport : ${ctx.viewport_w}×${ctx.viewport_h} (DPR ${ctx.device_pixel_ratio || 1})`,
      )
    }
    if (ctx.language) lines.push(`- Langue : ${ctx.language}`)
    if (ctx.timezone) lines.push(`- Timezone : ${ctx.timezone}`)
    if (ctx.build) lines.push(`- Build : ${ctx.build}`)
  }
  lines.push('')

  // ─── Description ──────────────────────────────────────────────────────
  lines.push('## Description')
  lines.push('')
  lines.push(ticket.description || '_(vide)_')
  lines.push('')

  // ─── Steps to reproduce (bugs) ────────────────────────────────────────
  if (ticket.steps_to_reproduce?.trim()) {
    lines.push('## Étapes pour reproduire')
    lines.push('')
    lines.push(ticket.steps_to_reproduce)
    lines.push('')
  }

  // ─── Screenshots / refs (avec signed URLs longues) ────────────────────
  if (attachments.length > 0) {
    lines.push('## Pièces jointes')
    lines.push('')
    for (const att of attachments) {
      const url = await getSignedUrl(
        att.file_path,
        EXPORT_URL_EXPIRE_SECONDS,
      )
      const isImage = (att.mime_type || '').startsWith('image/')
      if (isImage && url) {
        lines.push(`![${att.file_name}](${url})`)
      } else if (url) {
        lines.push(`- [${att.file_name}](${url})`)
      } else {
        lines.push(`- ${att.file_name} (URL non disponible)`)
      }
    }
    lines.push('')
    lines.push(
      '_Note : ces liens expirent dans 30 jours. Sauvegarde les images localement si besoin._',
    )
    lines.push('')
  }

  // ─── Commentaires ─────────────────────────────────────────────────────
  if (comments.length > 0) {
    lines.push('## Commentaires')
    lines.push('')
    for (const c of comments) {
      const name =
        c.author?.full_name ||
        c.author?.email?.split('@')[0] ||
        '—'
      const date = c.created_at
        ? new Date(c.created_at).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })
        : ''
      lines.push(`**${name}** (${date}) :`)
      lines.push('')
      lines.push(c.body)
      lines.push('')
    }
  }

  // ─── Footer ───────────────────────────────────────────────────────────
  lines.push('---')
  lines.push(
    `_Exporté depuis DESK Captiv le ${new Date().toLocaleDateString('fr-FR')}_`,
  )
  return lines.join('\n')
}

/**
 * Copie le markdown du ticket dans le presse-papier. Renvoie true si OK.
 */
export async function copyTicketToClipboard(ticket, attachments, comments) {
  const md = await exportTicketAsMarkdown(ticket, attachments, comments)
  try {
    await navigator.clipboard.writeText(md)
    return true
  } catch (e) {
    console.warn('[feedback] clipboard write KO', e)
    return false
  }
}

// ─── Realtime ──────────────────────────────────────────────────────────────

/**
 * S'abonne aux changements globaux du module feedback. La RLS filtre
 * déjà les events au niveau row → le client ne reçoit que ce qu'il peut
 * voir.
 *
 * @param {object} callbacks
 * @returns {{ unsubscribe: () => void }}
 */
export function subscribeToFeedback(callbacks = {}) {
  const channel = supabase
    .channel(`feedback:global`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'feedback_tickets',
      },
      (payload) => callbacks.onTicketChange?.(payload),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'feedback_attachments',
      },
      (payload) => callbacks.onAttachmentChange?.(payload),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'feedback_comments',
      },
      (payload) => callbacks.onCommentChange?.(payload),
    )
    .subscribe()
  return {
    unsubscribe: () => supabase.removeChannel(channel),
  }
}

// ─── Helpers de présentation ───────────────────────────────────────────────

/**
 * Calcule le compteur "nouveaux tickets" pour l'admin (= tickets en
 * status 'proposed' créés dans les dernières 24h, ou simplement tous les
 * tickets non vus). En V1 simple : tous les tickets 'proposed'.
 */
export function countNewForAdmin(tickets) {
  return (tickets || []).filter((t) => t.status === 'proposed').length
}
