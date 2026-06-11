// ════════════════════════════════════════════════════════════════════════════
// useProjetDeroules — jours (déroulés) d'un projet, ordonnés
// ════════════════════════════════════════════════════════════════════════════
//
// Sert à construire les pills de jours du Planning à partir des vraies dates
// des déroulés (et pas d'une liste codée en dur).
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadCache, saveCache } from '../lib/cache'

export function useProjetDeroules(projetId) {
  const [deroules, setDeroules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const cacheKey = `deroules:${projetId}`

  useEffect(() => {
    let alive = true
    loadCache(cacheKey).then((c) => {
      if (alive && Array.isArray(c)) {
        setDeroules(c)
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [cacheKey])

  const fetchDeroules = useCallback(async () => {
    if (!projetId) {
      setDeroules([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('projet_deroules')
        .select('id, date_jour, titre')
        .eq('project_id', projetId)
        .order('date_jour', { ascending: true })

      if (err) throw err
      setDeroules(data ?? [])
      saveCache(cacheKey, data ?? [])
    } catch (err) {
      console.warn('[useProjetDeroules] error', err.message)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [projetId])

  useEffect(() => {
    fetchDeroules()
  }, [fetchDeroules])

  return { deroules, loading, error, refetch: fetchDeroules }
}
