// ════════════════════════════════════════════════════════════════════════════
// deezer-search — Edge Function : recherche Deezer (Module Musiques MVP1)
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.3
//
// PIVOT depuis Spotify (originalement prévu) suite aux restrictions Spotify
// de Nov 2024 + Fév 2026 :
//   - preview_url retiré des réponses pour les nouvelles apps
//   - audio-features endpoint = 403 pour les nouvelles apps
//   - Spotify Premium requis pour le owner de l'app
//   - 5 users max en Dev Mode
//
// Deezer offre la même valeur métier pour Captiv :
//   - API publique sans auth pour search + track
//   - preview 30s public (mp3 sans pub, CDN deezer)
//   - BPM via /track/{id} (champ `bpm`)
//   - Catalogue solide pour le marché FR + électro + festival
//
// ─── API ─────────────────────────────────────────────────────────────────────
//
// Deux actions via query param `action` :
//
//   GET /deezer-search?action=search&q=...&limit=10
//     → { tracks: [{ deezer_id, title, artist, artist_id, album,
//                    cover_small, cover_medium, cover_large,
//                    duration_sec, preview_url, rank, explicit,
//                    deezer_url }] }
//
//   GET /deezer-search?action=track&id=12345
//     → { track: { ...search fields, bpm, gain, release_date,
//                  isrc, contributors[] } }
//
// La séparation search / track permet d'économiser les appels Deezer :
//   - search renvoie 10 candidats SANS BPM (1 call Deezer)
//   - au moment où l'utilisateur clique "Ajouter", on appelle track
//     pour récupérer BPM + détails (1 call Deezer)
//
// ─── Auth ────────────────────────────────────────────────────────────────────
//
// On exige un JWT Supabase pour empêcher l'abus public (rate-limiting auto
// par user). Deezer côté backend ne demande pas d'auth, mais on protège
// notre endpoint pour éviter qu'on devienne un proxy public gratuit.
//
// ─── Erreurs ─────────────────────────────────────────────────────────────────
//
// 400 → q manquant ou action invalide
// 401 → JWT manquant ou invalide
// 502 → erreur Deezer (downstream)
// 500 → erreur interne
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { corsHeaders } from '../_shared/cors.ts'

// ─── Configuration ────────────────────────────────────────────────────────
const DEEZER_API_BASE = 'https://api.deezer.com'
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25

// Réponse Deezer track brute (champs utilisés)
interface DeezerTrack {
  id: number
  title: string
  title_short: string
  link: string
  duration: number
  rank: number
  explicit_lyrics: boolean
  preview: string
  artist: {
    id: number
    name: string
    picture_medium?: string
  }
  album: {
    id: number
    title: string
    cover_small: string
    cover_medium: string
    cover_xl: string
  }
  // Champs présents uniquement sur /track/{id} (pas dans search)
  bpm?: number
  gain?: number
  release_date?: string
  isrc?: string
  contributors?: Array<{ id: number; name: string; role?: string }>
}

interface DeezerSearchResponse {
  data: DeezerTrack[]
  total: number
  next?: string
  error?: { type: string; message: string; code: number }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

/**
 * Normalise un track Deezer (search OU track) au format Captiv. Inclut
 * tous les champs sauf BPM (vide en mode search, rempli en mode track).
 */
function normalizeTrack(t: DeezerTrack) {
  return {
    deezer_id: String(t.id),
    deezer_url: t.link,
    title: t.title,
    title_short: t.title_short,
    artist: t.artist?.name || '',
    artist_id: t.artist ? String(t.artist.id) : null,
    artist_picture: t.artist?.picture_medium || null,
    album: t.album?.title || '',
    album_id: t.album ? String(t.album.id) : null,
    cover_small: t.album?.cover_small || null,
    cover_medium: t.album?.cover_medium || null,
    cover_large: t.album?.cover_xl || null,
    duration_sec: t.duration,
    preview_url: t.preview || null,
    rank: t.rank,
    explicit: Boolean(t.explicit_lyrics),
    // Champs présents seulement sur /track/{id}
    bpm: t.bpm ?? null,
    gain: t.gain ?? null,
    release_date: t.release_date ?? null,
    isrc: t.isrc ?? null,
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  // OPTIONS = preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed (GET requis)' })
  }

  const startedAt = Date.now()

  try {
    // ─── Auth (JWT Supabase obligatoire) ────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse(401, { error: 'Authorization header manquant' })
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) {
      return jsonResponse(401, { error: 'JWT manquant' })
    }

    // Vérification du JWT côté Supabase (validation user existe).
    // On ne stocke pas l'user dans une table — Deezer n'a pas besoin de
    // savoir qui appelle, c'est juste un anti-abus.
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: userResult, error: userErr } = await supa.auth.getUser()
    if (userErr || !userResult?.user) {
      return jsonResponse(401, { error: 'JWT invalide' })
    }
    const callerId = userResult.user.id

    // ─── Parsing query ──────────────────────────────────────────────────────
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'search'

    // ════════════════════════════════════════════════════════════════════
    // Mode SEARCH : liste de tracks pour la barre de recherche unifiée
    // ════════════════════════════════════════════════════════════════════
    if (action === 'search') {
      const q = url.searchParams.get('q')?.trim() || ''
      if (!q) {
        return jsonResponse(400, { error: 'paramètre q requis' })
      }
      const limitParam = parseInt(url.searchParams.get('limit') || '', 10)
      const limit =
        Number.isFinite(limitParam) && limitParam > 0
          ? Math.min(limitParam, MAX_LIMIT)
          : DEFAULT_LIMIT

      const deezerUrl = `${DEEZER_API_BASE}/search?q=${encodeURIComponent(
        q,
      )}&limit=${limit}`
      const res = await fetch(deezerUrl)
      if (!res.ok) {
        return jsonResponse(502, {
          error: `Deezer search failed (HTTP ${res.status})`,
        })
      }
      const data = (await res.json()) as DeezerSearchResponse
      if (data.error) {
        return jsonResponse(502, {
          error: `Deezer error : ${data.error.message}`,
        })
      }

      const tracks = (data.data || []).map(normalizeTrack)
      const durationMs = Date.now() - startedAt
      console.log(
        `[deezer-search] user=${callerId} q="${q}" hits=${tracks.length} duration=${durationMs}ms`,
      )

      return jsonResponse(200, {
        tracks,
        total: data.total ?? tracks.length,
        query: q,
      })
    }

    // ════════════════════════════════════════════════════════════════════
    // Mode TRACK : détails complets d'un track (BPM, release_date, …)
    // ════════════════════════════════════════════════════════════════════
    if (action === 'track') {
      const id = url.searchParams.get('id')?.trim() || ''
      if (!id) {
        return jsonResponse(400, { error: 'paramètre id requis' })
      }
      if (!/^\d+$/.test(id)) {
        return jsonResponse(400, { error: 'id doit être un nombre Deezer' })
      }
      const deezerUrl = `${DEEZER_API_BASE}/track/${id}`
      const res = await fetch(deezerUrl)
      if (!res.ok) {
        return jsonResponse(502, {
          error: `Deezer track failed (HTTP ${res.status})`,
        })
      }
      const t = (await res.json()) as DeezerTrack & {
        error?: { type: string; message: string; code: number }
      }
      if ('error' in t && t.error) {
        return jsonResponse(404, { error: 'Track Deezer introuvable' })
      }

      const track = normalizeTrack(t)
      const durationMs = Date.now() - startedAt
      console.log(
        `[deezer-search] user=${callerId} action=track id=${id} bpm=${track.bpm} duration=${durationMs}ms`,
      )

      return jsonResponse(200, { track })
    }

    return jsonResponse(400, {
      error: `action invalide : ${action} (attendu : search | track)`,
    })
  } catch (err) {
    const durationMs = Date.now() - startedAt
    console.error(
      `[deezer-search] FAILED duration=${durationMs}ms`,
      err,
    )
    return jsonResponse(500, {
      error: 'Erreur interne',
      details: err instanceof Error ? err.message : String(err),
    })
  }
})
