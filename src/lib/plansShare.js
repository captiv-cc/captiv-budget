/**
 * plansShare.js — Tokens de partage public plans (PLANS-SHARE).
 *
 * Permet d'exposer une vue READ-ONLY des plans techniques d'un projet à un
 * destinataire externe (technicien chantier, prestataire) via une URL
 * publique unique, sans authentification.
 *
 * Côté admin (auth) : CRUD des tokens via supabase client (RLS scoped).
 * Côté client (anon) : fetch payload via RPC SECURITY DEFINER + génération
 * des signed URLs des fichiers Storage côté client (la RPC ne signe pas
 * directement — pattern Captiv aligné sur MAT-10).
 *
 * Pattern aligné sur matosShare.js / equipeShare.js / livrableShare.js.
 *
 * Voir supabase/migrations/20260504_plans_share_tokens.sql.
 */

import { supabase } from './supabase'

const TOKEN_BYTES = 24 // 24 bytes → 32 chars base64url
const BUCKET = 'plans'
const SIGNED_URL_TTL_SEC = 10 * 60 // 10 minutes — renewé à chaque refresh

/* ─── Constantes scope ───────────────────────────────────────────────────── */

export const SHARE_SCOPES = Object.freeze({
  ALL: 'all',
  SELECTION: 'selection',
})

/* ─── Génération token ──────────────────────────────────────────────────── */

export function generateShareToken() {
  const cryptoObj = globalThis.crypto
  if (!cryptoObj?.getRandomValues) {
    throw new Error(
      'WebCrypto indisponible : impossible de générer un token de partage sécurisé',
    )
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
 * URL publique d'un token de partage plans.
 * Format : `<origin>/share/plans/:token`.
 */
export function buildShareUrl(token) {
  const path = `/share/plans/${encodeURIComponent(token)}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return path
}

/* ─── CRUD admin ────────────────────────────────────────────────────────── */

const TOKEN_COLS =
  'id, project_id, token, label, scope, selected_plan_ids, show_versions, ' +
  'created_by, created_at, revoked_at, expires_at, view_count, last_accessed_at'

export async function listPlansShareTokens({ projectId, includeRevoked = true } = {}) {
  if (!projectId) throw new Error('listPlansShareTokens : projectId requis')
  let query = supabase
    .from('plans_share_tokens')
    .select(TOKEN_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (!includeRevoked) query = query.is('revoked_at', null)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Crée un nouveau token plans.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.label]                — Libellé interne
 * @param {'all'|'selection'} [params.scope]      — 'all' (default) ou 'selection'
 * @param {string[]} [params.selectedPlanIds]     — UUIDs des plans (mode 'selection')
 * @param {boolean} [params.showVersions]         — Expose les versions historiques
 * @param {string|Date|null} [params.expiresAt]
 */
export async function createPlansShareToken({
  projectId,
  label = null,
  scope = SHARE_SCOPES.ALL,
  selectedPlanIds = [],
  showVersions = false,
  expiresAt = null,
} = {}) {
  if (!projectId) throw new Error('createPlansShareToken : projectId requis')
  if (![SHARE_SCOPES.ALL, SHARE_SCOPES.SELECTION].includes(scope)) {
    throw new Error(`createPlansShareToken : scope invalide (${scope})`)
  }
  if (scope === SHARE_SCOPES.SELECTION && (!Array.isArray(selectedPlanIds) || selectedPlanIds.length === 0)) {
    throw new Error('createPlansShareToken : selectedPlanIds requis en mode "selection"')
  }

  const token = generateShareToken()
  const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : null

  const payload = {
    project_id: projectId,
    token,
    label: label?.trim() || null,
    scope,
    // Toujours envoyer un array (pas null) pour matcher la colonne NOT NULL DEFAULT [].
    selected_plan_ids: scope === SHARE_SCOPES.SELECTION ? selectedPlanIds : [],
    show_versions: Boolean(showVersions),
    expires_at: expiresIso,
  }

  const { data, error } = await supabase
    .from('plans_share_tokens')
    .insert([payload])
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour un token (label, scope, sélection, show_versions, expiration).
 * Le token secret + project_id ne sont pas modifiables.
 */
export async function updatePlansShareToken(tokenId, fields = {}) {
  if (!tokenId) throw new Error('updatePlansShareToken : tokenId requis')
  const patch = {}
  if (fields.label !== undefined) patch.label = fields.label?.trim() || null
  if (fields.expiresAt !== undefined) {
    patch.expires_at = fields.expiresAt ? new Date(fields.expiresAt).toISOString() : null
  }
  if (fields.scope !== undefined) {
    if (![SHARE_SCOPES.ALL, SHARE_SCOPES.SELECTION].includes(fields.scope)) {
      throw new Error(`updatePlansShareToken : scope invalide (${fields.scope})`)
    }
    patch.scope = fields.scope
  }
  if (fields.selectedPlanIds !== undefined) {
    patch.selected_plan_ids = Array.isArray(fields.selectedPlanIds)
      ? fields.selectedPlanIds
      : []
  }
  if (fields.showVersions !== undefined) {
    patch.show_versions = Boolean(fields.showVersions)
  }
  if (Object.keys(patch).length === 0) return null

  const { data, error } = await supabase
    .from('plans_share_tokens')
    .update(patch)
    .eq('id', tokenId)
    .select(TOKEN_COLS)
    .single()
  if (error) throw error
  return data
}

export async function revokePlansShareToken(tokenId) {
  if (!tokenId) throw new Error('revokePlansShareToken : tokenId requis')
  const { error } = await supabase.rpc('revoke_plans_share_token', {
    p_token_id: tokenId,
  })
  if (error) throw error
}

export async function restorePlansShareToken(tokenId) {
  if (!tokenId) throw new Error('restorePlansShareToken : tokenId requis')
  const { error } = await supabase
    .from('plans_share_tokens')
    .update({ revoked_at: null })
    .eq('id', tokenId)
  if (error) throw error
}

export async function deletePlansShareToken(tokenId) {
  if (!tokenId) throw new Error('deletePlansShareToken : tokenId requis')
  const { error } = await supabase
    .from('plans_share_tokens')
    .delete()
    .eq('id', tokenId)
  if (error) throw error
}

/* ─── Fetch public (anon) ───────────────────────────────────────────────── */

/**
 * Génère une signed URL pour un path du bucket `plans`.
 * En mode anon, la policy storage `plans_storage_anon_share` autorise cet
 * appel tant qu'un token de share actif existe sur le projet correspondant.
 *
 * Retourne null si le path est falsy ou si la génération échoue (best-effort,
 * on ne casse pas le payload entier pour un fichier manquant).
 */
async function generateSignedUrl(path) {
  if (!path || path === 'pending') return null
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SEC)
    if (error) {
      console.warn('[plansShare] createSignedUrl error', path, error)
      return null
    }
    return data?.signedUrl || null
  } catch (err) {
    console.warn('[plansShare] createSignedUrl exception', path, err)
    return null
  }
}

/**
 * Enrichit le payload renvoyé par share_plans_fetch (ou
 * share_projet_plans_fetch — payload identique) avec les signed URLs
 * de chaque plan (fichier courant + thumbnail + versions historiques si
 * show_versions=true).
 *
 * Exportée pour réutilisation par lib/projectShare.fetchPlansPayload —
 * la sous-page plans du portail projet a besoin du même enrichissement.
 *
 * Toutes les générations sont parallélisées via Promise.all pour minimiser
 * la latence d'ouverture de la page (10-20 plans = 30-60 signed URLs en
 * parallèle, ~200ms typique).
 */
export async function enrichPlansPayloadWithSignedUrls(payload) {
  const plans = Array.isArray(payload?.plans) ? payload.plans : []
  if (plans.length === 0) return payload

  // Collecte tous les paths à signer en une seule passe (plan courant +
  // thumbnail + chaque version). On garde un index pour réinjecter ensuite.
  const tasks = []
  for (const plan of plans) {
    tasks.push(
      generateSignedUrl(plan.storage_path).then((url) => {
        plan.signed_url = url
      }),
    )
    if (plan.thumbnail_path) {
      tasks.push(
        generateSignedUrl(plan.thumbnail_path).then((url) => {
          plan.thumbnail_signed_url = url
        }),
      )
    } else {
      plan.thumbnail_signed_url = null
    }
    const versions = Array.isArray(plan.versions) ? plan.versions : []
    for (const version of versions) {
      tasks.push(
        generateSignedUrl(version.storage_path).then((url) => {
          version.signed_url = url
        }),
      )
    }
  }
  await Promise.all(tasks)
  return payload
}

/**
 * Récupère le payload du share plans + enrichit avec les signed URLs.
 *
 * Le payload retourné a la structure suivante :
 *   {
 *     share:        { label, scope, show_versions },
 *     project:      { id, title, ref_projet, cover_url },
 *     org:          { branding },
 *     categories:   [{ id, key, label, color, sort_order }],
 *     plans:        [{
 *       id, category_id, name, description, tags,
 *       storage_path, thumbnail_path, file_type, file_size,
 *       page_count, applicable_dates, current_version, sort_order,
 *       created_at,
 *       signed_url:           string | null,   ← AJOUTÉ ICI
 *       thumbnail_signed_url: string | null,   ← AJOUTÉ ICI
 *       versions: [{
 *         id, version_num, storage_path, file_type, file_size,
 *         page_count, comment, created_at,
 *         signed_url: string | null            ← AJOUTÉ ICI
 *       }]
 *     }],
 *     stats:        { total_plans },
 *     generated_at: timestamp
 *   }
 */
export async function fetchPlansSharePayload(token) {
  if (!token) throw new Error('fetchPlansSharePayload : token requis')
  const { data, error } = await supabase.rpc('share_plans_fetch', {
    p_token: token,
  })
  if (error) {
    console.error('[plansShare] share_plans_fetch error', error)
    throw error
  }
  if (!data) throw new Error('Token invalide ou expiré')
  return enrichPlansPayloadWithSignedUrls(data)
}

/* ─── Helpers de présentation ───────────────────────────────────────────── */

export function getPlansShareTokenState(token) {
  if (!token) return 'active'
  if (token.revoked_at) return 'revoked'
  if (token.expires_at && new Date(token.expires_at) <= new Date()) return 'expired'
  return 'active'
}

/**
 * Compte le nombre de plans concernés par un token (pour affichage admin).
 * Pour scope='selection', c'est la longueur de selected_plan_ids ; pour
 * scope='all', le caller doit déjà avoir le nombre total de plans non
 * archivés du projet (passé en arg) car on ne peut pas l'inférer du token.
 */
export function getPlansShareTokenScopeLabel(token, totalPlansCount = 0) {
  if (!token) return ''
  if (token.scope === SHARE_SCOPES.SELECTION) {
    const n = Array.isArray(token.selected_plan_ids) ? token.selected_plan_ids.length : 0
    return `${n} plan${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}`
  }
  return `Tous les plans${totalPlansCount ? ` (${totalPlansCount})` : ''}`
}
