/**
 * derouleShare.js — Tokens de partage public du déroulé (Vague 2).
 *
 * Permet d'exposer une vue READ-ONLY des déroulés d'un projet à un
 * destinataire externe (membre équipe, régisseur, prod, client) via un
 * lien public, sans authentification.
 *
 * Côté admin (auth) : CRUD des tokens via supabase client (RLS scoped).
 * Côté client (anon) : fetch payload via RPC SECURITY DEFINER.
 *
 * Pattern aligné sur equipeShare.js (EQUIPE-P4.2). Différences :
 *   - Pas de scope/lot_id : un déroulé concerne le projet entier
 *     (multi-jours possible). La page publique offre un sélecteur de date.
 *   - show_sensitive contrôle les notes internes + coordonnées membres.
 *
 * Voir supabase/migrations/20260508_deroule_share_tokens.sql.
 */

import { supabase } from './supabase'

const TOKEN_BYTES = 24 // 24 bytes → 32 chars base64url

/* ─── Génération token ──────────────────────────────────────────────────── */

/**
 * Génère un nouveau secret token (~32 chars base64url) avec
 * crypto.getRandomValues. Aligné sur equipeShare / livrableShare /
 * matosCheckToken / generateIcalToken pour rester cohérent dans l'app.
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
 * Construit l'URL publique de la page partage déroulé pour un token donné.
 */
export function buildShareUrl(token) {
  const path = `/share/deroule/${encodeURIComponent(token)}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return path
}

/* ─── CRUD admin ────────────────────────────────────────────────────────── */

const TOKEN_COLS =
  'id, project_id, token, label, show_sensitive, ' +
  'created_by, created_at, revoked_at, expires_at, last_accessed_at, view_count'

/**
 * Liste les tokens visibles pour un projet. Inclut par défaut les révoqués
 * (audit). Passer `includeRevoked: false` pour ne voir que les actifs.
 */
export async function listShareTokens({ projectId, includeRevoked = true } = {}) {
  if (!projectId) throw new Error('listShareTokens : projectId requis')
  let query = supabase
    .from('deroule_share_tokens')
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
 * envoyé par le serveur.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.label]            Libellé interne ("Régisseur Paul")
 * @param {boolean} [params.showSensitive=true]  Notes internes + coords visibles
 * @param {string|Date|null} [params.expiresAt]
 */
export async function createShareToken({
  projectId,
  label = null,
  showSensitive = true,
  expiresAt = null,
} = {}) {
  if (!projectId) throw new Error('createShareToken : projectId requis')

  const token = generateShareToken()
  const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : null

  const payload = {
    project_id: projectId,
    token,
    label: label?.trim() || null,
    show_sensitive: Boolean(showSensitive),
    expires_at: expiresIso,
  }

  const { data, error } = await supabase
    .from('deroule_share_tokens')
    .insert([payload])
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour les champs modifiables d'un token (label, expiration,
 * show_sensitive).
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
    .from('deroule_share_tokens')
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
  const { error } = await supabase.rpc('revoke_deroule_share_token', { p_token_id: tokenId })
  if (error) throw error
}

/**
 * Restaure un token précédemment révoqué.
 */
export async function restoreShareToken(tokenId) {
  if (!tokenId) throw new Error('restoreShareToken : tokenId requis')
  const { error } = await supabase
    .from('deroule_share_tokens')
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
  const { error } = await supabase.from('deroule_share_tokens').delete().eq('id', tokenId)
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
 *     share:    { label, show_sensitive },
 *     project:  { id, title, ref_projet, cover_url },
 *     org:      { ... branding ... },
 *     deroules: Array<{ id, date_jour, titre, ... }>,
 *     lanes:    Array<{ id, deroule_id, sort_order, libelle }>,
 *     creneaux: Array<{ id, deroule_id, lane_id, multi_lane,
 *                       heure_debut_min, heure_fin_min, titre, type,
 *                       couleur, lieu_text, statut, notes, member_ids }>,
 *     membres:  Array<{ id, prenom, nom, specialite, category, couleur, ... }>,
 *     generated_at,
 *   }
 *
 * Throws si le token est invalide / révoqué / expiré.
 */
export async function fetchSharePayload(token) {
  if (!token) throw new Error('fetchSharePayload : token requis')
  const { data, error } = await supabase.rpc('share_deroule_fetch', { p_token: token })
  if (error) {
    console.error('[derouleShare] share_deroule_fetch error', error)
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
