// ════════════════════════════════════════════════════════════════════════════
// youtubeOEmbed.js — Extraction métadonnées YouTube (titre, auteur, etc.)
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.4
//
// Quand un user colle un lien YouTube dans la barre de recherche, on récupère
// le titre de la vidéo via oEmbed (gratuit, sans clé API, sans quota), puis
// on essaie de parser le titre en {artiste, titre} pour ensuite chercher sur
// Spotify et préremplir la proposition.
//
// API publique :
//   - extractVideoId(url) → string | null
//   - normalizeYouTubeUrl(url) → string | null (URL canonique watch?v=...)
//   - isYouTubeUrl(text) → boolean
//   - fetchOEmbed(url) → Promise<{ title, author_name, thumbnail_url, ... } | null>
//   - parseVideoTitle(videoTitle, authorName?) → { artiste, titre }
//   - resolveFromUrl(url) → Promise<{ video_id, video_title, author_name,
//                                     thumbnail_url, artiste, titre } | null>
//
// La fonction parseVideoTitle implémente une heuristique sur les conventions
// de naming YouTube musical. Elle gère :
//   - séparateurs " - ", " — ", " – ", " | ", " : "
//   - suffixes parenthétiques à retirer (Official Video, HD, Audio, etc.)
//   - suffixes après pipe (" | Official Music Video")
//   - chaînes Topic ("Horsegiirl - Topic") où l'auteur est l'artiste fiable
//   - chaînes VEVO ("AnethaVEVO" → "Anetha")
//   - feat./ft. conservés dans le titre
//
// ════════════════════════════════════════════════════════════════════════════

// ─── 1. Extraction d'un video_id depuis une URL ─────────────────────────────

/**
 * Extrait l'identifiant de vidéo YouTube depuis une URL.
 * Supporte tous les formats courants :
 *   - https://www.youtube.com/watch?v=ABC123
 *   - https://youtu.be/ABC123
 *   - https://youtu.be/ABC123?si=...
 *   - https://www.youtube.com/watch?v=ABC123&t=140s
 *   - https://m.youtube.com/watch?v=ABC123
 *   - https://www.youtube.com/embed/ABC123
 *   - https://www.youtube.com/shorts/ABC123
 *   - https://music.youtube.com/watch?v=ABC123
 *
 * @param {string} url URL YouTube (peut contenir des paramètres parasites)
 * @returns {string|null} Le video_id (11 caractères) ou null si pas trouvé
 */
export function extractVideoId(url) {
  if (typeof url !== 'string' || url.length === 0) return null
  // On accepte les URL avec ou sans protocole
  let cleaned = url.trim()
  if (!cleaned.startsWith('http')) {
    // Si juste "youtu.be/XXX" sans schéma, on préfixe
    if (cleaned.startsWith('youtu.be/') || cleaned.startsWith('youtube.com/')) {
      cleaned = 'https://' + cleaned
    } else {
      // Peut-être juste l'id direct ?
      const idMatch = cleaned.match(/^[a-zA-Z0-9_-]{11}$/)
      if (idMatch) return idMatch[0]
      return null
    }
  }
  let parsed
  try {
    parsed = new URL(cleaned)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '')
  // Format court youtu.be/ABC123
  if (host === 'youtu.be') {
    const id = parsed.pathname.replace(/^\//, '').split('/')[0]
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
  }
  // Format long youtube.com/watch?v=ABC123 (et variantes music.youtube.com)
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    // /watch?v=ABC123
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v')
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
    }
    // /embed/ABC123 ou /shorts/ABC123 ou /v/ABC123
    const embedMatch = parsed.pathname.match(/^\/(?:embed|shorts|v|live)\/([a-zA-Z0-9_-]{11})/)
    if (embedMatch) return embedMatch[1]
  }
  return null
}

/**
 * Vérifie si une chaîne ressemble à une URL YouTube.
 * Utilisé par la barre de recherche unifiée pour détecter le mode "paste URL".
 */
export function isYouTubeUrl(text) {
  if (typeof text !== 'string') return false
  // On accepte les URL avec ou sans protocole. On veut détecter dès qu'on
  // voit "youtube.com" ou "youtu.be" dans la chaîne, même partiel.
  return /(?:^|[^a-z0-9])(youtu\.be|youtube\.com|music\.youtube\.com)\//i.test(
    text.trim(),
  )
}

/**
 * Construit une URL canonique watch?v=... depuis n'importe quel format
 * d'URL YouTube. Utile pour stocker en BDD (un seul format = pas de doublon).
 *
 * @returns {string|null} URL canonique ou null si video_id introuvable.
 */
export function normalizeYouTubeUrl(url) {
  const id = extractVideoId(url)
  if (!id) return null
  return `https://www.youtube.com/watch?v=${id}`
}

// ─── 2. Fetch oEmbed (gratuit, sans clé, sans quota) ────────────────────────

/**
 * Récupère les métadonnées d'une vidéo YouTube via l'API oEmbed publique.
 * Pas de clé API requise. Pas de quota documenté (Google n'expose rien
 * d'officiel, mais c'est utilisé partout sans souci).
 *
 * Réponse type :
 *   {
 *     title: "Horsegiirl - Eat Sleep Slay (Official Video)",
 *     author_name: "Horsegiirl",
 *     author_url: "https://www.youtube.com/@Horsegiirl",
 *     thumbnail_url: "https://i.ytimg.com/vi/CfOYq4Dv4CQ/hqdefault.jpg",
 *     thumbnail_width: 480,
 *     thumbnail_height: 360,
 *     provider_name: "YouTube",
 *     html: "<iframe ... ></iframe>",
 *     ...
 *   }
 *
 * @param {string} url URL YouTube
 * @returns {Promise<object|null>} Le payload oEmbed ou null si la vidéo est
 *   privée / supprimée / inaccessible.
 */
export async function fetchOEmbed(url) {
  const canonical = normalizeYouTubeUrl(url)
  if (!canonical) return null
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    canonical,
  )}&format=json`
  try {
    const res = await fetch(oembedUrl)
    if (!res.ok) return null
    const data = await res.json()
    return data
  } catch (err) {
    // CORS (peu probable car oEmbed YouTube le supporte), erreur réseau, etc.
    console.warn('[youtubeOEmbed] fetch failed', err)
    return null
  }
}

// ─── 3. Parser un titre vidéo en { artiste, titre } ─────────────────────────

// Suffixes parenthétiques à retirer (insensible à la casse). On peut en
// avoir plusieurs en cascade ("(Official Video) (HD)"). Liste pragmatique
// basée sur l'observation des chaînes musicales YouTube en 2025.
const STRIP_PATTERNS = [
  // Qualifications "officielles"
  /\s*\(\s*official\s+(?:music\s+)?(?:video|audio|visualizer|visualiser|lyric(?:s)?\s+video|art\s+video|version)\s*\)\s*/gi,
  /\s*\[\s*official\s+(?:music\s+)?(?:video|audio|visualizer|visualiser|lyric(?:s)?\s+video|art\s+video|version)\s*\]\s*/gi,
  /\s*\(\s*official\s*\)\s*/gi,
  /\s*\[\s*official\s*\]\s*/gi,
  // Lyric / Lyrics
  /\s*\(\s*lyric(?:s)?\s*(?:video)?\s*\)\s*/gi,
  /\s*\[\s*lyric(?:s)?\s*(?:video)?\s*\]\s*/gi,
  // Audio / Visualizer (sans "official")
  /\s*\(\s*(?:audio|visualizer|visualiser|art\s+video|music\s+video|lyric\s+visual)\s*\)\s*/gi,
  /\s*\[\s*(?:audio|visualizer|visualiser|art\s+video|music\s+video|lyric\s+visual)\s*\]\s*/gi,
  // Qualité
  /\s*\(\s*(?:hd|4k|hq|uhd|1080p|720p|hi-?res)\s*\)\s*/gi,
  /\s*\[\s*(?:hd|4k|hq|uhd|1080p|720p|hi-?res)\s*\]\s*/gi,
  // Live / Session
  /\s*\(\s*live(?:\s+at\s+.+?)?\s*\)\s*/gi,
  /\s*\(\s*live\s+session\s*\)\s*/gi,
  // Free download
  /\s*\(\s*free\s+download\s*\)\s*/gi,
  // Année à la fin
  /\s*\(\s*(?:19|20)\d{2}\s*\)\s*/gi,
  // Subscribe to channel notice (rare mais existe)
  /\s*\(\s*subscribe.*?\)\s*/gi,
]

// Suffixes pipe (" | …") à retirer : tout ce qui suit le premier pipe est
// considéré comme du metadata éditeur ("Horsegiirl - Eat Sleep Slay |
// Official Music Video").
const PIPE_SUFFIX = /\s*\|\s*.+$/

// Préfixes/suffixes étiquettes label/chaîne à retirer :
//   "[ANETHA] - Whistleblower" → "Whistleblower" + artiste depuis brackets
// On garde la valeur pour le compléter en artiste si on n'a pas mieux.
const LEADING_BRACKETS = /^\s*\[([^\]]{1,50})\]\s*(?:-|–|—)?\s*/

/**
 * Normalise le nom de l'auteur d'une chaîne YouTube en supprimant les
 * marqueurs " - Topic" et "VEVO" qui sont des conventions YouTube/labels.
 *
 *   "Horsegiirl - Topic" → "Horsegiirl"
 *   "AnethaVEVO"         → "Anetha"
 *   "Charlotte de Witte" → "Charlotte de Witte"
 */
function cleanAuthorName(author) {
  if (typeof author !== 'string') return ''
  let s = author.trim()
  // Suffixe " - Topic" (chaînes Auto-générées YouTube Music)
  s = s.replace(/\s+-\s+Topic\s*$/i, '').trim()
  // Suffixe VEVO en fin de chaîne (chaînes label/vevo)
  s = s.replace(/VEVO\s*$/i, '').trim()
  return s
}

/**
 * Détermine si une chaîne YouTube est une chaîne "Topic" (auto-générée
 * par YouTube Music). Dans ce cas, l'auteur EST l'artiste avec très
 * haute fiabilité et le titre vidéo = titre du morceau seul (pas de
 * format "Artist - Title").
 */
function isTopicChannel(author) {
  return typeof author === 'string' && /\s+-\s+Topic\s*$/i.test(author.trim())
}

/**
 * Nettoie un titre vidéo en retirant les suffixes connus (cascade).
 *
 *   "Horsegiirl - Eat Sleep Slay (Official Video) (HD)"
 *     → "Horsegiirl - Eat Sleep Slay"
 *
 *   "Anetha - Whistleblower | Official Music Video"
 *     → "Anetha - Whistleblower"
 */
function stripDecorations(title) {
  let s = (title || '').trim()
  // 1. Suffixe pipe (tout ce qui suit le premier |)
  s = s.replace(PIPE_SUFFIX, '')
  // 2. Cascade de suffixes parenthétiques
  let prev
  do {
    prev = s
    for (const pat of STRIP_PATTERNS) {
      s = s.replace(pat, ' ')
    }
    s = s.replace(/\s{2,}/g, ' ').trim()
  } while (s !== prev)
  return s
}

/**
 * Détecte le séparateur entre artiste et titre. Ordre de préférence :
 *   " - " (espace tiret espace) — le plus fréquent
 *   " — " (em dash)
 *   " – " (en dash)
 * Si plusieurs occurrences (ex : "A - B - C"), on coupe sur la première
 * (l'artiste à gauche, le titre complet à droite).
 */
function splitArtistTitle(cleanedTitle) {
  const seps = [' - ', ' — ', ' – ']
  for (const sep of seps) {
    const idx = cleanedTitle.indexOf(sep)
    if (idx > 0 && idx < cleanedTitle.length - sep.length) {
      const left = cleanedTitle.slice(0, idx).trim()
      const right = cleanedTitle.slice(idx + sep.length).trim()
      if (left && right) {
        return { artiste: left, titre: right }
      }
    }
  }
  return null
}

/**
 * Parser principal : prend le titre vidéo (et optionnellement le nom de
 * l'auteur de la chaîne) et renvoie {artiste, titre} au mieux.
 *
 * Algorithme :
 *   1. Si la chaîne est une chaîne "Topic" → titre = videoTitle nettoyé,
 *      artiste = author cleané.
 *   2. Nettoyage du titre vidéo (suffixes "Official Video", "HD", etc.)
 *   3. Préfixe [ARTISTE] détecté → on extrait
 *   4. Split sur " - " (puis variantes em/en dash)
 *   5. Fallback : tout est le titre, artiste = author cleané
 *
 * @param {string} videoTitle Le titre brut de la vidéo (oEmbed.title)
 * @param {string} [authorName] Le nom de la chaîne YouTube (oEmbed.author_name)
 * @returns {{ artiste: string, titre: string }}
 */
export function parseVideoTitle(videoTitle, authorName = '') {
  const author = cleanAuthorName(authorName)
  let raw = (videoTitle || '').trim()
  if (!raw) {
    return { artiste: author || '', titre: '' }
  }

  // Cas 1 — Chaîne Topic : l'auteur est l'artiste, le titre vidéo = titre
  if (isTopicChannel(authorName)) {
    return { artiste: author, titre: stripDecorations(raw) }
  }

  // Cas 2 — Préfixe [ARTISTE] explicite en début de titre.
  const bracketMatch = raw.match(LEADING_BRACKETS)
  let bracketArtist = null
  if (bracketMatch) {
    bracketArtist = bracketMatch[1].trim()
    raw = raw.slice(bracketMatch[0].length).trim()
  }

  // Cas 3 — Nettoyage du titre (suffixes Official Video, HD, pipe…)
  const cleaned = stripDecorations(raw)

  // Cas 4 — Split sur " - " ou em/en dash
  const split = splitArtistTitle(cleaned)
  if (split) {
    return split
  }

  // Cas 5 — Pas de séparateur trouvé. On garde tout comme titre, artiste
  // = bracketArtist sinon author (en dernier recours).
  return {
    artiste: bracketArtist || author || '',
    titre: cleaned,
  }
}

// ─── 4. Resolver de haut niveau (URL → tout d'un coup) ──────────────────────

/**
 * Pipeline complet pour la barre de recherche :
 *   URL YouTube → oEmbed → parsing → renvoie tout ce dont la UI a besoin
 *
 * @param {string} url URL YouTube (n'importe quel format)
 * @returns {Promise<{
 *   video_id: string,
 *   canonical_url: string,
 *   video_title: string,
 *   author_name: string,
 *   thumbnail_url: string,
 *   artiste: string,
 *   titre: string,
 * } | null>}
 */
export async function resolveFromUrl(url) {
  const video_id = extractVideoId(url)
  if (!video_id) return null
  const canonical_url = `https://www.youtube.com/watch?v=${video_id}`
  const oembed = await fetchOEmbed(canonical_url)
  if (!oembed) return null
  const { artiste, titre } = parseVideoTitle(oembed.title, oembed.author_name)
  return {
    video_id,
    canonical_url,
    video_title: oembed.title || '',
    author_name: oembed.author_name || '',
    thumbnail_url: oembed.thumbnail_url || '',
    artiste,
    titre,
  }
}
