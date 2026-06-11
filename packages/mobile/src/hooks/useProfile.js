// ════════════════════════════════════════════════════════════════════════════
// useProfile — profil de l'utilisateur connecté (nom, avatar)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { loadCache, saveCache } from '../lib/cache'

export function useProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const cacheKey = `profile:${user?.id}`

  useEffect(() => {
    let alive = true
    loadCache(cacheKey).then((c) => {
      if (alive && c) {
        setProfile(c)
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [cacheKey])

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, prenom, nom, email, avatar_url, role')
        .eq('id', user.id)
        .maybeSingle()
      if (error) throw error
      const p = data
        ? { ...data, displayName: data.full_name || [data.prenom, data.nom].filter(Boolean).join(' ') || data.email }
        : null
      setProfile(p)
      saveCache(cacheKey, p)
    } catch (err) {
      // offline → garde le cache
      console.warn('[useProfile] error', err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  return { profile, loading, refetch: fetchProfile }
}
