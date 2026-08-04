/**
 * musiqueAutorShare.js — Portail RP des autorisations musiques (MUS-7 A3).
 *
 * Les chargés de comm / RP du festival opèrent le suivi SANS compte via un
 * lien token : lecture complète + écriture whitelistée (statut, durée,
 * contact, doc signé, master, utilisé) + commentaires, signés par le prénom
 * saisi sur le portail.
 *
 * Côté admin (auth) : CRUD des tokens via supabase client (RLS org).
 * Côté public (anon) : RPCs SECURITY DEFINER — le token fait office d'auth.
 *
 * Pattern aligné sur logistiqueShare.js.
 * Voir supabase/migrations/20260804b_musique_autor_share.sql.
 */

import { supabase } from './supabase'
import { generateShareToken } from './projectShare'

/* ─── URL ───────────────────────────────────────────────────────────────── */

export function buildShareUrl(token) {
  const path = `/share/musiques-autor/${encodeURIComponent(token)}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return path
}

/* ─── CRUD admin ────────────────────────────────────────────────────────── */

const TOKEN_COLS =
  'id, project_id, token, label, created_by, created_at, revoked_at, expires_at, last_accessed_at, view_count'

export async function listShareTokens({ projectId, includeRevoked = true } = {}) {
  if (!projectId) throw new Error('listShareTokens : projectId requis')
  let query = supabase
    .from('musique_autor_share_tokens')
    .select(TOKEN_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (!includeRevoked) query = query.is('revoked_at', null)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function createShareToken({ projectId, label = null, expiresAt = null } = {}) {
  if (!projectId) throw new Error('createShareToken : projectId requis')
  const token = generateShareToken()
  const { data, error } = await supabase
    .from('musique_autor_share_tokens')
    .insert([
      {
        project_id: projectId,
        token,
        label: label?.trim() || null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      },
    ])
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

export async function updateShareToken(tokenId, { label, expiresAt } = {}) {
  if (!tokenId) throw new Error('updateShareToken : tokenId requis')
  const patch = {}
  if (label !== undefined) patch.label = label?.trim() || null
  if (expiresAt !== undefined) {
    patch.expires_at = expiresAt ? new Date(expiresAt).toISOString() : null
  }
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('musique_autor_share_tokens')
    .update(patch)
    .eq('id', tokenId)
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

export async function revokeShareToken(tokenId) {
  if (!tokenId) throw new Error('revokeShareToken : tokenId requis')
  const { error } = await supabase
    .from('musique_autor_share_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .is('revoked_at', null)
  if (error) throw error
}

export async function restoreShareToken(tokenId) {
  if (!tokenId) throw new Error('restoreShareToken : tokenId requis')
  const { error } = await supabase
    .from('musique_autor_share_tokens')
    .update({ revoked_at: null })
    .eq('id', tokenId)
  if (error) throw error
}

export async function deleteShareToken(tokenId) {
  if (!tokenId) throw new Error('deleteShareToken : tokenId requis')
  const { error } = await supabase
    .from('musique_autor_share_tokens')
    .delete()
    .eq('id', tokenId)
  if (error) throw error
}

/* ─── Public (anon) ─────────────────────────────────────────────────────── */

/**
 * Payload complet : share/project/org + links (même shape que
 * listAutorisationRows — le tableau est partagé) + events du projet.
 */
export async function fetchSharePayload(token) {
  if (!token) throw new Error('fetchSharePayload : token requis')
  const { data, error } = await supabase.rpc('share_musique_autor_fetch', { p_token: token })
  if (error) {
    console.error('[musiqueAutorShare] fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou expiré')
  return data
}

/**
 * Patch whitelisté d'une autorisation (row créée côté serveur si besoin).
 * authorName = prénom saisi par le RP, journalisé sur les statuts.
 */
export async function shareUpdateAutorisation(token, linkId, patch, authorName) {
  const { data, error } = await supabase.rpc('share_musique_autor_update', {
    p_token: token,
    p_link_id: linkId,
    p_patch: patch,
    p_author_name: authorName || null,
  })
  if (error) {
    console.error('[musiqueAutorShare] update error', error)
    throw error
  }
  return data
}

export async function shareAddComment(token, linkId, body, authorName) {
  const { data, error } = await supabase.rpc('share_musique_autor_comment', {
    p_token: token,
    p_link_id: linkId,
    p_body: body,
    p_author_name: authorName || null,
  })
  if (error) {
    console.error('[musiqueAutorShare] comment error', error)
    throw error
  }
  return data
}

/* ─── Présentation ──────────────────────────────────────────────────────── */

export function getShareTokenState(token) {
  if (!token) return 'active'
  if (token.revoked_at) return 'revoked'
  if (token.expires_at && new Date(token.expires_at) <= new Date()) return 'expired'
  return 'active'
}
