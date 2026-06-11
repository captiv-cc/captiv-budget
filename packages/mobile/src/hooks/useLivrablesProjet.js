// ════════════════════════════════════════════════════════════════════════════
// useLivrablesProjet — livrables d'un projet, groupés par bloc
// ════════════════════════════════════════════════════════════════════════════
//
// Tables :
// - livrable_blocks (id, project_id, nom, prefixe, couleur, sort_order, deleted_at)
// - livrables       (id, block_id, project_id, numero, nom, format, duree,
//                    statut, date_livraison, assignee_profile_id, sort_order, deleted_at)
//
// Renvoie blocs ordonnés + map block_id -> livrables, normalisés au format
// attendu par LivrablesScreen (label, couleur, livraison...).
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadCache, saveCache } from '../lib/cache'

export function useLivrablesProjet(projetId) {
  const [blocs, setBlocs] = useState([])
  const [livrables, setLivrables] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const cacheKey = `livrables:${projetId}`

  useEffect(() => {
    let alive = true
    loadCache(cacheKey).then((c) => {
      if (alive && c) {
        setBlocs(c.blocs ?? [])
        setLivrables(c.livrables ?? [])
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [cacheKey])

  const fetchData = useCallback(async () => {
    if (!projetId) {
      setBlocs([])
      setLivrables([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [blocsRes, livrablesRes] = await Promise.all([
        supabase
          .from('livrable_blocks')
          .select('id, nom, couleur, prefixe, sort_order')
          .eq('project_id', projetId)
          .is('deleted_at', null)
          .order('sort_order', { ascending: true }),
        supabase
          .from('livrables')
          .select('id, block_id, numero, nom, format, duree, statut, date_livraison, assignee_profile_id, sort_order')
          .eq('project_id', projetId)
          .is('deleted_at', null)
          .order('sort_order', { ascending: true }),
      ])

      if (blocsRes.error) throw blocsRes.error
      if (livrablesRes.error) throw livrablesRes.error

      const blocsData = (blocsRes.data ?? []).map((b) => ({
        id: b.id,
        label: b.nom,
        couleur: b.couleur ?? '#6B7280',
        prefixe: b.prefixe,
        sort_order: b.sort_order,
      }))
      const livrablesData = (livrablesRes.data ?? []).map((l) => ({
        id: l.id,
        bloc_id: l.block_id,
        numero: l.numero,
        nom: l.nom,
        format: l.format,
        duree: l.duree,
        statut: l.statut,
        livraison: l.date_livraison,
        assignee_profile_id: l.assignee_profile_id,
      }))
      setBlocs(blocsData)
      setLivrables(livrablesData)
      saveCache(cacheKey, { blocs: blocsData, livrables: livrablesData })
    } catch (err) {
      console.warn('[useLivrablesProjet] error', err.message)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [projetId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const livrablesParBloc = useMemo(() => {
    const map = {}
    for (const l of livrables) {
      if (!map[l.bloc_id]) map[l.bloc_id] = []
      map[l.bloc_id].push(l)
    }
    return map
  }, [livrables])

  return { blocs, livrables, livrablesParBloc, loading, error, refetch: fetchData }
}
