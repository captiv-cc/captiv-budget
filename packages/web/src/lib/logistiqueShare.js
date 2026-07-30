/**
 * logistiqueShare.js — Tokens de partage public dédiés à la Logistique & VHR.
 *
 * Le module Logistique a ses propres liens (comme le déroulé, l'équipe…) :
 * table logistique_share_tokens, page publique /share/logistique/:token,
 * jamais de retour vers le hub portail projet.
 *
 * Côté admin (auth) : CRUD des tokens via supabase client (RLS org).
 * Côté public (anon) : fetch payload via RPC share_logistique_fetch
 * SECURITY DEFINER — le token fait office d'authentification.
 *
 * Trois sections togglables par lien, appliquées CÔTÉ SERVEUR :
 * show_overview (grille), show_synthese, show_personnes (fiches + docs V0).
 *
 * Pattern aligné sur derouleShare.js.
 * Voir supabase/migrations/20260730c_logistique_share_tokens.sql.
 */

import { supabase } from './supabase'
import { generateShareToken } from './projectShare'

/* ─── URL helpers ───────────────────────────────────────────────────────── */

export function buildShareUrl(token) {
  const path = `/share/logistique/${encodeURIComponent(token)}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return path
}

/* ─── CRUD admin ────────────────────────────────────────────────────────── */

const TOKEN_COLS =
  'id, project_id, token, label, show_overview, show_synthese, show_personnes, ' +
  'created_by, created_at, revoked_at, expires_at, last_accessed_at, view_count'

export async function listShareTokens({ projectId, includeRevoked = true } = {}) {
  if (!projectId) throw new Error('listShareTokens : projectId requis')
  let query = supabase
    .from('logistique_share_tokens')
    .select(TOKEN_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (!includeRevoked) query = query.is('revoked_at', null)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Crée un nouveau token. Le secret est généré localement.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.label]                 Destinataire ("Équipe", "Festival")
 * @param {boolean} [params.showOverview=true]
 * @param {boolean} [params.showSynthese=true]
 * @param {boolean} [params.showPersonnes=true]
 * @param {string|Date|null} [params.expiresAt]
 */
export async function createShareToken({
  projectId,
  label = null,
  showOverview = true,
  showSynthese = true,
  showPersonnes = true,
  expiresAt = null,
} = {}) {
  if (!projectId) throw new Error('createShareToken : projectId requis')

  const token = generateShareToken()
  const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : null

  const payload = {
    project_id: projectId,
    token,
    label: label?.trim() || null,
    show_overview: Boolean(showOverview),
    show_synthese: Boolean(showSynthese),
    show_personnes: Boolean(showPersonnes),
    expires_at: expiresIso,
  }

  const { data, error } = await supabase
    .from('logistique_share_tokens')
    .insert([payload])
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour les champs modifiables d'un token (label, expiration, sections).
 */
export async function updateShareToken(
  tokenId,
  { label, expiresAt, showOverview, showSynthese, showPersonnes } = {},
) {
  if (!tokenId) throw new Error('updateShareToken : tokenId requis')
  const patch = {}
  if (label !== undefined) patch.label = label?.trim() || null
  if (expiresAt !== undefined) {
    patch.expires_at = expiresAt ? new Date(expiresAt).toISOString() : null
  }
  if (showOverview !== undefined) patch.show_overview = Boolean(showOverview)
  if (showSynthese !== undefined) patch.show_synthese = Boolean(showSynthese)
  if (showPersonnes !== undefined) patch.show_personnes = Boolean(showPersonnes)
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('logistique_share_tokens')
    .update(patch)
    .eq('id', tokenId)
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Révoque un token (soft : `revoked_at` posé). Idempotent.
 */
export async function revokeShareToken(tokenId) {
  if (!tokenId) throw new Error('revokeShareToken : tokenId requis')
  const { error } = await supabase
    .from('logistique_share_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .is('revoked_at', null)
  if (error) throw error
}

export async function restoreShareToken(tokenId) {
  if (!tokenId) throw new Error('restoreShareToken : tokenId requis')
  const { error } = await supabase
    .from('logistique_share_tokens')
    .update({ revoked_at: null })
    .eq('id', tokenId)
  if (error) throw error
}

/**
 * Supprime physiquement un token. Préférer `revokeShareToken` pour garder
 * l'historique des vues.
 */
export async function deleteShareToken(tokenId) {
  if (!tokenId) throw new Error('deleteShareToken : tokenId requis')
  const { error } = await supabase
    .from('logistique_share_tokens')
    .delete()
    .eq('id', tokenId)
  if (error) throw error
}

/* ─── Fetch public (anon) ───────────────────────────────────────────────── */

/**
 * Récupère le payload de partage pour un token donné (même shape que
 * fetchLogistiqueV0Payload du portail : share/config/project/org + global,
 * entries, documents, membres, participations, trajets, repas, nuits,
 * hébergements). Bump le compteur de vues côté serveur.
 *
 * Throws si le token est invalide / révoqué / expiré.
 */
export async function fetchSharePayload(token) {
  if (!token) throw new Error('fetchSharePayload : token requis')
  const { data, error } = await supabase.rpc('share_logistique_fetch', { p_token: token })
  if (error) {
    console.error('[logistiqueShare] share_logistique_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou expiré')
  return data
}

/* ─── Helpers de présentation ───────────────────────────────────────────── */

export function getShareTokenState(token) {
  if (!token) return 'active'
  if (token.revoked_at) return 'revoked'
  if (token.expires_at && new Date(token.expires_at) <= new Date()) return 'expired'
  return 'active'
}
