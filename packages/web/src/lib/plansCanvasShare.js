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

/** Token actif (non révoqué, non expiré) le plus récent du plan, sinon null. */
export async function getActiveShareToken(canvasId) {
  const { data, error } = await supabase
    .from('plans_canvas_share_tokens')
    .select('*')
    .eq('canvas_id', canvasId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const row = data?.[0]
  if (!row) return null
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null
  return row
}

export async function createShareToken({ canvasId, permissions = 'comment', expiresInDays = null, userId = null }) {
  const expires_at = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 3600 * 1000).toISOString()
    : null
  const { data, error } = await supabase
    .from('plans_canvas_share_tokens')
    .insert({ canvas_id: canvasId, permissions, expires_at, created_by: userId })
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
  'id, parent_id, anchor_x, anchor_y, body, author_type, author_user_id, author_client_name, resolved, created_at, author:profiles(full_name)'

export async function listComments(canvasId) {
  const { data, error } = await supabase
    .from('plans_canvas_comments')
    .select(COMMENT_FIELDS)
    .eq('canvas_id', canvasId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Réponse desk à un thread (les nouveaux ancrages client passent par la page publique). */
export async function replyToComment({ canvasId, parentId, body, userId }) {
  const { data, error } = await supabase
    .from('plans_canvas_comments')
    .insert({
      canvas_id: canvasId,
      parent_id: parentId,
      body: body.trim(),
      author_type: 'user',
      author_user_id: userId,
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
