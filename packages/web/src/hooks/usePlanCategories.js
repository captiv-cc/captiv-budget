/**
 * usePlanCategories — Hook de gestion des catégories de plans (per-org).
 *
 * Utilisé côté admin org pour la page de gestion des catégories. Le
 * PlansTab utilise `usePlans` qui charge déjà les catégories en parallèle —
 * ce hook est dédié à la modale / page de gestion (CRUD complet).
 *
 * RLS : SELECT ouvert à tous les membres de l'org, WRITE admin org only.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import * as P from '../lib/plans'

export function usePlanCategories({ orgId, includeArchived = false } = {}) {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [reloadKey, setReloadKey] = useState(0)
  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), [])

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!orgId) {
      setCategories([])
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await P.listPlanCategories(orgId, { includeArchived })
        if (cancelled || !aliveRef.current) return
        setCategories(data)
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
  }, [orgId, includeArchived, reloadKey])

  const createCategory = useCallback(
    async (payload) => {
      const created = await P.createPlanCategory({ orgId, ...payload })
      bumpReload()
      return created
    },
    [orgId, bumpReload],
  )

  const updateCategory = useCallback(
    async (catId, fields) => {
      // Optimistic patch.
      setCategories((prev) =>
        prev.map((c) => (c.id === catId ? { ...c, ...fields } : c)),
      )
      try {
        await P.updatePlanCategory(catId, fields)
        bumpReload()
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  const archiveCategory = useCallback(
    async (catId) => {
      await P.archivePlanCategory(catId)
      bumpReload()
    },
    [bumpReload],
  )

  const restoreCategory = useCallback(
    async (catId) => {
      await P.restorePlanCategory(catId)
      bumpReload()
    },
    [bumpReload],
  )

  const reorderCategories = useCallback(
    async (orderedIds) => {
      // Optimistic.
      setCategories((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]))
        const reordered = []
        orderedIds.forEach((id, idx) => {
          const cat = byId.get(id)
          if (cat) {
            reordered.push({ ...cat, sort_order: idx * 10 })
            byId.delete(id)
          }
        })
        for (const remaining of byId.values()) reordered.push(remaining)
        return reordered
      })
      try {
        await P.reorderPlanCategories(orderedIds)
        bumpReload()
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  return {
    categories,
    loading,
    error,
    actions: {
      createCategory,
      updateCategory,
      archiveCategory,
      restoreCategory,
      reorderCategories,
    },
    reload: bumpReload,
  }
}

export default usePlanCategories
