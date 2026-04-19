/**
 * Edge Function : ical-feed
 * -------------------------
 * Sert un corpus iCalendar (RFC 5545) pour les tokens d'abonnement définis
 * dans `ical_tokens`. Consommée en GET par Google Calendar, Apple Calendar,
 * Outlook… sous forme d'URL :
 *
 *     GET {SUPABASE_URL}/functions/v1/ical-feed?token=XXXX
 *
 * Aucune auth front — le token EST le secret d'auth. Toute la logique DB
 * passe par un client service_role (bypass RLS).
 *
 * Scopes gérés (cf. migration PL-8 v1) :
 *   - project : tous les events du projet
 *   - my      : tous les events où le user est assigné (event_members),
 *               cross-projets, hors statut 'declined'
 *
 * Fenêtre par défaut : -3 mois à +12 mois autour d'aujourd'hui. Override
 * possible via ?from=YYYY-MM-DD&to=YYYY-MM-DD pour les clients curieux
 * (peu utile en pratique, mais utile pour debug).
 *
 * Les events récurrents sont envoyés en tant que "masters" (1 ligne ICS
 * avec RRULE), c'est le client iCal qui étend les occurrences. C'est à la
 * fois plus léger (1 row par pattern) et plus fidèle (respecte EXDATE).
 *
 * En cas de token invalide / révoqué : 404 text/plain (pas d'info leak).
 */

// @ts-ignore - Deno imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { buildICS, type ICalEvent } from '../_shared/ical.ts'

// @ts-ignore - Deno global
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Promise<Response>) => void
}

const FEED_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// Fenêtre par défaut : on ne veut pas dumper 10 ans d'historique à un
// iPhone qui se (re)synchronise. Clamp raisonnable.
const DEFAULT_DAYS_BACK    = 90    // ~3 mois
const DEFAULT_DAYS_FORWARD = 365   // 12 mois

function textResponse(status: number, body: string, extraHeaders: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { ...FEED_CORS, 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders },
  })
}

function icsResponse(body: string, extraHeaders: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      ...FEED_CORS,
      'Content-Type': 'text/calendar; charset=utf-8',
      // max-age court : les clients iCal majeurs imposent leur propre rythme
      // (Google ~12h, Apple 15min-1h) mais on reste conservateur pour les
      // proxys intermédiaires.
      'Cache-Control': 'private, max-age=300',
      ...extraHeaders,
    },
  })
}

function parseDate(s: string | null, fallback: Date): Date {
  if (!s) return fallback
  const d = new Date(s + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) ? fallback : d
}

/**
 * Mise en forme du lieu pour le champ LOCATION iCal.
 * La table `locations` (jointe via events.location_id) a `name`, `address`,
 * `city`, `postal_code`, `country`. On concatène dans l'ordre le plus
 * lisible pour Google/Apple Calendar : "Nom, adresse, CP ville, pays".
 */
function formatLocationText(loc: Record<string, unknown> | null | undefined): string | null {
  if (!loc || typeof loc !== 'object') return null
  const name = (loc.name as string) || ''
  const address = (loc.address as string) || ''
  const city = (loc.city as string) || ''
  const postal = (loc.postal_code as string) || ''
  const country = (loc.country as string) || ''
  const cityPart = [postal, city].filter(Boolean).join(' ')
  const parts = [name, address, cityPart, country].filter((s) => s && s.trim())
  return parts.length ? parts.join(', ') : null
}

/**
 * Normalise les lignes `events` remontées par PostgREST pour coller à
 * l'interface ICalEvent (qui attend `location` en string). La jointure
 * `location:locations(...)` renvoie un objet, on l'aplatit.
 */
function normalizeEventRow(row: Record<string, unknown>): ICalEvent {
  const loc = row.location as Record<string, unknown> | null | undefined
  return {
    ...(row as object),
    location: formatLocationText(loc),
  } as ICalEvent
}

// SELECT partagé entre les deux scopes (project + my) pour rester cohérent.
const EVENTS_SELECT = `
  id, title, starts_at, ends_at, all_day, tz,
  description, notes, external_url,
  rrule, rrule_exdates,
  location:locations ( name, address, city, postal_code, country )
`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: FEED_CORS })
  }
  if (req.method !== 'GET') {
    return textResponse(405, 'Method not allowed')
  }

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')?.trim()
    if (!token) {
      return textResponse(400, 'Missing token')
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── 1. Résolution token ─────────────────────────────────────────────────
    const { data: tokenRow, error: tokenErr } = await admin
      .from('ical_tokens')
      .select('id, org_id, project_id, user_id, label, revoked_at')
      .eq('token', token)
      .maybeSingle()

    if (tokenErr) {
      console.error('[ical-feed] token lookup failed:', tokenErr.message)
      return textResponse(500, 'Internal error')
    }
    if (!tokenRow || tokenRow.revoked_at) {
      // 404 générique — pas de distinction invalide vs révoqué (info leak)
      return textResponse(404, 'Not found')
    }

    // ── 2. Fenêtre temporelle ───────────────────────────────────────────────
    const now = new Date()
    const defaultFrom = new Date(now.getTime() - DEFAULT_DAYS_BACK * 86_400_000)
    const defaultTo   = new Date(now.getTime() + DEFAULT_DAYS_FORWARD * 86_400_000)
    const rangeFrom = parseDate(url.searchParams.get('from'), defaultFrom)
    const rangeTo   = parseDate(url.searchParams.get('to'),   defaultTo)

    // ── 3. Chargement des events selon le scope ─────────────────────────────
    let events: ICalEvent[] = []
    let calName = tokenRow.label || 'Captiv'

    if (tokenRow.project_id) {
      // Scope PROJECT : tous les events du projet, incluant masters récurrents
      // dont ends_at pourrait précéder rangeFrom si rrule étend jusque dans
      // la fenêtre. On est lâche côté borne inférieure (starts_at ≤ rangeTo)
      // et on laisse les clients iCal calculer.
      const { data: projectRow } = await admin
        .from('projects')
        .select('id, title')
        .eq('id', tokenRow.project_id)
        .maybeSingle()

      if (projectRow?.title && !tokenRow.label) {
        calName = `Captiv — ${projectRow.title}`
      } else if (tokenRow.label) {
        calName = tokenRow.label
      }

      const { data, error } = await admin
        .from('events')
        .select(EVENTS_SELECT)
        .eq('project_id', tokenRow.project_id)
        .lte('starts_at', rangeTo.toISOString())
        .or(`ends_at.gte.${rangeFrom.toISOString()},rrule.not.is.null`)

      if (error) {
        console.error('[ical-feed] project events fetch failed:', error.message)
        return textResponse(500, 'Internal error')
      }
      events = (data || []).map(normalizeEventRow)
    } else if (tokenRow.user_id) {
      // Scope MY : events où le user est assigné (event_members.profile_id),
      // tout projet confondu dans l'org, hors statuts 'declined'.
      if (!tokenRow.label) {
        calName = 'Mon planning Captiv'
      }

      const { data: memberRows, error: memberErr } = await admin
        .from('event_members')
        .select('event_id, status')
        .eq('profile_id', tokenRow.user_id)
        .neq('status', 'declined')

      if (memberErr) {
        console.error('[ical-feed] event_members fetch failed:', memberErr.message)
        return textResponse(500, 'Internal error')
      }

      const eventIds = (memberRows || []).map((r: { event_id: string }) => r.event_id)
      if (eventIds.length === 0) {
        events = []
      } else {
        const { data, error } = await admin
          .from('events')
          .select(EVENTS_SELECT)
          .in('id', eventIds)
          .lte('starts_at', rangeTo.toISOString())
          .or(`ends_at.gte.${rangeFrom.toISOString()},rrule.not.is.null`)

        if (error) {
          console.error('[ical-feed] my events fetch failed:', error.message)
          return textResponse(500, 'Internal error')
        }
        events = (data || []).map(normalizeEventRow)
      }
    } else {
      // Scope invalide (contrainte XOR violée) : ne devrait jamais arriver.
      console.error('[ical-feed] token with no scope:', tokenRow.id)
      return textResponse(500, 'Internal error')
    }

    // ── 4. Build ICS ────────────────────────────────────────────────────────
    const feedUrl = url.origin + url.pathname + `?token=${encodeURIComponent(token)}`
    const ics = buildICS(events, {
      calName,
      url: feedUrl,
      now,
    })

    // ── 5. Mise à jour last_accessed_at (fire-and-forget) ──────────────────
    // On n'attend pas le résultat : un failure ici ne doit pas casser le feed
    // (le client iCal pourrait retenter à l'infini si on renvoyait 500).
    admin
      .from('ical_tokens')
      .update({ last_accessed_at: now.toISOString() })
      .eq('id', tokenRow.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('[ical-feed] last_accessed_at update failed:', error.message)
      })

    return icsResponse(ics)
  } catch (err) {
    console.error('[ical-feed] uncaught:', err)
    return textResponse(500, 'Internal error')
  }
})
