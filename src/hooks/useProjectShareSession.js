// ════════════════════════════════════════════════════════════════════════════
// useProjectShareSession — Hooks publics pour le portail projet (PROJECT-SHARE)
// ════════════════════════════════════════════════════════════════════════════
//
// Trois hooks pour les 3 endpoints du portail projet :
//   - useProjectShareHub(token)        → payload du hub (page d'accueil)
//   - useProjectShareEquipe(token)     → payload sous-page équipe
//   - useProjectShareLivrables(token)  → payload sous-page livrables
//
// Pas d'auth user (token = identification). Pas de Realtime (instantané).
// Le hook expose :
//   { payload, loading, error, refresh,
//     requirePassword, passwordHint, passwordKind, submitPassword }
//
// Password gate (PROJECT-SHARE-PWD) :
//   Si la RPC raise 28P01 (mdp requis ou invalide), on expose
//   `requirePassword=true` + `passwordKind` ('missing' | 'invalid') + `passwordHint`.
//   Le composant page rend alors un <ProjectSharePasswordGate /> qui appelle
//   `submitPassword(plain)`. Le mdp est stocké en sessionStorage pour la durée
//   de l'onglet et réutilisé sur les autres sous-pages du même portail.
//
// Pattern aligné sur useEquipeShareSession + useLivrableShareSession.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchHubPayload,
  fetchEquipePayload,
  fetchLivrablesPayload,
  getStoredSharePassword,
  storeSharePassword,
  detectPasswordError,
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

  // Password gate state
  const [requirePassword, setRequirePassword] = useState(false)
  const [passwordHint, setPasswordHint] = useState(null)
  const [passwordKind, setPasswordKind] = useState(null) // 'missing' | 'invalid'

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  /**
   * Soumet le mot de passe entré par l'utilisateur sur le password gate.
   * Stocke en sessionStorage et déclenche un refetch.
   */
  const submitPassword = useCallback(
    (plain) => {
      if (!token) return
      storeSharePassword(token, plain)
      setRequirePassword(false)
      setPasswordKind(null)
      setReloadKey((k) => k + 1)
    },
    [token],
  )

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
    const stored = getStoredSharePassword(token)
    fetcher(token, stored)
      .then((data) => {
        if (cancelled || !aliveRef.current) return
        setPayload(data)
        setRequirePassword(false)
        setPasswordKind(null)
        setPasswordHint(null)
      })
      .catch((e) => {
        if (cancelled || !aliveRef.current) return
        const pwd = detectPasswordError(e)
        if (pwd) {
          // Mot de passe requis ou invalide. On écarte le payload, on bascule
          // sur le gate UI. Si le mdp stocké est invalide, on l'oublie pour
          // que le prochain submit reparte de zéro.
          if (pwd.kind === 'invalid') storeSharePassword(token, null)
          setPayload(null)
          setError(null)
          setRequirePassword(true)
          setPasswordKind(pwd.kind)
          setPasswordHint(pwd.hint || null)
        } else {
          setError(e)
          setPayload(null)
          setRequirePassword(false)
          setPasswordKind(null)
          setPasswordHint(null)
        }
      })
      .finally(() => {
        if (cancelled || !aliveRef.current) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, reloadKey, fetcher])

  return {
    payload,
    loading,
    error,
    refresh,
    // Password gate
    requirePassword,
    passwordHint,
    passwordKind,
    submitPassword,
  }
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
