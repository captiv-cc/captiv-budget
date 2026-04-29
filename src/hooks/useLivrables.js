// ════════════════════════════════════════════════════════════════════════════
// useLivrables — Hook React pour l'Outil Livrables (LIV-3)
// ════════════════════════════════════════════════════════════════════════════
//
// Orchestre l'état complet d'un projet côté Livrables :
//   - config (en-tête)
//   - blocks + livrables + livrablesByBlock (groupage)
//   - versions + étapes (indexées par livrable_id)
//   - phases projet
//   - dérivés : compteurs (total / en retard / livrés / validés / prochain),
//               liste des monteurs distincts
//
// Pattern miroir de `useMateriel` (cf. MAT-9B + MAT-9B-opt) :
//   - bumpReload pour forcer un refetch ciblé après mutation
//   - aliveRef pour ignorer les setState après unmount
//   - lastReloadAtRef pour muter les self-echoes Realtime (1500ms)
//   - debounce 400ms sur les events Realtime pour coalescer les rafales
//   - optimistic updates dès la V1 sur les inline edits :
//       updateLivrable → patch state local AVANT await
//       updatePhase    → idem (utile pour les drag dans drawer)
//
// LIV-4 (sync planning) — ACQUIS :
//   - création/maj/suppression auto de l'event miroir lors des mutations
//     d'étapes et de phases (forward sync dans `livrables.js`).
//   - action `backfillEvents` exposée pour réconcilier les étapes/phases
//     créées sous LIV-3 (event_id=null) en un coup.
//   - reverse sync (planning → LIV) : helpers `eventPatchToEtapePatch` /
//     `isEventMirror` dans `livrablesPlanningSync.js` — à composer côté UI
//     planning (PlanningTab). Pas d'écouteur events ici : le contrat est
//     que le planning route TOUJOURS les mirror events via `updateEtape` /
//     `updatePhase`, ce qui re-sync l'event via la forward sync naturelle.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as L from '../lib/livrables'
import {
  computeCompteurs,
  groupLivrablesByBlock,
  indexEtapesByLivrable,
  indexVersionsByLivrable,
  listMonteurs,
  sortBySortOrder,
} from '../lib/livrablesHelpers'
import { backfillMirrorEvents } from '../lib/livrablesPlanningSync'
import { supabase } from '../lib/supabase'

export function useLivrables(projectId) {
  // ─── État principal ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [config, setConfig] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [livrables, setLivrables] = useState([])
  const [versions, setVersions] = useState([])
  const [etapes, setEtapes] = useState([])
  const [phases, setPhases] = useState([])

  // Compteur de reload (incrémenté par bumpReload — déclenche refetch).
  const [reloadKey, setReloadKey] = useState(0)
  const lastReloadAtRef = useRef(0)
  const bumpReload = useCallback(() => {
    lastReloadAtRef.current = Date.now()
    setReloadKey((k) => k + 1)
  }, [])

  // Ref pour éviter les setState après unmount (cf. MAT pattern).
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // ─── Chargement initial + refetch sur reloadKey ───────────────────────────
  // Spinner full-page UNIQUEMENT au premier chargement (ou changement de
  // projet) — sur un bumpReload (mutation locale ou echo Realtime), refetch
  // silencieux pour éviter le flicker UI.
  const loadedProjectIdRef = useRef(null)
  useEffect(() => {
    if (!projectId) {
      setLoading(false)
      setConfig(null)
      setBlocks([])
      setLivrables([])
      setVersions([])
      setEtapes([])
      setPhases([])
      loadedProjectIdRef.current = null
      return
    }
    let cancelled = false
    const isProjectSwitch = loadedProjectIdRef.current !== projectId
    async function load() {
      if (isProjectSwitch) setLoading(true)
      setError(null)
      try {
        const bundle = await L.fetchProjectLivrablesBundle(projectId)
        if (cancelled || !aliveRef.current) return
        setConfig(bundle.config)
        setBlocks(bundle.blocks)
        setLivrables(bundle.livrables)
        setVersions(bundle.versions)
        setEtapes(bundle.etapes)
        setPhases(bundle.phases)
        loadedProjectIdRef.current = projectId
      } catch (err) {
        if (!cancelled && aliveRef.current) setError(err)
      } finally {
        if (!cancelled && aliveRef.current && isProjectSwitch) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, reloadKey])

  // ─── Realtime collab (Layer 1, miroir MAT-9B) ─────────────────────────────
  // Abonnement aux 6 tables livrables_*. Stratégie :
  //   - 1 seul channel par projet : `livrables-collab:${projectId}`
  //   - Tables avec project_id direct (config, blocks, livrables, phases)
  //     → filter server-side `project_id=eq.X`
  //   - Tables sans project_id (versions, étapes) → pas de filter, c'est la
  //     RLS (can_read_outil) qui filtre côté server. Un user qui n'a pas
  //     accès au projet ne reçoit aucun event.
  //   - Debounce 400ms pour coalescer les rafales (bulk update, reorder…).
  //   - Mute self-echo : si bumpReload local < 1500ms, on skip — c'est
  //     soit notre propre echo, soit un event qui sera de toute façon dans
  //     le refetch en cours.
  useEffect(() => {
    if (!projectId) return undefined
    let timer = null
    function debouncedReload() {
      if (Date.now() - lastReloadAtRef.current < 1500) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (aliveRef.current) bumpReload()
      }, 400)
    }
    const channel = supabase
      .channel(`livrables-collab:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projet_livrable_config',
          filter: `project_id=eq.${projectId}`,
        },
        debouncedReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'livrable_blocks',
          filter: `project_id=eq.${projectId}`,
        },
        debouncedReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'livrables',
          filter: `project_id=eq.${projectId}`,
        },
        debouncedReload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'livrable_versions' },
        debouncedReload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'livrable_etapes' },
        debouncedReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projet_phases',
          filter: `project_id=eq.${projectId}`,
        },
        debouncedReload,
      )
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [projectId, bumpReload])

  // ─── Dérivés ─────────────────────────────────────────────────────────────
  const sortedBlocks = useMemo(() => sortBySortOrder(blocks), [blocks])
  const sortedLivrables = useMemo(() => sortBySortOrder(livrables), [livrables])
  const livrablesByBlock = useMemo(
    () => groupLivrablesByBlock(sortedLivrables),
    [sortedLivrables],
  )
  const versionsByLivrable = useMemo(() => indexVersionsByLivrable(versions), [versions])
  const etapesByLivrable = useMemo(() => indexEtapesByLivrable(etapes), [etapes])
  const compteurs = useMemo(() => computeCompteurs(sortedLivrables), [sortedLivrables])
  const monteurs = useMemo(
    () => listMonteurs(sortedLivrables, /* profilesById */ new Map()),
    [sortedLivrables],
  )

  // ─── Actions — Config ────────────────────────────────────────────────────
  const updateConfigAction = useCallback(
    async (fields) => {
      if (!projectId) return null
      // Optimistic : on patch en local AVANT le await pour éviter le lag
      // sur les inline edits du header.
      setConfig((prev) => ({ ...(prev || { project_id: projectId }), ...fields }))
      try {
        const data = await L.upsertConfig(projectId, fields)
        bumpReload()
        return data
      } catch (err) {
        bumpReload() // rollback via refetch
        throw err
      }
    },
    [projectId, bumpReload],
  )

  // ─── Actions — Blocks ────────────────────────────────────────────────────
  const createBlockAction = useCallback(
    async ({ nom, prefixe = null, couleur = null } = {}) => {
      if (!projectId) return null
      const nextOrder =
        sortedBlocks.reduce((max, b) => Math.max(max, b.sort_order || 0), 0) + 1
      const block = await L.createBlock({
        projectId,
        nom: nom || 'Nouveau bloc',
        prefixe,
        couleur,
        sortOrder: nextOrder,
      })
      bumpReload()
      return block
    },
    [projectId, sortedBlocks, bumpReload],
  )

  const updateBlockAction = useCallback(
    async (blockId, fields) => {
      // Optimistic — la rename inline d'un bloc est très fréquent.
      setBlocks((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, ...fields } : b)),
      )
      try {
        const data = await L.updateBlock(blockId, fields)
        bumpReload()
        return data
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  // Rename = updateBlock { nom } — alias explicite pour matcher la roadmap.
  const renameBlockAction = useCallback(
    async (blockId, nom) => updateBlockAction(blockId, { nom }),
    [updateBlockAction],
  )

  const deleteBlockAction = useCallback(
    async (blockId) => {
      await L.deleteBlock(blockId)
      bumpReload()
    },
    [bumpReload],
  )

  const restoreBlockAction = useCallback(
    async (blockId) => {
      await L.restoreBlock(blockId)
      bumpReload()
    },
    [bumpReload],
  )

  const reorderBlocksAction = useCallback(
    async (orderedIds) => {
      await L.reorderBlocks(orderedIds)
      bumpReload()
    },
    [bumpReload],
  )

  // ─── Actions — Livrables ─────────────────────────────────────────────────
  const createLivrableAction = useCallback(
    async ({ blockId, data = {} } = {}) => {
      if (!projectId) return null
      if (!blockId) throw new Error('createLivrable: blockId requis')
      const livrable = await L.createLivrable({ blockId, projectId, data })
      bumpReload()
      return livrable
    },
    [projectId, bumpReload],
  )

  // Optimistic update — c'est le code chaud (toutes les inline edits passent
  // ici). Patch local AVANT await, rollback via bumpReload en cas d'erreur.
  const updateLivrableAction = useCallback(
    async (livrableId, fields) => {
      setLivrables((prev) =>
        prev.map((l) => (l.id === livrableId ? { ...l, ...fields } : l)),
      )
      try {
        const data = await L.updateLivrable(livrableId, fields)
        bumpReload()
        return data
      } catch (err) {
        bumpReload() // rollback via refetch
        throw err
      }
    },
    [bumpReload],
  )

  const deleteLivrableAction = useCallback(
    async (livrableId) => {
      // Optimistic remove — la corbeille (si visible) sera resynchronisée
      // au prochain refetch.
      setLivrables((prev) => prev.filter((l) => l.id !== livrableId))
      try {
        await L.deleteLivrable(livrableId)
        bumpReload()
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  const restoreLivrableAction = useCallback(
    async (livrableId) => {
      await L.restoreLivrable(livrableId)
      bumpReload()
    },
    [bumpReload],
  )

  const reorderLivrablesAction = useCallback(
    async (orderedIds) => {
      // Optimistic reorder : on applique le nouvel ordre côté state.
      setLivrables((prev) => {
        const byId = new Map(prev.map((l) => [l.id, l]))
        const next = []
        orderedIds.forEach((id, idx) => {
          const l = byId.get(id)
          if (l) {
            next.push({ ...l, sort_order: idx })
            byId.delete(id)
          }
        })
        // Append les non-réordonnés (autres blocs) tels quels.
        for (const l of byId.values()) next.push(l)
        return next
      })
      try {
        await L.reorderLivrables(orderedIds)
        bumpReload()
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  const duplicateLivrableAction = useCallback(
    async (livrableId) => {
      const dup = await L.duplicateLivrable(livrableId)
      bumpReload()
      return dup
    },
    [bumpReload],
  )

  // LIV-13 — Duplication cross-project. Pas d'optimistic update : le livrable
  // créé est dans un AUTRE projet, donc invisible dans la liste courante. Le
  // hook du projet cible (s'il est ouvert dans un autre onglet) le verra via
  // realtime. Sinon, visible au prochain mount du projet cible.
  const duplicateLivrableToProjectAction = useCallback(
    async (livrableId, targetProjectId, opts) => {
      return L.duplicateLivrableToProject(livrableId, targetProjectId, opts)
    },
    [],
  )

  const duplicateBlockToProjectAction = useCallback(
    async (blockId, targetProjectId) => {
      return L.duplicateBlockToProject(blockId, targetProjectId)
    },
    [],
  )

  const bulkUpdateLivrablesAction = useCallback(
    async (livrableIds, fields) => {
      // Optimistic patch sur tous les ids ciblés.
      const ids = new Set(livrableIds)
      setLivrables((prev) =>
        prev.map((l) => (ids.has(l.id) ? { ...l, ...fields } : l)),
      )
      try {
        const data = await L.bulkUpdateLivrables(livrableIds, fields)
        bumpReload()
        return data
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  // ─── Actions — Versions ──────────────────────────────────────────────────
  const addVersionAction = useCallback(
    async (livrableId, data = {}) => {
      const v = await L.addVersion({ livrableId, data })
      bumpReload()
      return v
    },
    [bumpReload],
  )

  const updateVersionAction = useCallback(
    async (versionId, fields) => {
      // Optimistic — saisie de feedback / changement de statut sont fréquents.
      setVersions((prev) =>
        prev.map((v) => (v.id === versionId ? { ...v, ...fields } : v)),
      )
      try {
        const data = await L.updateVersion(versionId, fields)
        bumpReload()
        return data
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  const deleteVersionAction = useCallback(
    async (versionId) => {
      setVersions((prev) => prev.filter((v) => v.id !== versionId))
      try {
        await L.deleteVersion(versionId)
        bumpReload()
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  // ─── Actions — Étapes ────────────────────────────────────────────────────
  const addEtapeAction = useCallback(
    async (livrableId, data = {}) => {
      const e = await L.addEtape({ livrableId, data })
      bumpReload()
      return e
    },
    [bumpReload],
  )

  const updateEtapeAction = useCallback(
    async (etapeId, fields) => {
      setEtapes((prev) =>
        prev.map((e) => (e.id === etapeId ? { ...e, ...fields } : e)),
      )
      try {
        const data = await L.updateEtape(etapeId, fields)
        bumpReload()
        return data
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  const deleteEtapeAction = useCallback(
    async (etapeId) => {
      setEtapes((prev) => prev.filter((e) => e.id !== etapeId))
      try {
        await L.deleteEtape(etapeId)
        bumpReload()
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  // ─── Actions — Phases ────────────────────────────────────────────────────
  const addPhaseAction = useCallback(
    async (data = {}) => {
      if (!projectId) return null
      const p = await L.addPhase({ projectId, data })
      bumpReload()
      return p
    },
    [projectId, bumpReload],
  )

  const updatePhaseAction = useCallback(
    async (phaseId, fields) => {
      setPhases((prev) =>
        prev.map((p) => (p.id === phaseId ? { ...p, ...fields } : p)),
      )
      try {
        const data = await L.updatePhase(phaseId, fields)
        bumpReload()
        return data
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  const deletePhaseAction = useCallback(
    async (phaseId) => {
      setPhases((prev) => prev.filter((p) => p.id !== phaseId))
      try {
        await L.deletePhase(phaseId)
        bumpReload()
      } catch (err) {
        bumpReload()
        throw err
      }
    },
    [bumpReload],
  )

  // ─── Actions — Duplication cross-project ─────────────────────────────────
  const duplicateFromProjectAction = useCallback(
    async ({ sourceProjectId, includeBlocks, includeLivrables, includePhases }) => {
      if (!projectId) return null
      const result = await L.duplicateFromProject({
        sourceProjectId,
        targetProjectId: projectId,
        includeBlocks,
        includeLivrables,
        includePhases,
      })
      bumpReload()
      return result
    },
    [projectId, bumpReload],
  )

  // ─── Refresh manuel ─────────────────────────────────────────────────────
  const refresh = useCallback(() => bumpReload(), [bumpReload])

  // ─── Backfill events miroirs (LIV-4) ─────────────────────────────────────
  // Réconciliation one-shot : crée les events manquants pour toutes les
  // étapes/phases (is_event=true, event_id=null) du projet. À appeler :
  //   - après migration de projets créés sous LIV-3 (event_id=null partout)
  //   - depuis un bouton admin "Réconcilier planning" en cas de désync
  const backfillEventsAction = useCallback(
    async () => {
      if (!projectId) return { etapes: 0, phases: 0 }
      const result = await backfillMirrorEvents(projectId)
      bumpReload()
      return result
    },
    [projectId, bumpReload],
  )

  return {
    // État
    loading,
    error,
    // Données
    config,
    blocks: sortedBlocks,
    livrables: sortedLivrables,
    livrablesByBlock,
    phases,
    versions,
    etapes,
    versionsByLivrable,
    etapesByLivrable,
    // Dérivés
    compteurs,
    monteurs,
    // Actions
    actions: {
      // Config
      updateConfig: updateConfigAction,
      // Blocks
      createBlock: createBlockAction,
      updateBlock: updateBlockAction,
      renameBlock: renameBlockAction,
      deleteBlock: deleteBlockAction,
      restoreBlock: restoreBlockAction,
      reorderBlocks: reorderBlocksAction,
      // Livrables
      createLivrable: createLivrableAction,
      updateLivrable: updateLivrableAction,
      deleteLivrable: deleteLivrableAction,
      restoreLivrable: restoreLivrableAction,
      reorderLivrables: reorderLivrablesAction,
      duplicateLivrable: duplicateLivrableAction,
      duplicateLivrableToProject: duplicateLivrableToProjectAction, // LIV-13
      duplicateBlockToProject: duplicateBlockToProjectAction, // LIV-13
      bulkUpdateLivrables: bulkUpdateLivrablesAction,
      // Versions
      addVersion: addVersionAction,
      updateVersion: updateVersionAction,
      deleteVersion: deleteVersionAction,
      // Étapes
      addEtape: addEtapeAction,
      updateEtape: updateEtapeAction,
      deleteEtape: deleteEtapeAction,
      // Phases
      addPhase: addPhaseAction,
      updatePhase: updatePhaseAction,
      deletePhase: deletePhaseAction,
      // Duplication cross-project
      duplicateFromProject: duplicateFromProjectAction,
      // Sync planning (LIV-4)
      backfillEvents: backfillEventsAction,
      // Misc
      refresh,
    },
  }
}
