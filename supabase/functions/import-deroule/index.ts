/**
 * Edge Function : import-deroule
 * ------------------------------
 * Reçoit un PDF / image / capture d'une programmation festival,
 * appelle Claude Vision pour extraire les shows en JSON structuré,
 * renvoie le résultat au client pour preview + import (FEST-4.1).
 *
 * Entrée (POST JSON) :
 *   {
 *     file_data: string (base64),
 *     file_type: string (mime),
 *     file_name?: string (optionnel, pour les logs)
 *   }
 *
 * Sortie :
 *   {
 *     success: true,
 *     extracted: {
 *       date: string | null,        // YYYY-MM-DD
 *       shows: Array<{
 *         titre: string,
 *         scene: string | null,
 *         heure_debut: string,      // HH:MM
 *         heure_fin: string         // HH:MM
 *       }>
 *     },
 *     meta: { model, duration_ms, input_tokens, output_tokens }
 *   }
 *
 * Sécurité :
 *   - JWT obligatoire dans l'en-tête Authorization
 *   - L'appelant doit être authentifié (membre d'une org)
 *
 * Configuration requise :
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
 *   supabase functions deploy import-deroule
 */

// @ts-ignore - Deno imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'

// @ts-ignore - Deno global
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Promise<Response>) => void
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

// Limites de taille pour éviter d'envoyer des fichiers trop lourds à l'API
// (Anthropic accepte jusqu'à 32MB pour les PDFs et 5MB par image)
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20MB

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]
const PDF_TYPE = 'application/pdf'

// ─── Prompt système ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un parseur expert de programmations de festival audiovisuel.

À partir d'une image ou d'un PDF de programmation festival, tu extrais chaque show en JSON structuré via le tool fourni.

Règles strictes :
- Les horaires sont au format HH:MM (24h).
- Le titre est le NOM DE L'ARTISTE OU DU GROUPE, pas la catégorie ni le genre musical.
- La scène est le NOM exact de la scène (ex: "Grande Scène", "Scène Plage", "Scène Médiator"). Si non identifiable, retourner null.
- Si la date du festival est visible (date complète OU "jour 1 / jour 2" avec une date associée), la retourner au format YYYY-MM-DD.
- Si plusieurs jours sont visibles, ne retourner QUE le premier jour identifié (l'utilisateur importera les autres séparément).
- N'INVENTE JAMAIS de show qui n'apparaît pas dans le document. Si un horaire est ambigu ou illisible, omets le show plutôt que de deviner.
- Ignore les éléments NON-show : annonces sponsors, repas, navettes, conférences sauf si elles font partie de la programmation artistique.

PASSAGE DE MINUIT (très important pour les festivals) :
- Une grille horaire de festival affiche typiquement les heures de haut en bas : par exemple "16h, 17h, 18h, 19h, 20h, 21h, 22h, 23h, 00h, 01h, 02h".
- Les shows positionnés visuellement DANS LA PARTIE BASSE de la grille (après minuit, typiquement 00h-05h) ont lieu LE JOUR SUIVANT (J+1) par rapport à la date principale du festival.
- Pour ces shows entièrement après minuit, mets lendemain=true. Exemple : un show "00:30 – 02:00" dans une grille qui commence à 16h → lendemain=true.
- Cas spécial : un show qui CHEVAUCHE minuit (ex: début 23:30 J, fin 00:30 J+1). Garde heure_debut="23:30" heure_fin="00:30" et NE METS PAS lendemain=true. L'application interprète automatiquement la fin comme J+1.
- En cas de doute (festival qui commence à 11h le matin et se termine à 23h le soir), laisse lendemain=false.

ORDRE DES SHOWS dans le tableau :
- Trie les shows par SCÈNE en respectant l'ORDRE VISUEL gauche-à-droite tel qu'elles apparaissent dans la timetable.
- Au sein de chaque scène, trie les shows par heure de début ASC (les premiers shows de la soirée en premier, les shows after-midnight en dernier).
- Exemple : si la timetable a 5 colonnes "Scène A | Scène B | Scène C | Scène D | Scène E", commence par tous les shows de Scène A (triés par heure), puis Scène B, etc.

CONFIANCE (champ "confidence") :
- "ok" quand le nom ET les horaires sont parfaitement lisibles et sans ambiguïté.
- "doubtful" quand tu as dû interpréter : nom en typographie stylisée / partiellement masqué, horaire déduit de la position dans la grille plutôt que lu explicitement, case chevauchant deux colonnes, zone floue ou basse résolution.
- Ce flag sert à attirer l'œil de l'utilisateur pour vérification manuelle — en cas de doute même léger, mets "doubtful". Mieux vaut trop de vérifications que des erreurs silencieuses.`

// ─── Tool definition (force la sortie JSON via tool_use) ───────────────────
const EXTRACTION_TOOL = {
  name: 'extract_festival_program',
  description:
    "Extrait la programmation d'un festival depuis une image ou PDF de planning",
  input_schema: {
    type: 'object',
    properties: {
      date: {
        type: ['string', 'null'],
        description:
          'Date du festival au format YYYY-MM-DD, ou null si non détectable',
      },
      shows: {
        type: 'array',
        description:
          'Liste des shows extraits du document, triés par ordre visuel des scènes (gauche-à-droite), puis par heure de début ASC au sein de chaque scène',
        items: {
          type: 'object',
          properties: {
            titre: {
              type: 'string',
              description: "Nom de l'artiste ou du groupe",
            },
            scene: {
              type: ['string', 'null'],
              description: 'Nom de la scène ou null si non identifiable',
            },
            heure_debut: {
              type: 'string',
              description: 'Heure de début au format HH:MM 24h',
            },
            heure_fin: {
              type: 'string',
              description: 'Heure de fin au format HH:MM 24h',
            },
            lendemain: {
              type: 'boolean',
              description:
                "true si le show a lieu ENTIÈREMENT après minuit (J+1 par rapport à la date principale du festival). Typiquement les shows de fin de soirée 00h-05h dans une grille festival. Pour un show qui CHEVAUCHE minuit (ex: 23:30→00:30), laisse false : l'app gère ce cas automatiquement.",
            },
            confidence: {
              type: 'string',
              enum: ['ok', 'doubtful'],
              description:
                "'doubtful' si la lecture du nom ou des horaires est incertaine (typo stylisée, horaire déduit, zone floue) — sert au surlignage de vérification côté UI",
            },
          },
          required: ['titre', 'heure_debut', 'heure_fin', 'confidence'],
        },
      },
    },
    required: ['date', 'shows'],
  },
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function approxBytesFromBase64(b64: string): number {
  // base64 ≈ 4/3 du binaire. On enlève le padding.
  const len = b64.length
  const padding = (b64.match(/=+$/) || [''])[0].length
  return Math.floor((len * 3) / 4) - padding
}

// ─── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const startedAt = Date.now()

  try {
    // ─── Validation entrée ────────────────────────────────────────────────
    const body = await req.json()
    const { file_data, file_type, file_name } = body || {}

    if (!file_data || typeof file_data !== 'string') {
      return jsonResponse(400, { error: 'file_data (base64) requis' })
    }
    if (!file_type || typeof file_type !== 'string') {
      return jsonResponse(400, { error: 'file_type (mime) requis' })
    }

    const isImage = SUPPORTED_IMAGE_TYPES.includes(file_type.toLowerCase())
    const isPdf = file_type.toLowerCase() === PDF_TYPE
    if (!isImage && !isPdf) {
      return jsonResponse(400, {
        error: `Type non supporté : ${file_type}. Formats acceptés : PDF, JPEG, PNG, GIF, WebP.`,
      })
    }

    const sizeBytes = approxBytesFromBase64(file_data)
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      return jsonResponse(400, {
        error: `Fichier trop volumineux : ${(sizeBytes / 1024 / 1024).toFixed(1)}MB (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)`,
      })
    }

    // ─── Auth (JWT obligatoire) ───────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse(401, { error: 'Authorization header manquant' })
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) {
      return jsonResponse(401, { error: 'JWT manquant' })
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

    if (!ANTHROPIC_API_KEY) {
      return jsonResponse(500, {
        error:
          "ANTHROPIC_API_KEY n'est pas configurée. Configure le secret avec : supabase secrets set ANTHROPIC_API_KEY=sk-ant-...",
      })
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt)
    if (userErr || !userData?.user) {
      return jsonResponse(401, {
        error: 'Token invalide : ' + (userErr?.message || 'user null'),
      })
    }
    const callerId = userData.user.id

    // ─── Construction du content array pour Claude ────────────────────────
    // Pour les PDF, on utilise type=document (supporté nativement par Claude
    // depuis fin 2024). Pour les images, type=image.
    type ContentItem =
      | { type: 'text'; text: string }
      | {
          type: 'image'
          source: { type: 'base64'; media_type: string; data: string }
        }
      | {
          type: 'document'
          source: { type: 'base64'; media_type: string; data: string }
        }

    const content: ContentItem[] = []

    if (isPdf) {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: file_data,
        },
      })
    } else {
      // Normaliser image/jpg → image/jpeg pour Claude
      const mediaType = file_type === 'image/jpg' ? 'image/jpeg' : file_type
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: file_data,
        },
      })
    }

    content.push({
      type: 'text',
      text: 'Analyse ce document de programmation festival et extrais tous les shows artistiques en utilisant le tool extract_festival_program.',
    })

    // ─── Appel API Claude ─────────────────────────────────────────────────
    const claudeReq = {
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_festival_program' },
      messages: [{ role: 'user', content }],
    }

    console.log(
      `[import-deroule] user=${callerId} file_type=${file_type} size=${(sizeBytes / 1024).toFixed(1)}KB name=${file_name || '(none)'}`,
    )

    const claudeResp = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(claudeReq),
    })

    if (!claudeResp.ok) {
      const errText = await claudeResp.text()
      console.error(
        `[import-deroule] Claude API ${claudeResp.status} : ${errText}`,
      )
      return jsonResponse(502, {
        error: `Claude API a renvoyé ${claudeResp.status}`,
        detail: errText.slice(0, 500),
      })
    }

    const claudeJson = await claudeResp.json()

    // ─── Extraction du tool_use ───────────────────────────────────────────
    const toolUseBlock = (claudeJson.content || []).find(
      (b: { type: string }) => b.type === 'tool_use',
    )

    if (!toolUseBlock) {
      console.error(
        '[import-deroule] Pas de tool_use dans la réponse Claude',
        JSON.stringify(claudeJson).slice(0, 1000),
      )
      return jsonResponse(502, {
        error:
          "Claude n'a pas appelé le tool d'extraction. Le document est peut-être illisible ou pas une programmation festival.",
      })
    }

    const extracted = toolUseBlock.input as {
      date: string | null
      shows: Array<{
        titre: string
        scene: string | null
        heure_debut: string
        heure_fin: string
        lendemain?: boolean
        confidence?: string
      }>
    }

    // ─── Validation légère du résultat ────────────────────────────────────
    if (!extracted || !Array.isArray(extracted.shows)) {
      return jsonResponse(502, {
        error: "Réponse Claude invalide : 'shows' manquant ou pas un tableau",
      })
    }

    // Normalise les horaires (trim, padding 0). Si lendemain=true, on
    // encode l'heure en h+24 (ex: "01:30" → "25:30") pour que côté client
    // timeToMinutes() retourne une valeur > 1440 ⇒ l'app interprète J+1.
    const normalizedShows = extracted.shows
      .filter(
        (s) =>
          s &&
          typeof s.titre === 'string' &&
          s.titre.trim().length > 0 &&
          typeof s.heure_debut === 'string' &&
          typeof s.heure_fin === 'string',
      )
      .map((s) => {
        let heure_debut = normalizeHHMM(s.heure_debut)
        let heure_fin = normalizeHHMM(s.heure_fin)
        if (s.lendemain === true) {
          heure_debut = shiftToLendemain(heure_debut)
          heure_fin = shiftToLendemain(heure_fin)
        }
        return {
          titre: s.titre.trim(),
          scene:
            s.scene && typeof s.scene === 'string' ? s.scene.trim() : null,
          heure_debut,
          heure_fin,
          // Confiance de lecture : 'doubtful' → surlignage vérification UI.
          confidence: s.confidence === 'doubtful' ? 'doubtful' : 'ok',
        }
      })
      .filter((s) => s.heure_debut && s.heure_fin)

    const durationMs = Date.now() - startedAt
    const usage = claudeJson.usage || {}

    console.log(
      `[import-deroule] OK ${durationMs}ms — ${normalizedShows.length} shows extraits, tokens in=${usage.input_tokens} out=${usage.output_tokens}`,
    )

    return jsonResponse(200, {
      success: true,
      extracted: {
        date: extracted.date || null,
        shows: normalizedShows,
      },
      meta: {
        model: CLAUDE_MODEL,
        duration_ms: durationMs,
        input_tokens: usage.input_tokens ?? null,
        output_tokens: usage.output_tokens ?? null,
      },
    })
  } catch (e) {
    const err = e as Error
    console.error('[import-deroule] uncaught error', err)
    return jsonResponse(500, {
      error: 'Erreur interne : ' + (err.message || String(err)),
    })
  }
})

// ─── Helpers normalisation ─────────────────────────────────────────────────
function normalizeHHMM(s: string): string {
  if (!s || typeof s !== 'string') return ''
  const trimmed = s.trim()
  // Cas "9:30" → "09:30"
  const m = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return ''
  const h = parseInt(m[1], 10)
  const mm = parseInt(m[2], 10)
  if (Number.isNaN(h) || Number.isNaN(mm)) return ''
  // Accepte jusqu'à 28h pour permettre l'encodage J+1 (00h-04h J+1 = 24h-28h)
  if (h < 0 || h > 28 || mm < 0 || mm > 59) return ''
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Décale une heure HH:MM vers J+1 en ajoutant 24h.
 *   shiftToLendemain("00:30") → "24:30"
 *   shiftToLendemain("01:30") → "25:30"
 *   shiftToLendemain("04:00") → "28:00"
 * Côté client, timeToMinutes("25:30") = 1530 (> 1440) ⇒ interprété comme J+1.
 */
function shiftToLendemain(hhmm: string): string {
  if (!hhmm) return ''
  const m = hhmm.match(/^(\d{2}):(\d{2})$/)
  if (!m) return hhmm
  const h = parseInt(m[1], 10)
  if (h >= 24) return hhmm // déjà au-delà, no-op
  const shifted = h + 24
  if (shifted > 28) return hhmm // borne max app : 28:00 (= 04h00 J+1)
  return `${String(shifted).padStart(2, '0')}:${m[2]}`
}
