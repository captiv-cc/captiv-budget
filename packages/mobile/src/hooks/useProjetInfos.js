// ════════════════════════════════════════════════════════════════════════════
// useProjetInfos — fiche complète d'un projet (Infos projet)
// ════════════════════════════════════════════════════════════════════════════
//
// Beaucoup de champs (realisateur, agence, production…) sont dans
// projects.metadata (JSONB) plutôt qu'en colonnes → on lit metadata en
// priorité, fallback colonne. Client via jointure clients.
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadCache, saveCache } from '../lib/cache'

export function useProjetInfos(projetId) {
  const [infos, setInfos] = useState(null)
  const [loading, setLoading] = useState(true)
  const cacheKey = `projetinfos:${projetId}`

  useEffect(() => {
    let alive = true
    loadCache(cacheKey).then((c) => {
      if (alive && c) {
        setInfos(c)
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [cacheKey])

  const fetchInfos = useCallback(async () => {
    if (!projetId) {
      setInfos(null)
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          id, title, ref_projet, status, description, date_debut, date_fin,
          lieu_text, realisateur, agence, note_prod, drive_url, cover_url,
          types_projet, metadata,
          clients ( nom_commercial, email, phone, address )
        `)
        .eq('id', projetId)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        setInfos(null)
        return
      }

      const m = data.metadata ?? {}
      const meta = (key) => m[key] ?? null
      const normalized = {
        id: data.id,
        title: data.title,
        ref_projet: data.ref_projet,
        status: data.status,
        description: data.description,
        date_debut: data.date_debut,
        date_fin: data.date_fin,
        lieu_text: data.lieu_text,
        realisateur: meta('realisateur') ?? data.realisateur,
        agence: meta('agence') ?? data.agence,
        production: meta('production'),
        producteur: meta('producteur'),
        note_prod: data.note_prod,
        drive_url: data.drive_url,
        cover_url: data.cover_url,
        types_projet: Array.isArray(data.types_projet) ? data.types_projet : [],
        client: data.clients
          ? {
              nom: data.clients.nom_commercial,
              email: data.clients.email,
              phone: data.clients.phone,
              address: data.clients.address,
            }
          : null,
      }
      setInfos(normalized)
      saveCache(cacheKey, normalized)
    } catch (err) {
      console.warn('[useProjetInfos] error', err.message)
    } finally {
      setLoading(false)
    }
  }, [projetId])

  useEffect(() => {
    fetchInfos()
  }, [fetchInfos])

  return { infos, loading, refetch: fetchInfos }
}
