/**
 * usePlans — Hook de gestion des plans techniques d'un projet.
 *
 * Pattern aligné sur useMateriel / useLivrables (admin authed) :
 *   - Charge la liste des plans + catégories de l'org
 *   - Expose des actions (create/update/replace/archive/delete/reorder)
 *   - Optimistic updates sur les opérations courantes (rename, reorder, …)
 *   - bumpReload pour resync en fin de chaque action
 *
 * Pas de Realtime en V1 : la collab simultanée sur les plans est rare
 * (≠ matos qui a 5+ techniciens en parallèle pendant les essais). Si
 * besoin se fait sentir, ajout trivial sur le pattern matos.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as P from '../lib/plans'

export function usePlans({ projectId, orgId } = {}) {
  const [plans, setPlans] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Compteur de reload pour resync après mutation.
  const [reloadKey, setReloadKey] = useState(0)
  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), [])

  // Ref pour éviter setState après unmount.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // ─── Chargement plans + catégories (en parallèle) ──────────────────────
  useEffect(() => {
    if (!projectId) {
      setPlans([])
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [plansData, catsData] = await Promise.all([
          P.listPlans({ projectId }),
          orgId ? P.listPlanCategories(orgId) : Promise.resolve([]),
        ])
        if (cancelled || !aliveRef.current) return
        setPlans(plansData)
        setCategories(catsData)
      } catch (err) {
        if (!cancelled && aliveRef.current) setError(err)
      } finally {
        if (!cancelled && aliveRef.current) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, orgId, reloadKey])

  // ─── Dérivés ────────────────────────────────────────────────────────────
  const categoriesById = useMemo(() => {
    const map = new Map()
    for (const c of categories) map.set(c.id, c)
    return map
  }, [categories])

  const plansByCategory = useMemo(() => {
    const map = new Map()
    for (const p of plans) {
      const key = p.category_id || '__uncat__'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(p)
    }
    return map
  }, [plans])

  // Tags distincts utilisés dans le projet (pour autocomplete).
  const allTags = useMemo(() => {
    const set = new Set()
    for (const p of plans) {
      for (const t of p.tags || []) set.add(t)
    }
    return Array.from(set).sort()
  }, [plans])

  // ─── Actions — Plans ────────────────────────────────────────────────────
  const createPlan = useCallback(
    async (payload) => {
      const created = await P.createPlan({ projectId, ...payload })
      bumpReload()
      return created
    },
    [projectId, bumpReload],
  )

  // Optimistic update sur les méta — UI à jour synchrone, refetch en fin.
  const updatePlan = useCallback(
    async (planId, fields) => {
      setPlans((prev) =>
        prev.map((p) => (p.id === planId ? { ...p, ...fields } : p)),
      )
      try {
        await P.updatePlan(planId, fields)
        bumpReload()
      } catch (err) {
        bumpReload() // rollback via refetch
        throw err
      }
    },
    [bumpReload],
  )

  const replacePlanFile = useCallback(
    async (planId, file, opts) => {
      const updated = await P.replacePlanFile(planId, file, opts)
      bumpReload()
      return updated
    },
    [bumpReload],
  )

  const archivePlan = useCallback(
    async (planId) => {
      // Optimistic : retire de la liste visible.
      setPlans((prev) => prev.filter((p) => p.id !== planId))
      try {
        await P.archivePlan(planId)
        bumpReload()
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  const restorePlan = useCallback(
    async (planId) => {
      await P.restorePlan(planId)
      bumpReload()
    },
    [bumpReload],
  )

  const hardDeletePlan = useCallback(
    async (planId) => {
      await P.hardDeletePlan(planId)
      bumpReload()
    },
    [bumpReload],
  )

  /* ─── Actions en lot (bulk) ──────────────────────────────────────────
     Toutes les actions bulk parallélisent les requêtes via Promise.all
     et collectent les éventuelles erreurs partielles. Le caller reçoit
     un résumé { success: number, errors: [{ id, error }] } pour pouvoir
     afficher un toast adapté.
  */

  const archivePlansBulk = useCallback(
    async (planIds) => {
      // Optimistic : retire toutes les rows ciblées.
      const idSet = new Set(planIds)
      setPlans((prev) => prev.filter((p) => !idSet.has(p.id)))
      const results = await Promise.allSettled(
        planIds.map((id) => P.archivePlan(id)),
      )
      bumpReload()
      const errors = []
      let success = 0
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') success++
        else errors.push({ id: planIds[i], error: r.reason })
      })
      return { success, errors }
    },
    [bumpReload],
  )

  const restorePlansBulk = useCallback(
    async (planIds) => {
      const results = await Promise.allSettled(
        planIds.map((id) => P.restorePlan(id)),
      )
      bumpReload()
      const errors = []
      let success = 0
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') success++
        else errors.push({ id: planIds[i], error: r.reason })
      })
      return { success, errors }
    },
    [bumpReload],
  )

  const hardDeletePlansBulk = useCallback(
    async (planIds) => {
      const results = await Promise.allSettled(
        planIds.map((id) => P.hardDeletePlan(id)),
      )
      bumpReload()
      const errors = []
      let success = 0
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') success++
        else errors.push({ id: planIds[i], error: r.reason })
      })
      return { success, errors }
    },
    [bumpReload],
  )

  const reorderPlans = useCallback(
    async (orderedIds) => {
      // Optimistic : applique le nouvel ordre tout de suite.
      setPlans((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]))
        const reordered = []
        orderedIds.forEach((id, idx) => {
          const plan = byId.get(id)
          if (plan) {
            reordered.push({ ...plan, sort_order: idx * 10 })
            byId.delete(id)
          }
        })
        for (const remaining of byId.values()) reordered.push(remaining)
        return reordered
      })
      try {
        await P.reorderPlans(orderedIds)
        bumpReload()
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  return {
    plans,
    categories,
    categoriesById,
    plansByCategory,
    allTags,
    loading,
    error,
    actions: {
      createPlan,
      updatePlan,
      replacePlanFile,
      archivePlan,
      restorePlan,
      hardDeletePlan,
      reorderPlans,
      archivePlansBulk,
      restorePlansBulk,
      hardDeletePlansBulk,
    },
    reload: bumpReload,
  }
}

export default usePlans
