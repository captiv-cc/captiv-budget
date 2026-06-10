/**
 * livrableShare.js — Tokens de partage public livrables (LIV-24).
 *
 * Permet d'exposer une vue READ-ONLY simplifiée de l'état des livrables
 * d'un projet à un client externe via un lien public, sans authentification.
 *
 * Côté admin (auth) : CRUD des tokens via supabase client (RLS scoped).
 * Côté client (anon) : fetch payload via RPC SECURITY DEFINER.
 *
 * Voir supabase/migrations/20260503_liv24a_share_tokens.sql.
 */

import { supabase } from './supabase'

const TOKEN_BYTES = 24 // 24 bytes → 32 chars base64url

/* ─── Constantes config ─────────────────────────────────────────────────── */

/**
 * Niveaux d'affichage du calendrier dans la page client :
 *   - 'hidden'     : pas de calendrier, juste la liste des livrables
 *   - 'milestones' : timeline avec uniquement les jalons (envois versions
 *                    + deadlines de livraison)
 *   - 'phases'     : ajoute les bandes de production agrégées par
 *                    event_type (Dérush, Montage, Étalonnage, Son, …).
 *                    Pas les étapes individuelles ("Pré-derush", "Edit"),
 *                    juste les phases regroupées en blocs colorés.
 */
export const CALENDAR_LEVELS = ['hidden', 'milestones', 'phases']

export const CALENDAR_LEVEL_LABELS = {
  hidden:     'Caché',
  milestones: 'Jalons seulement',
  phases:     'Jalons + phases',
}

export const CALENDAR_LEVEL_DESCRIPTIONS = {
  hidden:
    'Pas de calendrier visible. Le client voit seulement la liste des livrables avec leurs versions et statuts.',
  milestones:
    'Timeline avec les envois prévus de versions (V1, V2…) et les deadlines de livraison.',
  phases:
    'Timeline avec les jalons + les phases de production agrégées (Dérush, Montage, Étalonnage…). Pas les étapes individuelles internes.',
}

/**
 * Config par défaut d'un token nouvellement créé. Conservatrice : pas de
 * calendrier, mais tout le reste autorisé (périodes, dates prévues, feedback).
 * L'admin coche/décoche dans la modale au moment de la création.
 */
export const DEFAULT_SHARE_CONFIG = Object.freeze({
  calendar_level:   'hidden',
  show_periodes:    true,
  show_envoi_prevu: true,
  show_feedback:    true,
})

/**
 * Garantit qu'une config est toujours complète (merge avec defaults).
 * Utile pour la lecture côté UI quand un vieux token aurait une shape
 * partielle.
 */
export function normalizeShareConfig(config) {
  const c = config && typeof config === 'object' ? config : {}
  return {
    calendar_level:
      CALENDAR_LEVELS.includes(c.calendar_level) ? c.calendar_level : DEFAULT_SHARE_CONFIG.calendar_level,
    show_periodes:    c.show_periodes    !== undefined ? Boolean(c.show_periodes)    : DEFAULT_SHARE_CONFIG.show_periodes,
    show_envoi_prevu: c.show_envoi_prevu !== undefined ? Boolean(c.show_envoi_prevu) : DEFAULT_SHARE_CONFIG.show_envoi_prevu,
    show_feedback:    c.show_feedback    !== undefined ? Boolean(c.show_feedback)    : DEFAULT_SHARE_CONFIG.show_feedback,
  }
}

/* ─── Génération token ──────────────────────────────────────────────────── */

/**
 * Génère un nouveau secret token (~32 chars base64url) avec
 * crypto.getRandomValues. Aligné sur generateIcalToken / matosCheckToken
 * pour rester cohérent dans l'app.
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
 * Construit l'URL publique de la page client pour un token donné.
 * Utilise window.location.origin si dispo (côté client), sinon une string
 * relative (utile en SSR / tests).
 */
export function buildShareUrl(token) {
  const path = `/share/livrables/${encodeURIComponent(token)}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return path
}

/* ─── CRUD admin ────────────────────────────────────────────────────────── */

const TOKEN_COLS =
  'id, project_id, token, label, config, created_by, created_at, ' +
  'revoked_at, expires_at, last_accessed_at, view_count'

/**
 * Liste les tokens visibles pour un projet. Inclut par défaut les révoqués
 * (audit). Passer `includeRevoked: false` pour ne voir que les actifs.
 */
export async function listShareTokens({ projectId, includeRevoked = true } = {}) {
  if (!projectId) throw new Error('listShareTokens : projectId requis')
  let query = supabase
    .from('livrable_share_tokens')
    .select(TOKEN_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (!includeRevoked) query = query.is('revoked_at', null)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row) => ({ ...row, config: normalizeShareConfig(row.config) }))
}

/**
 * Crée un nouveau token de partage. Le token secret est généré localement,
 * pas envoyé par le serveur.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.label]      Libellé interne ("Client Renault")
 * @param {object} [params.config]     Toggles (merge avec DEFAULT_SHARE_CONFIG)
 * @param {string|Date|null} [params.expiresAt] Expiration optionnelle (ISO ou Date)
 */
export async function createShareToken({
  projectId,
  label = null,
  config = {},
  expiresAt = null,
} = {}) {
  if (!projectId) throw new Error('createShareToken : projectId requis')

  const token = generateShareToken()
  const finalConfig = normalizeShareConfig({ ...DEFAULT_SHARE_CONFIG, ...config })
  const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : null

  const payload = {
    project_id: projectId,
    token,
    label: label?.trim() || null,
    config: finalConfig,
    expires_at: expiresIso,
  }

  const { data, error } = await supabase
    .from('livrable_share_tokens')
    .insert([payload])
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return { ...data, config: normalizeShareConfig(data.config) }
}

/**
 * Met à jour le label, la config ou l'expiration d'un token. N'importe lequel
 * des champs peut être omis (undefined) — seuls les champs présents sont écrits.
 */
export async function updateShareToken(tokenId, { label, config, expiresAt } = {}) {
  if (!tokenId) throw new Error('updateShareToken : tokenId requis')
  const patch = {}
  if (label !== undefined) patch.label = label?.trim() || null
  if (config !== undefined) patch.config = normalizeShareConfig(config)
  if (expiresAt !== undefined) {
    patch.expires_at = expiresAt ? new Date(expiresAt).toISOString() : null
  }
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('livrable_share_tokens')
    .update(patch)
    .eq('id', tokenId)
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return { ...data, config: normalizeShareConfig(data.config) }
}

/**
 * Révoque un token (soft : `revoked_at` est posé). Idempotent.
 */
export async function revokeShareToken(tokenId) {
  if (!tokenId) throw new Error('revokeShareToken : tokenId requis')
  const { error } = await supabase.rpc('revoke_livrable_share_token', { p_token_id: tokenId })
  if (error) throw error
}

/**
 * Restaure un token précédemment révoqué (efface revoked_at). Utile en cas
 * de révocation par erreur.
 */
export async function restoreShareToken(tokenId) {
  if (!tokenId) throw new Error('restoreShareToken : tokenId requis')
  const { error } = await supabase
    .from('livrable_share_tokens')
    .update({ revoked_at: null })
    .eq('id', tokenId)
  if (error) throw error
}

/**
 * Supprime physiquement un token. Préférer `revokeShareToken` pour garder
 * l'historique des vues. Réservé aux cas où on veut vraiment effacer la trace.
 */
export async function deleteShareToken(tokenId) {
  if (!tokenId) throw new Error('deleteShareToken : tokenId requis')
  const { error } = await supabase.from('livrable_share_tokens').delete().eq('id', tokenId)
  if (error) throw error
}

/* ─── Fetch public (anon) ───────────────────────────────────────────────── */

/**
 * Récupère le payload de partage pour un token donné. Appelable en anon
 * (la RPC est SECURITY DEFINER, le token fait office d'auth). Bump le
 * compteur de vues côté serveur à chaque appel.
 *
 * Retourne :
 *   { share: {label, config}, project, blocks, livrables, versions,
 *     etapes, event_types, generated_at }
 *
 * Throws si le token est invalide / révoqué / expiré.
 */
export async function fetchSharePayload(token) {
  if (!token) throw new Error('fetchSharePayload : token requis')
  const { data, error } = await supabase.rpc('share_livrables_fetch', { p_token: token })
  if (error) {
    // Log détaillé en console pour diagnostic admin (la page client n'expose
    // pas le détail technique mais on veut pouvoir le retrouver via DevTools).
    console.error('[livrableShare] share_livrables_fetch error', error)
    throw error
  }
  // La RPC peut renvoyer null si la SECURITY DEFINER raise — supabase-js
  // le mappe normalement en error, mais on garde la garde par défensif.
  if (!data) throw new Error('Token invalide ou expiré')
  return {
    ...data,
    share: data.share ? { ...data.share, config: normalizeShareConfig(data.share.config) } : null,
  }
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

/**
 * Normalise une URL saisie par l'utilisateur. Si elle n'a pas de protocole
 * (cas typique : "google.com" au lieu de "https://google.com"), on préfixe
 * avec `https://` — sinon le navigateur l'interprète comme un chemin relatif
 * et le bouton emmène le client sur /share/livrables/google.com au lieu
 * de google.com.
 *
 * Les protocoles déjà présents (http, https, mailto, tel, ftp…) sont
 * conservés tels quels.
 */
export function normalizeExternalUrl(url) {
  if (!url) return ''
  const trimmed = String(url).trim()
  if (!trimmed) return ''
  // Détection de protocole RFC-style : commence par une lettre, suivie de
  // lettres/chiffres/`+`/`-`/`.`, puis `:`. Match http:, https:, mailto:,
  // tel:, ftp:, git+ssh:, etc.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  // Pas de protocole → on préfixe en https par défaut.
  return `https://${trimmed}`
}
