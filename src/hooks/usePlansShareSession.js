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
// Auto-refresh : les signed URLs Storage ont une durée de vie de 10 min
// (TTL_SIGNED_URL côté lib). Si l'utilisateur laisse l'onglet ouvert et
// revient après une longue inactivité, on déclenche un refresh
// automatique au retour de focus pour régénérer le payload + signed URLs.
// Seuil : 5 minutes (marge de sécurité avant l'expiration à 10).
//
// Pattern aligné sur useMatosShareSession + useEquipeShareSession.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPlansSharePayload } from '../lib/plansShare'

// Seuil en ms au-dessus duquel on considère que les signed URLs risquent
// d'être périmées au retour de focus. 5 min = moitié du TTL Supabase (10 min).
const STALE_THRESHOLD_MS = 5 * 60 * 1000

export function usePlansShareSession(token) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const aliveRef = useRef(true)
  // Timestamp du dernier load réussi — pour détecter staleness au focus.
  const lastLoadAtRef = useRef(0)

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
        lastLoadAtRef.current = Date.now()
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

  // Auto-refresh au retour de focus si > STALE_THRESHOLD_MS depuis le
  // dernier load. Évite que l'utilisateur clique sur un plan dont la signed
  // URL aura expiré (Loader2 perpétuel ou erreur 403).
  useEffect(() => {
    if (!token) return undefined
    function handleVisibility() {
      if (document.hidden) return
      if (lastLoadAtRef.current === 0) return
      const elapsed = Date.now() - lastLoadAtRef.current
      if (elapsed > STALE_THRESHOLD_MS) {
        setReloadKey((k) => k + 1)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
    }
  }, [token])

  return { payload, loading, error, refresh }
}
