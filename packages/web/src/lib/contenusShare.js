/**
 * contenusShare.js — liens publics du module Contenus.
 *
 * Deux liens par projet, distingués par `can_edit` :
 *   - suivi photographes : lecture seule, sans mot de passe ;
 *   - équipe festival : écriture complète derrière un mot de passe partagé.
 *
 * Côté admin (auth) : CRUD des tokens via le client Supabase (RLS org), le
 * mot de passe passant par une RPC dédiée pour ne jamais transiter en clair
 * dans une colonne éditable.
 *
 * Côté public (anon) : tout passe par des RPC SECURITY DEFINER — le token et
 * le mot de passe font l'authentification, et le serveur refuse toute
 * écriture depuis un lien de lecture.
 *
 * Voir supabase/migrations/20260821c_contenus_share.sql.
 */

import { supabase } from './supabase'
import { generateShareToken } from './projectShare'

/* ─── URL ───────────────────────────────────────────────────────────────── */

export function buildContenusShareUrl(token) {
  const path = `/share/contenus/${encodeURIComponent(token)}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return path
}

/* ─── CRUD admin ────────────────────────────────────────────────────────── */

const TOKEN_COLS =
  'id, project_id, token, label, can_edit, password_hint, created_at, ' +
  'revoked_at, expires_at, last_accessed_at, view_count'

/** Le hash n'est jamais exposé : on ne renvoie qu'un booléen. */
export async function listContenusShareTokens(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('contenus_share_tokens')
    .select(`${TOKEN_COLS}, password_hash`)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(({ password_hash, ...t }) => ({
    ...t,
    has_password: Boolean(password_hash),
  }))
}

export async function createContenusShareToken({
  projectId,
  label = null,
  canEdit = false,
  password = null,
  passwordHint = null,
  expiresAt = null,
}) {
  if (!projectId) throw new Error('createContenusShareToken : projectId requis')
  const token = generateShareToken()
  const { data, error } = await supabase
    .from('contenus_share_tokens')
    .insert({
      project_id: projectId,
      token,
      label: label?.trim() || null,
      can_edit: canEdit,
      password_hint: passwordHint?.trim() || null,
      expires_at: expiresAt || null,
    })
    .select(TOKEN_COLS)
    .single()
  if (error) throw error

  if (password) {
    await setContenusSharePassword(data.id, password)
  }
  return { ...data, has_password: Boolean(password) }
}

export async function setContenusSharePassword(tokenId, password) {
  const { error } = await supabase.rpc('set_contenus_share_password', {
    p_token_id: tokenId,
    p_password: password || null,
  })
  if (error) throw error
}

export async function revokeContenusShareToken(tokenId) {
  const { error } = await supabase
    .from('contenus_share_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
  if (error) throw error
}

export async function deleteContenusShareToken(tokenId) {
  const { error } = await supabase.from('contenus_share_tokens').delete().eq('id', tokenId)
  if (error) throw error
}

/* ─── Portail public ────────────────────────────────────────────────────── */

/**
 * Charge le payload. Lève une erreur portant le code PostgreSQL :
 *   28000 = lien invalide ou expiré, 28P01 = mot de passe requis / erroné.
 */
export async function fetchContenusShare(token, password = null) {
  const { data, error } = await supabase.rpc('share_contenus_fetch', {
    p_token: token,
    p_password: password,
  })
  if (error) {
    console.error('[contenusShare] fetch', error)
    throw error
  }
  return data
}

export async function shareCreateContenu({ token, password, payload, authorName }) {
  const { data, error } = await supabase.rpc('share_contenus_create', {
    p_token: token,
    p_password: password,
    p_payload: payload,
    p_author_name: authorName || null,
  })
  if (error) throw error
  return data
}

export async function shareUpdateContenu({ token, password, contenuId, patch, authorName }) {
  const { error } = await supabase.rpc('share_contenus_update', {
    p_token: token,
    p_password: password,
    p_contenu_id: contenuId,
    p_patch: patch,
    p_author_name: authorName || null,
  })
  if (error) throw error
}

export async function shareDeleteContenu({ token, password, contenuId }) {
  const { error } = await supabase.rpc('share_contenus_delete', {
    p_token: token,
    p_password: password,
    p_contenu_id: contenuId,
  })
  if (error) throw error
}

export async function shareCommentContenu({ token, password, contenuId, body, authorName }) {
  const { data, error } = await supabase.rpc('share_contenus_comment', {
    p_token: token,
    p_password: password,
    p_contenu_id: contenuId,
    p_body: body,
    p_author_name: authorName || null,
  })
  if (error) throw error
  return data
}

export async function shareAddRef({ token, password, kind, valeur }) {
  const { error } = await supabase.rpc('share_contenus_add_ref', {
    p_token: token,
    p_password: password,
    p_kind: kind,
    p_valeur: valeur,
  })
  if (error) throw error
}
