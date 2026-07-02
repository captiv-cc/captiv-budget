// ════════════════════════════════════════════════════════════════════════════
// devis-sign — Edge Function : démarre une signature Universign (Phase 2)
// ════════════════════════════════════════════════════════════════════════════
//
// Appelée par la page publique quand le client clique « Signer le devis ».
// Flux (cf. https://apps.universign.com/docs/guides/transactions/quick_start/) :
//   1. valide le token + statut « envoyé » + snapshot PDF présent ;
//   2. télécharge le PDF figé depuis le bucket devis-snapshots ;
//   3. Universign : POST /v1/files → /v1/transactions → documents → fields
//      (type signature) → signatures (signer = email) → start ;
//   4. enregistre la demande dans devis_signatures (proof = réponse start) ;
//   5. renvoie l'URL de la cérémonie de signature (redirection côté client).
//
// Reprise : si une signature « started » existe déjà pour ce devis et le même
// email, on renvoie l'URL stockée au lieu de créer une nouvelle transaction.
//
// Config (supabase secrets set …) :
//   UNIVERSIGN_API_KEY   — clé API (préprod ou prod)
//   UNIVERSIGN_BASE_URL  — optionnel, défaut https://api.universign.com
//                          (préprod : https://api.alpha.universign.com)
// Sans clé configurée → { error: "not_configured" } : la page publique
// retombe sur l'acceptation simple « bon pour accord ».
//
// Déploiement : supabase functions deploy devis-sign --no-verify-jwt
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
  const UNIVERSIGN_API_KEY = Deno.env.get('UNIVERSIGN_API_KEY') ?? ''
  const UNIVERSIGN_BASE_URL = Deno.env.get('UNIVERSIGN_BASE_URL') || 'https://api.universign.com'
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Config manquante' }, 500)
  if (!UNIVERSIGN_API_KEY) return json({ error: 'not_configured' }, 501)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

  let payload: { token?: string; signer?: { name?: string; email?: string; fonction?: string } }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'JSON invalide' }, 400)
  }
  const token = payload.token
  const signerName = payload.signer?.name?.trim()
  const signerEmail = payload.signer?.email?.trim().toLowerCase()
  const signerFonction = payload.signer?.fonction?.trim() || null
  if (!token) return json({ error: 'Token requis' }, 400)
  if (!signerName || !signerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signerEmail)) {
    return json({ error: 'invalid_signer' }, 400)
  }

  // ── Devis ──────────────────────────────────────────────────────────────────
  const { data: devis } = await supabase
    .from('devis')
    .select('id, version_number, title, status, pdf_snapshot_path')
    .eq('public_token', token)
    .maybeSingle()
  if (!devis) return json({ error: 'not_found' }, 404)
  if (devis.status !== 'envoye') return json({ error: 'not_signable', status: devis.status }, 409)
  if (!devis.pdf_snapshot_path) return json({ error: 'no_snapshot' }, 409)

  // ── Reprise d'une signature en cours (même email) ──────────────────────────
  const { data: existing } = await supabase
    .from('devis_signatures')
    .select('id, status, signer_email, proof')
    .eq('devis_id', devis.id)
    .eq('status', 'started')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing && existing.signer_email === signerEmail) {
    const resumeUrl = extractActionUrl(existing.proof)
    if (resumeUrl) return json({ url: resumeUrl, resumed: true })
  }

  // ── Universign ─────────────────────────────────────────────────────────────
  const authHeader = { Authorization: `Bearer ${UNIVERSIGN_API_KEY}` }
  const uni = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${UNIVERSIGN_BASE_URL}${path}`, {
      ...init,
      headers: { ...authHeader, ...(init.headers || {}) },
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      console.error('[devis-sign] Universign', path, res.status, JSON.stringify(body))
      throw new Error(`universign_${res.status}`)
    }
    return body
  }
  const form = (obj: Record<string, string>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(obj)) p.set(k, v)
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: p,
    }
  }

  try {
    // 1) PDF depuis le storage
    const { data: blob, error: dlErr } = await supabase.storage
      .from('devis-snapshots')
      .download(devis.pdf_snapshot_path)
    if (dlErr || !blob) throw new Error('snapshot_download_failed')

    // 2) Upload du fichier chez Universign (multipart)
    const fd = new FormData()
    fd.append('file', blob, `devis-V${devis.version_number}.pdf`)
    const file = await uni('/v1/files', { method: 'POST', body: fd })

    // 3) Transaction + document + champ de signature + signataire
    const tx = await uni('/v1/transactions', { method: 'POST' })
    const doc = await uni(`/v1/transactions/${tx.id}/documents`, form({ document: file.id }))
    const field = await uni(
      `/v1/transactions/${tx.id}/documents/${doc.id}/fields`,
      form({ type: 'signature' }),
    )
    await uni(
      `/v1/transactions/${tx.id}/signatures`,
      form({ signer: signerEmail, field: field.id }),
    )

    // 4) Démarrage → URL de cérémonie
    const started = await uni(`/v1/transactions/${tx.id}/start`, { method: 'POST' })
    const url = extractActionUrl(started)
    if (!url) throw new Error('no_action_url')

    // 5) Persistance de la demande
    await supabase.from('devis_signatures').insert({
      devis_id: devis.id,
      provider: 'universign',
      transaction_id: tx.id,
      signer_name: signerName,
      signer_email: signerEmail,
      signer_fonction: signerFonction,
      status: 'started',
      proof: started,
    })

    return json({ url })
  } catch (err) {
    console.error('[devis-sign]', err)
    return json({ error: 'sign_failed', detail: String(err?.message || err) }, 500)
  }
})

// Trouve l'URL d'action signataire dans une réponse transaction Universign.
function extractActionUrl(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const actions = o.actions
  if (Array.isArray(actions)) {
    for (const a of actions) {
      const url = (a as Record<string, unknown>)?.url
      if (typeof url === 'string' && url.startsWith('http')) return url
    }
  }
  // fallback : chercher une url http dans les valeurs de premier niveau
  for (const v of Object.values(o)) {
    if (typeof v === 'string' && v.startsWith('http') && v.includes('universign')) return v
  }
  return null
}
