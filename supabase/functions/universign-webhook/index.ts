// ════════════════════════════════════════════════════════════════════════════
// universign-webhook — Edge Function : complétion des signatures (Phase 2)
// ════════════════════════════════════════════════════════════════════════════
//
// URL à configurer dans le Developer menu Universign (Webhooks), événements
// de fin de transaction. Sécurité : le webhook n'est traité que comme un
// SIGNAL — on re-lit systématiquement la transaction via l'API Universign
// (source de vérité) avant d'agir, donc un appel forgé ne peut rien déclencher
// d'incorrect (au pire un re-sync).
//
//   transaction completed → télécharge le PDF signé → storage devis-snapshots,
//     devis_signatures.status = signed (+ proof), devis.status = accepte,
//     event public "accept" (meta signed).
//   refused  → devis_signatures.status = refused, devis.status = refuse.
//   expired / canceled → statut de la demande mis à jour, devis inchangé.
//
// Déploiement : supabase functions deploy universign-webhook --no-verify-jwt
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Les payloads webhook Universign peuvent varier : on ratisse les champs
// susceptibles de contenir l'id de transaction.
function extractTransactionId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const o = payload as Record<string, unknown>
  const candidates = [
    o.transaction_id,
    o.transactionId,
    (o.transaction as Record<string, unknown>)?.id,
    (o.data as Record<string, unknown>)?.transaction_id,
    ((o.data as Record<string, unknown>)?.transaction as Record<string, unknown>)?.id,
    (o.object as Record<string, unknown>)?.id,
    o.id,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 3) return c
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const UNIVERSIGN_API_KEY = Deno.env.get('UNIVERSIGN_API_KEY') ?? ''
  const UNIVERSIGN_BASE_URL = Deno.env.get('UNIVERSIGN_BASE_URL') || 'https://api.universign.com'
  if (!SUPABASE_URL || !SERVICE_ROLE || !UNIVERSIGN_API_KEY) return json({ ok: true })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json({ ok: true })
  }
  const txId = extractTransactionId(payload)
  if (!txId) return json({ ok: true, ignored: 'no_transaction_id' })

  // Demande de signature correspondante (sinon : pas pour nous)
  const { data: sig } = await supabase
    .from('devis_signatures')
    .select('id, devis_id, status, signer_name, signer_email')
    .eq('transaction_id', txId)
    .maybeSingle()
  if (!sig) return json({ ok: true, ignored: 'unknown_transaction' })
  if (sig.status !== 'started') return json({ ok: true, ignored: 'already_final' })

  // ── Source de vérité : relire la transaction chez Universign ──────────────
  const authHeader = { Authorization: `Bearer ${UNIVERSIGN_API_KEY}` }
  const txRes = await fetch(`${UNIVERSIGN_BASE_URL}/v1/transactions/${txId}`, {
    headers: authHeader,
  })
  if (!txRes.ok) return json({ ok: true, ignored: `fetch_${txRes.status}` })
  const tx = await txRes.json()
  const status: string = String(tx?.status || '').toLowerCase()

  const touch = { updated_at: new Date().toISOString() }

  if (status === 'completed') {
    // 1) Récupérer le PDF signé (best effort — la preuve API suffit sinon)
    let signedPath: string | null = null
    try {
      const docsRes = await fetch(
        `${UNIVERSIGN_BASE_URL}/v1/transactions/${txId}/signed-documents`,
        { headers: authHeader },
      )
      if (docsRes.ok) {
        const ct = docsRes.headers.get('content-type') || ''
        let pdfBytes: ArrayBuffer | null = null
        if (ct.includes('application/pdf')) {
          pdfBytes = await docsRes.arrayBuffer()
        } else if (ct.includes('json')) {
          const docs = await docsRes.json()
          const first = Array.isArray(docs) ? docs[0] : (docs?.data?.[0] ?? docs)
          // Selon le format : contenu base64 inline OU url de téléchargement
          const b64 = first?.content || first?.file?.content
          const url = first?.url || first?.download_url || first?.file?.url
          if (typeof b64 === 'string' && b64.length > 100) {
            pdfBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer
          } else if (typeof url === 'string') {
            const dl = await fetch(url, { headers: authHeader })
            if (dl.ok) pdfBytes = await dl.arrayBuffer()
          }
        }
        if (pdfBytes && pdfBytes.byteLength > 500) {
          signedPath = `${sig.devis_id}/signe-${txId}.pdf`
          const { error: upErr } = await supabase.storage
            .from('devis-snapshots')
            .upload(signedPath, new Blob([pdfBytes], { type: 'application/pdf' }), {
              contentType: 'application/pdf',
              upsert: true,
            })
          if (upErr) {
            console.error('[universign-webhook] upload signed pdf', upErr)
            signedPath = null
          }
        }
      }
    } catch (err) {
      console.error('[universign-webhook] signed doc', err)
    }

    // 2) Marquer la signature + le devis
    await supabase
      .from('devis_signatures')
      .update({ status: 'signed', signed_pdf_path: signedPath, proof: tx, ...touch })
      .eq('id', sig.id)
    await supabase.from('devis').update({ status: 'accepte' }).eq('id', sig.devis_id)
    await supabase.from('devis_public_events').insert({
      devis_id: sig.devis_id,
      type: 'accept',
      meta: { signed: true, transaction_id: txId, signer: sig.signer_email },
    })
    return json({ ok: true, handled: 'completed' })
  }

  if (status === 'refused') {
    await supabase
      .from('devis_signatures')
      .update({ status: 'refused', proof: tx, ...touch })
      .eq('id', sig.id)
    await supabase.from('devis').update({ status: 'refuse' }).eq('id', sig.devis_id)
    await supabase.from('devis_public_events').insert({
      devis_id: sig.devis_id,
      type: 'refuse',
      meta: { transaction_id: txId, signer: sig.signer_email },
    })
    return json({ ok: true, handled: 'refused' })
  }

  if (status === 'expired' || status === 'canceled' || status === 'cancelled') {
    await supabase
      .from('devis_signatures')
      .update({ status: status === 'expired' ? 'expired' : 'canceled', proof: tx, ...touch })
      .eq('id', sig.id)
    return json({ ok: true, handled: status })
  }

  return json({ ok: true, ignored: `status_${status}` })
})
