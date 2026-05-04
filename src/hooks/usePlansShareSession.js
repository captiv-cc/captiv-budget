// ════════════════════════════════════════════════════════════════════════════
// usePlansShareSession — Hook public pour le partage plans (PLANS-SHARE)
// ════════════════════════════════════════════════════════════════════════════
//
// Endpoint anon qui charge le payload de la page /share/plans/:token via
// la RPC share_plans_fetch (SECURITY DEFINER) + enrichit avec les signed
// URLs Storage côté client (pattern Captiv aligné sur MAT-10).
//
// Pas d'auth (token = identification). Pas de Realtime (instantané).
// Le hook expose : { loading, error, payload, refresh }.
//
// `refresh` est utile pour régénérer les signed URLs en arrière-plan
// quand le user revient sur l'onglet après une longue inactivité (les
// signed URLs expirent à 10 min).
//
// Pattern aligné sur useMatosShareSession + useEquipeShareSession.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPlansSharePayload } from '../lib/plansShare'

export function usePlansShareSession(token) {
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
    fetchPlansSharePayload(token)
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
