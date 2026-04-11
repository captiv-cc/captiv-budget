import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Garde de route fondée sur les permissions outil + action.
 *
 * À utiliser pour les sous-pages granulaires (par exemple, onglets projet).
 *
 * Usage :
 *   <RequirePermission outil="livrables" action="read">
 *     <LivrablesTab />
 *   </RequirePermission>
 *
 * Comportement :
 *   - Bypass automatique pour les rôles internes (admin/charge_prod/coordinateur)
 *   - Refus → redirect /unauthorized avec contexte
 *
 * @param {string} outil - Clé de l'outil (ex: 'livrables')
 * @param {string} action - 'read' | 'comment' | 'edit' (défaut: 'read')
 */
export default function RequirePermission({ outil, action = 'read', children }) {
  const { loading, profile, can, role } = useAuth()
  const location = useLocation()

  if (loading || !profile) return children
  if (can(outil, action)) return children

  return (
    <Navigate
      to="/unauthorized"
      replace
      state={{
        from: location.pathname + location.search,
        requiredRole: `${action} sur ${outil}`,
        currentRole: role,
      }}
    />
  )
}
