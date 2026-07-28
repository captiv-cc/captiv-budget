/**
 * Edge Function : import-programmation
 * ------------------------------------
 * Reçoit un PDF / image / capture d'une AFFICHE de festival (line-up),
 * appelle Claude Vision pour extraire la liste des ARTISTES (sans
 * horaires), renvoie le résultat au client pour preview + import dans
 * l'annuaire projet_artistes (MUS-1.5).
 *
 * Différent de import-deroule :
 *   - import-deroule : grille horaire avec créneaux, scènes, horaires
 *   - import-programmation : juste les noms d'artistes du line-up
 *     (avec optionnellement jour/scène/headliner si visibles sur
 *     l'affiche)
 *
 * Cas d'usage : Hugo dépose l'affiche du festival des semaines avant
 * la grille horaire. Permet de peupler l'annuaire artistes tôt pour
 * que la sélection musique puisse démarrer.
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
 *       festival_name: string | null,
 *       dates: string | null,                 // ex: "11-13 août 2025"
 *       artistes: Array<{
 *         nom: string,
 *         jour: string | null,                // "J1" | "Vendredi" | "11 août" si dispo
 *         scene: string | null,               // si dispo sur l'affiche
 *         headliner: boolean                  // tête d'affiche (typographie)
 *       }>
 *     },
 *     meta: { model, duration_ms, input_tokens, output_tokens }
 *   }
 *
 * Sécurité :
 *   - JWT obligatoire dans l'en-tête Authorization
 *
 * Configuration requise :
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
 *   supabase functions deploy import-programmation
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
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20 Mo

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]
const PDF_TYPE = 'application/pdf'

// ─── Prompt système ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un parseur expert d'affiches de festival musical.

À partir d'une image ou PDF d'affiche / flyer / line-up festival, tu extrais la LISTE DES ARTISTES en JSON structuré via le tool fourni.

Règles strictes :
- Extrais UNIQUEMENT les noms d'ARTISTES OU GROUPES. Pas les sponsors, pas les organisateurs, pas les médias partenaires, pas les marques.
- Conserve la casse exacte des noms tels qu'ils apparaissent sur l'affiche (ex: "MØDE", "BU$HI", "horsegiirL", "Bigflo & Oli"). C'est important pour le matching dans l'annuaire.
- N'INVENTE JAMAIS un artiste qui n'apparaît pas sur l'affiche. En cas de doute (typographie illisible, nom partiel), omets l'artiste.
- Gère les groupes avec "&", "feat.", "vs" comme un seul artiste si c'est leur nom officiel (ex: "Bigflo & Oli", "Macklemore & Ryan Lewis"). Mais si l'affiche liste deux artistes séparés sur deux lignes différentes, c'est deux entrées.

JOUR :
- Si l'affiche montre clairement à quel jour chaque artiste joue (par exemple : section "VENDREDI 11 AOÛT" ou "DAY 1" suivie d'une liste d'artistes), capture ce jour dans le champ "jour".
- Format flexible : "J1" / "Vendredi" / "11 août" / "Day 1" — utilise ce qui est écrit sur l'affiche.
- Si pas d'info jour clair, laisse null.

SCÈNE :
- Si l'affiche organise les artistes par scène (rare sur les affiches générales, plus fréquent sur les grilles horaires), capture la scène.
- Sinon, laisse null. Pas d'invention.

HEADLINER :
- Marque headliner=true pour les artistes affichés en typographie significativement plus grosse (têtes d'affiche).
- En général : 2 à 5 headliners par jour. Si l'affiche n'a pas de hiérarchie typographique, laisse tout à false.

INFOS FESTIVAL :
- festival_name : nom du festival si visible (ex: "Plages Électroniques", "Marsatac"). Sinon null.
- dates : période du festival si visible (ex: "11-13 août 2025", "16-18 mai"). Sinon null.

CONFIANCE (champ "confidence") :
- "ok" quand le nom est parfaitement lisible et sans ambiguïté.
- "doubtful" quand tu as dû interpréter : typographie stylisée difficile à lire, caractères spéciaux incertains, nom partiellement masqué ou coupé, orthographe inhabituelle dont tu n'es pas sûr, résolution faible à cet endroit de l'image.
- Ce flag sert à attirer l'œil de l'utilisateur pour vérification manuelle — en cas de doute même léger, mets "doubtful". Mieux vaut trop de vérifications que des erreurs silencieuses.

Sois exhaustif sur les artistes (un grand festival a souvent 50-150 artistes) mais ne sors RIEN qui n'est pas explicitement écrit.`

// ─── Tool definition ───────────────────────────────────────────────────────
const EXTRACTION_TOOL = {
  name: 'extract_festival_lineup',
  description:
    "Extrait la liste des artistes d'une affiche / line-up festival",
  input_schema: {
    type: 'object',
    properties: {
      festival_name: {
        type: ['string', 'null'],
        description: 'Nom du festival si visible, sinon null',
      },
      dates: {
        type: ['string', 'null'],
        description:
          'Période du festival si visible (ex: "11-13 août 2025"), sinon null',
      },
      artistes: {
        type: 'array',
        description:
          "Liste des artistes ou groupes du line-up, dans l'ordre où ils apparaissent sur l'affiche (haut vers bas, gauche vers droite)",
        items: {
          type: 'object',
          properties: {
            nom: {
              type: 'string',
              description:
                "Nom de l'artiste tel qu'il apparaît sur l'affiche, casse exacte",
            },
            jour: {
              type: ['string', 'null'],
              description:
                'Jour de programmation si visible (ex: "J1", "Vendredi", "11 août"), sinon null',
            },
            scene: {
              type: ['string', 'null'],
              description: "Scène si l'affiche l'indique, sinon null",
            },
            headliner: {
              type: 'boolean',
              description:
                'true si typographie significativement plus grosse (tête d\'affiche)',
            },
            confidence: {
              type: 'string',
              enum: ['ok', 'doubtful'],
              description:
                "'doubtful' si la lecture du nom est incertaine (typo stylisée, illisible, coupé) — sert au surlignage de vérification côté UI",
            },
          },
          required: ['nom', 'headliner', 'confidence'],
        },
      },
    },
    required: ['artistes'],
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
  const len = b64.length
  const padding = (b64.match(/=+$/) || [''])[0].length
  return Math.floor((len * 3) / 4) - padding
}

// ─── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
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

    // @ts-ignore - Deno
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    // @ts-ignore - Deno
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    // @ts-ignore - Deno
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

    if (!ANTHROPIC_API_KEY) {
      return jsonResponse(500, {
        error:
          "ANTHROPIC_API_KEY n'est pas configurée. Exécute : supabase secrets set ANTHROPIC_API_KEY=sk-ant-...",
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

    // ─── Content array pour Claude ────────────────────────────────────────
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
      text: "Analyse cette affiche / line-up de festival et extrais TOUS les artistes via le tool extract_festival_lineup. Capture casse exacte des noms et marque les headliners (typographie plus grosse) si pertinent.",
    })

    // ─── Appel API Claude ─────────────────────────────────────────────────
    const claudeReq = {
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_festival_lineup' },
      messages: [{ role: 'user', content }],
    }

    console.log(
      `[import-programmation] user=${callerId} file_type=${file_type} size=${(sizeBytes / 1024).toFixed(1)}KB name=${file_name || '(none)'}`,
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
        `[import-programmation] Claude API ${claudeResp.status} : ${errText}`,
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
        '[import-programmation] Pas de tool_use dans la réponse Claude',
        JSON.stringify(claudeJson).slice(0, 1000),
      )
      return jsonResponse(502, {
        error:
          "Claude n'a pas appelé le tool d'extraction. Le document est peut-être illisible ou pas une affiche festival.",
      })
    }

    const extracted = toolUseBlock.input as {
      festival_name: string | null
      dates: string | null
      artistes: Array<{
        nom: string
        jour: string | null
        scene: string | null
        headliner: boolean
        confidence?: string
      }>
    }

    // ─── Validation légère ────────────────────────────────────────────────
    if (!extracted || !Array.isArray(extracted.artistes)) {
      return jsonResponse(502, {
        error:
          "Réponse Claude invalide : 'artistes' manquant ou pas un tableau",
      })
    }

    const normalizedArtistes = extracted.artistes
      .filter(
        (a) =>
          a &&
          typeof a.nom === 'string' &&
          a.nom.trim().length > 0,
      )
      .map((a) => ({
        nom: a.nom.trim(),
        jour: a.jour && typeof a.jour === 'string' ? a.jour.trim() : null,
        scene: a.scene && typeof a.scene === 'string' ? a.scene.trim() : null,
        headliner: Boolean(a.headliner),
        // Confiance de lecture : 'doubtful' → surlignage de vérification UI.
        confidence: a.confidence === 'doubtful' ? 'doubtful' : 'ok',
      }))

    const usage = claudeJson.usage || {}
    const durationMs = Date.now() - startedAt
    console.log(
      `[import-programmation] OK ${durationMs}ms — ${normalizedArtistes.length} artistes extraits, tokens in=${usage.input_tokens} out=${usage.output_tokens}`,
    )

    return jsonResponse(200, {
      success: true,
      extracted: {
        festival_name: extracted.festival_name || null,
        dates: extracted.dates || null,
        artistes: normalizedArtistes,
      },
      meta: {
        model: CLAUDE_MODEL,
        duration_ms: durationMs,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    })
  } catch (err) {
    const durationMs = Date.now() - startedAt
    console.error(
      `[import-programmation] FAILED duration=${durationMs}ms`,
      err,
    )
    return jsonResponse(500, {
      error: 'Erreur interne',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})
