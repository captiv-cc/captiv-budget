import { Link, useNavigate, useLocation } from 'react-router-dom'
import { ShieldOff, ArrowLeft, Home } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Page affichée quand un utilisateur tente d'accéder à une ressource
 * ou à une page pour laquelle il n'a pas les droits (chantier 3 : <RequireRole>).
 *
 * Paramètres optionnels via location.state :
 *   - from        : URL depuis laquelle l'accès a été refusé
 *   - requiredRole: rôle minimum requis (ex: 'admin', 'charge_prod')
 */
export default function Unauthorized() {
  const navigate = useNavigate()
  const location = useLocation()
  const { role, profile } = useAuth()

  const from         = location.state?.from
  const requiredRole = location.state?.requiredRole
  const displayName  = profile?.full_name || profile?.email || 'Utilisateur'

  return (
    <div className="flex items-center justify-center min-h-[70vh] p-6">
      <div
        className="w-full max-w-md rounded-2xl shadow-sm border border-gray-200 bg-white p-8 text-center"
        role="alert"
        aria-live="polite"
      >
        <div className="w-14 h-14 mx-auto rounded-full bg-amber-50 flex items-center justify-center mb-5">
          <ShieldOff className="w-7 h-7 text-amber-600" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Accès non autorisé
        </h1>

        <p className="text-sm text-gray-600 leading-relaxed mb-1">
          Tu n'as pas les droits pour consulter cette page.
        </p>
        <p className="text-xs text-gray-400 mb-6">
          Connecté en tant que <span className="font-medium text-gray-600">{displayName}</span>
          {role && <> — rôle <span className="font-mono text-gray-600">{role}</span></>}
          {requiredRole && (
            <>
              <br />
              Rôle requis : <span className="font-mono text-gray-600">{requiredRole}</span>
            </>
          )}
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium transition"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Page précédente
          </button>
          <Link
            to="/accueil"
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            Accueil
          </Link>
        </div>

        {from && (
          <p className="mt-6 text-[11px] text-gray-400">
            URL refusée : <span className="font-mono">{from}</span>
          </p>
        )}

        <p className="mt-6 text-[11px] text-gray-400">
          Si tu penses que c'est une erreur, contacte l'administrateur de ton organisation.
        </p>
      </div>
    </div>
  )
}
