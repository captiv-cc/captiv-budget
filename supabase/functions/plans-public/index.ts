// ════════════════════════════════════════════════════════════════════════════
// plans-public — accès client aux plans techniques partagés (token)
// ════════════════════════════════════════════════════════════════════════════
//
// Route publique /plans/share/:token (pas d'auth Supabase) : cette function
// (service role) valide le token et sert :
//   - action 'get'          : plan + ydocState + projet/org + commentaires
//   - action 'sign-assets'  : URLs signées des fichiers storage référencés
//                             par le doc (fond, images collées) — chemins
//                             restreints au project_id du plan
//   - action 'comment'      : commentaire ancré (permissions 'comment')
//   - action 'validate'     : statut → 'valide' (validation client)
//
// Déploiement : supabase functions deploy plans-public --no-verify-jwt
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { corsHeaders } from '../_shared/cors.ts'
import { resolvePlanRecipients, sendPlanNotification } from '../_shared/plansNotify.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Config manquante' }, 500)
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

  let payload: {
    token?: string
    action?: string
    paths?: string[]
    body?: string
    anchorX?: number
    anchorY?: number
    parentId?: string
    clientName?: string
  }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'JSON invalide' }, 400)
  }
  const { token, action = 'get' } = payload
  if (!token || typeof token !== 'string') return json({ error: 'token requis' }, 400)

  // ── Validation du token ─────────────────────────────────────────────────
  const { data: share } = await supabase
    .from('plans_canvas_share_tokens')
    .select('id, canvas_id, permissions, expires_at, revoked_at, view_count, created_by, label, mode')
    .eq('token', token)
    .maybeSingle()
  if (!share) return json({ error: 'not_found' }, 404)
  if (share.revoked_at) return json({ error: 'revoked' }, 410)
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return json({ error: 'expired' }, 410)
  }

  const { data: canvas } = await supabase
    .from('plans_canvas')
    .select('id, project_id, titre, description, statut, updated_at, ydoc_state')
    .eq('id', share.canvas_id)
    .maybeSingle()
  if (!canvas) return json({ error: 'not_found' }, 404)

  // ── GET : payload complet de la page publique ───────────────────────────
  if (action === 'get') {
    // Contenu : plan en cours (live) ou dernière version figée (frozen).
    let ydocState = canvas.ydoc_state
    let frozenVersion: number | null = null
    if (share.mode === 'frozen') {
      const { data: versions } = await supabase
        .from('plans_canvas_versions')
        .select('ydoc_state, version')
        .eq('canvas_id', canvas.id)
        .order('version', { ascending: false })
        .limit(1)
      if (versions?.[0]?.ydoc_state) {
        ydocState = versions[0].ydoc_state
        frozenVersion = versions[0].version
      }
    }

    const { data: project } = await supabase
      .from('projects')
      .select(
        'title, ref_projet, cover_url, ' +
          'organisations(display_name, legal_name, email, phone, ' +
          'logo_url_clair, logo_url_sombre, logo_banner_url, brand_color, website_url)',
      )
      .eq('id', canvas.project_id)
      .maybeSingle()

    const { data: comments } = await supabase
      .from('plans_canvas_comments')
      .select('id, parent_id, anchor_x, anchor_y, body, author_type, author_client_name, resolved, created_at, author:profiles(full_name)')
      .eq('canvas_id', canvas.id)
      // Les commentaires internes équipe ne sortent JAMAIS par un lien de partage.
      .eq('internal', false)
      .order('created_at', { ascending: true })

    // Tracking léger (best-effort)
    await supabase
      .from('plans_canvas_share_tokens')
      .update({ view_count: (share.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
      .eq('id', share.id)

    return json({
      plan: {
        titre: canvas.titre,
        description: canvas.description,
        statut: canvas.statut,
        updated_at: canvas.updated_at,
        version: frozenVersion,
      },
      ydocState,
      permissions: share.permissions,
      project: project
        ? { title: project.title, ref_projet: project.ref_projet, cover_url: project.cover_url }
        : null,
      org: project?.organisations ?? null,
      comments: comments ?? [],
    })
  }

  // ── SIGN-ASSETS : URLs signées des fichiers du doc ──────────────────────
  if (action === 'sign-assets') {
    const paths = Array.isArray(payload.paths) ? payload.paths.slice(0, 50) : []
    const urls: Record<string, string> = {}
    for (const path of paths) {
      // Restreint au projet du plan (le token ne donne pas accès au reste).
      if (typeof path !== 'string' || !path.startsWith(`${canvas.project_id}/`)) continue
      const { data } = await supabase.storage.from('plans').createSignedUrl(path, 3600)
      if (data?.signedUrl) urls[path] = data.signedUrl
    }
    return json({ urls })
  }

  // ── COMMENT : commentaire client ancré ──────────────────────────────────
  if (action === 'comment') {
    if (share.permissions !== 'comment') return json({ error: 'forbidden' }, 403)
    const body = (payload.body || '').trim().slice(0, 2000)
    if (!body) return json({ error: 'body requis' }, 400)
    const clientName = (payload.clientName || '').trim().slice(0, 80) || 'Client'
    const insert: Record<string, unknown> = {
      canvas_id: canvas.id,
      body,
      author_type: 'client',
      author_client_name: clientName,
    }
    if (payload.parentId) {
      insert.parent_id = payload.parentId
    } else {
      if (typeof payload.anchorX !== 'number' || typeof payload.anchorY !== 'number') {
        return json({ error: 'anchor requis' }, 400)
      }
      insert.anchor_x = payload.anchorX
      insert.anchor_y = payload.anchorY
    }
    const { data: comment, error } = await supabase
      .from('plans_canvas_comments')
      .insert(insert)
      .select('id, parent_id, anchor_x, anchor_y, body, author_type, author_client_name, resolved, created_at')
      .single()
    if (error) return json({ error: error.message }, 500)

    // Notification desk/mobile : créateur du plan + créateur du lien.
    const recipients = await resolvePlanRecipients(
      supabase,
      canvas,
      'quotidien',
      'plans_commentaires',
      [share.created_by],
    )
    await sendPlanNotification({
      userIds: recipients,
      type: 'plan_commentaire',
      titre: `Commentaire sur « ${canvas.titre} »`,
      corps: `${clientName} : ${body.slice(0, 140)}${body.length > 140 ? '…' : ''}`,
      plan: canvas,
      supabase,
    })

    return json({ comment })
  }

  // ── VALIDATE : validation du plan par le destinataire ───────────────────
  if (action === 'validate') {
    if (canvas.statut === 'valide') return json({ ok: true, statut: 'valide' })
    const { error } = await supabase
      .from('plans_canvas')
      .update({ statut: 'valide' })
      .eq('id', canvas.id)
    if (error) return json({ error: error.message }, 500)

    // Notification majeure : créateur + créateur du lien + admins/charge_prod.
    const recipients = await resolvePlanRecipients(
      supabase,
      canvas,
      'majeur',
      'plans_validations',
      [share.created_by],
    )
    await sendPlanNotification({
      userIds: recipients,
      type: 'plan_valide',
      titre: `Plan validé : « ${canvas.titre} »`,
      corps: share.label ? `Validé via le lien « ${share.label} »` : 'Validé via le lien de partage',
      plan: canvas,
      supabase,
    })

    return json({ ok: true, statut: 'valide' })
  }

  return json({ error: 'action inconnue' }, 400)
})
