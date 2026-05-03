/**
 * matosShare.js — Tokens de partage public matériel (MATOS-SHARE).
 *
 * Permet d'exposer une vue READ-ONLY de la liste matériel d'un projet à un
 * destinataire externe via une URL publique unique, sans authentification.
 *
 * Côté admin (auth) : CRUD des tokens via supabase client (RLS scoped).
 * Côté client (anon) : fetch payload via RPC SECURITY DEFINER.
 *
 * Pattern aligné sur equipeShare.js / livrableShare.js. À ne pas confondre
 * avec matos_check_tokens (MAT-10) qui est en mode "agir" (cocher des
 * cases en terrain) — matos_share_tokens est strictement READ-ONLY.
 *
 * Voir supabase/migrations/20260504_matos_share_tokens.sql.
 */

import { supabase } from './supabase'

const TOKEN_BYTES = 24 // 24 bytes → 32 chars base64url

/* ─── Config par défaut ─────────────────────────────────────────────────── */

/**
 * Toggles d'affichage par défaut. Cohérent avec la décision Hugo :
 *   - Loueurs + qté visibles (utile pour le client / DOP)
 *   - Remarques + flags + checklist + photos masqués (interne par défaut)
 */
export const DEFAULT_SHARE_CONFIG = Object.freeze({
  show_loueurs:    true,
  show_quantites:  true,
  show_remarques:  false,
  show_flags:      false,
  show_checklist:  false,
  show_photos:     false,
})

/**
 * Garantit qu'une config est toujours complète (merge avec defaults).
 * Utile pour la lecture côté UI quand un vieux token aurait une shape
 * partielle.
 */
export function normalizeShareConfig(config) {
  const c = config && typeof config === 'object' ? config : {}
  return {
    show_loueurs:    c.show_loueurs    !== undefined ? Boolean(c.show_loueurs)    : DEFAULT_SHARE_CONFIG.show_loueurs,
    show_quantites:  c.show_quantites  !== undefined ? Boolean(c.show_quantites)  : DEFAULT_SHARE_CONFIG.show_quantites,
    show_remarques:  c.show_remarques  !== undefined ? Boolean(c.show_remarques)  : DEFAULT_SHARE_CONFIG.show_remarques,
    show_flags:      c.show_flags      !== undefined ? Boolean(c.show_flags)      : DEFAULT_SHARE_CONFIG.show_flags,
    show_checklist:  c.show_checklist  !== undefined ? Boolean(c.show_checklist)  : DEFAULT_SHARE_CONFIG.show_checklist,
    show_photos:     c.show_photos     !== undefined ? Boolean(c.show_photos)     : DEFAULT_SHARE_CONFIG.show_photos,
  }
}

/* ─── Génération token ──────────────────────────────────────────────────── */

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
 * URL publique d'un token de partage matériel.
 * Format : `<origin>/share/materiel/:token`.
 */
export function buildShareUrl(token) {
  const path = `/share/materiel/${encodeURIComponent(token)}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return path
}

/* ─── CRUD admin ────────────────────────────────────────────────────────── */

const TOKEN_COLS =
  'id, project_id, token, label, version_id, config, ' +
  'created_by, created_at, revoked_at, expires_at, view_count, last_accessed_at'

export async function listMatosShareTokens({ projectId, includeRevoked = true } = {}) {
  if (!projectId) throw new Error('listMatosShareTokens : projectId requis')
  let query = supabase
    .from('matos_share_tokens')
    .select(TOKEN_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (!includeRevoked) query = query.is('revoked_at', null)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Crée un nouveau token matériel.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.label]                     Libellé interne
 * @param {string|null} [params.versionId]            null = mode 'active' (suit
 *                                                    la version active courante).
 *                                                    UUID = snapshot figé.
 * @param {object} [params.config]                    Toggles (merge avec
 *                                                    DEFAULT_SHARE_CONFIG)
 * @param {string|Date|null} [params.expiresAt]
 */
export async function createMatosShareToken({
  projectId,
  label = null,
  versionId = null,
  config = null,
  expiresAt = null,
} = {}) {
  if (!projectId) throw new Error('createMatosShareToken : projectId requis')

  const finalConfig = normalizeShareConfig({ ...DEFAULT_SHARE_CONFIG, ...(config || {}) })
  const token = generateShareToken()
  const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : null

  const payload = {
    project_id: projectId,
    token,
    label: label?.trim() || null,
    version_id: versionId || null,
    config: finalConfig,
    expires_at: expiresIso,
  }

  const { data, error } = await supabase
    .from('matos_share_tokens')
    .insert([payload])
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour un token (label, expiration, config, version_id).
 * Le token secret + project_id ne sont pas modifiables.
 *
 * Pour la version :
 *   - `versionId === undefined`  → ne change pas
 *   - `versionId === null`       → repasse en mode 'active'
 *   - `versionId === '<uuid>'`   → snapshot figé sur cette version
 */
export async function updateMatosShareToken(tokenId, fields = {}) {
  if (!tokenId) throw new Error('updateMatosShareToken : tokenId requis')
  const patch = {}
  if (fields.label !== undefined) patch.label = fields.label?.trim() || null
  if (fields.expiresAt !== undefined) {
    patch.expires_at = fields.expiresAt ? new Date(fields.expiresAt).toISOString() : null
  }
  if (fields.versionId !== undefined) {
    patch.version_id = fields.versionId || null
  }
  if (fields.config !== undefined) {
    patch.config = normalizeShareConfig({ ...DEFAULT_SHARE_CONFIG, ...(fields.config || {}) })
  }
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('matos_share_tokens')
    .update(patch)
    .eq('id', tokenId)
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

export async function revokeMatosShareToken(tokenId) {
  if (!tokenId) throw new Error('revokeMatosShareToken : tokenId requis')
  const { error } = await supabase.rpc('revoke_matos_share_token', {
    p_token_id: tokenId,
  })
  if (error) throw error
}

export async function restoreMatosShareToken(tokenId) {
  if (!tokenId) throw new Error('restoreMatosShareToken : tokenId requis')
  const { error } = await supabase
    .from('matos_share_tokens')
    .update({ revoked_at: null })
    .eq('id', tokenId)
  if (error) throw error
}

export async function deleteMatosShareToken(tokenId) {
  if (!tokenId) throw new Error('deleteMatosShareToken : tokenId requis')
  const { error } = await supabase
    .from('matos_share_tokens')
    .delete()
    .eq('id', tokenId)
  if (error) throw error
}

/* ─── Fetch public (anon) ───────────────────────────────────────────────── */

/**
 * Récupère le payload du share matériel. Le numero_reference des loueurs
 * n'est jamais exposé (sensible). Les champs masqués selon config sont
 * remplacés par NULL côté SQL.
 */
export async function fetchMatosSharePayload(token) {
  if (!token) throw new Error('fetchMatosSharePayload : token requis')
  const { data, error } = await supabase.rpc('share_matos_fetch', {
    p_token: token,
  })
  if (error) {
    console.error('[matosShare] share_matos_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou expiré')
  return data
}

/* ─── Helpers de présentation ───────────────────────────────────────────── */

export function getMatosShareTokenState(token) {
  if (!token) return 'active'
  if (token.revoked_at) return 'revoked'
  if (token.expires_at && new Date(token.expires_at) <= new Date()) return 'expired'
  return 'active'
}

/**
 * Renvoie le mode de la version : 'active' (suit la version active courante)
 * ou 'snapshot' (figée).
 */
export function getMatosShareVersionMode(token) {
  if (!token) return 'active'
  return token.version_id ? 'snapshot' : 'active'
}
