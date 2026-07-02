// ════════════════════════════════════════════════════════════════════════════
// devisNotify — notifications admin autour d'un devis (partagé edge functions)
// ════════════════════════════════════════════════════════════════════════════
//
// Utilisé par devis-public, universign-webhook et devis-scheduler.
// Politique de destinataires (décision Hugo, juil. 2026) :
//   - "quotidien" (consulté, relance, expiration) → envoyeur (sent_by) +
//     créateur (created_by) du devis, dédupliqués ;
//   - "majeur" (accepté/signé, refusé) → en plus, tous les profils de l'org
//     avec rôle admin ou charge_prod (l'équipe doit savoir).
// Filtre : user_settings.notif_devis = false → exclu.
// Livraison via send-push (log en table notifications + push mobile Expo).
// ════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

export interface DevisRef {
  id: string
  project_id: string
  sent_by?: string | null
  created_by?: string | null
  version_number?: number | null
  title?: string | null
}

// Catégories de préférence (user_settings.notif_prefs, absence de clé = activé) :
//   devis_consultations | devis_relances | devis_decisions | devis_modifications
export type DevisPrefKey =
  | 'devis_consultations'
  | 'devis_relances'
  | 'devis_decisions'
  | 'devis_modifications'

// Résout les destinataires selon la portée, filtre les opt-out (global +
// catégorie de préférence).
export async function resolveRecipients(
  supabase: SupabaseClient,
  devis: DevisRef,
  scope: 'quotidien' | 'majeur',
  prefKey: DevisPrefKey,
): Promise<string[]> {
  const ids = new Set<string>()
  if (devis.sent_by) ids.add(devis.sent_by)
  if (devis.created_by) ids.add(devis.created_by)

  if (scope === 'majeur') {
    const { data: proj } = await supabase
      .from('projects')
      .select('org_id')
      .eq('id', devis.project_id)
      .maybeSingle()
    if (proj?.org_id) {
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('org_id', proj.org_id)
        .in('role', ['admin', 'charge_prod'])
      for (const a of admins || []) ids.add(a.id)
    }
  }

  if (ids.size === 0) return []
  const all = [...ids]
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, notif_devis, notif_prefs')
    .in('user_id', all)
  const isMuted = (prefs: Record<string, unknown> | null) => {
    const mutes = (prefs?.mutes as Array<{ type: string; id: string }>) || []
    return (
      Array.isArray(mutes) &&
      mutes.some(
        (m) =>
          (m.type === 'devis' && m.id === devis.id) ||
          (m.type === 'project' && m.id === devis.project_id),
      )
    )
  }
  const optOut = new Set(
    (settings || [])
      .filter(
        (s) =>
          s.notif_devis === false ||
          (s.notif_prefs && s.notif_prefs[prefKey] === false) ||
          isMuted(s.notif_prefs),
      )
      .map((s) => s.user_id),
  )
  return all.filter((id) => !optOut.has(id))
}

// True si une notification de ce type pour ce devis a été émise depuis N heures
// (anti-spam : « devis consulté » max 1 fois/24 h, relance max 1 fois/N jours).
export async function recentlyNotified(
  supabase: SupabaseClient,
  devisId: string,
  type: string,
  withinHours: number,
): Promise<boolean> {
  const since = new Date(Date.now() - withinHours * 3600 * 1000).toISOString()
  const { data } = await supabase
    .from('notifications')
    .select('id')
    .eq('type', type)
    .gte('created_at', since)
    .contains('data', { devis_id: devisId })
    .limit(1)
  return Boolean(data?.length)
}

// Envoie la notification via send-push (log table + push mobile).
// `projectTitle` : affiché discrètement dans le panneau desk ; si absent,
// résolu depuis la DB quand `supabase` est fourni.
export async function sendDevisNotification(opts: {
  userIds: string[]
  type: string
  titre: string
  corps?: string
  devis: DevisRef
  extraData?: Record<string, unknown>
  projectTitle?: string | null
  supabase?: SupabaseClient
}): Promise<void> {
  if (!opts.userIds.length) return
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!SUPABASE_URL || !SERVICE_ROLE) return
  let projectTitle = opts.projectTitle ?? null
  if (!projectTitle && opts.supabase) {
    const { data: proj } = await opts.supabase
      .from('projects')
      .select('title')
      .eq('id', opts.devis.project_id)
      .maybeSingle()
    projectTitle = proj?.title ?? null
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_ids: opts.userIds,
        type: opts.type,
        titre: opts.titre,
        corps: opts.corps ?? null,
        link_web: `/projets/${opts.devis.project_id}/devis/${opts.devis.id}`,
        project_id: opts.devis.project_id,
        data: { devis_id: opts.devis.id, project_title: projectTitle, ...(opts.extraData || {}) },
      }),
    })
    if (!res.ok) {
      console.warn('[devisNotify] send-push', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.warn('[devisNotify]', err)
  }
}

// Libellé court d'un devis pour les titres de notification.
export function devisLabel(devis: DevisRef): string {
  const v = devis.version_number ? `V${devis.version_number}` : 'devis'
  return devis.title ? `${v} « ${devis.title} »` : `Devis ${v}`
}
