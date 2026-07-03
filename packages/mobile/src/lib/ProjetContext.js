// ════════════════════════════════════════════════════════════════════════════
// ProjetContext — projet courant partagé + sélecteur (changer de projet)
// ════════════════════════════════════════════════════════════════════════════
//
// Centralise LE projet actif de toute l'app (Planning, Livrables, pages projet).
// - charge mes projets (chaîne contacts.user_id → projet_membres → projects)
// - défaut = projet dont le déroulé est le plus proche d'aujourd'hui
// - override manuel via setProjetId (persisté), réutilisé au prochain lancement
// - cache offline
//
// ════════════════════════════════════════════════════════════════════════════

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { fetchMesMembres } from './membre'
import { loadCache, saveCache } from './cache'
import { aujourdhuiJour } from './dateMin'

const SELECTED_KEY = 'selectedProjetId'

const ProjetContext = createContext(null)

function joursDeDiff(dateA, dateB) {
  const [ay, am, ad] = dateA.split('-').map(Number)
  const [by, bm, bd] = dateB.split('-').map(Number)
  return Math.abs(Math.round((new Date(ay, am - 1, ad) - new Date(by, bm - 1, bd)) / 86400000))
}

export function ProjetProvider({ children }) {
  const { user } = useAuth()
  const [projets, setProjets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [autoId, setAutoId] = useState(null) // défaut calculé (projet le plus proche)
  const [loading, setLoading] = useState(true)
  const cacheKey = `projets:${user?.id}`

  // Hydrate (offline + instantané) : liste projets + dernier projet choisi
  useEffect(() => {
    let alive = true
    Promise.all([loadCache(cacheKey), AsyncStorage.getItem(SELECTED_KEY)]).then(([cached, sel]) => {
      if (!alive) return
      if (Array.isArray(cached)) {
        setProjets(cached)
        setLoading(false)
      }
      if (sel) setSelectedId(sel)
    })
    return () => { alive = false }
  }, [cacheKey])

  const fetchProjets = useCallback(async () => {
    if (!user?.id) return
    try {
      // Internes (admin/charge_prod/coordinateur) : TOUS les projets de l'org
      // (un admin n'est pas forcément « membre » de chaque projet). Externes :
      // chaîne contacts.user_id → projet_membres → projects, comme avant.
      const { data: prof } = await supabase
        .from('profiles')
        .select('role, org_id')
        .eq('id', user.id)
        .maybeSingle()
      const isInternal = ['admin', 'charge_prod', 'coordinateur'].includes(prof?.role)

      let ids = null // null = pas de filtre .in() (requête org)
      if (!isInternal) {
        const membres = await fetchMesMembres(user.id)
        ids = [...new Set(membres.map((m) => m.project_id))]
        if (ids.length === 0) {
          setProjets([])
          setLoading(false)
          return
        }
      }

      let query = supabase
        .from('projects')
        .select('id, title, status, date_debut, date_fin, lieu_text, realisateur, agence, note_prod, drive_url, ref_projet, cover_url, lat, lon, metadata')
      query = isInternal ? query.eq('org_id', prof.org_id) : query.in('id', ids)
      const { data: rows, error } = await query
      if (error) throw error
      if (isInternal) ids = (rows ?? []).map((r) => r.id)

      // Défaut = projet dont un déroulé est le plus proche d'aujourd'hui
      const today = aujourdhuiJour()
      const { data: deroules } = await supabase
        .from('projet_deroules')
        .select('project_id, date_jour')
        .in('project_id', ids)

      let best = null
      for (const d of deroules ?? []) {
        if (!d.date_jour) continue
        const dist = joursDeDiff(d.date_jour, today)
        if (!best || dist < best.dist) best = { id: d.project_id, dist }
      }
      const auto = best?.id ?? ids[0]
      setAutoId(auto)

      const sorted = (rows ?? []).slice().sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', 'fr'))
      setProjets(sorted)
      saveCache(cacheKey, sorted)
    } catch (err) {
      console.warn('[ProjetContext] error', err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    fetchProjets()
  }, [fetchProjets])

  const setProjetId = useCallback((id) => {
    setSelectedId(id)
    AsyncStorage.setItem(SELECTED_KEY, id).catch(() => {})
  }, [])

  // Projet effectif : choix manuel s'il est encore valide, sinon défaut auto
  const projet = useMemo(() => {
    if (!projets.length) return null
    const wanted = selectedId && projets.some((p) => p.id === selectedId) ? selectedId : autoId
    return projets.find((p) => p.id === wanted) ?? projets[0]
  }, [projets, selectedId, autoId])

  const value = useMemo(
    () => ({ projet, projets, loading, setProjetId, refetch: fetchProjets }),
    [projet, projets, loading, setProjetId, fetchProjets],
  )

  return <ProjetContext.Provider value={value}>{children}</ProjetContext.Provider>
}

export function useProjet() {
  const ctx = useContext(ProjetContext)
  if (!ctx) throw new Error('useProjet doit être utilisé dans <ProjetProvider>')
  return ctx
}
