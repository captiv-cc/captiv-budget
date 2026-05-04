// ════════════════════════════════════════════════════════════════════════════
// ProjectSharePlansSession — Sous-page /share/projet/:token/plans
// (PLANS-SHARE-5f)
// ════════════════════════════════════════════════════════════════════════════
//
// Wrapper minimaliste qui :
//   - Récupère le payload via useProjectSharePlans(token) (RPC
//     share_projet_plans_fetch — SECURITY DEFINER, payload identique à
//     share_plans_fetch + signed URLs enrichies côté lib).
//   - Réutilise PlansShareView (exporté par PlansShareSession) — pas de
//     duplication du code de rendu.
//   - Partage le thème dark/light avec le hub via PROJECT_SHARE_THEME_KEY.
//   - Affiche un lien "← Portail" qui ramène au hub.
//   - Loading / erreur / password gate cohérents avec les autres sous-pages.
//
// Pattern aligné sur ProjectShareMaterielSession.jsx.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react'
import { useProjectSharePlans } from '../hooks/useProjectShareSession'
import { PlansShareView } from './PlansShareSession'
import { PROJECT_SHARE_THEME_KEY } from './ProjectShareSession'
import ProjectSharePasswordGate from '../components/share/ProjectSharePasswordGate'

export default function ProjectSharePlansSession() {
  const { token } = useParams()
  const {
    payload, loading, error,
    requirePassword, passwordHint, passwordKind, submitPassword,
  } = useProjectSharePlans(token)

  // Thème partagé avec le hub (clé localStorage commune).
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

  if (requirePassword) {
    return (
      <ProjectSharePasswordGate
        kind={passwordKind || 'missing'}
        hint={passwordHint}
        onSubmit={submitPassword}
        pageLabel="les plans"
      />
    )
  }
  if (loading) {
    return (
      <FullScreenStatus
        icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}
      >
        Chargement des plans…
      </FullScreenStatus>
    )
  }

  if (error || !payload) {
    return <ErrorState error={error} token={token} />
  }

  return (
    <PlansShareView
      payload={payload}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      extraHeader={<BackToHubLink token={token} />}
    />
  )
}

// ─── Lien retour vers le hub portail ────────────────────────────────────────
function BackToHubLink({ token }) {
  return (
    <Link
      to={`/share/projet/${encodeURIComponent(token)}`}
      className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors mb-3"
      style={{ color: 'var(--txt-3)' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--txt)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Portail projet
    </Link>
  )
}

// ─── États pleine page ─────────────────────────────────────────────────────
function FullScreenStatus({ icon, children }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      {icon}
      <p className="mt-3 text-sm" style={{ color: 'var(--txt-2)' }}>
        {children}
      </p>
    </div>
  )
}

function ErrorState({ error, token }) {
  const msg = error?.message || ''
  const isInvalid = /invalid|expired|28000/i.test(msg)
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <AlertCircle
        className="w-10 h-10 mb-3"
        style={{ color: 'var(--red, #ef4444)' }}
      />
      <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
        {isInvalid ? 'Page non accessible' : 'Impossible de charger les plans'}
      </h1>
      <p className="mt-2 text-sm max-w-md" style={{ color: 'var(--txt-3)' }}>
        {isInvalid
          ? 'Cette page n\u2019est pas activée pour ce portail, ou le lien est expiré.'
          : msg || 'Une erreur s\u2019est produite. Réessaye dans quelques instants.'}
      </p>
      {token && (
        <Link
          to={`/share/projet/${encodeURIComponent(token)}`}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'var(--blue)' }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au portail
        </Link>
      )}
    </div>
  )
}
