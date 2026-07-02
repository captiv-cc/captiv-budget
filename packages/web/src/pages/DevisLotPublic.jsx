/**
 * DevisLotPublic — page client d'un LOT, accessible via /devis/lot/:token
 *
 * Présente côte à côte les versions ENVOYÉES d'un lot (« proposition à
 * options » : ex. formule SMALL vs FULL). Le client compare les montants et
 * ouvre l'option de son choix pour la consulter et la signer (chaque option
 * renvoie vers sa page /devis/public/:token).
 *
 * Même design que la page devis : hero portail + liquid glass, thème sombre.
 * Données : edge function devis-public, payload { lotToken }.
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SharePageHeader from '../components/share/SharePageHeader'
import { Check, X, ArrowRight, Layers, Mail } from 'lucide-react'

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''
const fmtEur = (v) =>
  v === null || v === undefined
    ? null
    : Number(v).toLocaleString('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
      })

const glass = {
  background: 'rgba(255,255,255,0.045)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: '16px',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
}

export default function DevisLotPublic() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: res, error } = await supabase.functions.invoke('devis-public', {
      body: { lotToken: token },
    })
    if (error || !res || res.error) setNotFound(true)
    else setData(res)
    setLoading(false)
  }, [token])

  useEffect(() => {
    load()
  }, [load])

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
        <h1 className="text-xl font-bold text-white mb-2">Proposition introuvable</h1>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Ce lien est invalide ou a expiré.
        </p>
      </div>
    )

  const { lot, project, org, options = [] } = data
  const cover = project?.cover_url
  const orgName = org?.display_name || org?.legal_name || ''
  const chosen = options.find((o) => o.status === 'accepte')
  const mailHref = org?.email
    ? `mailto:${org.email}?subject=${encodeURIComponent(`Proposition ${lot?.title || ''}${project?.title ? ` · ${project.title}` : ''}`)}`
    : null

  return (
    <div className="min-h-screen relative" style={{ background: '#0b0d10' }}>
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
        <SharePageHeader
          kicker="Proposition"
          pageTitle={lot?.title || 'Proposition'}
          project={{ title: project?.title, ref_projet: project?.ref_projet, cover_url: cover }}
          org={org}
          metaItems={[
            project?.ref_projet && { type: 'ref', value: project.ref_projet },
            options.length > 1 && {
              type: 'label',
              value: `${options.length} options proposées`,
            },
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

        {chosen && (
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
            <p className="text-sm font-bold text-white">
              Vous avez retenu la V{chosen.version_number}
              {chosen.title ? ` « ${chosen.title} »` : ''}
              {chosen.accepted_at ? ` le ${fmtDate(chosen.accepted_at)}` : ''}. Merci !
            </p>
          </div>
        )}

        {options.length === 0 ? (
          <div className="p-10 text-center" style={glass}>
            <Layers className="w-8 h-8 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.25)' }} />
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Aucune proposition disponible pour le moment.
            </p>
          </div>
        ) : (
          <div
            className={`grid grid-cols-1 gap-4 sm:gap-5 ${
              options.length >= 3 ? 'lg:grid-cols-3 sm:grid-cols-2' : 'sm:grid-cols-2'
            }`}
          >
            {options.map((o) => {
              const isChosen = o.status === 'accepte'
              const isRefused = o.status === 'refuse'
              const muted = (chosen && !isChosen) || isRefused
              return (
                <div
                  key={o.token}
                  className="flex flex-col p-5"
                  style={{
                    ...glass,
                    border: isChosen
                      ? '1px solid rgba(34,197,94,0.45)'
                      : glass.border,
                    opacity: muted ? 0.55 : 1,
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="font-mono text-xs font-bold px-2 py-0.5 rounded"
                      style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }}
                    >
                      V{o.version_number}
                    </span>
                    {isChosen && (
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{ color: '#4ade80', background: 'rgba(74,222,128,0.12)' }}
                      >
                        Option retenue
                      </span>
                    )}
                    {isRefused && (
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{ color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.08)' }}
                      >
                        Refusée
                      </span>
                    )}
                    {o.expired && !isChosen && !isRefused && (
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.12)' }}
                      >
                        Expirée
                      </span>
                    )}
                  </div>
                  <p className="text-base font-bold text-white leading-snug mb-3">
                    {o.title || `Devis V${o.version_number}`}
                  </p>
                  {fmtEur(o.total_ht) && (
                    <div className="mb-3">
                      <p className="text-2xl font-bold text-white tabular-nums">
                        {fmtEur(o.total_ht)}{' '}
                        <span
                          className="text-xs font-semibold"
                          style={{ color: 'rgba(255,255,255,0.45)' }}
                        >
                          HT
                        </span>
                      </p>
                      {fmtEur(o.total_ttc) && (
                        <p className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.45)' }}>
                          {fmtEur(o.total_ttc)} TTC
                        </p>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] mb-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Envoyée le {fmtDate(o.sent_at)}
                    {o.valid_until && !o.expired && ` · valable jusqu'au ${fmtDate(o.valid_until)}`}
                  </p>
                  <Link
                    to={`/devis/public/${o.token}`}
                    className="mt-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-transform hover:scale-[1.02]"
                    style={
                      isChosen || isRefused || o.expired
                        ? {
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid rgba(255,255,255,0.15)',
                          }
                        : {
                            background: 'linear-gradient(135deg, #16a34a, #22c55e)',
                            boxShadow: '0 8px 24px rgba(34,197,94,0.25)',
                          }
                    }
                  >
                    {isChosen || isRefused || o.expired ? 'Consulter' : 'Consulter et signer'}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-center text-xs pb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Document confidentiel. Lien de consultation personnel, ne pas diffuser.
        </p>
      </div>
    </div>
  )
}
