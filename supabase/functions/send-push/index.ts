// ════════════════════════════════════════════════════════════════════════════
// send-push — Edge Function : envoi push notifications via Expo Push Service
// ════════════════════════════════════════════════════════════════════════════
//
// Phase 4 CAD-mobile.
//
// Appelé par :
//   - Triggers Postgres (via http extension) sur INSERT créneau_assignment,
//     UPDATE créneau (changement horaire / lieu), etc.
//   - L'app mobile elle-même pour le test (bouton "Envoyer push test"
//     dans Profil → Notifications).
//   - Job cron pour les rappels avant créneau (calcule next_rappel_at,
//     déclenche T-15min).
//
// Stratégie :
//   1. Récupère les push_tokens de tous les user_ids cibles
//   2. Insère N entrées dans `notifications` (1 par destinataire)
//   3. Appelle Expo Push API en batch (max 100 messages par batch)
//   4. Retourne le résumé : { sent, failed, tickets }
//
// Sécurité :
//   - JWT requis (anti-abus)
//   - Mode privilégié si on détecte le service_role token → autorise targetting
//     d'autres users que soi-même (cas trigger Postgres / cron)
//
// API :
//   POST /send-push
//   Body :
//   {
//     user_ids: string[],         // UUIDs des destinataires
//     type: 'creneau_assigne' | 'creneau_modifie' | 'creneau_annule'
//         | 'mention' | 'livrable_valide' | 'rappel_creneau' | 'test',
//     titre: string,
//     corps?: string,
//     deep_link?: string,         // ex "captivdesk://creneau/c3"
//     data?: Record<string, any>, // payload custom
//     dry_run?: boolean,          // true = log seulement, pas d'envoi push
//   }
//
//   Renvoie :
//   {
//     sent: number,
//     failed: number,
//     tickets: { token: string, status: 'ok' | 'error', message?: string }[],
//     notifications_logged: number,
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

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const BATCH_SIZE = 100 // Expo limit per request

interface SendPushBody {
  user_ids: string[]
  type: string
  titre: string
  corps?: string
  deep_link?: string
  data?: Record<string, unknown>
  dry_run?: boolean
}

interface PushTicket {
  token: string
  status: 'ok' | 'error'
  message?: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function chunked<T>(arr: T[], size: number): Promise<T[][]> {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

async function sendBatchToExpo(messages: any[]): Promise<PushTicket[]> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    })
    const data = await res.json()
    // data.data is an array of tickets, in the same order as messages
    const tickets: any[] = data.data ?? []
    return messages.map((m, i) => {
      const t = tickets[i]
      if (!t) {
        return { token: m.to, status: 'error', message: 'no ticket returned' }
      }
      if (t.status === 'ok') {
        return { token: m.to, status: 'ok' }
      }
      return { token: m.to, status: 'error', message: t.message ?? t.details?.error }
    })
  } catch (err) {
    return messages.map((m) => ({
      token: m.to,
      status: 'error',
      message: (err as Error).message,
    }))
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'missing_authorization' }, 401)
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return jsonResponse({ error: 'env_misconfigured' }, 500)
  }

  // Client admin pour bypass RLS sur push_tokens + insertion notifications
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

  let body: SendPushBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  if (!body.user_ids?.length || !body.titre || !body.type) {
    return jsonResponse({ error: 'missing_fields', fields: ['user_ids', 'titre', 'type'] }, 400)
  }

  // ── Contrôle d'autorisation ────────────────────────────────────────────────
  // Privilégié (triggers Postgres / cron) si le bearer == service_role : peut
  // cibler n'importe quels user_ids. Sinon, c'est un utilisateur connecté → on
  // restreint les cibles à lui-même (anti-abus : pas de spam d'autrui).
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
  const isService = SUPABASE_SERVICE_ROLE !== '' && bearer === SUPABASE_SERVICE_ROLE
  if (!isService) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(bearer)
    if (userErr || !userData?.user) {
      return jsonResponse({ error: 'unauthorized' }, 401)
    }
    const selfId = userData.user.id
    body.user_ids = body.user_ids.filter((id) => id === selfId)
    if (body.user_ids.length === 0) {
      return jsonResponse({ error: 'forbidden_targets' }, 403)
    }
  }

  // 1. Fetch push tokens pour les user_ids cibles
  const { data: tokens, error: tokensErr } = await supabase
    .from('push_tokens')
    .select('user_id, expo_token, platform')
    .in('user_id', body.user_ids)

  if (tokensErr) {
    return jsonResponse({ error: 'tokens_query_failed', details: tokensErr.message }, 500)
  }

  // 2. Fetch user_settings pour vérifier qui a push activé
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, push_enabled')
    .in('user_id', body.user_ids)

  const pushDisabled = new Set(
    (settings ?? []).filter((s) => !s.push_enabled).map((s) => s.user_id),
  )

  // 3. Log dans la table notifications (1 ligne par user destinataire)
  const notifRows = body.user_ids.map((uid) => ({
    user_id: uid,
    type: body.type,
    titre: body.titre,
    corps: body.corps ?? null,
    deep_link: body.deep_link ?? null,
    data: body.data ?? null,
    envoye_at: new Date().toISOString(),
  }))
  const { error: logErr } = await supabase.from('notifications').insert(notifRows)
  if (logErr) {
    // eslint-disable-next-line no-console
    console.warn('[send-push] notifications insert failed', logErr.message)
  }

  // 4. Construire les messages Expo (filtrer ceux qui ont désactivé le push)
  const messages = (tokens ?? [])
    .filter((t) => !pushDisabled.has(t.user_id))
    .map((t) => ({
      to: t.expo_token,
      sound: 'default',
      title: body.titre,
      body: body.corps ?? '',
      data: {
        deep_link: body.deep_link ?? null,
        type: body.type,
        ...(body.data ?? {}),
      },
      _displayInForeground: true,
    }))

  if (body.dry_run) {
    return jsonResponse({
      sent: 0,
      failed: 0,
      tickets: messages.map((m) => ({ token: m.to as string, status: 'ok' as const })),
      notifications_logged: notifRows.length,
      dry_run: true,
    })
  }

  // 5. Envoi en batches
  const allTickets: PushTicket[] = []
  for (const batch of await chunked(messages, BATCH_SIZE)) {
    const tickets = await sendBatchToExpo(batch)
    allTickets.push(...tickets)
  }

  const sent = allTickets.filter((t) => t.status === 'ok').length
  const failed = allTickets.length - sent

  return jsonResponse({
    sent,
    failed,
    tickets: allTickets,
    notifications_logged: notifRows.length,
  })
})
