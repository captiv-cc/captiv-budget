// ════════════════════════════════════════════════════════════════════════════
// useMateriel — refonte "blocs simples"
// ════════════════════════════════════════════════════════════════════════════
//
// Hook React qui orchestre l'état de l'Outil Matériel pour un projet :
//   - liste des versions (V1, V2...) du projet avec la version active
//   - détail de la version sélectionnée : blocs + items + pivots loueurs
//   - catalogue materiel_bdd (autocomplete désignation)
//   - liste des loueurs disponibles (fournisseurs avec is_loueur_matos=true)
//   - récap loueurs (agrégation par loueur + clé materiel_bdd_id)
//   - toggle "detailed" (vue compressée vs détaillée, persistée en localStorage)
//
// Pattern : mutations + bumpReload pour forcer un refresh ciblé.
//
// Exemple :
//   const {
//     versions, activeVersion, blocks, itemsByBlock, loueursByItem,
//     loueurs, materielBdd, recapByLoueur, detailed, setDetailed,
//     actions: { createVersion, duplicateVersion, createBlock, ... },
//   } = useMateriel(projectId)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as M from '../lib/materiel'
import { supabase } from '../lib/supabase'

const DETAILED_STORAGE_KEY = 'matos.view.detailed'

function readDetailedFromStorage() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DETAILED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeDetailedToStorage(val) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DETAILED_STORAGE_KEY, val ? '1' : '0')
  } catch {
    // ignore
  }
}

export function useMateriel(projectId) {
  // ─── État principal ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [versions, setVersions] = useState([])
  const [activeVersionId, setActiveVersionId] = useState(null)

  // Détail de la version sélectionnée
  const [blocks, setBlocks] = useState([])
  const [items, setItems] = useState([])
  const [itemLoueurs, setItemLoueurs] = useState([])
  // MAT-20 : infos logistique per-version, indexées ensuite par loueur_id.
  const [versionLoueurInfos, setVersionLoueurInfos] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)

  // Ressources partagées
  const [loueurs, setLoueurs] = useState([])
  const [materielBdd, setMaterielBdd] = useState([])

  // Toggle affichage global (persisté)
  const [detailed, setDetailedState] = useState(readDetailedFromStorage)
  const setDetailed = useCallback((val) => {
    setDetailedState((prev) => {
      const next = typeof val === 'function' ? val(prev) : val
      writeDetailedToStorage(next)
      return next
    })
  }, [])

  // Compteur de reload
  const [reloadKey, setReloadKey] = useState(0)
  // Timestamp du dernier bumpReload, pour filtrer les echoes Realtime
  // (cf. useEffect Realtime plus bas). Ref (pas state) : on n'a pas besoin
  // de re-render quand ça change.
  const lastReloadAtRef = useRef(0)
  const bumpReload = useCallback(() => {
    lastReloadAtRef.current = Date.now()
    setReloadKey((k) => k + 1)
  }, [])

  // Ref pour éviter les setState après unmount
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // ─── Chargement initial : versions + loueurs + catalogue ───────────────
  // Même pattern que le chargement détail : on ne montre le spinner
  // full-page qu'au tout premier chargement (ou changement de projet).
  // Sur un bumpReload (mutation ou echo Realtime), refetch silencieux.
  const loadedProjectIdRef = useRef(null)
  useEffect(() => {
    if (!projectId) {
      setLoading(false)
      setVersions([])
      setActiveVersionId(null)
      loadedProjectIdRef.current = null
      return
    }
    let cancelled = false
    const isProjectSwitch = loadedProjectIdRef.current !== projectId
    async function load() {
      if (isProjectSwitch) setLoading(true)
      setError(null)
      try {
        const [versionsData, loueursData, materielData] = await Promise.all([
          M.fetchVersions(projectId),
          M.fetchLoueurs(),
          M.fetchMaterielBdd(),
        ])
        if (cancelled || !aliveRef.current) return
        setVersions(versionsData)
        setLoueurs(loueursData)
        setMaterielBdd(materielData)
        loadedProjectIdRef.current = projectId

        // Sélection auto : priorité à la version active, sinon la 1re.
        if (versionsData.length) {
          const stillValid = versionsData.some((v) => v.id === activeVersionId)
          if (!stillValid) {
            const active = M.getActiveVersion(versionsData)
            setActiveVersionId(active?.id || versionsData[0].id)
          }
        } else {
          setActiveVersionId(null)
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, reloadKey])

  // ─── Chargement détail quand la version change ─────────────────────────
  // On ne montre le spinner full-page QUE si la version active change
  // (ou au premier chargement). Sur un simple bumpReload (mutation locale
  // ou event Realtime), on fait un refetch "silencieux" : les données
  // se mettent à jour sans flasher le spinner, donc pas de flicker UI.
  const loadedVersionIdRef = useRef(null)
  useEffect(() => {
    if (!activeVersionId) {
      setBlocks([])
      setItems([])
      setItemLoueurs([])
      setVersionLoueurInfos([])
      loadedVersionIdRef.current = null
      return
    }
    let cancelled = false
    const isVersionSwitch = loadedVersionIdRef.current !== activeVersionId
    async function loadDetail() {
      if (isVersionSwitch) setDetailLoading(true)
      try {
        const { blocks, items, itemLoueurs, versionLoueurInfos } =
          await M.fetchVersionDetails(activeVersionId)
        if (cancelled || !aliveRef.current) return
        setBlocks(blocks)
        setItems(items)
        setItemLoueurs(itemLoueurs)
        setVersionLoueurInfos(versionLoueurInfos || [])
        loadedVersionIdRef.current = activeVersionId
      } catch (err) {
        if (!cancelled && aliveRef.current) setError(err)
      } finally {
        if (!cancelled && aliveRef.current && isVersionSwitch) setDetailLoading(false)
      }
    }
    loadDetail()
    return () => {
      cancelled = true
    }
  }, [activeVersionId, reloadKey])

  // ─── Collab temps réel (MAT-9B Layer 1) ────────────────────────────────
  // Abonnement Supabase Realtime sur les 4 tables matos_* pour pousser
  // un refetch dès qu'un autre user (ou le même sur un autre onglet)
  // modifie les données.
  //
  // Stratégie :
  //   - 1 seul channel par projet : `matos-collab:${projectId}`
  //   - matos_versions est filtré server-side sur project_id=eq.X
  //   - les 3 autres tables (blocks/items/item_loueurs) n'ont pas de
  //     project_id direct → on ne filtre pas, et c'est la RLS
  //     (can_read_outil) qui filtre côté server : un user ne reçoit
  //     que les events des lignes auxquelles il a accès.
  //   - Debounce 400ms pour coalescer les rafales (import template,
  //     reorder par splice, etc.) en un seul bumpReload().
  //   - Mute self-echo : si un bumpReload local vient d'être déclenché
  //     (par une action de l'user courant), on ignore les events Realtime
  //     qui arrivent dans la fenêtre de 1500ms suivante — c'est soit notre
  //     propre echo (Supabase renvoie les events à leur auteur), soit un
  //     event d'un autre user qui sera de toute façon inclus dans le
  //     refetch local en cours. Pas de perte d'info.
  //   - Cleanup : removeChannel + clearTimeout au unmount / changement
  //     de projectId.
  useEffect(() => {
    if (!projectId) return undefined
    let timer = null
    function debouncedReload() {
      // Mute self-echo : refetch déjà en cours depuis <1.5s → skip.
      if (Date.now() - lastReloadAtRef.current < 1500) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (aliveRef.current) bumpReload()
      }, 400)
    }
    const channel = supabase
      .channel(`matos-collab:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matos_versions',
          filter: `project_id=eq.${projectId}`,
        },
        debouncedReload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matos_blocks' },
        debouncedReload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matos_items' },
        debouncedReload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matos_item_loueurs' },
        debouncedReload,
      )
      // MAT-20 : infos logistique per-version. Pas de filter (pas de
      // project_id direct) → RLS filtre server-side comme pour les autres
      // tables matos_*.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matos_version_loueur_infos' },
        debouncedReload,
      )
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [projectId, bumpReload])

  // ─── Dérivés ─────────────────────────────────────────────────────────────
  const activeVersion = useMemo(
    () => versions.find((v) => v.id === activeVersionId) || null,
    [versions, activeVersionId],
  )

  const itemsByBlock = useMemo(() => M.groupItemsByBlock(items), [items])
  const loueursByItem = useMemo(() => M.groupLoueursByItem(itemLoueurs), [itemLoueurs])
  const flagCounts = useMemo(() => M.countFlags(items), [items])
  const checklistProgress = useMemo(() => M.computeChecklistProgress(items), [items])
  const loueursById = useMemo(() => {
    const map = new Map()
    for (const l of loueurs) map.set(l.id, l)
    return map
  }, [loueurs])
  const materielBddById = useMemo(() => {
    const map = new Map()
    for (const m of materielBdd) map.set(m.id, m)
    return map
  }, [materielBdd])

  const recapByLoueur = useMemo(
    () => M.computeRecapByLoueur({ items, itemLoueurs, loueurs }),
    [items, itemLoueurs, loueurs],
  )

  // MAT-20 : Map(loueur_id → {id, infos_logistique, updated_at, updated_by}).
  // Utilisé à la fois par la slide-over (édition) et par les exports PDF
  // (rendu en tête de section).
  const infosLogistiqueByLoueur = useMemo(
    () => M.indexVersionLoueurInfosByLoueur(versionLoueurInfos),
    [versionLoueurInfos],
  )

  // ─── Actions — Versions ──────────────────────────────────────────────────
  const createVersionAction = useCallback(
    async ({ label = null } = {}) => {
      const v = await M.createVersion({ projectId, label })
      bumpReload()
      setActiveVersionId(v.id)
      return v
    },
    [projectId, bumpReload],
  )

  const duplicateVersionAction = useCallback(
    async (sourceVersionId = activeVersionId) => {
      if (!sourceVersionId) return null
      const v = await M.duplicateVersion({ sourceVersionId })
      bumpReload()
      setActiveVersionId(v.id)
      return v
    },
    [activeVersionId, bumpReload],
  )

  const archiveVersionAction = useCallback(
    async (versionId) => {
      await M.archiveVersion(versionId)
      bumpReload()
    },
    [bumpReload],
  )

  const restoreVersionAction = useCallback(
    async (versionId) => {
      await M.restoreVersion(versionId)
      bumpReload()
      setActiveVersionId(versionId)
    },
    [bumpReload],
  )

  const updateVersionAction = useCallback(
    async (versionId, fields) => {
      await M.updateVersion(versionId, fields)
      bumpReload()
    },
    [bumpReload],
  )

  const deleteVersionAction = useCallback(
    async (versionId) => {
      await M.deleteVersion(versionId)
      if (activeVersionId === versionId) setActiveVersionId(null)
      bumpReload()
    },
    [activeVersionId, bumpReload],
  )

  // ─── Actions — Blocks ────────────────────────────────────────────────────
  const createBlockAction = useCallback(
    async ({ titre, affichage = 'liste', couleur = null } = {}) => {
      if (!activeVersionId) return null
      const nextOrder = blocks.reduce((max, b) => Math.max(max, b.sort_order || 0), 0) + 1
      const block = await M.createBlock({
        versionId: activeVersionId,
        titre: titre || 'Nouveau bloc',
        affichage,
        sortOrder: nextOrder,
        couleur,
      })
      bumpReload()
      return block
    },
    [activeVersionId, blocks, bumpReload],
  )

  const updateBlockAction = useCallback(
    async (blockId, fields) => {
      await M.updateBlock(blockId, fields)
      bumpReload()
    },
    [bumpReload],
  )

  const deleteBlockAction = useCallback(
    async (blockId) => {
      await M.deleteBlock(blockId)
      bumpReload()
    },
    [bumpReload],
  )

  const duplicateBlockAction = useCallback(
    async (blockId) => {
      const block = await M.duplicateBlock(blockId)
      bumpReload()
      return block
    },
    [bumpReload],
  )

  // MAT-9B-opt : reorder blocs avec optimistic update + rollback.
  // Avant : on attendait simplement le write DB puis bumpReload(). Si le
  // write échouait silencieusement (cf. reorderBlocks lib pré-fix erreur),
  // bumpReload remettait l'ancien ordre sans feedback.
  // Maintenant : on patche `sort_order` localement immédiatement (UI à jour
  // dès le drop), puis le bumpReload final resynchronise. En cas d'erreur,
  // bumpReload aussi → rollback implicite via refetch + propagation throw
  // pour que BlockList affiche `notify.error`.
  const reorderBlocksAction = useCallback(
    async (orderedIds) => {
      // Patch optimiste : applique le nouvel ordre tout de suite.
      setBlocks((prev) => {
        const byId = new Map(prev.map((b) => [b.id, b]))
        const reordered = []
        orderedIds.forEach((id, idx) => {
          const block = byId.get(id)
          if (block) {
            reordered.push({ ...block, sort_order: idx })
            byId.delete(id)
          }
        })
        // Conserve les blocs non listés (paranoïa : ne devrait pas arriver).
        for (const remaining of byId.values()) reordered.push(remaining)
        return reordered
      })
      try {
        await M.reorderBlocks(orderedIds)
        bumpReload()
      } catch (err) {
        bumpReload() // rollback via refetch
        throw err
      }
    },
    [bumpReload],
  )

  // ─── Actions — Items ─────────────────────────────────────────────────────
  const createItemAction = useCallback(
    async ({ blockId, data = {} }) => {
      // Si le caller passe un sort_order explicite, on le respecte
      // (cas des templates CAM LIVE/CAM PUB qui insèrent plusieurs items
      // en boucle — le state items est stale entre deux await, donc
      // recalculer max+1 à chaque itération donnerait la même valeur
      // pour les 10 insertions et casserait l'ordre stable).
      let payload = data
      if (data.sort_order === undefined) {
        const inBlock = items.filter((i) => i.block_id === blockId)
        const nextOrder =
          inBlock.reduce((max, i) => Math.max(max, i.sort_order || 0), 0) + 1
        payload = { ...data, sort_order: nextOrder }
      }
      const item = await M.createItem({ blockId, data: payload })
      bumpReload()
      return item
    },
    [items, bumpReload],
  )

  // MAT-9B-opt : updateItem patche d'abord le state local (synchrone) pour
  // éliminer le lag perçu sur les inline edits (label, quantité, remarques…),
  // puis await le network. En cas d'erreur, bumpReload() refetch la vérité
  // serveur (rollback implicite).
  const updateItemAction = useCallback(
    async (itemId, fields) => {
      // Champs whitelistés (miroir de M.updateItem) — on filtre ici aussi
      // pour ne patcher que ce que le serveur acceptera.
      const allowed = [
        'label',
        'designation',
        'quantite',
        'remarques',
        'flag',
        'materiel_bdd_id',
        'block_id',
        'sort_order',
      ]
      const patch = {}
      for (const k of allowed) if (k in fields) patch[k] = fields[k]
      if (!Object.keys(patch).length) return

      // Optimistic patch avant la roundtrip.
      setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
      )

      try {
        await M.updateItem(itemId, fields)
        bumpReload()
      } catch (err) {
        bumpReload() // rollback via refetch
        throw err
      }
    },
    [bumpReload],
  )

  const deleteItemAction = useCallback(
    async (itemId) => {
      await M.deleteItem(itemId)
      bumpReload()
    },
    [bumpReload],
  )

  const reorderItemsAction = useCallback(
    async (orderedIds) => {
      await M.reorderItems(orderedIds)
      bumpReload()
    },
    [bumpReload],
  )

  // MAT-9B-opt : toggleCheck flippe `${type}_check_at` localement avant la
  // roundtrip. Sur `check` → timestamp ISO + by=null (le serveur rattachera
  // auth.uid() au refetch). Sur `uncheck` → null/null. bumpReload en fin
  // resynchronise avec la vérité serveur (pre_check_by_name inclus).
  const toggleCheckAction = useCallback(
    async (itemId, type) => {
      const atCol = `${type}_check_at`
      const byCol = `${type}_check_by`
      const nowIso = new Date().toISOString()

      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== itemId) return it
          const wasChecked = Boolean(it[atCol])
          return {
            ...it,
            [atCol]: wasChecked ? null : nowIso,
            [byCol]: null,
          }
        }),
      )

      try {
        await M.toggleCheck(itemId, type)
        bumpReload()
      } catch (err) {
        bumpReload() // rollback
        throw err
      }
    },
    [bumpReload],
  )

  // MAT-9B-opt : setFlag patche le `flag` localement (ok/attention/probleme/
  // null) avant l'UPDATE serveur. Sélecteur de drapeau réactif au clic.
  const setFlagAction = useCallback(
    async (itemId, flag) => {
      setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, flag } : it)),
      )

      try {
        await M.setItemFlag(itemId, flag)
        bumpReload()
      } catch (err) {
        bumpReload() // rollback
        throw err
      }
    },
    [bumpReload],
  )

  // ─── Actions — Loueurs sur item ──────────────────────────────────────────
  const addLoueurAction = useCallback(
    async ({ itemId, loueurId, numeroReference }) => {
      await M.addLoueurToItem({ itemId, loueurId, numeroReference })
      bumpReload()
    },
    [bumpReload],
  )

  const updateLoueurAction = useCallback(
    async (itemLoueurId, fields) => {
      await M.updateItemLoueur(itemLoueurId, fields)
      bumpReload()
    },
    [bumpReload],
  )

  const removeLoueurAction = useCallback(
    async (itemLoueurId) => {
      await M.removeLoueurFromItem(itemLoueurId)
      bumpReload()
    },
    [bumpReload],
  )

  const createLoueurAction = useCallback(
    async ({ orgId, nom, couleur }) => {
      const loueur = await M.createLoueur({ orgId, nom, couleur })
      bumpReload()
      return loueur
    },
    [bumpReload],
  )

  const updateLoueurCouleurAction = useCallback(
    async (loueurId, couleur) => {
      await M.updateLoueurCouleur(loueurId, couleur)
      bumpReload()
    },
    [bumpReload],
  )

  // ─── Actions — Infos logistique loueur (MAT-20) ─────────────────────────
  // Upsert (ou delete si chaîne vide) de la ligne `matos_version_loueur_infos`
  // pour le couple (version active, loueur). Met à jour optimistiquement le
  // state local pour que l'UI (slide-over + compteur "x infos renseignées")
  // réagisse instantanément, puis laisse le Realtime + bumpReload rafraîchir
  // le serveur de vérité.
  //
  // Contrat :
  //   - text vide (ou whitespace only) → DELETE row (pas de clutter DB)
  //   - text non vide → UPSERT (onConflict sur (version_id, loueur_id))
  //
  // On patche d'abord en optimistic (setState synchrone) puis on await le
  // network call. En cas d'erreur, on laisse bumpReload() reset au serveur.
  const saveLoueurInfosAction = useCallback(
    async (loueurId, text) => {
      if (!activeVersionId || !loueurId) return null
      const trimmed = String(text ?? '').trim()

      // Optimistic update : patch local avant la roundtrip.
      setVersionLoueurInfos((prev) => {
        const idx = prev.findIndex((vli) => vli.loueur_id === loueurId)
        if (!trimmed) {
          // Clear : on retire la ligne si elle existe.
          if (idx === -1) return prev
          const next = prev.slice()
          next.splice(idx, 1)
          return next
        }
        const nowIso = new Date().toISOString()
        if (idx === -1) {
          // Insertion optimiste (id provisoire — sera remplacé au prochain fetch).
          return [
            ...prev,
            {
              id: `__optimistic__${loueurId}`,
              version_id: activeVersionId,
              loueur_id: loueurId,
              infos_logistique: trimmed,
              updated_at: nowIso,
              updated_by: null,
            },
          ]
        }
        const next = prev.slice()
        next[idx] = { ...next[idx], infos_logistique: trimmed, updated_at: nowIso }
        return next
      })

      try {
        const result = await M.upsertVersionLoueurInfo({
          versionId: activeVersionId,
          loueurId,
          infosLogistique: trimmed,
        })
        // bumpReload pour synchroniser l'id réel + updated_by (et rafraîchir
        // les autres sessions ouvertes via Realtime).
        bumpReload()
        return result
      } catch (err) {
        // Rollback implicite via bumpReload (repart du serveur).
        bumpReload()
        throw err
      }
    },
    [activeVersionId, bumpReload],
  )

  // ─── Refresh manuel ─────────────────────────────────────────────────────
  const refresh = useCallback(() => bumpReload(), [bumpReload])

  return {
    // État
    loading,
    detailLoading,
    error,
    versions,
    activeVersion,
    activeVersionId,
    setActiveVersionId,
    blocks,
    items,
    itemLoueurs,
    // MAT-20 : infos logistique par loueur (per-version).
    versionLoueurInfos,
    infosLogistiqueByLoueur,
    loueurs,
    loueursById,
    materielBdd,
    materielBddById,
    // Toggle global d'affichage
    detailed,
    setDetailed,
    // Dérivés
    itemsByBlock,
    loueursByItem,
    flagCounts,
    checklistProgress,
    recapByLoueur,
    // Actions
    actions: {
      // Versions
      createVersion: createVersionAction,
      duplicateVersion: duplicateVersionAction,
      archiveVersion: archiveVersionAction,
      restoreVersion: restoreVersionAction,
      updateVersion: updateVersionAction,
      deleteVersion: deleteVersionAction,
      // Blocks
      createBlock: createBlockAction,
      updateBlock: updateBlockAction,
      deleteBlock: deleteBlockAction,
      duplicateBlock: duplicateBlockAction,
      reorderBlocks: reorderBlocksAction,
      // Items
      createItem: createItemAction,
      updateItem: updateItemAction,
      deleteItem: deleteItemAction,
      reorderItems: reorderItemsAction,
      toggleCheck: toggleCheckAction,
      setFlag: setFlagAction,
      // Loueurs pivots
      addLoueur: addLoueurAction,
      updateLoueur: updateLoueurAction,
      removeLoueur: removeLoueurAction,
      // Loueurs (fournisseurs)
      createLoueur: createLoueurAction,
      updateLoueurCouleur: updateLoueurCouleurAction,
      // MAT-20 : infos logistique per-loueur
      saveLoueurInfos: saveLoueurInfosAction,
      // Misc
      refresh,
    },
  }
}
