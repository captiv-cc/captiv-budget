// ════════════════════════════════════════════════════════════════════════════
// useMatosShareSession — Hook public pour le partage matériel (MATOS-SHARE)
// ════════════════════════════════════════════════════════════════════════════
//
// Endpoint anon qui charge le payload de la page /share/materiel/:token via
// la RPC share_matos_fetch (SECURITY DEFINER).
//
// Pas d'auth (token = identification). Pas de Realtime (instantané).
// Le hook expose : { loading, error, payload, refresh }.
//
// Pattern aligné sur useEquipeShareSession + useLivrableShareSession.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMatosSharePayload } from '../lib/matosShare'

export function useMatosShareSession(token) {
  const [payload, setPayload] = useState(null)
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
    if (!token) {
      setPayload(null)
      setError(new Error('Token manquant'))
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchMatosSharePayload(token)
      .then((data) => {
        if (cancelled || !aliveRef.current) return
        setPayload(data)
      })
      .catch((e) => {
        if (cancelled || !aliveRef.current) return
        setError(e)
        setPayload(null)
      })
      .finally(() => {
        if (cancelled || !aliveRef.current) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, reloadKey])

  return { payload, loading, error, refresh }
}
