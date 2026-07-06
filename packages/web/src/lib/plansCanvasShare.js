// ════════════════════════════════════════════════════════════════════════════
// plansCanvasShare — partage client + commentaires des plans ÉDITABLES (desk)
// ════════════════════════════════════════════════════════════════════════════
//
// Distinct de plansShare.js (partage des FICHIERS plans, système v1). Le lien
// public /plans/share/<token> est servi par l'edge function plans-public
// (service role). Ici : gestion des tokens et des commentaires depuis le
// desk (RLS can_edit_outil / can_read_outil).
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

/* ─── Tokens ────────────────────────────────────────────────────────────── */

/** Liens actifs (non révoqués, non expirés) du plan, du plus récent au plus ancien. */
export async function listActiveShareTokens(canvasId) {
  const { data, error } = await supabase
    .from('plans_canvas_share_tokens')
    .select('*')
    .eq('canvas_id', canvasId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  const now = new Date()
  return (data ?? []).filter((row) => !row.expires_at || new Date(row.expires_at) > now)
}

export async function createShareToken({
  canvasId,
  label = null,
  permissions = 'comment',
  mode = 'live',
  expiresAt = null,
  userId = null,
}) {
  const { data, error } = await supabase
    .from('plans_canvas_share_tokens')
    .insert({
      canvas_id: canvasId,
      label: label?.trim() || null,
      permissions,
      mode,
      expires_at: expiresAt,
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function revokeShareToken(tokenId) {
  const { error } = await supabase
    .from('plans_canvas_share_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
  if (error) throw error
}

export function publicPlanUrl(token) {
  return `${window.location.origin}/plans/share/${token}`
}

/* ─── Commentaires ──────────────────────────────────────────────────────── */

const COMMENT_FIELDS =
  'id, parent_id, anchor_x, anchor_y, body, author_type, author_user_id, author_client_name, resolved, internal, created_at, author:profiles(full_name)'

export async function listComments(canvasId) {
  const { data, error } = await supabase
    .from('plans_canvas_comments')
    .select(COMMENT_FIELDS)
    .eq('canvas_id', canvasId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Nouveau commentaire équipe ancré sur le canvas (coordonnées PAGE tldraw).
 * `internal: true` (défaut) = discussion interne, invisible des liens de
 * partage (filtré par l'edge function plans-public).
 */
export async function createAnchoredComment({
  canvasId,
  anchorX,
  anchorY,
  body,
  userId,
  internal = true,
}) {
  const { data, error } = await supabase
    .from('plans_canvas_comments')
    .insert({
      canvas_id: canvasId,
      anchor_x: anchorX,
      anchor_y: anchorY,
      body: body.trim(),
      author_type: 'user',
      author_user_id: userId,
      internal,
    })
    .select(COMMENT_FIELDS)
    .single()
  if (error) throw error
  return data
}

/**
 * Réponse desk à un thread (les nouveaux ancrages client passent par la page
 * publique). La réponse hérite de la visibilité du thread : répondre dans un
 * thread interne reste interne.
 */
export async function replyToComment({ canvasId, parentId, body, userId, internal = false }) {
  const { data, error } = await supabase
    .from('plans_canvas_comments')
    .insert({
      canvas_id: canvasId,
      parent_id: parentId,
      body: body.trim(),
      author_type: 'user',
      author_user_id: userId,
      internal,
    })
    .select(COMMENT_FIELDS)
    .single()
  if (error) throw error
  return data
}

export async function setCommentResolved(commentId, resolved) {
  const { error } = await supabase
    .from('plans_canvas_comments')
    .update({ resolved })
    .eq('id', commentId)
  if (error) throw error
}

/** Realtime : INSERT/UPDATE sur les commentaires du plan → cb(). */
export function subscribeToComments(canvasId, cb) {
  const channel = supabase
    .channel(`plan-comments:${canvasId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'plans_canvas_comments', filter: `canvas_id=eq.${canvasId}` },
      () => cb(),
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
