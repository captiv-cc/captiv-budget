import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'

/**
 * Garde de route fondée sur les permissions outil + action, pour les sous-pages
 * d'un projet (routes /projets/:id/...).
 *
 * À placer à l'intérieur d'une route projet : le projectId est lu depuis
 * useParams() par défaut.
 *
 * Usage :
 *   <Route path="livrables" element={
 *     <RequirePermission outil="livrables" action="read">
 *       <LivrablesTab />
 *     </RequirePermission>
 *   } />
 *
 * Comportement :
 *   - Admin : bypass total
 *   - Internes attachés (charge_prod / coordinateur) : bypass outil
 *   - Prestataires attachés : résolution template + override via useProjectPermissions
 *   - Non attaché OU action interdite : redirect /unauthorized avec contexte
 *
 * @param {string} outil      - Clé de l'outil (ex: 'livrables')
 * @param {string} action     - 'read' | 'comment' | 'edit' (défaut: 'read')
 * @param {string} [projectId]- ID de projet explicite (override useParams)
 */
export default function RequirePermission({ outil, action = 'read', projectId, children }) {
  const params = useParams()
  const pid = projectId || params.id
  const { loading: authLoading, profile, role } = useAuth()
  const { loading: permLoading, isAttached, can } = useProjectPermissions(pid)
  const location = useLocation()

  if (authLoading || !profile || permLoading) return children
  if (!isAttached) {
    return (
      <Navigate
        to="/unauthorized"
        replace
        state={{
          from: location.pathname + location.search,
          requiredRole: `attachement au projet`,
          currentRole: role,
        }}
      />
    )
  }
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
