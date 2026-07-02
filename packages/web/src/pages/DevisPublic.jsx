/**
 * DevisPublic — page client, accessible via /devis/public/:token
 *
 * Design aligné sur le portail projet (/share/*) : hero avec cover du projet
 * floutée + logo org (SharePageHeader), fond ambiant liquid glass, cartes en
 * verre. Thème sombre fixe (le PDF, blanc, ressort dessus).
 *
 * Contenu : timeline de statut (Envoyé → Consulté → Accepté), mot
 * d'accompagnement personnalisé, PDF figé rendu en pages pdf.js (défilement
 * OK sur mobile, contrairement à l'iframe), historique des versions envoyées
 * du lot. Les infos émetteur/destinataire ne sont PAS répétées : elles sont
 * déjà dans le PDF.
 *
 * Données : tout passe par l'edge function devis-public (service role).
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SharePageHeader from '../components/share/SharePageHeader'
import PdfPagesViewer from '../components/PdfPagesViewer'
import { Check, X, Download, FileText, RefreshCw, Mail, ArrowRight, Layers } from 'lucide-react'

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''
const fmtDateShort = (iso) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''

// Carte "verre" du thème sombre public
const glass = {
  background: 'rgba(255,255,255,0.045)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: '16px',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
}

const STATUS_CHIPS = {
  envoye: { label: 'Envoyé', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  accepte: { label: 'Accepté', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  refuse: { label: 'Refusé', color: 'rgba(255,255,255,0.5)', bg: 'rgba(255,255,255,0.08)' },
}

export default function DevisPublic() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [acceptModal, setAcceptModal] = useState(false)
  // Formulaire signataire (Phase 2 Universign)
  const [signName, setSignName] = useState('')
  const [signFonction, setSignFonction] = useState('')
  const [signEmail, setSignEmail] = useState('')
  const [signError, setSignError] = useState(null)
  const [signFallback, setSignFallback] = useState(false) // Universign non configuré
  // Refus motivé
  const [refuseModal, setRefuseModal] = useState(false)
  const [refuseReason, setRefuseReason] = useState('')
  const [refusing, setRefusing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: res, error } = await supabase.functions.invoke('devis-public', {
      body: { token, action: 'get' },
    })
    if (error || !res || res.error) {
      setNotFound(true)
    } else {
      setData(res)
      if (res.client?.email) setSignEmail((p) => p || res.client.email)
      if (res.client?.contact_name) setSignName((p) => p || res.client.contact_name)
    }
    setLoading(false)
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  // Acceptation simple (fallback quand Universign n'est pas configuré)
  async function confirmAccept() {
    if (accepting) return
    setAccepting(true)
    const { data: res, error } = await supabase.functions.invoke('devis-public', {
      body: { token, action: 'accept' },
    })
    setAccepting(false)
    setAcceptModal(false)
    if (error || res?.error) {
      load()
      return
    }
    setData((d) => ({
      ...d,
      devis: { ...d.devis, status: 'accepte', accepted_at: new Date().toISOString() },
    }))
  }

  // Signature Universign : crée la transaction et redirige vers la cérémonie.
  async function startSignature() {
    if (accepting) return
    setSignError(null)
    if (!signName.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signEmail.trim())) {
      setSignError('Renseignez votre nom et un email valide.')
      return
    }
    setAccepting(true)
    const { data: res, error } = await supabase.functions.invoke('devis-sign', {
      body: {
        token,
        signer: { name: signName.trim(), email: signEmail.trim(), fonction: signFonction.trim() },
      },
    })
    setAccepting(false)
    if (res?.url) {
      window.location.href = res.url
      return
    }
    // Universign non configuré (501) ou fonction non déployée (404) → bascule
    // sur le bon pour accord simple. La signature reste un plus, jamais un mur.
    const status = error?.context?.status
    if (status === 501 || status === 404 || res?.error === 'not_configured') {
      setSignFallback(true)
      return
    }
    if (res?.error === 'not_signable') {
      load()
      return
    }
    setSignError('La signature est indisponible pour le moment. Réessayez ou contactez votre interlocuteur.')
  }

  async function confirmRefuse() {
    if (refusing) return
    setRefusing(true)
    const { data: res, error } = await supabase.functions.invoke('devis-public', {
      body: { token, action: 'refuse', reason: refuseReason.trim() },
    })
    setRefusing(false)
    setRefuseModal(false)
    if (error || res?.error) {
      load()
      return
    }
    setData((d) => ({ ...d, devis: { ...d.devis, status: 'refuse' } }))
  }

  function handleDownload() {
    const url = data?.signedPdfUrl || data?.pdfUrl
    if (!url) return
    supabase.functions.invoke('devis-public', { body: { token, action: 'download' } })
    window.open(url, '_blank', 'noopener')
  }

  if (loading)
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{ background: '#0b0d10' }}
      >
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )

  if (notFound)
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen text-center p-8"
        style={{ background: '#0b0d10' }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          <X className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Devis introuvable</h1>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Ce lien est invalide ou a expiré.
        </p>
      </div>
    )

  const { devis, project, org, pdfUrl, signature, signedPdfUrl, expired, versions = [] } = data
  const accepted = devis.status === 'accepte'
  const refused = devis.status === 'refuse'
  const signaturePending = !accepted && !refused && !expired && signature?.status === 'started'
  const displayPdfUrl = signedPdfUrl || pdfUrl
  const cover = project?.cover_url
  const orgName = org?.display_name || org?.legal_name || ''
  const newerVersion = versions.find((v) => !v.current && v.version_number > devis.version_number)
  const mailHref = org?.email
    ? `mailto:${org.email}?subject=${encodeURIComponent(`Devis V${devis.version_number}${project?.title ? ` · ${project.title}` : ''}`)}`
    : null

  return (
    <div className="min-h-screen relative" style={{ background: '#0b0d10' }}>
      {/* ── Fond ambiant : cover projet floutée (liquid glass) ─────────────── */}
      {cover && (
        <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
          <img
            src={cover}
            alt=""
            className="w-full h-full object-cover"
            style={{ filter: 'blur(90px) saturate(1.2)', transform: 'scale(1.3)', opacity: 0.16 }}
          />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, rgba(11,13,16,0.2), #0b0d10 75%)' }}
          />
        </div>
      )}

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-4 sm:gap-5">
        {/* ── Hero portail ───────────────────────────────────────────────── */}
        <SharePageHeader
          kicker="Devis"
          pageTitle={devis.title || `Devis V${devis.version_number}`}
          project={{ title: project?.title, ref_projet: project?.ref_projet, cover_url: cover }}
          org={org}
          metaItems={[
            { type: 'ref', value: `V${devis.version_number}` },
            project?.ref_projet && { type: 'ref', value: project.ref_projet },
            devis.sent_at && { type: 'label', value: `Envoyé le ${fmtDate(devis.sent_at)}` },
          ].filter(Boolean)}
          actions={
            mailHref && (
              <a
                href={mailHref}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white backdrop-blur transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.25)',
                }}
                title={`Écrire à ${orgName}`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Une question ?</span>
              </a>
            )
          }
        />

        {/* ── Version plus récente disponible ────────────────────────────── */}
        {newerVersion && (
          <a
            href={`/devis/public/${newerVersion.token}`}
            className="flex items-center gap-3 px-5 py-3 transition-transform hover:scale-[1.005]"
            style={{
              ...glass,
              background: 'rgba(251,191,36,0.09)',
              border: '1px solid rgba(251,191,36,0.3)',
            }}
          >
            <Layers className="w-4 h-4 shrink-0" style={{ color: '#fbbf24' }} />
            <p className="text-sm flex-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
              <strong style={{ color: '#fbbf24' }}>
                Une version plus récente (V{newerVersion.version_number}) a été envoyée
              </strong>
              {newerVersion.sent_at ? ` le ${fmtDate(newerVersion.sent_at)}.` : '.'}
            </p>
            <span
              className="inline-flex items-center gap-1 text-xs font-bold shrink-0"
              style={{ color: '#fbbf24' }}
            >
              Consulter <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </a>
        )}

        {/* ── Statut / action ────────────────────────────────────────────── */}
        {accepted ? (
          <div
            className="flex items-center gap-3 px-5 py-4"
            style={{
              ...glass,
              background: 'rgba(34,197,94,0.10)',
              border: '1px solid rgba(34,197,94,0.3)',
            }}
          >
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'rgba(34,197,94,0.2)' }}
            >
              <Check className="w-5 h-5 text-green-400" />
            </span>
            <div>
              <p className="text-sm font-bold text-white">
                Devis {signature?.status === 'signed' ? 'signé' : 'accepté'}
                {signature?.status === 'signed' && signature?.signer_name
                  ? ` par ${signature.signer_name}`
                  : ''}
                {devis.accepted_at ? ` le ${fmtDate(devis.accepted_at)}` : ''}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Merci pour votre confiance. {orgName} revient vers vous rapidement.
              </p>
            </div>
          </div>
        ) : refused ? (
          <div className="flex items-center gap-3 px-5 py-4" style={glass}>
            <X className="w-5 h-5 shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }} />
            <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Ce devis a été refusé.
            </p>
          </div>
        ) : expired ? (
          <div
            className="flex flex-wrap items-center gap-3 px-5 py-4"
            style={{
              ...glass,
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.28)',
            }}
          >
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-bold" style={{ color: '#fbbf24' }}>
                Offre expirée le {fmtDate(devis.valid_until)}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Ce devis n&apos;est plus valable. Contactez {orgName || 'votre interlocuteur'} pour
                une nouvelle proposition.
              </p>
            </div>
            {mailHref && (
              <a
                href={mailHref}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              >
                <Mail className="w-4 h-4" />
                Nous contacter
              </a>
            )}
          </div>
        ) : signaturePending ? (
          <div className="flex flex-wrap items-center gap-3 px-5 py-4" style={glass}>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-bold text-white">Signature en cours</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Une signature a été initiée par {signature.signer_name}. Reprenez-la ou
                recommencez avec un autre signataire.
              </p>
            </div>
            {signature.resumeUrl && (
              <a
                href={signature.resumeUrl}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-transform hover:scale-[1.02]"
                style={{
                  background: 'linear-gradient(135deg, #16a34a, #22c55e)',
                  boxShadow: '0 8px 24px rgba(34,197,94,0.25)',
                }}
              >
                <Check className="w-4 h-4" />
                Reprendre la signature
              </a>
            )}
            <button
              onClick={() => setAcceptModal(true)}
              className="text-xs px-3 py-2 rounded-lg font-semibold"
              style={{ color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              Autre signataire
            </button>
          </div>
        ) : (
          pdfUrl && (
            <div className="flex flex-wrap items-center gap-3 px-5 py-4" style={glass}>
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-bold text-white">Ce devis vous convient ?</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  Signature électronique rapide, horodatée et à valeur légale.
                  {devis.valid_until && (
                    <> Offre valable jusqu&apos;au {fmtDate(devis.valid_until)}.</>
                  )}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <button
                  onClick={() => setAcceptModal(true)}
                  disabled={accepting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, #16a34a, #22c55e)',
                    boxShadow: '0 8px 24px rgba(34,197,94,0.25)',
                  }}
                >
                  <Check className="w-4 h-4" />
                  Signer ce devis
                </button>
                <button
                  onClick={() => setRefuseModal(true)}
                  className="text-[11px] underline-offset-2 hover:underline"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                >
                  ou refuser ce devis
                </button>
              </div>
            </div>
          )
        )}

        {/* ── Mot d'accompagnement ───────────────────────────────────────── */}
        {devis.message_client && (
          <div
            className="px-5 py-4"
            style={{ ...glass, borderLeft: '3px solid rgba(96,165,250,0.6)' }}
          >
            <p
              className="text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: 'rgba(255,255,255,0.85)' }}
            >
              {devis.message_client}
            </p>
            {orgName && (
              <p className="text-xs mt-2 font-semibold" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {orgName}
              </p>
            )}
          </div>
        )}

        {/* ── Document ───────────────────────────────────────────────────── */}
        {pdfUrl ? (
          <div style={{ ...glass, overflow: 'hidden' }}>
            <div
              className="flex items-center justify-between px-5 py-3"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-white min-w-0">
                <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="truncate">Devis V{devis.version_number}</span>
                {signedPdfUrl ? (
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ color: '#4ade80', background: 'rgba(74,222,128,0.12)' }}
                  >
                    Document signé
                  </span>
                ) : (
                  devis.pdf_snapshot_at && (
                    <span
                      className="text-xs font-normal hidden sm:inline"
                      style={{ color: 'rgba(255,255,255,0.45)' }}
                    >
                      édité le {fmtDate(devis.pdf_snapshot_at)}
                    </span>
                  )
                )}
              </div>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors shrink-0"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                <Download className="w-3.5 h-3.5" />
                Télécharger
              </button>
            </div>
            <PdfPagesViewer url={displayPdfUrl} />
          </div>
        ) : (
          <div className="p-10 text-center" style={glass}>
            <FileText
              className="w-8 h-8 mx-auto mb-3"
              style={{ color: 'rgba(255,255,255,0.25)' }}
            />
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Le document n&apos;est pas encore disponible. Contactez votre interlocuteur.
            </p>
          </div>
        )}

        {/* ── Versions envoyées ──────────────────────────────────────────── */}
        {versions.length > 1 && (
          <div style={glass}>
            <div
              className="flex items-center gap-2 px-5 py-3"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Layers className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
              <p className="text-sm font-semibold text-white">Versions de la proposition</p>
            </div>
            {versions.map((v) => {
              const chip = STATUS_CHIPS[v.status] || STATUS_CHIPS.envoye
              return (
                <a
                  key={v.token}
                  href={v.current ? undefined : `/devis/public/${v.token}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors"
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    cursor: v.current ? 'default' : 'pointer',
                    background: v.current ? 'rgba(255,255,255,0.03)' : 'transparent',
                  }}
                >
                  <span
                    className="font-mono text-xs font-bold px-2 py-0.5 rounded shrink-0"
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.85)',
                    }}
                  >
                    V{v.version_number}
                  </span>
                  <span className="text-sm text-white truncate flex-1">
                    {v.title || `Devis V${v.version_number}`}
                    {v.sent_at && (
                      <span
                        className="text-xs ml-2"
                        style={{ color: 'rgba(255,255,255,0.4)' }}
                      >
                        envoyé le {fmtDateShort(v.sent_at)}
                      </span>
                    )}
                  </span>
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ color: chip.color, background: chip.bg }}
                  >
                    {chip.label}
                  </span>
                  {v.current ? (
                    <span
                      className="text-[11px] shrink-0"
                      style={{ color: 'rgba(255,255,255,0.4)' }}
                    >
                      Vous êtes ici
                    </span>
                  ) : (
                    <ArrowRight
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: 'rgba(255,255,255,0.4)' }}
                    />
                  )}
                </a>
              )
            })}
          </div>
        )}

        {/* ── Pied ───────────────────────────────────────────────────────── */}
        <p className="text-center text-xs pb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Document confidentiel. Lien de consultation personnel, ne pas diffuser.
        </p>
      </div>

      {/* ── Modale de refus ───────────────────────────────────────────────── */}
      {refuseModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
          onClick={() => setRefuseModal(false)}
        >
          <div
            className="w-full p-6"
            style={{ ...glass, maxWidth: '420px', background: 'rgba(24,27,32,0.95)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-white mb-2">Refuser ce devis</h3>
            <p className="text-sm leading-relaxed mb-4" style={{ color: 'rgba(255,255,255,0.65)' }}>
              Pouvez-vous nous dire pourquoi ? Cela nous aide à revenir avec une proposition plus
              adaptée.
            </p>
            <textarea
              value={refuseReason}
              onChange={(e) => setRefuseReason(e.target.value)}
              placeholder="Budget dépassé, projet reporté, autre prestataire… (optionnel)"
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none resize-none mb-4"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                lineHeight: 1.5,
              }}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setRefuseModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ color: 'rgba(255,255,255,0.65)' }}
              >
                Annuler
              </button>
              <button
                onClick={confirmRefuse}
                disabled={refusing}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white"
                style={{
                  background: 'rgba(239,68,68,0.85)',
                  boxShadow: '0 8px 24px rgba(239,68,68,0.2)',
                }}
              >
                {refusing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                Refuser le devis
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modale de signature ───────────────────────────────────────────── */}
      {acceptModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
          onClick={() => setAcceptModal(false)}
        >
          <div
            className="w-full p-6"
            style={{ ...glass, maxWidth: '440px', background: 'rgba(24,27,32,0.95)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {signFallback ? (
              <>
                <h3 className="text-base font-bold text-white mb-2">Accepter ce devis</h3>
                <p
                  className="text-sm leading-relaxed mb-5"
                  style={{ color: 'rgba(255,255,255,0.65)' }}
                >
                  Vous acceptez le devis V{devis.version_number}
                  {devis.title ? ` « ${devis.title} »` : ''} émis par {orgName || 'l’émetteur'}.
                  Cette action vaut bon pour accord et sera horodatée.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setAcceptModal(false)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{ color: 'rgba(255,255,255,0.65)' }}
                  >
                    Annuler
                  </button>
                  <button
                    onClick={confirmAccept}
                    disabled={accepting}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white"
                    style={{
                      background: 'linear-gradient(135deg, #16a34a, #22c55e)',
                      boxShadow: '0 8px 24px rgba(34,197,94,0.25)',
                    }}
                  >
                    {accepting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Bon pour accord
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-base font-bold text-white mb-2">Signer ce devis</h3>
                <p
                  className="text-sm leading-relaxed mb-4"
                  style={{ color: 'rgba(255,255,255,0.65)' }}
                >
                  Devis V{devis.version_number}
                  {devis.title ? ` « ${devis.title} »` : ''} émis par {orgName || 'l’émetteur'}.
                  Vous allez être redirigé vers Universign, tiers de confiance, pour la signature
                  électronique.
                </p>
                <div className="flex flex-col gap-3 mb-4">
                  <SignInput
                    label="Nom et prénom *"
                    value={signName}
                    onChange={setSignName}
                    placeholder="Jean Dupont"
                  />
                  <SignInput
                    label="Fonction"
                    value={signFonction}
                    onChange={setSignFonction}
                    placeholder="Directeur de production (optionnel)"
                  />
                  <SignInput
                    label="Email *"
                    type="email"
                    value={signEmail}
                    onChange={setSignEmail}
                    placeholder="jean@entreprise.fr"
                  />
                </div>
                {signError && (
                  <p className="text-xs mb-3" style={{ color: '#f87171' }}>
                    {signError}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setAcceptModal(false)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{ color: 'rgba(255,255,255,0.65)' }}
                  >
                    Annuler
                  </button>
                  <button
                    onClick={startSignature}
                    disabled={accepting}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white"
                    style={{
                      background: 'linear-gradient(135deg, #16a34a, #22c55e)',
                      boxShadow: '0 8px 24px rgba(34,197,94,0.25)',
                    }}
                  >
                    {accepting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Continuer vers la signature
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Champ du formulaire signataire ──────────────────────────────────────────

function SignInput({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: 'rgba(255,255,255,0.45)' }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="px-3 py-2 rounded-lg text-sm text-white outline-none"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.14)',
        }}
      />
    </label>
  )
}

