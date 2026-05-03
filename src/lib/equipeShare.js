/**
 * equipeShare.js — Tokens de partage public techlist (EQUIPE-P4.2).
 *
 * Permet d'exposer une vue READ-ONLY de la techlist d'un projet à un
 * destinataire externe (régisseur, prod, client) via un lien public, sans
 * authentification.
 *
 * Côté admin (auth) : CRUD des tokens via supabase client (RLS scoped).
 * Côté client (anon) : fetch payload via RPC SECURITY DEFINER.
 *
 * Pattern aligné sur livrableShare.js (LIV-24). Les principales différences :
 *   - Scope : 'all' (tous lots) ou 'lot' (un lot précis via lot_id)
 *   - Toggle coordonnées (show_sensitive) au lieu d'une config complexe
 *   - Pas de "calendar_level" — la techlist n'a pas de mini-Gantt
 *
 * Voir supabase/migrations/20260502_equipe_p42_share_tokens.sql.
 */

import { supabase } from './supabase'

const TOKEN_BYTES = 24 // 24 bytes → 32 chars base64url

/* ─── Constantes ────────────────────────────────────────────────────────── */

export const SHARE_SCOPES = ['all', 'lot']

/* ─── Génération token ──────────────────────────────────────────────────── */

/**
 * Génère un nouveau secret token (~32 chars base64url) avec
 * crypto.getRandomValues. Aligné sur livrableShare / matosCheckToken /
 * generateIcalToken pour rester cohérent dans l'app.
 */
export function generateShareToken() {
  const cryptoObj = globalThis.crypto
  if (!cryptoObj?.getRandomValues) {
    throw new Error('WebCrypto indisponible : impossible de générer un token de partage sécurisé')
  }
  const bytes = new Uint8Array(TOKEN_BYTES)
  cryptoObj.getRandomValues(bytes)
  return base64urlEncode(bytes)
}

function base64urlEncode(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/* ─── URL helpers ───────────────────────────────────────────────────────── */

/**
 * Construit l'URL publique de la page partage pour un token donné.
 */
export function buildShareUrl(token) {
  const path = `/share/equipe/${encodeURIComponent(token)}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return path
}

/* ─── CRUD admin ────────────────────────────────────────────────────────── */

const TOKEN_COLS =
  'id, project_id, token, label, scope, lot_id, show_sensitive, ' +
  'created_by, created_at, revoked_at, expires_at, last_accessed_at, view_count'

/**
 * Liste les tokens visibles pour un projet. Inclut par défaut les révoqués
 * (audit). Passer `includeRevoked: false` pour ne voir que les actifs.
 */
export async function listShareTokens({ projectId, includeRevoked = true } = {}) {
  if (!projectId) throw new Error('listShareTokens : projectId requis')
  let query = supabase
    .from('equipe_share_tokens')
    .select(TOKEN_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (!includeRevoked) query = query.is('revoked_at', null)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Crée un nouveau token de partage. Le secret est généré localement, pas
 * envoyé par le serveur. Le caller est responsable d'établir le scope cohérent
 * (scope='lot' nécessite lot_id, scope='all' nécessite lot_id=null —
 * c'est aussi vérifié par CHECK constraint en DB).
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.label]          Libellé interne ("Régisseur Paul")
 * @param {'all'|'lot'} [params.scope='all']
 * @param {string|null} [params.lotId]     Requis si scope='lot'
 * @param {boolean} [params.showSensitive=true]  Coordonnées visibles
 * @param {string|Date|null} [params.expiresAt]
 */
export async function createShareToken({
  projectId,
  label = null,
  scope = 'all',
  lotId = null,
  showSensitive = true,
  expiresAt = null,
} = {}) {
  if (!projectId) throw new Error('createShareToken : projectId requis')
  if (!SHARE_SCOPES.includes(scope)) {
    throw new Error(`createShareToken : scope invalide (${scope})`)
  }
  if (scope === 'lot' && !lotId) {
    throw new Error('createShareToken : lot_id requis quand scope=lot')
  }

  const token = generateShareToken()
  const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : null

  const payload = {
    project_id: projectId,
    token,
    label: label?.trim() || null,
    scope,
    lot_id: scope === 'lot' ? lotId : null,
    show_sensitive: Boolean(showSensitive),
    expires_at: expiresIso,
  }

  const { data, error } = await supabase
    .from('equipe_share_tokens')
    .insert([payload])
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour les champs modifiables d'un token (label, expiration,
 * show_sensitive). Le scope/lot_id ne sont pas modifiables après création
 * — il vaut mieux révoquer + recréer pour changer le périmètre.
 */
export async function updateShareToken(tokenId, { label, expiresAt, showSensitive } = {}) {
  if (!tokenId) throw new Error('updateShareToken : tokenId requis')
  const patch = {}
  if (label !== undefined) patch.label = label?.trim() || null
  if (expiresAt !== undefined) {
    patch.expires_at = expiresAt ? new Date(expiresAt).toISOString() : null
  }
  if (showSensitive !== undefined) patch.show_sensitive = Boolean(showSensitive)
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('equipe_share_tokens')
    .update(patch)
    .eq('id', tokenId)
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Révoque un token (soft : `revoked_at` est posé). Idempotent.
 */
export async function revokeShareToken(tokenId) {
  if (!tokenId) throw new Error('revokeShareToken : tokenId requis')
  const { error } = await supabase.rpc('revoke_equipe_share_token', { p_token_id: tokenId })
  if (error) throw error
}

/**
 * Restaure un token précédemment révoqué.
 */
export async function restoreShareToken(tokenId) {
  if (!tokenId) throw new Error('restoreShareToken : tokenId requis')
  const { error } = await supabase
    .from('equipe_share_tokens')
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
  const { error } = await supabase.from('equipe_share_tokens').delete().eq('id', tokenId)
  if (error) throw error
}

/* ─── Fetch public (anon) ───────────────────────────────────────────────── */

/**
 * Récupère le payload de partage pour un token donné. Appelable en anon
 * (la RPC est SECURITY DEFINER, le token fait office d'auth). Bump le
 * compteur de vues côté serveur à chaque appel.
 *
 * Retourne :
 *   {
 *     share:   { label, scope, lot_id, show_sensitive },
 *     project: { id, title, ref_projet, cover_url },
 *     org:     { id, name, tagline, logo_url },
 *     lots:    Array<{ id, title, sort_order, ref_devis_id }>,
 *     membres: Array<{...}>,
 *     generated_at,
 *   }
 *
 * Throws si le token est invalide / révoqué / expiré.
 */
export async function fetchSharePayload(token) {
  if (!token) throw new Error('fetchSharePayload : token requis')
  const { data, error } = await supabase.rpc('share_equipe_fetch', { p_token: token })
  if (error) {
    console.error('[equipeShare] share_equipe_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou expiré')
  return data
}

/* ─── Helpers de présentation ───────────────────────────────────────────── */

/**
 * État d'affichage d'un token (pour le badge dans la modale d'admin).
 *   - 'active'   : utilisable
 *   - 'expired'  : expires_at dépassé
 *   - 'revoked'  : revoked_at posé
 */
export function getShareTokenState(token) {
  if (!token) return 'active'
  if (token.revoked_at) return 'revoked'
  if (token.expires_at && new Date(token.expires_at) <= new Date()) return 'expired'
  return 'active'
}
