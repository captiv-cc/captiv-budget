// ════════════════════════════════════════════════════════════════════════════
// useLivrableShareSession — Hook public pour la page client /share/livrables/:token
// ════════════════════════════════════════════════════════════════════════════
//
// Charge le payload de partage via la RPC `share_livrables_fetch`. Pas
// d'auth (le token fait office d'authentification). Pas de Realtime
// (la page client est un instantané, le refetch se fait à chaque re-mount).
//
// Le hook expose :
//   - loading / error / payload (le retour brut de la RPC)
//   - refresh() pour re-fetcher (utile si l'utilisateur reste longtemps
//     sur la page et veut recharger).
//
// Voir src/lib/livrableShare.js pour le helper fetchSharePayload.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSharePayload } from '../lib/livrableShare'

export function useLivrableShareSession(token) {
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
    fetchSharePayload(token)
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
