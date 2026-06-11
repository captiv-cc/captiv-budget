// ════════════════════════════════════════════════════════════════════════════
// useDerouleJour — TOUTES les lanes + créneaux d'un jour (vue Timeline)
// ════════════════════════════════════════════════════════════════════════════
//
// Alimente la vue agenda multi-lanes (style Google Calendar). Charge :
// - les lanes du déroulé (lieu / personne / equipe / global) + ma lane perso
// - tous les créneaux du déroulé
//
// Ordre des colonnes : MOI (ma lane perso) → lieux (scènes) → autres cadreurs
// → équipes. Les lanes 'global' ne sont pas des colonnes (créneaux multi_lane).
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fetchMonMembreId } from '../lib/membre'
import { loadCache, saveCache } from '../lib/cache'
import { effectiveLaneColor } from '../lib/derouleColors'

export function useDerouleJour({ projetId, jour }) {
  const { user } = useAuth()
  const [lanes, setLanes] = useState([])
  const [creneaux, setCreneaux] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const cacheKey = `deroulejour:${user?.id}:${projetId}:${jour}`

  useEffect(() => {
    let alive = true
    loadCache(cacheKey).then((c) => {
      if (alive && c) {
        setLanes(c.lanes ?? [])
        setCreneaux(c.creneaux ?? [])
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [cacheKey])

  const fetchData = useCallback(async () => {
    if (!projetId || !jour) {
      setLanes([])
      setCreneaux([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const membreId = user?.id ? await fetchMonMembreId(user.id, projetId) : null

      const { data: deroule } = await supabase
        .from('projet_deroules')
        .select('id, date_jour')
        .eq('project_id', projetId)
        .eq('date_jour', jour)
        .maybeSingle()

      if (!deroule) {
        setLanes([])
        setCreneaux([])
        setLoading(false)
        return
      }

      const [lanesRes, creneauxRes] = await Promise.all([
        supabase
          .from('projet_deroule_lanes')
          .select('id, libelle, type, membre_id, couleur, sort_order')
          .eq('deroule_id', deroule.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('projet_deroule_creneaux')
          .select('id, titre, type, statut, heure_debut_min, heure_fin_min, lieu_text, couleur, lane_id, multi_lane, artiste_id')
          .eq('deroule_id', deroule.id),
      ])

      if (lanesRes.error) throw lanesRes.error
      if (creneauxRes.error) throw creneauxRes.error

      const creneauxData = creneauxRes.data ?? []

      // Colonnes = TOUTES les lanes (global/équipe/lieu/personne), sauf celles
      // vides. Les vrais créneaux multi_lane restent des bandeaux côté vue, donc
      // une lane n'est gardée que si elle a au moins un créneau mono-lane — OU
      // si c'est ma lane perso (toujours visible). Ordre : MOI puis sort_order.
      const usedLaneIds = new Set(
        creneauxData.filter((c) => !c.multi_lane && c.lane_id).map((c) => c.lane_id),
      )
      const cols = (lanesRes.data ?? [])
        .map((l) => ({
          id: l.id,
          libelle: l.libelle,
          type: l.type,
          color: effectiveLaneColor(l),
          isMine: !!membreId && l.type === 'personne' && l.membre_id === membreId,
          sort_order: l.sort_order ?? 0,
        }))
        .filter((l) => usedLaneIds.has(l.id) || l.isMine)
        .sort((a, b) => {
          if (a.isMine !== b.isMine) return a.isMine ? -1 : 1
          return a.sort_order - b.sort_order
        })

      setLanes(cols)
      setCreneaux(creneauxData)
      saveCache(cacheKey, { lanes: cols, creneaux: creneauxData })
    } catch (err) {
      console.warn('[useDerouleJour] error', err.message)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [user?.id, projetId, jour])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { lanes, creneaux, loading, error, refetch: fetchData }
}
