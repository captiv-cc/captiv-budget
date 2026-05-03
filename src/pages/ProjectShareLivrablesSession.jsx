// ════════════════════════════════════════════════════════════════════════════
// ProjectShareLivrablesSession — Sous-page /share/projet/:token/livrables
// (PROJECT-SHARE-3)
// ════════════════════════════════════════════════════════════════════════════
//
// Wrapper minimaliste qui :
//   - Récupère le payload via useProjectShareLivrables(token) (RPC
//     share_projet_livrables_fetch — SECURITY DEFINER, même shape que
//     share_livrables_fetch).
//   - Réutilise LivrableShareView (exporté par LivrableShareSession) — pas
//     une ligne de duplication de code de rendu.
//   - Partage le thème dark/light avec le hub via PROJECT_SHARE_THEME_KEY.
//   - Affiche un lien "← Portail" qui ramène au hub.
//   - Loading/erreur cohérent avec la sous-page Équipe.
//
// La signature de LivrableShareView est plus riche que celle de
// EquipeShareView (cf. LivrableShareSession.jsx) — on déstructure le payload
// ici pour aligner le contrat.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react'
import { useProjectShareLivrables } from '../hooks/useProjectShareSession'
import { LivrableShareView } from './LivrableShareSession'
import { PROJECT_SHARE_THEME_KEY } from './ProjectShareSession'

export default function ProjectShareLivrablesSession() {
  const { token } = useParams()
  const { payload, loading, error } = useProjectShareLivrables(token)

  // Thème partagé avec le hub (clé localStorage commune). Default 'dark'
  // pour rester cohérent avec le hub. Note : LivrableShareSession indépendant
  // a son propre default 'light', mais ici on est dans le portail → on suit
  // la convention portail.
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === 'undefined') return 'dark'
    return localStorage.getItem(PROJECT_SHARE_THEME_KEY) === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.checkTheme = 'light'
    else delete root.dataset.checkTheme
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROJECT_SHARE_THEME_KEY, theme)
    }
    return () => {
      delete root.dataset.checkTheme
    }
  }, [theme])

  if (loading) {
    return (
      <FullScreenStatus
        icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}
      >
        Chargement des livrables…
      </FullScreenStatus>
    )
  }

  if (error || !payload) {
    return <ErrorState error={error} token={token} />
  }

  // Déstructuration alignée sur LivrableShareSession.jsx (composant ShareContent
  // exporté en LivrableShareView). On reproduit le même contrat de props.
  const share = payload.share || {}
  const project = payload.project || {}
  const org = payload.org || null
  const blocks = payload.blocks || []
  const livrables = payload.livrables || []
  const versions = payload.versions || []
  const etapes = payload.etapes || []
  const eventTypes = payload.event_types || []
  const config = share.config || {}
  const calendarLevel = config.calendar_level || 'hidden'

  return (
    <div style={{ background: 'var(--bg)' }}>
      <BackToHubLink token={token} />
      <LivrableShareView
        payload={payload}
        project={project}
        share={share}
        org={org}
        blocks={blocks}
        livrables={livrables}
        versions={versions}
        etapes={etapes}
        eventTypes={eventTypes}
        config={config}
        calendarLevel={calendarLevel}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      />
    </div>
  )
}

// ─── Lien retour vers le hub portail ────────────────────────────────────────
function BackToHubLink({ token }) {
  return (
    <div
      className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6"
      style={{ background: 'var(--bg)' }}
    >
      <Link
        to={`/share/projet/${encodeURIComponent(token)}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors"
        style={{ color: 'var(--txt-3)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--txt)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Portail projet
      </Link>
    </div>
  )
}

// ─── États système (loading / erreur) ──────────────────────────────────────
function FullScreenStatus({ icon, children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="flex flex-col items-center gap-3">
        {icon}
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          {children}
        </p>
      </div>
    </div>
  )
}

function ErrorState({ error, token }) {
  const msg = error?.message || 'Erreur inconnue'
  const lower = msg.toLowerCase()
  const isInvalid = lower.includes('invalid') || lower.includes('expired')
  const isNotEnabled = lower.includes('non activée') || lower.includes('not enabled')

  // Détails techniques (code + message + hint + details) pour aider à diagnostiquer
  // un faux fallback. Seulement affiché si on n'est pas en cas isInvalid (le
  // destinataire externe n'a pas besoin de voir le code Postgres pour un lien
  // expiré). Mirror du pattern LivrableShareSession.
  const techDetail = !isInvalid
    ? [error?.code, error?.message, error?.hint, error?.details]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div
        className="max-w-md w-full text-center p-6 sm:p-8 rounded-2xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <AlertCircle
          className="w-10 h-10 mx-auto mb-3"
          style={{ color: 'var(--red)', opacity: 0.7 }}
        />
        <h1 className="text-base font-bold mb-2" style={{ color: 'var(--txt)' }}>
          {isInvalid
            ? 'Lien invalide'
            : isNotEnabled
              ? 'Page non activée'
              : 'Page inaccessible'}
        </h1>
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--txt-2)' }}>
          {isInvalid
            ? 'Ce lien n\u2019est plus valide. Il a peut-être été révoqué ou a expiré.'
            : isNotEnabled
              ? 'La page Livrables n\u2019est pas activée pour ce portail.'
              : 'Impossible de charger les livrables pour le moment. Réessayez dans quelques instants.'}
        </p>
        {techDetail && (
          <details className="mt-4 text-left">
            <summary
              className="cursor-pointer text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--txt-3)' }}
            >
              Détails techniques
            </summary>
            <pre
              className="mt-2 text-[10px] whitespace-pre-wrap break-all p-2 rounded"
              style={{
                color: 'var(--txt-3)',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
              }}
            >
              {techDetail}
            </pre>
          </details>
        )}
        {token && (
          <Link
            to={`/share/projet/${encodeURIComponent(token)}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold mt-4"
            style={{ color: 'var(--blue)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour au portail
          </Link>
        )}
      </div>
    </div>
  )
}
