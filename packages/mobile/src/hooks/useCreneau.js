// ════════════════════════════════════════════════════════════════════════════
// useCreneau — détail d'un créneau + son équipe (membres + profiles)
// ════════════════════════════════════════════════════════════════════════════
//
// Stratégie :
// 1. Charge le créneau (projet_deroule_creneaux) + son déroulé (pour date_jour)
// 2. Charge les membres (projet_deroule_creneau_membres) joints à profiles
// 3. Normalise au format attendu par CreneauDetailSheet
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { combineDateAndMinutes, dureeMinutes } from '../lib/dateMin'

export function useCreneau(creneauId) {
  const { user } = useAuth()
  const [creneau, setCreneau] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchCreneau = useCallback(async () => {
    if (!creneauId) {
      setCreneau(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // 1. Le créneau + son déroulé (date_jour pour les timestamps)
      const { data: c, error: errC } = await supabase
        .from('projet_deroule_creneaux')
        .select(`
          id, titre, type, description, notes, statut,
          heure_debut_min, heure_fin_min,
          lieu_text, lieu_id, lane_id, couleur,
          alerte_text, alerte_niveau,
          artiste_id, deroule_id,
          projet_deroules!inner ( date_jour )
        `)
        .eq('id', creneauId)
        .maybeSingle()

      if (errC) throw errC
      if (!c) {
        setCreneau(null)
        return
      }

      const dateJour = c.projet_deroules?.date_jour
      const start = combineDateAndMinutes(dateJour, c.heure_debut_min)
      const end = combineDateAndMinutes(dateJour, c.heure_fin_min)

      // 2. Les membres → projet_membres → contacts (nom, tel, lien compte)
      const { data: membres, error: errM } = await supabase
        .from('projet_deroule_creneau_membres')
        .select(`
          id, role, membre_id,
          projet_membres!inner (
            id, nom, prenom,
            contacts ( user_id, nom, prenom, telephone )
          )
        `)
        .eq('creneau_id', creneauId)

      if (errM) throw errM

      const equipe = (membres ?? []).map((m) => {
        const pm = m.projet_membres
        const ct = pm?.contacts
        const prenom = ct?.prenom ?? pm?.prenom
        const nom = ct?.nom ?? pm?.nom
        const label = [prenom, nom].filter(Boolean).join(' ').trim()
        return {
          membre_id: m.membre_id,
          role: m.role ?? 'Cadreur',
          nom: label || 'Inconnu',
          phone: ct?.telephone ?? null,
          is_me: !!ct?.user_id && ct.user_id === user?.id,
        }
      })

      setCreneau({
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
        deroule_id: c.deroule_id ?? null,
        headliner: false, // TODO: déduire de artiste.headliner si dispo
        brief: c.description,
        notes: c.notes,
        alerte_text: c.alerte_text,
        alerte_niveau: c.alerte_niveau,
        warnings: c.alerte_text ? [c.alerte_text] : [],
        equipe,
        _raw: c,
      })
    } catch (err) {
      console.warn('[useCreneau] error', err.message)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [creneauId, user?.id])

  useEffect(() => {
    fetchCreneau()
  }, [fetchCreneau])

  return { creneau, loading, error, refetch: fetchCreneau }
}
