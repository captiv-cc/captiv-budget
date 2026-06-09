// ════════════════════════════════════════════════════════════════════════════
// og-fetch — Edge Function : résolution metadata d'une URL externe
// ════════════════════════════════════════════════════════════════════════════
//
// Module Moodboard MOD-1.2
//
// Quand un user paste une URL dans le Moodboard, on appelle cette fonction
// pour récupérer :
//   - title : titre de la page / vidéo
//   - description : description courte (optionnel)
//   - image_url : hero image (og:image, vignette vidéo, ...)
//   - provider : 'youtube' | 'tiktok' | 'vimeo' | 'twitter' | 'instagram' | null
//   - oembed_html : HTML d'embed officiel si dispo (providers connus uniquement)
//
// Stratégie :
//   1. Détection du provider via regex sur l'URL
//   2. Si provider connu → appel oEmbed officiel
//      - YouTube  : https://www.youtube.com/oembed?url=...
//      - TikTok   : https://www.tiktok.com/oembed?url=...
//      - Vimeo    : https://vimeo.com/api/oembed.json?url=...
//      - Twitter  : https://publish.twitter.com/oembed?url=...
//      - Instagram: pas d'oEmbed public → fallback OG tags
//   3. Si pas de provider connu OU oEmbed KO → fetch HTML + parse OG tags
//   4. Fallback ultime : { title: url, image_url: null, ... }
//
// Sécurité :
//   - JWT requis (anti-abus → un user authentifié)
//   - Timeout 8s sur chaque fetch
//   - oembed_html n'est retourné QUE pour les providers connus officiels.
//     Les sites tiers ne sont pas embedables (on ne fait pas confiance au
//     HTML d'un site random) — le front affichera juste image + titre.
//   - Côté front : DOMPurify avant injection oembed_html dans le DOM
//
// API :
//   POST /og-fetch
//   Body : { "url": "https://..." }
//
//   Renvoie (toujours 200, best-effort) :
//   {
//     url: string,
//     title: string,
//     description: string | null,
//     image_url: string | null,
//     provider: 'youtube'|'tiktok'|'vimeo'|'twitter'|'instagram'|null,
//     oembed_html: string | null,
//     source: 'oembed'|'og'|'fallback'
//   }
//
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { corsHeaders } from '../_shared/cors.ts'

// @ts-ignore - Deno global
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Promise<Response>) => void
}

const FETCH_TIMEOUT_MS = 8000
const USER_AGENT =
  'Mozilla/5.0 (compatible; CaptivMoodboard/1.0; +https://captiv.cc)'

type Provider =
  | 'youtube'
  | 'tiktok'
  | 'vimeo'
  | 'twitter'
  | 'instagram'
  | null

interface OgFetchResult {
  url: string
  title: string
  description: string | null
  image_url: string | null
  provider: Provider
  oembed_html: string | null
  source: 'oembed' | 'og' | 'fallback'
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ─── Provider detection ─────────────────────────────────────────────────────

function detectProvider(url: string): Provider {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
    return 'youtube'
  }
  if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host.endsWith('.tiktok.com')) {
    return 'tiktok'
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    return 'vimeo'
  }
  if (host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com') {
    return 'twitter'
  }
  if (host === 'instagram.com' || host === 'instagr.am' || host.endsWith('.instagram.com')) {
    return 'instagram'
  }
  return null
}

// ─── Fetch with timeout ─────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        ...(init.headers || {}),
      },
    })
  } finally {
    clearTimeout(tid)
  }
}

// ─── Embed direct via URL /embed/ (Instagram + TikTok) ─────────────────────
//
// Pour Instagram et TikTok, l'oEmbed officiel est inaccessible sans token
// (IG Business token requis) ou retourne du HTML avec scripts (blockquote +
// widgets.js) qui ne s'exécutent pas via dangerouslySetInnerHTML côté front.
//
// Les deux providers exposent en revanche des URLs d'embed directes qui
// rendent un iframe interactif SANS auth :
//   - Instagram : https://www.instagram.com/p/SHORTCODE/embed/captioned/
//                 Marche aussi avec /reel/SHORTCODE et /tv/SHORTCODE
//   - TikTok    : https://www.tiktok.com/embed/v2/VIDEO_ID
//
// On extrait l'ID de l'URL et on construit l'iframe nous-mêmes.
//
// Renvoie { oembed_html, title? } ou null si l'URL ne match pas le pattern.
function buildDirectEmbed(
  provider: Provider,
  targetUrl: string,
): { oembed_html: string; title?: string } | null {
  if (provider === 'instagram') {
    // Patterns Instagram (le 1er match l'emporte) :
    //   /p/SHORTCODE/        : post classique
    //   /reel/SHORTCODE/     : reel (singulier — partage iOS)
    //   /reels/SHORTCODE/    : reel (pluriel — partage web)
    //   /tv/SHORTCODE/       : IGTV
    const m = targetUrl.match(
      /instagram\.com\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/,
    )
    if (!m) return null
    const shortcode = m[1]
    // On utilise le blockquote officiel d'Instagram (PAS l'iframe direct
    // qui a une hauteur fixe inadaptée aux différents formats). Le script
    // embed.js d'Instagram, chargé côté front, transformera ce blockquote
    // en iframe dont la hauteur s'auto-ajuste au contenu (caption +
    // likes + commentaires).
    const permalink = `https://www.instagram.com/p/${shortcode}/`
    const oembed_html =
      `<blockquote class="instagram-media" data-instgrm-captioned ` +
      `data-instgrm-permalink="${permalink}" data-instgrm-version="14" ` +
      `style="background:#FFF;border:0;border-radius:3px;` +
      `box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15);` +
      `margin:1px;max-width:540px;min-width:326px;padding:0;width:99.375%;"></blockquote>`
    return { oembed_html }
  }
  if (provider === 'tiktok') {
    // URL canonique : tiktok.com/@user/video/VIDEO_ID
    // Fallback : ID dans l'URL vm.tiktok.com (raccourci) — non géré ici
    const m = targetUrl.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/)
    if (!m) return null
    const videoId = m[1]
    // Pareil qu'Instagram : on utilise le blockquote officiel TikTok. Le
    // script embed.js de TikTok transformera le blockquote en iframe
    // dont la hauteur s'auto-ajuste.
    const oembed_html =
      `<blockquote class="tiktok-embed" cite="${targetUrl}" ` +
      `data-video-id="${videoId}" ` +
      `style="max-width:605px;min-width:325px;">` +
      `<section></section></blockquote>`
    return { oembed_html }
  }
  return null
}

// ─── oEmbed officiel (providers connus) ─────────────────────────────────────

interface OembedResponse {
  title?: string
  author_name?: string
  thumbnail_url?: string
  html?: string
  description?: string
  provider_name?: string
}

async function fetchOembed(
  provider: Provider,
  targetUrl: string,
): Promise<OembedResponse | null> {
  if (!provider) return null

  let endpoint: string | null = null
  const encoded = encodeURIComponent(targetUrl)

  switch (provider) {
    case 'youtube':
      endpoint = `https://www.youtube.com/oembed?url=${encoded}&format=json`
      break
    case 'tiktok':
      endpoint = `https://www.tiktok.com/oembed?url=${encoded}`
      break
    case 'vimeo':
      endpoint = `https://vimeo.com/api/oembed.json?url=${encoded}`
      break
    case 'twitter':
      // publish.twitter.com supporte twitter.com + x.com via le param URL
      endpoint = `https://publish.twitter.com/oembed?url=${encoded}&omit_script=true`
      break
    case 'instagram':
      // Pas d'oEmbed public sans token IG Business → on saute
      return null
    default:
      return null
  }

  try {
    const res = await fetchWithTimeout(endpoint, { method: 'GET' })
    if (!res.ok) {
      console.warn(`[og-fetch] oEmbed ${provider} HTTP ${res.status}`)
      return null
    }
    return (await res.json()) as OembedResponse
  } catch (e) {
    console.warn(`[og-fetch] oEmbed ${provider} fetch KO`, e)
    return null
  }
}

// ─── OG tags scraping (fallback générique) ──────────────────────────────────

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

/**
 * Parse les meta tags d'une page HTML pour extraire OG + fallback standards.
 * On limite la lecture à 256 Ko (le `<head>` rentre largement dedans pour
 * 99% des sites — pas besoin de tout télécharger).
 */
async function scrapeOgTags(targetUrl: string): Promise<{
  title: string | null
  description: string | null
  image_url: string | null
} | null> {
  let res: Response
  try {
    res = await fetchWithTimeout(targetUrl)
  } catch (e) {
    console.warn('[og-fetch] HTML fetch KO', e)
    return null
  }
  if (!res.ok) {
    console.warn(`[og-fetch] HTML fetch HTTP ${res.status}`)
    return null
  }
  const ct = res.headers.get('content-type') || ''
  if (!ct.toLowerCase().includes('html')) {
    // Ce n'est pas une page HTML (PDF, image directe, ...) — on ne scrape pas
    return null
  }

  // Lecture limitée (head suffit pour OG tags). On stream et coupe.
  const reader = res.body?.getReader()
  if (!reader) return null
  let html = ''
  const MAX_BYTES = 256 * 1024
  let received = 0
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    html += decoder.decode(value, { stream: true })
    if (received >= MAX_BYTES) {
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
      break
    }
    // Couper dès qu'on a passé </head> — c'est tout ce qu'on veut
    if (html.toLowerCase().includes('</head>')) break
  }
  html += decoder.decode()

  // Limite l'analyse au <head> si présent (sinon tout le HTML reçu)
  const headEnd = html.toLowerCase().indexOf('</head>')
  const headBlock = headEnd > 0 ? html.slice(0, headEnd) : html

  // Helpers : extrait un meta tag par property/name
  function metaContent(
    block: string,
    keyType: 'property' | 'name',
    key: string,
  ): string | null {
    // Tolère ordre property/content inversé + simple/double quote
    const re = new RegExp(
      `<meta\\s+(?:[^>]*?)${keyType}\\s*=\\s*["']${key}["'](?:[^>]*?)content\\s*=\\s*["']([^"']*)["'][^>]*?/?>`,
      'i',
    )
    const m1 = block.match(re)
    if (m1) return decodeHtmlEntities(m1[1])
    const re2 = new RegExp(
      `<meta\\s+(?:[^>]*?)content\\s*=\\s*["']([^"']*)["'](?:[^>]*?)${keyType}\\s*=\\s*["']${key}["'][^>]*?/?>`,
      'i',
    )
    const m2 = block.match(re2)
    if (m2) return decodeHtmlEntities(m2[1])
    return null
  }

  function fallbackTitle(block: string): string | null {
    const m = block.match(/<title[^>]*>([^<]*)<\/title>/i)
    if (m) return decodeHtmlEntities(m[1].trim())
    return null
  }

  // Résolution URL relative pour og:image (certains sites mettent "/img.png")
  function absolutize(u: string): string {
    try {
      return new URL(u, targetUrl).toString()
    } catch {
      return u
    }
  }

  const og_title = metaContent(headBlock, 'property', 'og:title')
  const og_description = metaContent(headBlock, 'property', 'og:description')
  const og_image = metaContent(headBlock, 'property', 'og:image')
  const tw_title = metaContent(headBlock, 'name', 'twitter:title')
  const tw_description = metaContent(headBlock, 'name', 'twitter:description')
  const tw_image = metaContent(headBlock, 'name', 'twitter:image')
  const std_description = metaContent(headBlock, 'name', 'description')

  const rawImage = (og_image && og_image.trim()) || (tw_image && tw_image.trim()) || null

  return {
    title: og_title || tw_title || fallbackTitle(headBlock),
    description: og_description || tw_description || std_description,
    image_url: rawImage ? absolutize(rawImage) : null,
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const startedAt = Date.now()

  try {
    // ─── Auth ────────────────────────────────────────────────────────────
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

    // ─── Parse body ──────────────────────────────────────────────────────
    let body: { url?: unknown }
    try {
      body = await req.json()
    } catch {
      return jsonResponse(400, { error: 'JSON invalide' })
    }
    const inputUrl =
      typeof body?.url === 'string' ? body.url.trim() : ''
    if (!inputUrl) {
      return jsonResponse(400, { error: 'paramètre url requis' })
    }

    // Validation URL basique
    let parsed: URL
    try {
      parsed = new URL(inputUrl)
    } catch {
      return jsonResponse(400, { error: 'URL invalide' })
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return jsonResponse(400, { error: 'Protocole non supporté' })
    }
    // Anti-SSRF basique : refuse localhost / IPs internes (Deno isolated mais
    // par précaution)
    const host = parsed.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.startsWith('172.16.') ||
      host.endsWith('.local')
    ) {
      return jsonResponse(400, { error: 'Host interdit' })
    }

    const url = parsed.toString()
    const provider = detectProvider(url)

    // ─── Tentative oEmbed officiel ──────────────────────────────────────
    let result: OgFetchResult = {
      url,
      title: url,
      description: null,
      image_url: null,
      provider,
      oembed_html: null,
      source: 'fallback',
    }

    if (provider) {
      // 1. Priorité aux embeds directs pour les providers qui n'ont pas
      //    d'oEmbed exploitable côté front (Instagram pas d'oEmbed public,
      //    TikTok renvoie du HTML avec scripts).
      const direct = buildDirectEmbed(provider, url)
      if (direct) {
        result = {
          url,
          title: url,
          description: null,
          image_url: null,
          provider,
          oembed_html: direct.oembed_html,
          source: 'oembed',
        }
      } else {
        // 2. Sinon oEmbed officiel (YouTube/Vimeo/Twitter)
        const oembed = await fetchOembed(provider, url)
        if (oembed) {
          result = {
            url,
            title: oembed.title || oembed.author_name || url,
            description: null,
            image_url: oembed.thumbnail_url || null,
            provider,
            oembed_html: oembed.html || null,
            source: 'oembed',
          }
        }
      }
    }

    // ─── Fallback OG scrape si pas d'oEmbed (Instagram, sites random,
    //     ou tentative ratée d'oEmbed). On enrichit aussi quand oEmbed
    //     n'a pas renvoyé d'image (rare mais possible).
    const needsScrape =
      result.source === 'fallback' ||
      (result.source === 'oembed' &&
        (!result.image_url || result.title === url))
    if (needsScrape) {
      const og = await scrapeOgTags(url)
      if (og) {
        result = {
          url,
          title: og.title || result.title,
          description: og.description || result.description,
          image_url: og.image_url || result.image_url,
          provider,
          oembed_html: result.oembed_html, // garde l'oembed si déjà présent
          source: result.source === 'oembed' ? 'oembed' : 'og',
        }
      }
    }

    const durationMs = Date.now() - startedAt
    console.log(
      `[og-fetch] user=${callerId} url=${url} provider=${provider || 'none'} source=${result.source} duration=${durationMs}ms`,
    )

    return jsonResponse(200, result)
  } catch (err) {
    console.error('[og-fetch] FAILED', err)
    return jsonResponse(500, {
      error: 'Erreur interne',
      details: err instanceof Error ? err.message : String(err),
    })
  }
})
