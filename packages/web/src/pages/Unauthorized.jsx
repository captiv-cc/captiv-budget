import { Link, useNavigate, useLocation } from 'react-router-dom'
import { ShieldOff, ArrowLeft, Home } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Page affichée quand un utilisateur tente d'accéder à une ressource
 * pour laquelle il n'a pas les droits (chantier 3 — gate <RequireRole>).
 *
 * Affichée DANS l'app (l'utilisateur est connecté), donc pas de hero
 * immersif type Login : juste une card centrée, sobre, avec deux
 * actions claires (retour précédent / aller à l'accueil).
 *
 * Cohérent avec le design system de l'app :
 *   - CSS vars (var(--bg-elev), var(--brd)…) au lieu de classes
 *     Tailwind hardcodées — robuste pour le futur lightmode
 *   - Bouton primaire blanc (action recommandée = aller à l'accueil)
 *   - Bouton secondaire glass (action alternative = revenir en arrière)
 *   - Animation fade + slide-up au load (cohérent avec Login/Invite)
 *
 * Paramètres optionnels via location.state :
 *   - from        : URL depuis laquelle l'accès a été refusé
 *   - requiredRole: rôle minimum requis (ex: 'admin', 'charge_prod')
 */
export default function Unauthorized() {
  const navigate = useNavigate()
  const location = useLocation()
  const { role, profile } = useAuth()

  const from = location.state?.from
  const requiredRole = location.state?.requiredRole
  const displayName = profile?.full_name || profile?.email || 'Utilisateur'

  return (
    <div
      className="flex items-center justify-center min-h-[70vh] p-4 sm:p-6"
      style={{ color: 'var(--txt)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-7 sm:p-8 text-center"
        role="alert"
        aria-live="polite"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          animation: 'unauth-in 380ms cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
      >
        {/* Icône warning ambre — matérialise une erreur "douce" (pas
            une erreur système, juste un manque de droit). */}
        <div
          className="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-5"
          style={{
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}
        >
          <ShieldOff
            className="w-7 h-7"
            style={{ color: 'rgb(252, 211, 77)' }}
            aria-hidden="true"
          />
        </div>

        <h1
          className="text-xl font-semibold tracking-tight mb-2"
          style={{ color: 'var(--txt)' }}
        >
          Accès non autorisé
        </h1>

        <p className="text-sm leading-relaxed" style={{ color: 'var(--txt-2)' }}>
          Tu n&apos;as pas les droits pour consulter cette page.
        </p>

        <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--txt-3)' }}>
          Connecté en tant que{' '}
          <span style={{ color: 'var(--txt-2)' }}>{displayName}</span>
          {role && (
            <>
              {' '}— rôle{' '}
              <span
                className="font-mono px-1.5 py-0.5 rounded text-[11px]"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  color: 'var(--txt-2)',
                }}
              >
                {role}
              </span>
            </>
          )}
          {requiredRole && (
            <>
              <br />
              Rôle requis :{' '}
              <span
                className="font-mono px-1.5 py-0.5 rounded text-[11px]"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  color: 'var(--txt-2)',
                }}
              >
                {requiredRole}
              </span>
            </>
          )}
        </p>

        {/* Actions — Accueil = primaire (action recommandée), Retour =
            secondaire (alternative). Sur mobile : stack vertical. */}
        <div className="flex flex-col sm:flex-row gap-2 mt-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            }}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Page précédente
          </button>
          <Link
            to="/accueil"
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{ background: '#ffffff', color: '#0a0a0f' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(255,255,255,0.12)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            Accueil
          </Link>
        </div>

        {from && (
          <p
            className="mt-5 text-[11px] truncate"
            style={{ color: 'var(--txt-3)' }}
            title={from}
          >
            URL refusée : <span className="font-mono">{from}</span>
          </p>
        )}

        <p className="mt-5 text-[11px] leading-relaxed" style={{ color: 'var(--txt-3)' }}>
          Si tu penses que c&apos;est une erreur, contacte l&apos;administrateur de
          ton organisation.
        </p>
      </div>

      {/* Keyframe d'animation locale (fade + slide-up doux). */}
      <style>{`
        @keyframes unauth-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
