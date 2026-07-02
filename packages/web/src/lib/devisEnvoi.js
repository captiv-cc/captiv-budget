// ════════════════════════════════════════════════════════════════════════════
// devisEnvoi — envoi d'un devis au client (Phase 1 : snapshot PDF + lien)
// ════════════════════════════════════════════════════════════════════════════
//
// À l'envoi : on FIGE le document. Le PDF est généré dans le navigateur de
// l'admin (moteur exportDevisPDF existant), haché (SHA-256, futur dossier de
// preuve Universign), uploadé dans le bucket privé devis-snapshots, puis le
// devis passe en "envoyé" (sent_at horodaté par trigger). La page publique ne
// montre QUE ce snapshot : les modifications ultérieures de l'éditeur ne
// changent pas ce que le client voit, sauf renvoi explicite.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import { exportDevisPDF } from './pdfExport'

async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function getPublicDevisUrl(devis) {
  return `${window.location.origin}/devis/public/${devis?.public_token}`
}

// Génère + fige le PDF puis passe le devis en "envoyé".
// `message` : mot d'accompagnement affiché sur la page client (optionnel).
// Retourne { url, hash }. Lève une erreur explicite en cas d'échec.
export async function sendDevisToClient({ devis, categories, globalAdj, project, client, org, taux, message }) {
  // 1) PDF (même moteur que la préview / le téléchargement admin)
  const handle = await exportDevisPDF({ ...devis, categories, globalAdj }, project, client, org, taux)
  try {
    const hash = await sha256Hex(handle.blob)

    // 2) Upload storage : un fichier par envoi (horodaté) → on garde la trace
    //    de chaque version envoyée, pas seulement la dernière.
    const path = `${devis.id}/V${devis.version_number || 1}-${Date.now()}.pdf`
    const { error: upErr } = await supabase.storage
      .from('devis-snapshots')
      .upload(path, handle.blob, { contentType: 'application/pdf' })
    if (upErr) throw new Error(`upload PDF : ${upErr.message}`)

    // 3) Devis → envoyé + référence du snapshot (sent_at posé par trigger)
    const updates = {
      status: 'envoye',
      pdf_snapshot_path: path,
      pdf_snapshot_hash: hash,
      pdf_snapshot_at: new Date().toISOString(),
    }
    if (message !== undefined) updates.message_client = message || null
    const { error: updErr } = await supabase.from('devis').update(updates).eq('id', devis.id)
    if (updErr) throw new Error(`mise à jour devis : ${updErr.message}`)

    return { url: getPublicDevisUrl(devis), hash }
  } finally {
    handle.revoke()
  }
}

// Dernière signature du devis (Phase 2) : null si aucune.
export async function fetchDevisSignature(devisId) {
  const { data } = await supabase
    .from('devis_signatures')
    .select('status, signer_name, signer_email, signer_fonction, signed_pdf_path, updated_at')
    .eq('devis_id', devisId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

// URL signée (1 h) du PDF signé, pour l'admin.
export async function getSignedPdfUrl(signedPdfPath) {
  if (!signedPdfPath) return null
  const { data } = await supabase.storage
    .from('devis-snapshots')
    .createSignedUrl(signedPdfPath, 3600)
  return data?.signedUrl || null
}

// Agrégat de tracking pour l'admin : { views, lastViewAt, downloads }
export async function fetchDevisViewStats(devisId) {
  const { data, error } = await supabase
    .from('devis_public_events')
    .select('type, created_at')
    .eq('devis_id', devisId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error || !data) return { views: 0, lastViewAt: null, downloads: 0 }
  const views = data.filter((e) => e.type === 'view')
  return {
    views: views.length,
    lastViewAt: views[0]?.created_at || null,
    downloads: data.filter((e) => e.type === 'download').length,
  }
}
