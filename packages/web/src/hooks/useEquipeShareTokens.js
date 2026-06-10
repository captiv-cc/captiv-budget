// ════════════════════════════════════════════════════════════════════════════
// useEquipeShareTokens — Hook admin pour la gestion des tokens de partage techlist
// ════════════════════════════════════════════════════════════════════════════
//
// Liste les tokens d'un projet et expose les mutations CRUD. Pas de Realtime
// (la liste change peu ; un refetch après chaque mutation locale suffit).
//
// Pattern aligné sur useLivrableShareTokens.js.
// Voir src/lib/equipeShare.js pour la lib pure.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createShareToken,
  deleteShareToken,
  listShareTokens,
  restoreShareToken,
  revokeShareToken,
  updateShareToken,
} from '../lib/equipeShare'

export function useEquipeShareTokens(projectId) {
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
    listShareTokens({ projectId, includeRevoked: true })
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
      const token = await createShareToken({ projectId, ...params })
      refresh()
      return token
    },
    [projectId, refresh],
  )

  const update = useCallback(
    async (tokenId, patch) => {
      const result = await updateShareToken(tokenId, patch)
      refresh()
      return result
    },
    [refresh],
  )

  const revoke = useCallback(
    async (tokenId) => {
      await revokeShareToken(tokenId)
      refresh()
    },
    [refresh],
  )

  const restore = useCallback(
    async (tokenId) => {
      await restoreShareToken(tokenId)
      refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (tokenId) => {
      await deleteShareToken(tokenId)
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
