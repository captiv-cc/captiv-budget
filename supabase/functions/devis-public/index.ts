// ════════════════════════════════════════════════════════════════════════════
// devis-public — Edge Function : accès client au devis (Envoi client Phase 1)
// ════════════════════════════════════════════════════════════════════════════
//
// Point d'entrée unique de la page publique /devis/public/:token. Tourne en
// service role : la page publique n'a plus AUCUN accès direct aux tables.
//
// API : POST { token, action }
//   - action "get"      → données du devis + URL signée du PDF snapshot
//                          + enregistre un événement "view"
//   - action "download" → enregistre un événement "download" (fire & forget)
//   - action "accept"   → passe le devis en "accepte" (uniquement depuis
//                          "envoye") + événement "accept". La Phase 2 remplace
//                          ce chemin par le flux de signature Universign.
//
// Sécurité :
//   - le token (uuid non devinable) est le secret d'accès ;
//   - on ne renvoie que les champs nécessaires au client (jamais les coûts,
//     marges ou ids internes autres que la version) ;
//   - PDF servi via URL signée (bucket privé), valide 1 h ;
//   - déploiement : supabase functions deploy devis-public --no-verify-jwt
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { corsHeaders } from '../_shared/cors.ts'

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
    lotToken?: string
    action?: string
    reason?: string
  }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'JSON invalide' }, 400)
  }
  const { token, lotToken, action = 'get' } = payload

  // ── Page LOT : versions envoyées côte à côte (multi-options) ──────────────
  if (lotToken && typeof lotToken === 'string') {
    const { data: lot } = await supabase
      .from('devis_lots')
      .select('id, title, project_id')
      .eq('public_token', lotToken)
      .maybeSingle()
    if (!lot) return json({ error: 'not_found' }, 404)

    const { data: lotProj } = await supabase
      .from('projects')
      .select(
        'title, ref_projet, cover_url, ' +
          'organisations(display_name, legal_name, address, email, phone, siret, ' +
          'logo_url_clair, logo_url_sombre, logo_banner_url, brand_color)',
      )
      .eq('id', lot.project_id)
      .maybeSingle()

    const { data: options } = await supabase
      .from('devis')
      .select(
        'version_number, title, status, sent_at, accepted_at, valid_until, ' +
          'sent_total_ht, sent_total_ttc, public_token',
      )
      .eq('lot_id', lot.id)
      .not('sent_at', 'is', null)
      .order('version_number', { ascending: false })

    return json({
      lot: { title: lot.title },
      project: lotProj
        ? { title: lotProj.title, ref_projet: lotProj.ref_projet, cover_url: lotProj.cover_url }
        : null,
      org: lotProj?.organisations ?? null,
      options: (options || []).map((o) => ({
        version_number: o.version_number,
        title: o.title,
        status: o.status,
        sent_at: o.sent_at,
        accepted_at: o.accepted_at,
        valid_until: o.valid_until,
        total_ht: o.sent_total_ht,
        total_ttc: o.sent_total_ttc,
        token: o.public_token,
        expired:
          o.status === 'envoye' && o.valid_until
            ? new Date(o.valid_until).getTime() < Date.now()
            : false,
      })),
    })
  }

  if (!token || typeof token !== 'string') return json({ error: 'Token requis' }, 400)

  // ── Résolution du devis par token ──────────────────────────────────────────
  const { data: devis } = await supabase
    .from('devis')
    .select(
      'id, version_number, title, status, sent_at, accepted_at, refused_at, ' +
        'tva_rate, acompte_pct, notes, message_client, pdf_snapshot_path, pdf_snapshot_at, ' +
        'valid_until, refused_reason, project_id, lot_id',
    )
    .eq('public_token', token)
    .maybeSingle()
  if (!devis) return json({ error: 'not_found' }, 404)

  const expired =
    devis.status === 'envoye' &&
    Boolean(devis.valid_until) &&
    new Date(devis.valid_until).getTime() < Date.now()

  const userAgent = req.headers.get('user-agent') || null
  const logEvent = (type: string, meta: Record<string, unknown> = {}) =>
    supabase.from('devis_public_events').insert({
      devis_id: devis.id,
      type,
      user_agent: userAgent,
      meta,
    })

  // ── action: accept ─────────────────────────────────────────────────────────
  if (action === 'accept') {
    if (devis.status === 'accepte') return json({ status: 'accepte' })
    if (devis.status !== 'envoye') {
      return json({ error: 'not_acceptable', status: devis.status }, 409)
    }
    if (expired) return json({ error: 'expired' }, 409)
    const { error } = await supabase
      .from('devis')
      .update({ status: 'accepte' })
      .eq('id', devis.id)
      .eq('status', 'envoye') // garde anti-course
    if (error) return json({ error: 'update_failed' }, 500)
    await logEvent('accept')
    return json({ status: 'accepte' })
  }

  // ── action: refuse (avec raison optionnelle) ───────────────────────────────
  if (action === 'refuse') {
    if (devis.status === 'refuse') return json({ status: 'refuse' })
    if (devis.status !== 'envoye') {
      return json({ error: 'not_refusable', status: devis.status }, 409)
    }
    const reason = typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 500) : null
    const { error } = await supabase
      .from('devis')
      .update({ status: 'refuse', refused_reason: reason || null })
      .eq('id', devis.id)
      .eq('status', 'envoye')
    if (error) return json({ error: 'update_failed' }, 500)
    await logEvent('refuse', reason ? { reason } : {})
    return json({ status: 'refuse' })
  }

  // ── action: download (tracking seul) ───────────────────────────────────────
  if (action === 'download') {
    await logEvent('download')
    return json({ ok: true })
  }

  // ── action: get ────────────────────────────────────────────────────────────
  const { data: proj } = await supabase
    .from('projects')
    .select(
      'title, ref_projet, cover_url, ' +
        'clients(raison_sociale, nom_commercial, contact_name, email), ' +
        'organisations(display_name, legal_name, address, email, phone, siret, ' +
        'logo_url_clair, logo_url_sombre, logo_banner_url, brand_color)',
    )
    .eq('id', devis.project_id)
    .maybeSingle()

  let pdfUrl: string | null = null
  if (devis.pdf_snapshot_path) {
    const { data: signed } = await supabase.storage
      .from('devis-snapshots')
      .createSignedUrl(devis.pdf_snapshot_path, 3600)
    pdfUrl = signed?.signedUrl ?? null
  }

  // État de signature (Phase 2) : dernière demande pour ce devis.
  const { data: sig } = await supabase
    .from('devis_signatures')
    .select('status, signer_name, signer_fonction, signed_pdf_path, updated_at, proof')
    .eq('devis_id', devis.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  let signature: Record<string, unknown> | null = null
  let signedPdfUrl: string | null = null
  if (sig) {
    signature = {
      status: sig.status,
      signer_name: sig.signer_name,
      signed_at: sig.status === 'signed' ? sig.updated_at : null,
    }
    if (sig.status === 'started') {
      // URL de reprise de la cérémonie (stockée dans la réponse start)
      const actions = (sig.proof as Record<string, unknown>)?.actions
      if (Array.isArray(actions)) {
        const a = actions.find(
          (x) => typeof (x as Record<string, unknown>)?.url === 'string',
        ) as Record<string, unknown> | undefined
        if (a?.url) signature.resumeUrl = a.url
      }
    }
    if (sig.signed_pdf_path) {
      const { data: sp } = await supabase.storage
        .from('devis-snapshots')
        .createSignedUrl(sig.signed_pdf_path, 3600)
      signedPdfUrl = sp?.signedUrl ?? null
    }
  }

  // Première consultation (pour la timeline client) : calculée AVANT
  // d'enregistrer la vue courante.
  const { data: firstView } = await supabase
    .from('devis_public_events')
    .select('created_at')
    .eq('devis_id', devis.id)
    .eq('type', 'view')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Autres versions ENVOYÉES du même lot : le client peut suivre l'historique
  // de la proposition (V1 envoyée, V2 envoyée, V3 acceptée…).
  let versionsQuery = supabase
    .from('devis')
    .select('version_number, title, status, sent_at, accepted_at, public_token')
    .not('sent_at', 'is', null)
    .order('version_number', { ascending: false })
  versionsQuery = devis.lot_id
    ? versionsQuery.eq('lot_id', devis.lot_id)
    : versionsQuery.eq('project_id', devis.project_id)
  const { data: versions } = await versionsQuery

  // Tracking de vue (best effort, n'empêche jamais l'affichage)
  try {
    await logEvent('view')
  } catch (_e) {
    /* no-op */
  }

  return json({
    devis: {
      version_number: devis.version_number,
      title: devis.title,
      status: devis.status,
      sent_at: devis.sent_at,
      accepted_at: devis.accepted_at,
      refused_at: devis.refused_at,
      message_client: devis.message_client,
      pdf_snapshot_at: devis.pdf_snapshot_at,
      valid_until: devis.valid_until,
      refused_reason: devis.refused_reason,
    },
    expired,
    project: proj
      ? { title: proj.title, ref_projet: proj.ref_projet, cover_url: proj.cover_url }
      : null,
    client: proj?.clients ?? null,
    org: proj?.organisations ?? null,
    pdfUrl,
    signature,
    signedPdfUrl,
    firstViewedAt: firstView?.created_at ?? null,
    versions: (versions || []).map((v) => ({
      version_number: v.version_number,
      title: v.title,
      status: v.status,
      sent_at: v.sent_at,
      accepted_at: v.accepted_at,
      token: v.public_token,
      current: v.public_token === token,
    })),
  })
})
