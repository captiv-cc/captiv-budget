// ════════════════════════════════════════════════════════════════════════════
// useProjectShareSession — Hooks publics pour le portail projet (PROJECT-SHARE)
// ════════════════════════════════════════════════════════════════════════════
//
// Trois hooks pour les 3 endpoints du portail projet :
//   - useProjectShareHub(token)        → payload du hub (page d'accueil)
//   - useProjectShareEquipe(token)     → payload sous-page équipe
//   - useProjectShareLivrables(token)  → payload sous-page livrables
//
// Pas d'auth (token = identification). Pas de Realtime (instantané).
// Le hook expose : { loading, error, payload, refresh }.
//
// Pattern aligné sur useEquipeShareSession + useLivrableShareSession.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchHubPayload,
  fetchEquipePayload,
  fetchLivrablesPayload,
} from '../lib/projectShare'

/**
 * Factory générique : on partage la même logique de chargement entre les
 * 3 endpoints, avec juste un `fetcher` (lib function) différent. Évite de
 * dupliquer 50 lignes de useState / useEffect / cancel-on-unmount × 3.
 */
function useProjectSharePayload(token, fetcher) {
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
    fetcher(token)
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
  }, [token, reloadKey, fetcher])

  return { payload, loading, error, refresh }
}

export function useProjectShareHub(token) {
  return useProjectSharePayload(token, fetchHubPayload)
}

export function useProjectShareEquipe(token) {
  return useProjectSharePayload(token, fetchEquipePayload)
}

export function useProjectShareLivrables(token) {
  return useProjectSharePayload(token, fetchLivrablesPayload)
}
