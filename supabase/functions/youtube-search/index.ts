// ════════════════════════════════════════════════════════════════════════════
// youtube-search — Edge Function : recherche YouTube auto-find
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1.5 — MUS-2.3
//
// Quand une proposition est créée via Deezer ou en saisie manuelle, on
// veut compléter automatiquement le lien YouTube. Cette Edge Function
// fait la recherche pour le client, avec auth JWT (anti-abus).
//
// API :
//   GET /youtube-search?q=ARTIST+TITLE
//
//   Renvoie :
//   {
//     match: {
//       video_id: string,
//       video_url: string,
//       thumbnail_url: string,
//       channel: string,
//       title: string,
//     } | null
//   }
//
// ─── Provider primaire : YouTube Data API v3 ────────────────────────────────
//
// Free tier : 10 000 quota units/day. Search = 100 units/call.
// = ~100 recherches/jour. Largement suffisant pour le vrac d'un festival.
//
// Secret requis : YOUTUBE_API_KEY
//   supabase secrets set YOUTUBE_API_KEY=AIzaSy...
//
// ─── Fallback : Piped instance publique ─────────────────────────────────────
//
// Si pas de clé YouTube ou quota dépassé, on tente Piped (open source
// YouTube frontend) qui expose une API JSON publique. Latence variable
// mais bon backup gratuit.
//
// ─── Renvoie null en silence si tout échoue ────────────────────────────────
//
// Le client (findYouTubeForTrack) traite null comme "pas trouvé, on
// passe". Pas d'erreur affichée à l'utilisateur (auto-find = best effort).
//
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { corsHeaders } from '../_shared/cors.ts'

// @ts-ignore - Deno global
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Promise<Response>) => void
}

const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3/search'
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api-piped.mha.fi',
]

interface YouTubeMatch {
  video_id: string
  video_url: string
  thumbnail_url: string
  channel: string
  title: string
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

// ─── Provider primaire : YouTube Data API v3 ────────────────────────────────

async function searchViaYouTubeAPI(
  q: string,
  apiKey: string,
): Promise<YouTubeMatch | null> {
  const url = new URL(YOUTUBE_API_URL)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('q', q)
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('type', 'video')
  url.searchParams.set('maxResults', '1')
  url.searchParams.set('videoEmbeddable', 'true')
  // On préfère les vidéos officielles (musiques) — pas obligatoire mais
  // tend à remonter les vraies versions vs les uploads aléatoires.
  url.searchParams.set('videoCategoryId', '10') // Music
  const res = await fetch(url.toString())
  if (!res.ok) {
    if (res.status === 403) {
      // Quota dépassé ou clé invalide
      console.warn('[youtube-search] YouTube API quota dépassé ou clé KO')
      return null
    }
    console.warn(`[youtube-search] YouTube API HTTP ${res.status}`)
    return null
  }
  const data = await res.json()
  const item = data?.items?.[0]
  if (!item?.id?.videoId) return null
  return {
    video_id: item.id.videoId,
    video_url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    thumbnail_url:
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.default?.url ||
      '',
    channel: item.snippet?.channelTitle || '',
    title: item.snippet?.title || '',
  }
}

// ─── Fallback : Piped (open source YT frontend) ─────────────────────────────

async function searchViaPiped(q: string): Promise<YouTubeMatch | null> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const url = new URL(`${instance}/search`)
      url.searchParams.set('q', q)
      url.searchParams.set('filter', 'music_songs')
      // Timeout fetch via AbortController (sinon Piped peut bloquer 30s)
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch(url.toString(), { signal: ctrl.signal })
      clearTimeout(tid)
      if (!res.ok) continue
      const data = await res.json()
      const items = data?.items || []
      // Piped renvoie soit des "stream" (videos) soit des "playlist".
      // On veut un stream.
      const item = items.find(
        (x: { type?: string; url?: string }) =>
          x?.type === 'stream' && typeof x.url === 'string',
      )
      if (!item) continue
      // url Piped : "/watch?v=XXXX"
      const m = item.url.match(/v=([a-zA-Z0-9_-]{11})/)
      if (!m) continue
      const videoId = m[1]
      return {
        video_id: videoId,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail_url: item.thumbnail || '',
        channel: item.uploaderName || '',
        title: item.title || '',
      }
    } catch (e) {
      console.warn(`[youtube-search] Piped instance ${instance} KO`, e)
      // Try next instance
    }
  }
  return null
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const startedAt = Date.now()

  try {
    // ─── Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse(401, { error: 'Authorization manquant' })
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return jsonResponse(401, { error: 'JWT manquant' })

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
    const q = url.searchParams.get('q')?.trim() || ''
    if (!q) return jsonResponse(400, { error: 'paramètre q requis' })

    // ─── Tentative YouTube Data API ─────────────────────────────────────────
    const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY')
    let match: YouTubeMatch | null = null
    let source = ''
    if (YOUTUBE_API_KEY) {
      match = await searchViaYouTubeAPI(q, YOUTUBE_API_KEY)
      if (match) source = 'youtube-api'
    }

    // ─── Fallback Piped ─────────────────────────────────────────────────────
    if (!match) {
      match = await searchViaPiped(q)
      if (match) source = 'piped'
    }

    const durationMs = Date.now() - startedAt
    console.log(
      `[youtube-search] user=${callerId} q="${q}" source=${source || 'none'} found=${Boolean(match)} duration=${durationMs}ms`,
    )

    return jsonResponse(200, { match, source: source || null })
  } catch (err) {
    console.error('[youtube-search] FAILED', err)
    return jsonResponse(500, {
      error: 'Erreur interne',
      details: err instanceof Error ? err.message : String(err),
    })
  }
})
