// ════════════════════════════════════════════════════════════════════════════
// ProjectShareEquipeSession — Sous-page /share/projet/:token/equipe (PROJECT-SHARE-3)
// ════════════════════════════════════════════════════════════════════════════
//
// Wrapper minimaliste qui :
//   - Récupère le payload via useProjectShareEquipe(token) (RPC
//     share_projet_equipe_fetch — SECURITY DEFINER, même shape que
//     share_equipe_fetch).
//   - Réutilise EquipeShareView (exporté par EquipeShareSession) — pas une
//     ligne de duplication de code de rendu.
//   - Partage le thème dark/light avec le hub via PROJECT_SHARE_THEME_KEY.
//   - Affiche un lien "← Portail" qui ramène au hub.
//   - Loading/erreur cohérent avec le hub.
//
// Pour ajouter une autre sous-page (ex: matériel) : copier ce fichier,
// remplacer le hook + le composant View + le label du back-link.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react'
import { useProjectShareEquipe } from '../hooks/useProjectShareSession'
import { EquipeShareView } from './EquipeShareSession'
import { PROJECT_SHARE_THEME_KEY } from './ProjectShareSession'
import ProjectSharePasswordGate from '../components/share/ProjectSharePasswordGate'

export default function ProjectShareEquipeSession() {
  const { token } = useParams()
  const {
    payload, loading, error,
    requirePassword, passwordHint, passwordKind, submitPassword,
  } = useProjectShareEquipe(token)

  // Thème partagé avec le hub (clé localStorage commune) : si l'utilisateur
  // toggle ici, le hub se recharge dans la même variante. Default 'dark'
  // (cohérent avec hub + EquipeShareSession).
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
        pageLabel="l\u2019équipe"
      />
    )
  }
  if (loading) {
    return (
      <FullScreenStatus
        icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}
      >
        Chargement de l&rsquo;équipe…
      </FullScreenStatus>
    )
  }

  if (error || !payload) {
    return <ErrorState error={error} token={token} />
  }

  return (
    <div style={{ background: 'var(--bg)' }}>
      <BackToHubLink token={token} />
      <EquipeShareView payload={payload} theme={theme} setTheme={setTheme} />
    </div>
  )
}

// ─── Lien retour vers le hub portail ────────────────────────────────────────
//
// Bandeau discret en haut de page, indépendant du SharePageHeader interne au
// EquipeShareView. Le destinataire externe peut ainsi remonter vers les
// autres sous-pages activées (livrables, etc.).
function BackToHubLink({ token }) {
  return (
    <div
      className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6"
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
              ? 'La page Équipe n\u2019est pas activée pour ce portail.'
              : 'Impossible de charger l\u2019équipe pour le moment. Réessayez dans quelques instants.'}
        </p>
        {token && (
          <Link
            to={`/share/projet/${encodeURIComponent(token)}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold"
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
