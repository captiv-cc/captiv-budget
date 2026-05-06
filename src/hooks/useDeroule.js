// ════════════════════════════════════════════════════════════════════════════
//  useDeroule — Hook React pour l'Outil Déroulé (CONDUITE V1)
//  ──────────────────────────────────────────────────────────────
//
//  Orchestre l'état complet de l'onglet Déroulé d'un projet :
//   - liste des déroulés (1 par jour, pour le sélecteur de date)
//   - déroulé courant : header + lanes + créneaux + assignations membres
//
//  Pattern miroir de `useLivrables` / `useCrew` :
//   - bumpReload pour forcer un refetch après mutation
//   - aliveRef pour ignorer setState après unmount
//   - lastReloadAtRef pour muter les self-echoes Realtime (1500ms)
//   - debounce 400ms sur les events Realtime pour coalescer les rafales
//
//  V1 : pas d'optimistic updates (les actions courantes sont simples et
//  rapides — ajout d'un créneau, drag-drop, etc. — un refetch full après
//  chaque mutation est acceptable. Optimistic à ajouter en V1.5 si latence
//  ressentie).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as D from '../lib/deroule'
import { supabase } from '../lib/supabase'

/**
 * @param {string} projectId
 * @param {string|null} selectedDateJour  date ISO 'YYYY-MM-DD' du déroulé
 *                                        actuellement affiché. null = pas de
 *                                        déroulé sélectionné (état initial).
 */
export function useDeroule(projectId, selectedDateJour) {
  // ─── État principal ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Liste de tous les déroulés du projet (header seul, pour le sélecteur jour).
  const [deroules, setDeroules] = useState([])

  // Détail du déroulé courant (selon selectedDateJour).
  const [currentDeroule, setCurrentDeroule] = useState(null)
  const [lanes, setLanes] = useState([])
  const [creneaux, setCreneaux] = useState([])

  // Compteur de reload (incrémenté par bumpReload).
  const [reloadKey, setReloadKey] = useState(0)
  const lastReloadAtRef = useRef(0)
  const bumpReload = useCallback(() => {
    lastReloadAtRef.current = Date.now()
    setReloadKey((k) => k + 1)
  }, [])

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // ─── Chargement initial + refetch sur reloadKey/selectedDateJour ─────────
  const loadedKeyRef = useRef(null)
  useEffect(() => {
    if (!projectId) {
      setLoading(false)
      setDeroules([])
      setCurrentDeroule(null)
      setLanes([])
      setCreneaux([])
      loadedKeyRef.current = null
      return
    }

    let cancelled = false
    const loadKey = `${projectId}|${selectedDateJour || ''}`
    const isFirstLoad = loadedKeyRef.current !== loadKey

    async function load() {
      if (isFirstLoad) setLoading(true)
      setError(null)
      try {
        // 1. Liste des déroulés du projet (toujours rechargée, peu volumineuse)
        const allDeroules = await D.fetchProjectDeroules(projectId)
        if (cancelled || !aliveRef.current) return

        // 2. Détail du déroulé courant si une date est sélectionnée
        let derouleDetail = null
        const selected = selectedDateJour
          ? allDeroules.find((d) => d.date_jour === selectedDateJour)
          : null
        if (selected) {
          derouleDetail = await D.fetchDerouleComplet(selected.id)
        }
        if (cancelled || !aliveRef.current) return

        setDeroules(allDeroules)
        setCurrentDeroule(derouleDetail?.deroule || null)
        setLanes(derouleDetail?.lanes || [])
        setCreneaux(derouleDetail?.creneaux || [])
        loadedKeyRef.current = loadKey
      } catch (e) {
        if (cancelled || !aliveRef.current) return
        console.error('[useDeroule] load error', e)
        setError(e)
      } finally {
        if (!cancelled && aliveRef.current) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedDateJour, reloadKey])

  // ─── Realtime ─────────────────────────────────────────────────────────────
  // Écoute les 4 tables filtrées par project_id (pour deroules) ou via JOIN
  // implicite (les autres tables n'ont pas project_id direct, on filtre côté
  // client après bumpReload). Mute les self-echoes (1500ms après bumpReload).
  useEffect(() => {
    if (!projectId) return undefined

    const debounce = (() => {
      let timer = null
      return (fn) => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          fn()
        }, 400)
      }
    })()

    const handler = () => {
      if (Date.now() - lastReloadAtRef.current < 1500) return
      debounce(() => bumpReload())
    }

    const channel = supabase
      .channel(`deroule-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projet_deroules',
          filter: `project_id=eq.${projectId}`,
        },
        handler,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projet_deroule_lanes' },
        handler,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projet_deroule_creneaux' },
        handler,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projet_deroule_creneau_membres',
        },
        handler,
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId, bumpReload])

  // ─── Dérivés mémoïsés ─────────────────────────────────────────────────────

  /** Map laneId → liste de créneaux triés par heure_debut. */
  const creneauxByLane = useMemo(() => {
    const map = new Map()
    for (const lane of lanes) map.set(lane.id, [])
    map.set(null, []) // bucket pour multi_lane
    for (const c of creneaux) {
      const key = c.multi_lane ? null : c.lane_id
      const arr = map.get(key) || []
      arr.push(c)
      map.set(key, arr)
    }
    for (const [k, arr] of map) {
      map.set(k, D.sortCreneauxByTime(arr))
    }
    return map
  }, [lanes, creneaux])

  /** Créneaux multi-lane (à rendre par-dessus toutes les colonnes). */
  const creneauxMultiLane = useMemo(
    () => D.sortCreneauxByTime(creneaux.filter((c) => c.multi_lane)),
    [creneaux],
  )

  // ─── Mutations — helpers exposés ─────────────────────────────────────────

  const reload = bumpReload

  const createDeroule = useCallback(
    async (payload) => {
      const result = await D.createDeroule({ ...payload, project_id: projectId })
      bumpReload()
      return result
    },
    [projectId, bumpReload],
  )

  const updateDeroule = useCallback(
    async (derouleId, fields) => {
      const result = await D.updateDeroule(derouleId, fields)
      bumpReload()
      return result
    },
    [bumpReload],
  )

  const deleteDeroule = useCallback(
    async (derouleId) => {
      await D.deleteDeroule(derouleId)
      bumpReload()
    },
    [bumpReload],
  )

  const addLane = useCallback(
    async (libelle) => {
      if (!currentDeroule?.id) throw new Error('Aucun déroulé sélectionné')
      const result = await D.addLane(currentDeroule.id, libelle)
      bumpReload()
      return result
    },
    [currentDeroule, bumpReload],
  )

  const updateLane = useCallback(
    async (laneId, fields) => {
      const result = await D.updateLane(laneId, fields)
      bumpReload()
      return result
    },
    [bumpReload],
  )

  const deleteLane = useCallback(
    async (laneId) => {
      await D.deleteLane(laneId)
      bumpReload()
    },
    [bumpReload],
  )

  const createCreneau = useCallback(
    async (payload) => {
      if (!currentDeroule?.id) throw new Error('Aucun déroulé sélectionné')
      const result = await D.createCreneau({
        ...payload,
        deroule_id: currentDeroule.id,
      })
      bumpReload()
      return result
    },
    [currentDeroule, bumpReload],
  )

  const updateCreneau = useCallback(
    async (creneauId, fields) => {
      const result = await D.updateCreneau(creneauId, fields)
      bumpReload()
      return result
    },
    [bumpReload],
  )

  const deleteCreneau = useCallback(
    async (creneauId) => {
      await D.deleteCreneau(creneauId)
      bumpReload()
    },
    [bumpReload],
  )

  const setCreneauMembres = useCallback(
    async (creneauId, membreIds, role = null) => {
      await D.setCreneauMembres(creneauId, membreIds, role)
      bumpReload()
    },
    [bumpReload],
  )

  const importPresences = useCallback(
    async (membres) => {
      if (!currentDeroule?.id) throw new Error('Aucun déroulé sélectionné')
      const created = await D.importPresencesFromTechlist(
        currentDeroule.id,
        membres,
      )
      bumpReload()
      return created
    },
    [currentDeroule, bumpReload],
  )

  return {
    loading,
    error,
    // Liste de tous les déroulés du projet (sélecteur jour)
    deroules,
    // Déroulé courant
    deroule: currentDeroule,
    lanes,
    creneaux,
    creneauxByLane,
    creneauxMultiLane,
    // Mutations
    reload,
    createDeroule,
    updateDeroule,
    deleteDeroule,
    addLane,
    updateLane,
    deleteLane,
    createCreneau,
    updateCreneau,
    deleteCreneau,
    setCreneauMembres,
    importPresences,
  }
}
