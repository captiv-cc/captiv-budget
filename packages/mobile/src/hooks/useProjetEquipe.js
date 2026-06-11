// ════════════════════════════════════════════════════════════════════════════
// useProjetEquipe — équipe d'un projet (membres + contacts + sessions), groupée
// ════════════════════════════════════════════════════════════════════════════
//
// Calqué sur le web (lib/crew.js + EquipeShareSession) :
// - projet_membres + embed contacts (champs contact prioritaires, fallback)
// - secteur = projet_membres.secteur || contacts.ville
// - sessions de présence via projet_session_membres + projet_sessions
// - groupé par `category`, ordre des catégories = projects.metadata.equipe.category_order
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { loadCache, saveCache } from '../lib/cache'

export function useProjetEquipe(projetId, categoryOrder) {
  const { user } = useAuth()
  const [membres, setMembres] = useState([])
  const [loading, setLoading] = useState(true)
  const cacheKey = `equipe:${projetId}`

  useEffect(() => {
    let alive = true
    loadCache(cacheKey).then((c) => {
      if (alive && Array.isArray(c)) {
        setMembres(c)
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [cacheKey])

  const fetchEquipe = useCallback(async () => {
    if (!projetId) {
      setMembres([])
      setLoading(false)
      return
    }
    try {
      const [membresRes, sessionsRes] = await Promise.all([
        supabase
          .from('projet_membres')
          .select(`
            id, nom, prenom, email, telephone, specialite, secteur, category, sort_order,
            contacts ( nom, prenom, email, telephone, specialite, ville, user_id )
          `)
          .eq('project_id', projetId)
          .is('parent_membre_id', null)
          .order('category', { ascending: true })
          .order('sort_order', { ascending: true }),
        supabase
          .from('projet_session_membres')
          .select(`
            membre_id, presence_days, arrival_date, arrival_time, departure_date, departure_time, statut,
            session:projet_sessions!inner ( label, lieu_principal_text, couleur, start_date, end_date, sort_order, project_id )
          `)
          .eq('session.project_id', projetId),
      ])

      if (membresRes.error) throw membresRes.error

      // Sessions groupées par membre
      const sessByMembre = new Map()
      for (const s of sessionsRes.data ?? []) {
        const days = Array.isArray(s.presence_days) ? [...s.presence_days].sort() : []
        const arrival = s.arrival_date ?? days[0] ?? s.session?.start_date ?? null
        const departure = s.departure_date ?? days[days.length - 1] ?? s.session?.end_date ?? null
        const sess = {
          label: s.session?.label ?? null,
          lieu: s.session?.lieu_principal_text ?? null,
          couleur: s.session?.couleur ?? null,
          days,
          arrival, // plage (dérivée)
          departure,
          arrivalDate: s.arrival_date ?? null, // explicite (= badge voyage web)
          departureDate: s.departure_date ?? null,
          arrival_time: s.arrival_time ?? null,
          departure_time: s.departure_time ?? null,
          sort_order: s.session?.sort_order ?? 0,
        }
        if (!sessByMembre.has(s.membre_id)) sessByMembre.set(s.membre_id, [])
        sessByMembre.get(s.membre_id).push(sess)
      }
      for (const arr of sessByMembre.values()) arr.sort((a, b) => a.sort_order - b.sort_order)

      const normalized = (membresRes.data ?? []).map((m) => {
        const ct = m.contacts
        const prenom = ct?.prenom ?? m.prenom
        const nom = ct?.nom ?? m.nom
        return {
          id: m.id,
          nom: [prenom, nom].filter(Boolean).join(' ').trim() || 'Sans nom',
          poste: m.specialite || ct?.specialite || null,
          category: m.category || 'Équipe',
          secteur: m.secteur || ct?.ville || null,
          phone: ct?.telephone || m.telephone || null,
          email: ct?.email || m.email || null,
          is_me: !!ct?.user_id && ct.user_id === user?.id,
          sessions: sessByMembre.get(m.id) ?? [],
        }
      })
      setMembres(normalized)
      saveCache(cacheKey, normalized)
    } catch (err) {
      console.warn('[useProjetEquipe] error', err.message)
    } finally {
      setLoading(false)
    }
  }, [projetId, user?.id])

  useEffect(() => {
    fetchEquipe()
  }, [fetchEquipe])

  const groupes = useMemo(() => {
    const map = new Map()
    for (const m of membres) {
      if (!map.has(m.category)) map.set(m.category, [])
      map.get(m.category).push(m)
    }
    let cats = [...map.keys()]
    // Ordre web : catégories de metadata.equipe.category_order d'abord, reste après
    if (Array.isArray(categoryOrder) && categoryOrder.length) {
      const idx = (c) => {
        const i = categoryOrder.indexOf(c)
        return i === -1 ? Number.MAX_SAFE_INTEGER : i
      }
      cats = cats.sort((a, b) => idx(a) - idx(b) || a.localeCompare(b, 'fr'))
    }
    return cats.map((category) => ({ category, items: map.get(category) }))
  }, [membres, categoryOrder])

  return { membres, groupes, loading, refetch: fetchEquipe }
}
