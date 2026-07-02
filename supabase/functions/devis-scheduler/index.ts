// ════════════════════════════════════════════════════════════════════════════
// devis-scheduler — Edge Function : notifications temporelles devis (Notifs N3)
// ════════════════════════════════════════════════════════════════════════════
//
// Appelée 1x/jour par pg_cron (cf. supabase/notifications_cron.sql), ou à la
// main pour tester (Bearer service role requis). Balaie les devis « envoyé »
// et produit :
//
//   devis_relance : proposition de relance aux titulaires (sent_by/created_by)
//     - jamais ouvert depuis N jours (org_settings devis_relance_non_ouvert_jours, déf. 5)
//     - ouvert mais sans réponse depuis M jours (devis_relance_sans_reponse_jours, déf. 10)
//     - re-proposée au plus tous les K jours (devis_relance_intervalle_jours, déf. 7),
//       et pas si une relance manuelle (last_reminded_at) date de moins de K jours.
//   devis_expire : offre expirant dans ≤ 3 jours (une seule fois, marqueur J-3),
//     puis le jour de l'expiration (marqueur J0).
//
// Ménage : purge des notifications de plus de 90 jours (tous types).
//
// Déploiement : supabase functions deploy devis-scheduler --no-verify-jwt
// (l'auth est faite dans le code : service role uniquement)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import {
  resolveRecipients,
  recentlyNotified,
  sendDevisNotification,
  devisLabel,
} from '../_shared/devisNotify.ts'

const DAY_MS = 24 * 3600 * 1000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'env' }, 500)

  // Auth : service role OU secret dédié SCHEDULER_SECRET (supabase secrets set).
  // Le secret dédié évite toute dépendance au format des clés API (legacy JWT
  // vs nouvelles sb_secret_) : c'est lui qu'on met dans le job pg_cron.
  const SCHEDULER_SECRET = Deno.env.get('SCHEDULER_SECRET') ?? ''
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const authorized =
    bearer === SERVICE_ROLE || (SCHEDULER_SECRET !== '' && bearer === SCHEDULER_SECRET)
  if (!authorized) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)
  const now = Date.now()
  const out = { relances: 0, expirations: 0, purged: 0 }

  // ── Réglages par org (défauts si absents) ──────────────────────────────────
  const { data: settingsRows } = await supabase
    .from('org_settings')
    .select('org_id, key, value')
    .in('key', [
      'devis_relance_non_ouvert_jours',
      'devis_relance_sans_reponse_jours',
      'devis_relance_intervalle_jours',
    ])
  const orgSettings = new Map<string, Record<string, number>>()
  for (const r of settingsRows || []) {
    const m = orgSettings.get(r.org_id) || {}
    const n = parseInt(r.value, 10)
    if (Number.isFinite(n) && n > 0) m[r.key] = n
    orgSettings.set(r.org_id, m)
  }
  const orgSetting = (orgId: string, key: string, fallback: number) =>
    orgSettings.get(orgId)?.[key] ?? fallback

  // ── Devis envoyés (candidats relance/expiration) ───────────────────────────
  const { data: devisList } = await supabase
    .from('devis')
    .select(
      'id, project_id, sent_by, created_by, version_number, title, status, ' +
        'sent_at, valid_until, last_reminded_at, projects(org_id)',
    )
    .eq('status', 'envoye')
    .not('sent_at', 'is', null)

  for (const dv of devisList || []) {
    const orgId = (dv as Record<string, unknown>).projects?.org_id as string | undefined
    if (!orgId) continue
    const expired = dv.valid_until && new Date(dv.valid_until).getTime() < now

    // ── Expiration proche (pas de relance sur un devis expiré) ──────────────
    if (dv.valid_until) {
      const expiresAt = new Date(dv.valid_until).getTime()
      const daysLeft = Math.ceil((expiresAt - now) / DAY_MS)
      const marker = daysLeft <= 0 ? 'J0' : daysLeft <= 3 ? 'J-3' : null
      if (marker && daysLeft >= -1) {
        // Une notification par marqueur (recherche sur data.marker)
        const { data: already } = await supabase
          .from('notifications')
          .select('id')
          .eq('type', 'devis_expire')
          .contains('data', { devis_id: dv.id, marker })
          .limit(1)
        if (!already?.length) {
          const recipients = await resolveRecipients(supabase, dv, 'quotidien', 'devis_relances')
          await sendDevisNotification({
            userIds: recipients,
            type: 'devis_expire',
            titre:
              daysLeft <= 0
                ? `${devisLabel(dv)} expire aujourd'hui`
                : `${devisLabel(dv)} expire dans ${daysLeft} j`,
            corps: 'Relancez le client ou renvoyez une version avec une nouvelle validité.',
            devis: dv,
        supabase,
            extraData: { marker },
          })
          out.expirations += 1
        }
      }
    }
    if (expired) continue

    // ── Proposition de relance ───────────────────────────────────────────────
    const nonOuvertJours = orgSetting(orgId, 'devis_relance_non_ouvert_jours', 5)
    const sansReponseJours = orgSetting(orgId, 'devis_relance_sans_reponse_jours', 10)
    const intervalleJours = orgSetting(orgId, 'devis_relance_intervalle_jours', 7)

    const sentDays = (now - new Date(dv.sent_at).getTime()) / DAY_MS
    const remindedRecently =
      dv.last_reminded_at && (now - new Date(dv.last_reminded_at).getTime()) / DAY_MS < intervalleJours
    if (remindedRecently) continue
    if (await recentlyNotified(supabase, dv.id, 'devis_relance', intervalleJours * 24)) continue

    const { data: views } = await supabase
      .from('devis_public_events')
      .select('id')
      .eq('devis_id', dv.id)
      .eq('type', 'view')
      .limit(1)
    const opened = Boolean(views?.length)

    let corps: string | null = null
    if (!opened && sentDays >= nonOuvertJours) {
      corps = `Envoyé il y a ${Math.floor(sentDays)} j et jamais ouvert par le client.`
    } else if (opened && sentDays >= sansReponseJours) {
      corps = `Consulté par le client mais sans réponse depuis ${Math.floor(sentDays)} j.`
    }
    if (corps) {
      const recipients = await resolveRecipients(supabase, dv, 'quotidien', 'devis_relances')
      await sendDevisNotification({
        userIds: recipients,
        type: 'devis_relance',
        titre: `Relance suggérée : ${devisLabel(dv)}`,
        corps,
        devis: dv,
        supabase,
      })
      out.relances += 1
    }
  }

  // ── Purge des notifications anciennes (90 j) ───────────────────────────────
  const cutoff = new Date(now - 90 * DAY_MS).toISOString()
  const { count } = await supabase
    .from('notifications')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)
  out.purged = count || 0

  return json({ ok: true, ...out })
})
