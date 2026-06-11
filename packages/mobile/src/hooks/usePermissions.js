// ════════════════════════════════════════════════════════════════════════════
// usePermissions — rôle de l'utilisateur + droits (canEdit / view-all)
// ════════════════════════════════════════════════════════════════════════════
//
// Fondation du système de permissions mobile (à raffiner avec les overrides
// projet quand l'édition arrivera). Rôle = profiles.role (cf. current_user_role
// côté SQL).
//
// - interne (admin / charge_prod / coordinateur) : voit tout, éditera.
// - externe (prestataire / autre) : voit ses infos + le général.
//
// ════════════════════════════════════════════════════════════════════════════

import { useProfile } from './useProfile'

const INTERNAL_ROLES = ['admin', 'charge_prod', 'coordinateur']

export function usePermissions() {
  const { profile, loading } = useProfile()
  const role = profile?.role ?? null
  const isInternal = INTERNAL_ROLES.includes(role)

  return {
    loading,
    role,
    isInternal,
    isExternal: role != null && !isInternal,
    // Voit les infos de toute l'équipe (vs seulement les siennes)
    canViewAll: isInternal,
    // Édition (placeholder : interne uniquement ; prestataire suivra via
    // project_access_permissions). Rien n'est éditable pour l'instant.
    canEdit: (_outil) => isInternal,
  }
}
