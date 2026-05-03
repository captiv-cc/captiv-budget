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

// Note : password_hash est sélectionné mais N'EST JAMAIS affiché — on dérive
// uniquement un booléen (`isProjectShareTokenProtected`) côté UI. La RLS
// scope la lecture aux admins / membres du projet, donc l'exposition est
// acceptable. Le hash bcrypt n'est par ailleurs pas réversible.
const TOKEN_COLS =
  'id, project_id, token, label, enabled_pages, page_configs, ' +
  'created_by, created_at, revoked_at, expires_at, view_counts, last_accessed_at, ' +
  'password_hash, password_hint'

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
 * Le mot de passe (s'il est fourni) est posé via une RPC SECURITY DEFINER
 * `set_project_share_password` après l'INSERT — on ne fait JAMAIS transiter
 * de plain text dans une INSERT-from-client (et la colonne `password_hash`
 * du payload est ignorée par la RLS).
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.label]                  Libellé interne
 * @param {Array<string>} params.enabledPages      ex: ['equipe', 'livrables']
 * @param {object} [params.pageConfigs]            { equipe: {...}, livrables: {...} }
 * @param {string|Date|null} [params.expiresAt]
 * @param {string|null} [params.password]          Plain text (sera hashé côté DB).
 *                                                 NULL/'' = pas de protection.
 * @param {string|null} [params.passwordHint]      Indice optionnel
 */
export async function createProjectShareToken({
  projectId,
  label = null,
  enabledPages = [],
  pageConfigs = null,
  expiresAt = null,
  password = null,
  passwordHint = null,
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

  const finalConfigs = {}
  for (const p of enabledPages) {
    finalConfigs[p] = {
      ...(DEFAULT_PAGE_CONFIGS[p] || {}),
      ...(pageConfigs?.[p] || {}),
    }
  }

  const token = generateShareToken()
  const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : null
  const hint = (passwordHint || '').trim() || null

  const payload = {
    project_id: projectId,
    token,
    label: label?.trim() || null,
    enabled_pages: enabledPages,
    page_configs: finalConfigs,
    expires_at: expiresIso,
    password_hint: hint,
  }

  const { data, error } = await supabase
    .from('project_share_tokens')
    .insert([payload])
    .select(TOKEN_COLS)
    .single()
  if (error) throw error

  // Pose du mdp en post-INSERT via RPC (le hash ne quitte jamais la DB).
  if (password && password.length > 0) {
    const { error: pwdErr } = await supabase.rpc('set_project_share_password', {
      p_token_id: data.id,
      p_password: password,
    })
    if (pwdErr) {
      console.error(
        '[projectShare] createProjectShareToken : set password failed',
        pwdErr,
      )
      // Le token a été créé mais sans mdp — on remonte l'erreur pour que
      // l'UI puisse alerter et proposer un retry / clear.
      throw new Error(
        'Token créé mais mot de passe non posé : ' + (pwdErr.message || pwdErr),
      )
    }
    // Refetch pour avoir password_hash à jour.
    const { data: refreshed } = await supabase
      .from('project_share_tokens')
      .select(TOKEN_COLS)
      .eq('id', data.id)
      .single()
    return refreshed || data
  }

  return data
}

/**
 * Met à jour un token (label, expiration, pages activées, configs).
 * Le token secret + project_id ne sont pas modifiables. Pour changer
 * de projet, recréer un token.
 */
/**
 * Met à jour un token (label, expiration, pages activées, configs, mdp).
 * Le token secret + project_id ne sont pas modifiables. Pour changer
 * de projet, recréer un token.
 *
 * Pour le mot de passe :
 *   - `password === undefined`  → ne touche PAS au mdp existant
 *   - `password === null` ou ''  → efface le mdp (token redevient public)
 *   - `password === 'xxx'`       → pose ou remplace le mdp
 *
 * Le `passwordHint` suit la même règle que les autres champs (undefined =
 * inchangé, '' ou null = clear, string = set).
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
  if (fields.passwordHint !== undefined) {
    patch.password_hint = (fields.passwordHint || '').trim() || null
  }

  // Patch principal (sans toucher au mdp). On envoie même si patch est vide
  // dans le cas où seul le mdp change — pour récupérer la row à jour.
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from('project_share_tokens')
      .update(patch)
      .eq('id', tokenId)
    if (error) throw error
  }

  // Si fields.password est défini (y compris null/'' pour clear), on appelle
  // la RPC dédiée. NULL/'' → password_hash NULL.
  if (fields.password !== undefined) {
    const { error: pwdErr } = await supabase.rpc('set_project_share_password', {
      p_token_id: tokenId,
      p_password: fields.password || null,
    })
    if (pwdErr) {
      console.error(
        '[projectShare] updateProjectShareToken : set password failed',
        pwdErr,
      )
      throw new Error(
        'Mise à jour du mot de passe échouée : ' +
          (pwdErr.message || pwdErr),
      )
    }
  }

  // Refetch row à jour (incluant password_hash pour le flag isProtected).
  if (
    Object.keys(patch).length === 0 &&
    fields.password === undefined
  ) {
    return null // rien à faire
  }
  const { data, error } = await supabase
    .from('project_share_tokens')
    .select(TOKEN_COLS)
    .eq('id', tokenId)
    .single()
  if (error) throw error
  return data
}

/**
 * Renvoie true si le token est protégé par un mdp (password_hash IS NOT NULL).
 * Utilise une simple coercion booléenne sur la string bcrypt — on ne révèle
 * jamais le hash à l'UI.
 */
export function isProjectShareTokenProtected(token) {
  return Boolean(token?.password_hash)
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
 *
 * @param {string} token
 * @param {string} [password]  Mot de passe en clair (HTTPS). Optionnel : si
 *                             le token n'est pas protégé, ignoré côté DB.
 *                             Si protégé et mdp manquant/faux, raise 28P01.
 */
export async function fetchHubPayload(token, password = null) {
  if (!token) throw new Error('fetchHubPayload : token requis')
  const { data, error } = await supabase.rpc('share_projet_fetch', {
    p_token: token,
    p_password: password || null,
  })
  if (error) {
    console.error('[projectShare] share_projet_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou expiré')
  return data
}

export async function fetchEquipePayload(token, password = null) {
  if (!token) throw new Error('fetchEquipePayload : token requis')
  const { data, error } = await supabase.rpc('share_projet_equipe_fetch', {
    p_token: token,
    p_password: password || null,
  })
  if (error) {
    console.error('[projectShare] share_projet_equipe_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou page non activée')
  return data
}

export async function fetchLivrablesPayload(token, password = null) {
  if (!token) throw new Error('fetchLivrablesPayload : token requis')
  const { data, error } = await supabase.rpc('share_projet_livrables_fetch', {
    p_token: token,
    p_password: password || null,
  })
  if (error) {
    console.error('[projectShare] share_projet_livrables_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou page non activée')
  return data
}

/* ─── Stockage du mdp côté visiteur (sessionStorage) ────────────────────── */

// Per-tab, ephémère. Suffisant pour ne pas redemander à chaque navigation
// dans le portail. Disparaît à la fermeture de l'onglet — comportement
// volontairement plus strict que les cookies long-lived.
const SHARE_PWD_PREFIX = 'project-share-pwd:'

export function getStoredSharePassword(token) {
  if (!token || typeof sessionStorage === 'undefined') return null
  try {
    return sessionStorage.getItem(SHARE_PWD_PREFIX + token) || null
  } catch {
    return null
  }
}

export function storeSharePassword(token, password) {
  if (!token || typeof sessionStorage === 'undefined') return
  try {
    if (!password) {
      sessionStorage.removeItem(SHARE_PWD_PREFIX + token)
    } else {
      sessionStorage.setItem(SHARE_PWD_PREFIX + token, password)
    }
  } catch {
    /* noop : storage plein ou indisponible */
  }
}

/**
 * Détecte les erreurs de password gate (PG SQLSTATE 28P01).
 * Renvoie : { kind: 'missing' | 'invalid', hint }  ou null.
 */
export function detectPasswordError(error) {
  if (!error) return null
  if (error.code !== '28P01') return null
  const msg = String(error.message || '').toLowerCase()
  const kind = msg.includes('required') ? 'missing' : 'invalid'
  // PostgreSQL renvoie le HINT dans error.hint (PostgREST mappe ce champ).
  // Si le hint est vide, on retombe à null (le front affichera juste le
  // libellé générique).
  const hint =
    typeof error.hint === 'string' && error.hint.trim().length > 0
      ? error.hint.trim()
      : null
  return { kind, hint }
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
