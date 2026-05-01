// ════════════════════════════════════════════════════════════════════════════
// useLivrableShareTokens — Hook admin pour la gestion des tokens de partage
// ════════════════════════════════════════════════════════════════════════════
//
// Liste les tokens d'un projet et expose les mutations CRUD. Pas de Realtime
// (la liste change peu, et un refetch après chaque mutation locale suffit).
//
// Voir src/lib/livrableShare.js pour la lib pure.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createShareToken,
  deleteShareToken,
  listShareTokens,
  restoreShareToken,
  revokeShareToken,
  updateShareToken,
} from '../lib/livrableShare'

export function useLivrableShareTokens(projectId) {
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

  // ─── Fetch ────────────────────────────────────────────────────────────────
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

  // ─── Mutations ────────────────────────────────────────────────────────────
  const create = useCallback(
    async ({ label, config, expiresAt } = {}) => {
      const token = await createShareToken({ projectId, label, config, expiresAt })
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
