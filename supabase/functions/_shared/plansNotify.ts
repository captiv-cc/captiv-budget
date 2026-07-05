// ════════════════════════════════════════════════════════════════════════════
// plansNotify — notifications desk/mobile autour d'un plan éditable
// ════════════════════════════════════════════════════════════════════════════
//
// Utilisé par plans-public (commentaire destinataire, validation). Même
// architecture que devisNotify :
//   - "quotidien" (nouveau commentaire) → créateur du plan + créateur du
//     lien de partage, dédupliqués ;
//   - "majeur" (plan validé) → en plus, tous les admins/charge_prod de l'org.
// Préférences : user_settings.notif_prefs.plans_commentaires /
// plans_validations (absence de clé = activé) ; sourdines type 'project'
// (et 'plan') respectées.
// ════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

export interface PlanRef {
  id: string
  project_id: string
  titre?: string | null
}

export type PlanPrefKey = 'plans_commentaires' | 'plans_validations'

export async function resolvePlanRecipients(
  supabase: SupabaseClient,
  plan: PlanRef,
  scope: 'quotidien' | 'majeur',
  prefKey: PlanPrefKey,
  extraUserIds: Array<string | null | undefined> = [],
): Promise<string[]> {
  const ids = new Set<string>()
  const { data: row } = await supabase
    .from('plans_canvas')
    .select('created_by, updated_by')
    .eq('id', plan.id)
    .maybeSingle()
  if (row?.created_by) ids.add(row.created_by)
  for (const id of extraUserIds) if (id) ids.add(id)

  if (scope === 'majeur') {
    const { data: proj } = await supabase
      .from('projects')
      .select('org_id')
      .eq('id', plan.project_id)
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
    .select('user_id, notif_prefs')
    .in('user_id', all)
  const isMuted = (prefs: Record<string, unknown> | null) => {
    const mutes = (prefs?.mutes as Array<{ type: string; id: string }>) || []
    return (
      Array.isArray(mutes) &&
      mutes.some(
        (m) =>
          (m.type === 'plan' && m.id === plan.id) ||
          (m.type === 'project' && m.id === plan.project_id),
      )
    )
  }
  const optOut = new Set(
    (settings || [])
      .filter((s) => (s.notif_prefs && s.notif_prefs[prefKey] === false) || isMuted(s.notif_prefs))
      .map((s) => s.user_id),
  )
  return all.filter((id) => !optOut.has(id))
}

// Envoi via send-push (log table notifications + push mobile Expo).
export async function sendPlanNotification(opts: {
  userIds: string[]
  type: string
  titre: string
  corps?: string
  plan: PlanRef
  supabase?: SupabaseClient
}): Promise<void> {
  if (!opts.userIds.length) return
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!SUPABASE_URL || !SERVICE_ROLE) return
  let projectTitle: string | null = null
  if (opts.supabase) {
    const { data: proj } = await opts.supabase
      .from('projects')
      .select('title')
      .eq('id', opts.plan.project_id)
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
        link_web: `/projets/${opts.plan.project_id}/plans?canvas=${opts.plan.id}`,
        project_id: opts.plan.project_id,
        data: { plan_id: opts.plan.id, project_title: projectTitle },
      }),
    })
    if (!res.ok) {
      console.warn('[plansNotify] send-push', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.warn('[plansNotify]', err)
  }
}
