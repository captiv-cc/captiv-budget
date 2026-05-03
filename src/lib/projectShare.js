/**
 * projectShare.js — Tokens de partage public "portail projet" (PROJECT-SHARE).
 *
 * Permet d'exposer une vue READ-ONLY multi-pages d'un projet (hub +
 * sous-pages équipe / livrables / ...) à un destinataire externe via une
 * URL publique unique, sans authentification.
 *
 * Côté admin (auth) : CRUD des tokens via supabase client (RLS scoped).
 * Côté client (anon) : fetch payloads via RPCs SECURITY DEFINER.
 *
 * Pattern aligné sur equipeShare.js / livrableShare.js. Les tokens existants
 * (equipe_share_tokens, livrable_share_tokens) restent en place — c'est un
 * cas d'usage différent (lien dédié rapide vs portail multi-pages).
 *
 * Voir supabase/migrations/20260504_project_share_tokens.sql.
 */

import { supabase } from './supabase'

const TOKEN_BYTES = 24 // 24 bytes → 32 chars base64url

/* ─── Constantes ────────────────────────────────────────────────────────── */

// Pages éligibles dans le portail projet. Pour ajouter une page :
//   1. Ajouter sa clé ici (ex: 'logistique', 'materiel')
//   2. Créer la RPC share_projet_<page>_fetch côté SQL
//   3. Ajouter le fetcher correspondant dans ce fichier
//   4. Ajouter le hook + la page React + la carte du hub
export const SHARE_PAGES = ['equipe', 'livrables']

// Configuration par défaut pour chaque page (utilisée à la création d'un
// token si l'admin ne précise rien). Conventions miroir des share dédiés :
//   - equipe : scope='all', pas de filtre lot, coordonnées visibles
//   - livrables : pas de calendrier, périodes/envoi/feedback visibles
export const DEFAULT_PAGE_CONFIGS = {
  equipe: {
    scope: 'all',
    lot_id: null,
    show_sensitive: true,
  },
  livrables: {
    calendar_level: 'hidden',
    show_periodes: true,
    show_envoi_prevu: true,
    show_feedback: true,
  },
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
 * URL publique du HUB pour un token donné. Les sous-pages sont accessibles
 * en suffixant `/equipe`, `/livrables`, etc.
 */
export function buildProjectShareUrl(token) {
  const path = `/share/projet/${encodeURIComponent(token)}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return path
}

/* ─── CRUD admin ────────────────────────────────────────────────────────── */

const TOKEN_COLS =
  'id, project_id, token, label, enabled_pages, page_configs, ' +
  'created_by, created_at, revoked_at, expires_at, view_counts, last_accessed_at'

export async function listProjectShareTokens({ projectId, includeRevoked = true } = {}) {
  if (!projectId) throw new Error('listProjectShareTokens : projectId requis')
  let query = supabase
    .from('project_share_tokens')
    .select(TOKEN_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (!includeRevoked) query = query.is('revoked_at', null)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Crée un nouveau token portail projet.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.label]                  Libellé interne
 * @param {Array<string>} params.enabledPages      ex: ['equipe', 'livrables']
 * @param {object} [params.pageConfigs]            { equipe: {...}, livrables: {...} }
 *                                                 Chaque page activée doit avoir
 *                                                 son entrée. Si omise → defaults.
 * @param {string|Date|null} [params.expiresAt]
 */
export async function createProjectShareToken({
  projectId,
  label = null,
  enabledPages = [],
  pageConfigs = null,
  expiresAt = null,
} = {}) {
  if (!projectId) throw new Error('createProjectShareToken : projectId requis')
  if (!Array.isArray(enabledPages) || enabledPages.length === 0) {
    throw new Error('createProjectShareToken : au moins une page activée requise')
  }
  for (const p of enabledPages) {
    if (!SHARE_PAGES.includes(p)) {
      throw new Error(`createProjectShareToken : page inconnue (${p})`)
    }
  }

  // Construit pageConfigs final : si pas fourni, on prend les defaults.
  // Sinon, on merge les overrides sur les defaults pour les pages activées.
  const finalConfigs = {}
  for (const p of enabledPages) {
    finalConfigs[p] = {
      ...(DEFAULT_PAGE_CONFIGS[p] || {}),
      ...(pageConfigs?.[p] || {}),
    }
  }

  const token = generateShareToken()
  const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : null

  const payload = {
    project_id: projectId,
    token,
    label: label?.trim() || null,
    enabled_pages: enabledPages,
    page_configs: finalConfigs,
    expires_at: expiresIso,
  }

  const { data, error } = await supabase
    .from('project_share_tokens')
    .insert([payload])
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour un token (label, expiration, pages activées, configs).
 * Le token secret + project_id ne sont pas modifiables. Pour changer
 * de projet, recréer un token.
 */
export async function updateProjectShareToken(tokenId, fields = {}) {
  if (!tokenId) throw new Error('updateProjectShareToken : tokenId requis')
  const patch = {}
  if (fields.label !== undefined) patch.label = fields.label?.trim() || null
  if (fields.expiresAt !== undefined) {
    patch.expires_at = fields.expiresAt ? new Date(fields.expiresAt).toISOString() : null
  }
  if (fields.enabledPages !== undefined) {
    if (!Array.isArray(fields.enabledPages)) {
      throw new Error('updateProjectShareToken : enabledPages doit être un array')
    }
    for (const p of fields.enabledPages) {
      if (!SHARE_PAGES.includes(p)) {
        throw new Error(`updateProjectShareToken : page inconnue (${p})`)
      }
    }
    patch.enabled_pages = fields.enabledPages
  }
  if (fields.pageConfigs !== undefined) {
    patch.page_configs = fields.pageConfigs
  }
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('project_share_tokens')
    .update(patch)
    .eq('id', tokenId)
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

export async function revokeProjectShareToken(tokenId) {
  if (!tokenId) throw new Error('revokeProjectShareToken : tokenId requis')
  const { error } = await supabase.rpc('revoke_project_share_token', { p_token_id: tokenId })
  if (error) throw error
}

export async function restoreProjectShareToken(tokenId) {
  if (!tokenId) throw new Error('restoreProjectShareToken : tokenId requis')
  const { error } = await supabase
    .from('project_share_tokens')
    .update({ revoked_at: null })
    .eq('id', tokenId)
  if (error) throw error
}

export async function deleteProjectShareToken(tokenId) {
  if (!tokenId) throw new Error('deleteProjectShareToken : tokenId requis')
  const { error } = await supabase
    .from('project_share_tokens')
    .delete()
    .eq('id', tokenId)
  if (error) throw error
}

/* ─── Fetch public (anon) ───────────────────────────────────────────────── */

/**
 * Récupère le payload du HUB (page d'accueil portail). Bump view_counts['_hub'].
 */
export async function fetchHubPayload(token) {
  if (!token) throw new Error('fetchHubPayload : token requis')
  const { data, error } = await supabase.rpc('share_projet_fetch', { p_token: token })
  if (error) {
    console.error('[projectShare] share_projet_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou expiré')
  return data
}

/**
 * Récupère le payload de la sous-page ÉQUIPE. Raise si page non activée.
 */
export async function fetchEquipePayload(token) {
  if (!token) throw new Error('fetchEquipePayload : token requis')
  const { data, error } = await supabase.rpc('share_projet_equipe_fetch', { p_token: token })
  if (error) {
    console.error('[projectShare] share_projet_equipe_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou page non activée')
  return data
}

/**
 * Récupère le payload de la sous-page LIVRABLES. Raise si page non activée.
 */
export async function fetchLivrablesPayload(token) {
  if (!token) throw new Error('fetchLivrablesPayload : token requis')
  const { data, error } = await supabase.rpc('share_projet_livrables_fetch', { p_token: token })
  if (error) {
    console.error('[projectShare] share_projet_livrables_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou page non activée')
  return data
}

/* ─── Helpers de présentation ───────────────────────────────────────────── */

export function getProjectShareTokenState(token) {
  if (!token) return 'active'
  if (token.revoked_at) return 'revoked'
  if (token.expires_at && new Date(token.expires_at) <= new Date()) return 'expired'
  return 'active'
}

/**
 * Renvoie le total de vues (somme de view_counts) pour un token.
 */
export function totalViews(token) {
  const counts = token?.view_counts || {}
  return Object.values(counts).reduce((acc, v) => acc + (Number(v) || 0), 0)
}
