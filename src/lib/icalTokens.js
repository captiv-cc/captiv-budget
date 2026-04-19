/**
 * icalTokens.js — CRUD et helpers pour les tokens d'abonnement iCal (PL-8 v1).
 *
 * Les tokens sont consommés par l'edge function `ical-feed` qui sert un corpus
 * iCalendar au client (Google Calendar, Apple, Outlook…). Le token lui-même
 * est un secret opaque ~32 chars base64url, généré CÔTÉ CLIENT via
 * crypto.getRandomValues pour ne jamais transiter en clair depuis le serveur.
 *
 * Deux scopes :
 *   - 'project' : exporte tous les events d'un projet.
 *   - 'my'      : exporte tous les events où le user est assigné (cross-projets).
 *
 * Voir supabase/migrations/20260419_ical_tokens_pl8.sql pour la shape DB.
 */

import { supabase } from './supabase'

const TOKEN_BYTES = 24 // 24 bytes → 32 chars en base64url — suffisant cryptographiquement

/* ─── Génération token ──────────────────────────────────────────────────── */

/**
 * Génère un nouveau secret token (~32 chars base64url) avec crypto.getRandomValues.
 * Lève une erreur si l'environnement ne supporte pas WebCrypto (très rare).
 */
export function generateIcalToken() {
  const cryptoObj = globalThis.crypto
  if (!cryptoObj?.getRandomValues) {
    throw new Error('WebCrypto indisponible : impossible de générer un token iCal sécurisé')
  }
  const bytes = new Uint8Array(TOKEN_BYTES)
  cryptoObj.getRandomValues(bytes)
  return base64urlEncode(bytes)
}

function base64urlEncode(bytes) {
  // btoa accepte une string binaire ; on passe par String.fromCharCode
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/* ─── Feed URL ─────────────────────────────────────────────────────────── */

/**
 * Construit l'URL publique du feed iCal pour un token.
 * Retourne aussi bien un `https://…` cliquable qu'une variante `webcal://`
 * (plus ergonomique sur Apple Calendar qui ouvre l'app au clic).
 */
export function buildFeedUrl(token) {
  const base = import.meta.env?.VITE_SUPABASE_URL?.replace(/\/$/, '') || ''
  const httpsUrl = `${base}/functions/v1/ical-feed?token=${encodeURIComponent(token)}`
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://')
  return { httpsUrl, webcalUrl }
}


/* ─── CRUD ical_tokens ──────────────────────────────────────────────────── */

/**
 * Liste les tokens visibles par le user courant pour un scope donné.
 *   - scope='project' : tokens du projet (tous les membres org peuvent les voir)
 *   - scope='my'      : tokens personnels du user
 *
 * Les tokens révoqués sont inclus par défaut avec `includeRevoked=true` pour
 * l'audit ; passer `false` pour ne voir que les liens actifs.
 */
export async function listIcalTokens({ projectId = null, userId = null, includeRevoked = true } = {}) {
  let query = supabase
    .from('ical_tokens')
    .select('id, token, org_id, project_id, user_id, label, created_by, created_at, revoked_at, last_accessed_at')
    .order('created_at', { ascending: false })

  if (projectId) {
    query = query.eq('project_id', projectId)
  } else if (userId) {
    query = query.eq('user_id', userId)
  } else {
    throw new Error('listIcalTokens : projectId ou userId requis')
  }
  if (!includeRevoked) {
    query = query.is('revoked_at', null)
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Crée un nouveau token iCal. `scope` est dérivé des clés passées :
 *   - createIcalToken({ projectId, label })  → scope 'project'
 *   - createIcalToken({ userId, label })     → scope 'my'
 *
 * Le token secret est généré localement (crypto) ; le serveur ne reçoit
 * que le résultat final.
 */
export async function createIcalToken({ projectId = null, userId = null, label = null, orgId }) {
  if (!orgId) throw new Error('createIcalToken : orgId requis')
  if ((projectId && userId) || (!projectId && !userId)) {
    throw new Error("createIcalToken : exactement l'un de projectId ou userId doit être fourni")
  }

  const token = generateIcalToken()
  const payload = {
    token,
    org_id: orgId,
    project_id: projectId,
    user_id: userId,
    label: label?.trim() || null,
  }

  const { data, error } = await supabase
    .from('ical_tokens')
    .insert([payload])
    .select('id, token, org_id, project_id, user_id, label, created_by, created_at, revoked_at, last_accessed_at')
    .single()

  if (error) throw error
  return data
}

/**
 * Révoque un token (soft : on set `revoked_at`, la ligne reste pour l'audit).
 * Idempotent : réappeler ne re-touche pas la date si déjà révoqué.
 */
export async function revokeIcalToken(tokenId) {
  // On appelle le helper PL/pgSQL côté DB pour garder l'intention explicite.
  const { error } = await supabase.rpc('revoke_ical_token', { p_token_id: tokenId })
  if (error) throw error
}

/**
 * Restaure un token précédemment révoqué (efface revoked_at).
 * Utile si l'utilisateur révoque par erreur. La RLS laisse faire tant que
 * le scope est respecté (propriétaire du 'my' ou membre org pour 'project').
 */
export async function restoreIcalToken(tokenId) {
  const { error } = await supabase
    .from('ical_tokens')
    .update({ revoked_at: null })
    .eq('id', tokenId)
  if (error) throw error
}

/** Rename un token (édition du label, utile après coup). */
export async function renameIcalToken(tokenId, newLabel) {
  const { error } = await supabase
    .from('ical_tokens')
    .update({ label: (newLabel || '').trim() || null })
    .eq('id', tokenId)
  if (error) throw error
}
