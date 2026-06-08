// ════════════════════════════════════════════════════════════════════════════
// musiqueSearch.js — Client de la barre de recherche unifiée Musiques
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.3 (partie client)
//
// Wrapper haut-niveau pour la recherche musicale. Détection automatique
// du type d'input :
//   - URL YouTube → resolveFromUrl (lib/youtubeOEmbed)
//   - Texte libre → searchDeezer (Edge Function deezer-search)
//   - [Futur MVP5] Description naturelle → searchSmart (Claude + Deezer)
//
// La barre de recherche dans la modal AddProposition consomme ce module.
// Le composant ne sait pas quelle source il interroge — c'est la fonction
// resolveQuery() qui dispatche.
//
// API publique :
//   - searchDeezer(query, opts)      → { tracks }
//   - getDeezerTrack(deezerId)       → { track } (avec BPM, release_date, …)
//   - resolveYouTubeUrl(url)         → { video_id, video_title, artiste, titre, ... }
//   - resolveQuery(input)            → { kind: 'youtube'|'deezer'|'empty', ... }
//   - mapDeezerToProposition(track, opts) → payload pour createProposition
//
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import {
  isYouTubeUrl,
  resolveFromUrl,
} from './youtubeOEmbed'

// ─── Appel Edge Function deezer-search ─────────────────────────────────────

/**
 * Recherche sur Deezer via l'Edge Function. JWT auto-injecté.
 *
 * Note : on n'utilise pas supabase.functions.invoke() parce qu'il ne
 * supporte pas (ou mal selon les versions) les query params en GET.
 * On fait un fetch direct avec construction d'URL.
 *
 * @param {string} query Texte libre (artiste, titre, ou les deux)
 * @param {object} [opts]
 * @param {number} [opts.limit=10] Max 25
 * @returns {Promise<{ tracks: Array, total: number, query: string }>}
 */
export async function searchDeezer(query, opts = {}) {
  const q = (query || '').trim()
  if (!q) return { tracks: [], total: 0, query: '' }
  const limit = opts.limit || 10
  // Throw si infra KO. Le caller doit catch DeezerEdgeError pour
  // distinguer un vrai zéro résultat d'un problème d'infra.
  const result = await callDeezerEdge('search', { q, limit })
  return result || { tracks: [], total: 0, query: q }
}

/**
 * Récupère les détails d'un track Deezer (avec BPM, release_date, etc.)
 * Appelé au moment où l'utilisateur clique "Ajouter" sur un résultat
 * de recherche, pour économiser les appels Deezer pendant le typing.
 *
 * @param {string|number} deezerId
 * @returns {Promise<object|null>}
 */
export async function getDeezerTrack(deezerId) {
  const id = String(deezerId || '').trim()
  if (!id) return null
  const result = await callDeezerEdge('track', { id })
  return result?.track || null
}

/**
 * Erreur typée renvoyée par callDeezerEdge en cas de problème
 * d'infrastructure (vs Deezer qui renvoie 0 résultats légitimement).
 */
export class DeezerEdgeError extends Error {
  constructor(message, { code, status, body } = {}) {
    super(message)
    this.name = 'DeezerEdgeError'
    this.code = code
    this.status = status
    this.body = body
  }
}

/**
 * Appel direct à l'Edge Function avec query params GET.
 *
 * Throw DeezerEdgeError si problème d'infrastructure (function pas
 * déployée, JWT invalide, etc.). Renvoie le body JSON sinon — même
 * si tracks est vide (= 0 résultat légitime côté Deezer).
 */
async function callDeezerEdge(action, params) {
  const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || ''
  const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl) {
    throw new DeezerEdgeError(
      'VITE_SUPABASE_URL manquant — config front incomplète',
      { code: 'NO_SUPABASE_URL' },
    )
  }
  const url = new URL(
    `${supabaseUrl.replace(/\/$/, '')}/functions/v1/deezer-search`,
  )
  url.searchParams.set('action', action)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }
  // Auth : récupère le JWT courant
  const { data: sessionResult } = await supabase.auth.getSession()
  const accessToken = sessionResult?.session?.access_token
  if (!accessToken) {
    throw new DeezerEdgeError(
      'Non authentifié — reconnecte-toi pour utiliser la recherche',
      { code: 'NO_SESSION' },
    )
  }
  let res
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
      },
    })
  } catch (err) {
    throw new DeezerEdgeError(
      'Erreur réseau — vérifie ta connexion ou le déploiement Supabase',
      { code: 'NETWORK', body: err?.message },
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 404) {
      throw new DeezerEdgeError(
        "Edge Function 'deezer-search' non déployée — exécute `supabase functions deploy deezer-search`",
        { code: 'NOT_DEPLOYED', status: 404, body: text },
      )
    }
    if (res.status === 401) {
      throw new DeezerEdgeError(
        'JWT invalide — reconnecte-toi',
        { code: 'UNAUTHORIZED', status: 401, body: text },
      )
    }
    if (res.status === 502) {
      throw new DeezerEdgeError(
        'Deezer ne répond pas (502) — réessaie dans quelques secondes',
        { code: 'DEEZER_DOWN', status: 502, body: text },
      )
    }
    throw new DeezerEdgeError(
      `Edge Function HTTP ${res.status}`,
      { code: 'HTTP_ERROR', status: res.status, body: text },
    )
  }
  return await res.json()
}

// ─── Résolveur YouTube (proxy pour cohérence d'API) ────────────────────────

export async function resolveYouTubeUrl(url) {
  return resolveFromUrl(url)
}

// ─── Dispatcher principal ──────────────────────────────────────────────────

/**
 * Analyse l'input et appelle le bon résolveur. Renvoie un objet uniforme
 * pour la modal d'ajout de proposition.
 *
 * @param {string} input Saisie utilisateur (URL ou texte libre)
 * @returns {Promise<{ kind: 'youtube'|'deezer'|'empty', ...details }>}
 */
export async function resolveQuery(input) {
  const text = (input || '').trim()
  if (!text) return { kind: 'empty' }
  if (isYouTubeUrl(text)) {
    const data = await resolveYouTubeUrl(text)
    if (!data) {
      return {
        kind: 'youtube',
        error: 'URL YouTube invalide ou vidéo inaccessible',
      }
    }
    return { kind: 'youtube', ...data }
  }
  // Sinon = texte libre Deezer. On catch DeezerEdgeError pour pouvoir
  // distinguer côté UI un vrai zéro résultat d'un problème d'infra.
  try {
    const data = await searchDeezer(text, { limit: 10 })
    return { kind: 'deezer', ...(data || { tracks: [], total: 0 }) }
  } catch (err) {
    if (err instanceof DeezerEdgeError) {
      return {
        kind: 'error',
        error: err.message,
        code: err.code,
        status: err.status,
      }
    }
    return {
      kind: 'error',
      error: err?.message || 'Erreur de recherche Deezer',
    }
  }
}

// ─── YouTube auto-find (post-création) ────────────────────────────────────

/**
 * Cherche automatiquement la vidéo YouTube correspondant à un track
 * via l'Edge Function youtube-search. Renvoie null si rien trouvé.
 *
 * @param {string} artist
 * @param {string} title
 * @returns {Promise<{ video_id, video_url, thumbnail_url, channel } | null>}
 */
export async function findYouTubeForTrack(artist, title) {
  const a = (artist || '').trim()
  const t = (title || '').trim()
  if (!a && !t) return null
  const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || ''
  const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl) return null
  const url = new URL(
    `${supabaseUrl.replace(/\/$/, '')}/functions/v1/youtube-search`,
  )
  url.searchParams.set('q', `${a} ${t}`.trim())
  const { data: sessionResult } = await supabase.auth.getSession()
  const accessToken = sessionResult?.session?.access_token
  if (!accessToken) return null
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
      },
    })
    if (!res.ok) {
      // Quota dépassé ou Edge Function pas déployée — silencieux
      return null
    }
    const data = await res.json()
    return data?.match || null
  } catch (err) {
    console.warn('[findYouTubeForTrack] failed', err)
    return null
  }
}

// ─── Mappers : track Deezer → payload createProposition ────────────────────

/**
 * Convertit un track Deezer normalisé en payload pour
 * createProposition (lib/musiques). Gère audio_features partiel
 * (BPM seul, le reste null) pour matcher la shape JSONB attendue.
 *
 * @param {object} track Track normalisé par l'Edge Function
 * @param {object} [opts]
 * @param {string|null} [opts.artiste_id] Si l'artiste a été matché dans
 *   l'annuaire, son id ; sinon null et l'artiste_text est utilisé.
 * @returns {object} Payload prêt pour createProposition
 */
export function mapDeezerToProposition(track, opts = {}) {
  if (!track) throw new Error('track requis')
  const audio_features = {
    // Schema Deezer : BPM (autres champs absents)
    tempo: track.bpm ?? null,
    // gain ≈ loudness (en dB côté Deezer, normalisable)
    loudness: track.gain ?? null,
    // Champs Spotify non disponibles côté Deezer mais on les expose à null
    // pour matcher la shape attendue par la UI (filtres BPM/énergie futurs).
    energy: null,
    danceability: null,
    valence: null,
    key: null,
    acousticness: null,
    instrumentalness: null,
    liveness: null,
    speechiness: null,
    source: 'deezer', // permet de tracer la provenance des audio_features
  }
  return {
    artiste_id: opts.artiste_id || null,
    artiste_text: opts.artiste_id ? null : track.artist,
    titre: track.title,
    // Deezer fournit deezer_url ; on l'expose sur spotify_url (champ générique
    // "url canonique du provider") + on garde deezer_id en spotify_id pour
    // simplifier le schéma BDD (rename éventuel plus tard). Le champ a un nom
    // historique "spotify_id" mais sa sémantique est "external_track_id".
    // TODO MVP2 : renommer les colonnes en provider_track_id + provider_url
    // pour neutraliser le naming.
    spotify_id: track.deezer_id,
    spotify_url: track.deezer_url,
    preview_url: track.preview_url || null,
    cover_url: track.cover_medium || track.cover_large || null,
    duration_ms: (track.duration_sec || 0) * 1000,
    audio_features,
  }
}
