// ════════════════════════════════════════════════════════════════════════════
// usePlansShareTokens — Hook admin pour la gestion des tokens partage plans
// ════════════════════════════════════════════════════════════════════════════
//
// Liste les tokens d'un projet et expose les mutations CRUD. Pas de Realtime
// (la liste change peu ; un refetch après chaque mutation locale suffit).
//
// Pattern aligné sur useMatosShareTokens.js / useEquipeShareTokens.js.
// Voir src/lib/plansShare.js pour la lib pure.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createPlansShareToken,
  deletePlansShareToken,
  listPlansShareTokens,
  restorePlansShareToken,
  revokePlansShareToken,
  updatePlansShareToken,
} from '../lib/plansShare'

export function usePlansShareTokens(projectId) {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!projectId) {
      setTokens([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    listPlansShareTokens({ projectId, includeRevoked: true })
      .then((data) => {
        if (cancelled || !aliveRef.current) return
        setTokens(data)
      })
      .catch((e) => {
        if (cancelled || !aliveRef.current) return
        setError(e)
      })
      .finally(() => {
        if (cancelled || !aliveRef.current) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadKey])

  const create = useCallback(
    async (params = {}) => {
      const token = await createPlansShareToken({ projectId, ...params })
      refresh()
      return token
    },
    [projectId, refresh],
  )

  const update = useCallback(
    async (tokenId, patch) => {
      const result = await updatePlansShareToken(tokenId, patch)
      refresh()
      return result
    },
    [refresh],
  )

  const revoke = useCallback(
    async (tokenId) => {
      await revokePlansShareToken(tokenId)
      refresh()
    },
    [refresh],
  )

  const restore = useCallback(
    async (tokenId) => {
      await restorePlansShareToken(tokenId)
      refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (tokenId) => {
      await deletePlansShareToken(tokenId)
      refresh()
    },
    [refresh],
  )

  return {
    tokens,
    loading,
    error,
    refresh,
    create,
    update,
    revoke,
    restore,
    remove,
  }
}
