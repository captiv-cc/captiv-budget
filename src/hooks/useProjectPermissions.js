// ════════════════════════════════════════════════════════════════════════════
// useProjectPermissions — Chantier 3B
// ════════════════════════════════════════════════════════════════════════════
//
// Hook React qui charge et expose les permissions PAR PROJET pour un user.
//
// Flux :
//   1. Vérifie si le user est attaché au projet via project_access
//      (admin est considéré attaché de facto)
//   2. Si pas attaché → { isAttached: false } → la page doit rediriger
//   3. Si attaché et interne → bypass complet, can() renvoie true partout
//   4. Si attaché et prestataire → charge le template + overrides du projet
//      et construit l'objet permissions via buildProjectPermissions
//
// Exemple :
//   const { loading, isAttached, can, canSee } = useProjectPermissions(project.id)
//   if (loading) return <Spinner />
//   if (!isAttached) return <Navigate to="/unauthorized" />
//   if (!canSee('livrables')) return null
//
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  ROLES,
  INTERNAL_ROLES,
  buildProjectPermissions,
  can as canFn,
  canSee as canSeeFn,
} from '../lib/permissions'

export function useProjectPermissions(projectId) {
  const { user, role, isAdmin } = useAuth()

  const [loading, setLoading]       = useState(true)
  const [isAttached, setIsAttached] = useState(false)
  const [permissions, setPermissions] = useState({}) // { outil_key: {can_read, can_comment, can_edit} }

  useEffect(() => {
    let alive = true

    async function load() {
      // Rien à charger tant qu'on n'a pas un user + projectId
      if (!user?.id || !projectId) {
        if (alive) {
          setLoading(false)
          setIsAttached(false)
          setPermissions({})
        }
        return
      }

      setLoading(true)

      // ─── Admin : bypass complet, aucune requête nécessaire ────────────────
      if (isAdmin) {
        if (alive) {
          setIsAttached(true)
          setPermissions({})
          setLoading(false)
        }
        return
      }

      // ─── Autres rôles : vérification d'attachement ────────────────────────
      const { data: access, error: accessErr } = await supabase
        .from('project_access')
        .select('metier_template_id')
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .maybeSingle()

      if (!alive) return

      if (accessErr || !access) {
        // Pas attaché → aucun droit
        setIsAttached(false)
        setPermissions({})
        setLoading(false)
        return
      }

      setIsAttached(true)

      // ─── Internes attachés : bypass outil via can() ───────────────────────
      if (INTERNAL_ROLES.includes(role)) {
        setPermissions({})
        setLoading(false)
        return
      }

      // ─── Prestataires : template + overrides projet ───────────────────────
      const [templateRes, overrideRes] = await Promise.all([
        access.metier_template_id
          ? supabase
              .from('metier_template_permissions')
              .select('outil_key, can_read, can_comment, can_edit')
              .eq('template_id', access.metier_template_id)
          : Promise.resolve({ data: [] }),
        supabase
          .from('project_access_permissions')
          .select('outil_key, can_read, can_comment, can_edit')
          .eq('user_id', user.id)
          .eq('project_id', projectId),
      ])

      if (!alive) return

      setPermissions(
        buildProjectPermissions(
          templateRes.data || [],
          overrideRes.data || [],
        )
      )
      setLoading(false)
    }

    load()
    return () => { alive = false }
  }, [user?.id, projectId, role, isAdmin])

  // ─── Contexte pour le moteur permissions ──────────────────────────────────
  const permCtx = useMemo(() => ({ role, permissions }), [role, permissions])

  const can = useCallback(
    (outil, action) => canFn(permCtx, outil, action),
    [permCtx],
  )
  const canSee = useCallback(
    (outil) => canSeeFn(permCtx, outil),
    [permCtx],
  )

  return {
    loading,
    isAttached,
    permissions,
    can,
    canSee,
  }
}
