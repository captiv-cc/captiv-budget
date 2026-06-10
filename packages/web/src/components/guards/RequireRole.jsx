import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Garde de route fondée sur le rôle de l'utilisateur.
 *
 * Usage :
 *   <Route path="/compta" element={
 *     <RequireRole roles={['admin', 'charge_prod']}>
 *       <Compta />
 *     </RequireRole>
 *   } />
 *
 * Comportement :
 *   - Si le user n'est pas encore chargé → on laisse passer (le PrivateRoute
 *     s'occupe du loader global).
 *   - Si le user n'a pas le bon rôle → redirect vers /unauthorized avec le
 *     contexte (URL d'origine + rôle requis) dans location.state.
 *
 * @param {string[]} roles - Liste des rôles autorisés (ex: ['admin'])
 */
export default function RequireRole({ roles, children }) {
  const { loading, profile, role, hasRole } = useAuth()
  const location = useLocation()

  // Tant qu'on n'a pas le profile, on laisse passer : le PrivateRoute parent
  // gère déjà l'état "loading" global. Ici on ne veut pas dupliquer le loader.
  if (loading || !profile) return children

  if (hasRole(roles)) return children

  return (
    <Navigate
      to="/unauthorized"
      replace
      state={{
        from: location.pathname + location.search,
        requiredRole: Array.isArray(roles) ? roles.join(' ou ') : roles,
        currentRole: role,
      }}
    />
  )
}
