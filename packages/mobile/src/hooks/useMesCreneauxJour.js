// ════════════════════════════════════════════════════════════════════════════
// useMesCreneauxJour — créneaux du cadreur pour un jour donné (modèle lane)
// ════════════════════════════════════════════════════════════════════════════
//
// « Mes créneaux » = créneaux du déroulé du jour dont :
//   - lane_id == ma lane perso (projet_deroule_lanes type='personne'), OU
//   - je suis dans member_ids (projet_deroule_creneau_membres)
// Exactement la logique de la vue web DerouleCadreurView.
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fetchMonMembreId } from '../lib/membre'
import { loadCache, saveCache } from '../lib/cache'
import { combineDateAndMinutes, dureeMinutes, aujourdhuiJour } from '../lib/dateMin'

export function useMesCreneauxJour({ projetId, jour }) {
  const { user } = useAuth()
  const [creneaux, setCreneaux] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const cacheKey = `mescreneaux:${user?.id}:${projetId}:${jour}`

  // Hydrate depuis le cache (offline / affichage instantané)
  useEffect(() => {
    let alive = true
    loadCache(cacheKey).then((c) => {
      if (alive && Array.isArray(c)) {
        setCreneaux(c)
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [cacheKey])

  const fetchCreneaux = useCallback(async () => {
    if (!user?.id || !projetId || !jour) {
      setCreneaux([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const dateJour = jour ?? aujourdhuiJour()

      // 0. Mon membre_id pour ce projet
      const membreId = await fetchMonMembreId(user.id, projetId)

      // 1. Le déroulé du jour
      const { data: deroule } = await supabase
        .from('projet_deroules')
        .select('id, date_jour')
        .eq('project_id', projetId)
        .eq('date_jour', dateJour)
        .maybeSingle()

      if (!deroule) {
        setCreneaux([])
        setLoading(false)
        return
      }

      // 2a. Mes lanes perso dans ce déroulé
      let myLaneIds = new Set()
      if (membreId) {
        const { data: lanes } = await supabase
          .from('projet_deroule_lanes')
          .select('id')
          .eq('deroule_id', deroule.id)
          .eq('type', 'personne')
          .eq('membre_id', membreId)
        myLaneIds = new Set((lanes ?? []).map((l) => l.id))
      }

      // 2b. Créneaux où je suis dans member_ids (assignation directe)
      let assignedIds = new Set()
      if (membreId) {
        const { data: assigns } = await supabase
          .from('projet_deroule_creneau_membres')
          .select('creneau_id, projet_deroule_creneaux!inner(deroule_id)')
          .eq('membre_id', membreId)
          .eq('projet_deroule_creneaux.deroule_id', deroule.id)
        assignedIds = new Set((assigns ?? []).map((a) => a.creneau_id))
      }

      if (myLaneIds.size === 0 && assignedIds.size === 0) {
        setCreneaux([])
        setLoading(false)
        return
      }

      // 3. Tous les créneaux du déroulé, filtrés en JS (lane OU assignation)
      const { data: rows, error: err } = await supabase
        .from('projet_deroule_creneaux')
        .select(`
          id, titre, type, description, statut,
          heure_debut_min, heure_fin_min,
          lieu_text, lieu_id, couleur, lane_id,
          alerte_text, alerte_niveau, artiste_id
        `)
        .eq('deroule_id', deroule.id)

      if (err) throw err

      const normalized = (rows ?? [])
        .filter((c) => myLaneIds.has(c.lane_id) || assignedIds.has(c.id))
        .map((c) => {
          const start = combineDateAndMinutes(deroule.date_jour, c.heure_debut_min)
          const end = combineDateAndMinutes(deroule.date_jour, c.heure_fin_min)
          return {
            id: c.id,
            titre: c.titre,
            type: c.type,
            couleur: c.couleur,
            statut: c.statut ?? 'planifie',
            start: start?.toISOString() ?? null,
            end: end?.toISOString() ?? null,
            duree_min: dureeMinutes(c.heure_debut_min, c.heure_fin_min),
            lieu: c.lieu_text,
            lieu_id: c.lieu_id ?? null,
            lane_id: c.lane_id ?? null,
            deroule_id: deroule.id,
            headliner: false,
            brief: c.description,
            warnings: c.alerte_text ? [c.alerte_text] : [],
            equipe: [], // chargée à la demande dans le détail (useCreneau)
            _raw: c,
          }
        })
        .sort((a, b) => (a._raw.heure_debut_min ?? 0) - (b._raw.heure_debut_min ?? 0))

      setCreneaux(normalized)
      saveCache(cacheKey, normalized)
    } catch (err) {
      console.warn('[useMesCreneauxJour] error', err.message)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [user?.id, projetId, jour])

  useEffect(() => {
    fetchCreneaux()
  }, [fetchCreneaux])

  return { creneaux, loading, error, refetch: fetchCreneaux }
}
