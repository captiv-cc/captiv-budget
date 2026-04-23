// ════════════════════════════════════════════════════════════════════════════
// useCheckAuthedSession — Hook React pour le mode chantier authentifié (MAT-14)
// ════════════════════════════════════════════════════════════════════════════
//
// Miroir de `useCheckTokenSession` pour la route privée
// `/projets/:id/materiel/check/:versionId?`. Différences clés :
//
//   - Keyed par `versionId` (pas par `token`)
//   - Identité = `profiles.full_name` (via useAuth) — pas de localStorage
//   - Actions → RPCs `check_*_authed` gated par can_edit_outil / can_read_outil
//   - Les RPC lisent `auth.uid()` serveur-side pour peupler
//     pre_check_by / author_id / added_by / removed_by / closed_by — le
//     userName n'est JAMAIS envoyé depuis le client
//
// Shape exposée IDENTIQUE à useCheckTokenSession (blocks, itemsByBlock,
// loueursByItem, commentsByItem, progressByBlock, attachments, actions{…})
// pour que CheckSession.jsx puisse brancher les deux hooks via un simple
// `mode === 'token' ? useTokenHook(...) : useAuthedHook(...)`.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as CA from '../lib/matosCheckAuthed'
import * as MP from '../lib/matosItemPhotos'
import { computeProgressByBlock } from '../lib/matosCheckFilter'
import { aggregateBilanData, bilanZipFilename } from '../lib/matosBilanData'
import { uploadBilanArchive } from '../lib/matosCloture'

/**
 * @param {string} versionId — UUID de la version matériel
 * @param {object} opts
 * @param {string} [opts.userName] — full_name authentifié (fallback 'Utilisateur')
 */
export function useCheckAuthedSession(versionId, { userName = null } = {}) {
  // ─── État principal ──────────────────────────────────────────────────────
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Ref anti-unmount (évite les setState après démontage).
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // ─── Chargement initial + refetch manuel ─────────────────────────────────
  const [reloadKey, setReloadKey] = useState(0)
  const refetch = useCallback(() => {
    setReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!versionId) {
      setLoading(false)
      setSession(null)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await CA.fetchCheckSessionAuthed(versionId)
        if (cancelled || !aliveRef.current) return
        setSession(data)
      } catch (err) {
        if (!cancelled && aliveRef.current) setError(err)
      } finally {
        if (!cancelled && aliveRef.current) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [versionId, reloadKey])

  // ─── Dérivés mémoïsés (aligned strictement sur useCheckTokenSession) ────
  const blocks = useMemo(() => session?.blocks || [], [session])
  const items = useMemo(() => session?.items || [], [session])
  const loueurs = useMemo(() => session?.loueurs || [], [session])
  // ⚠️ snake_case, pas itemLoueurs — voir commentaire useCheckTokenSession.
  const itemLoueurs = useMemo(() => session?.item_loueurs || [], [session])
  const comments = useMemo(() => session?.comments || [], [session])
  const attachments = useMemo(() => session?.attachments || [], [session])
  // MAT-20 : même snake_case que la RPC (version_loueur_infos).
  const versionLoueurInfos = useMemo(
    () => session?.version_loueur_infos || [],
    [session],
  )
  // MAT-11 : photos = rows matos_item_photos (kind='probleme'|'pack',
  // ancrage XOR item|block). Shape RPC snake_case — miroir exact du hook token.
  const photos = useMemo(() => session?.photos || [], [session])

  const itemsByBlock = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      if (!map.has(it.block_id)) map.set(it.block_id, [])
      map.get(it.block_id).push(it)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const so = (a.sort_order ?? 0) - (b.sort_order ?? 0)
        if (so !== 0) return so
        return new Date(a.created_at) - new Date(b.created_at)
      })
    }
    return map
  }, [items])

  const loueursByItem = useMemo(() => {
    const byId = new Map(loueurs.map((l) => [l.id, l]))
    const map = new Map()
    for (const il of itemLoueurs) {
      const l = byId.get(il.loueur_id)
      if (!l) continue
      if (!map.has(il.item_id)) map.set(il.item_id, [])
      map.get(il.item_id).push(l)
    }
    return map
  }, [loueurs, itemLoueurs])

  const commentsByItem = useMemo(() => {
    const map = new Map()
    for (const c of comments) {
      if (!map.has(c.item_id)) map.set(c.item_id, [])
      map.get(c.item_id).push(c)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    }
    return map
  }, [comments])

  const progressByBlock = useMemo(
    () => computeProgressByBlock(blocks, itemsByBlock),
    [blocks, itemsByBlock],
  )

  // MAT-20 : index par loueur_id pour lookup O(1) côté consommateur
  // (rendu PDF + éventuels affichages read-only). L'édition des infos se
  // fait dans l'onglet Matériel, pas dans le mode chantier.
  const infosLogistiqueByLoueur = useMemo(() => {
    const map = new Map()
    for (const vli of versionLoueurInfos) {
      if (!vli?.loueur_id) continue
      map.set(vli.loueur_id, vli)
    }
    return map
  }, [versionLoueurInfos])

  // MAT-11 : index photos par ancrage (XOR item/block). Les 2 maps sont
  // disjointes (CHECK DB sur une seule FK non-NULL). Tri chrono ascendant.
  const photosByItem = useMemo(() => MP.indexPhotosByItem(photos), [photos])
  const photosByBlock = useMemo(() => MP.indexPhotosByBlock(photos), [photos])

  // ─── Patch helpers (optimistic updates) ──────────────────────────────────
  const patchItem = useCallback((itemId, patch) => {
    if (!itemId || !patch) return
    setSession((prev) => {
      if (!prev) return prev
      const nextItems = prev.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it))
      return { ...prev, items: nextItems }
    })
  }, [])

  const appendItem = useCallback((newItem) => {
    if (!newItem?.id) return
    setSession((prev) => {
      if (!prev) return prev
      if (prev.items.some((it) => it.id === newItem.id)) return prev
      return { ...prev, items: [...prev.items, newItem] }
    })
  }, [])

  // MAT-19 : miroir local d'une ligne pivot `item_loueurs` après création d'un
  // additif avec loueur attribué — cf. useCheckTokenSession pour les détails.
  const appendItemLoueur = useCallback((pivot) => {
    if (!pivot?.item_id || !pivot?.loueur_id) return
    setSession((prev) => {
      if (!prev) return prev
      const existing = prev.item_loueurs || []
      if (pivot.id && existing.some((x) => x.id === pivot.id)) return prev
      if (existing.some(
        (x) => x.item_id === pivot.item_id && x.loueur_id === pivot.loueur_id,
      )) return prev
      return { ...prev, item_loueurs: [...existing, pivot] }
    })
  }, [])

  const appendComment = useCallback((newComment) => {
    if (!newComment?.id) return
    setSession((prev) => {
      if (!prev) return prev
      if (prev.comments.some((c) => c.id === newComment.id)) return prev
      return { ...prev, comments: [...prev.comments, newComment] }
    })
  }, [])

  const removeItem = useCallback((itemId) => {
    if (!itemId) return
    setSession((prev) => {
      if (!prev) return prev
      const nextItems = prev.items.filter((it) => it.id !== itemId)
      const nextComments = prev.comments.filter((c) => c.item_id !== itemId)
      const nextPhotos = (prev.photos || []).filter((p) => p.item_id !== itemId)
      return { ...prev, items: nextItems, comments: nextComments, photos: nextPhotos }
    })
  }, [])

  // MAT-11 : helpers photo (append / remove / patch). Dédup par id (résiste
  // aux double-appels Realtime + optimistic). Miroir exact du hook token.
  const appendPhoto = useCallback((newPhoto) => {
    if (!newPhoto?.id) return
    setSession((prev) => {
      if (!prev) return prev
      const existing = prev.photos || []
      if (existing.some((p) => p.id === newPhoto.id)) return prev
      return { ...prev, photos: [...existing, newPhoto] }
    })
  }, [])

  const removePhoto = useCallback((photoId) => {
    if (!photoId) return
    setSession((prev) => {
      if (!prev) return prev
      const existing = prev.photos || []
      return { ...prev, photos: existing.filter((p) => p.id !== photoId) }
    })
  }, [])

  const patchPhoto = useCallback((photoId, patch) => {
    if (!photoId || !patch) return
    setSession((prev) => {
      if (!prev) return prev
      const existing = prev.photos || []
      return {
        ...prev,
        photos: existing.map((p) => (p.id === photoId ? { ...p, ...patch } : p)),
      }
    })
  }, [])

  // ─── Actions publiques ───────────────────────────────────────────────────
  // Toutes les RPC *_authed lisent auth.uid() serveur-side pour l'attribution.
  // Le client n'envoie pas de userName ; on passe `userName` uniquement pour
  // peupler les champs *_by_name côté patch local (affichage instantané avant
  // refetch).

  const toggle = useCallback(
    async (itemId) => {
      const updated = await CA.toggleCheckAuthed({ itemId })
      patchItem(itemId, {
        pre_check_at: updated?.pre_check_at ?? null,
        pre_check_by_name: updated?.pre_check_by_name ?? null,
        pre_check_by: updated?.pre_check_by ?? null,
      })
      return updated
    },
    [patchItem],
  )

  // MAT-19 : `loueurId` optionnel. Si fourni, la RPC insère aussi la ligne
  // pivot `item_loueurs` dans la même transaction — on la miroite en local
  // avec `appendItemLoueur` pour que le récap loueur s'actualise instant.
  const addItem = useCallback(
    async ({ blockId, designation, quantite = 1, loueurId = null }) => {
      const created = await CA.addCheckItemAuthed({
        blockId,
        designation,
        quantite,
        loueurId,
      })
      appendItem({
        id: created?.id,
        block_id: blockId,
        designation: designation.trim(),
        quantite,
        added_during_check: true,
        added_by_name: userName || created?.added_by_name || 'Utilisateur',
        added_at: new Date().toISOString(),
        pre_check_at: null,
        pre_check_by_name: null,
        flag: null,
        sort_order: 99999,
      })
      if (created?.item_loueur_id && created?.loueur_id) {
        appendItemLoueur({
          id: created.item_loueur_id,
          item_id: created.id,
          loueur_id: created.loueur_id,
          numero_reference: null,
          sort_order: 0,
        })
      }
      return created
    },
    [appendItem, appendItemLoueur, userName],
  )

  const addComment = useCallback(
    async ({ itemId, body }) => {
      const created = await CA.addCheckCommentAuthed({ itemId, body })
      appendComment(created)
      return created
    },
    [appendComment],
  )

  const setFlag = useCallback(
    async ({ itemId, flag }) => {
      const updated = await CA.setCheckFlagAuthed({ itemId, flag })
      patchItem(itemId, { flag: updated?.flag ?? flag })
      return updated
    },
    [patchItem],
  )

  const setRemoved = useCallback(
    async ({ itemId, removed, reason = null }) => {
      const updated = await CA.setItemRemovedAuthed({ itemId, removed, reason })
      const patch = {
        removed_at: updated?.removed_at ?? null,
        removed_by_name: updated?.removed_by_name ?? null,
        removed_reason: updated?.removed_reason ?? null,
      }
      if (removed) {
        patch.pre_check_at = null
        patch.pre_check_by_name = null
      }
      patchItem(itemId, patch)
      return updated
    },
    [patchItem],
  )

  const deleteAdditif = useCallback(
    async ({ itemId }) => {
      const result = await CA.deleteCheckAdditifAuthed({ itemId })
      removeItem(itemId)
      return result
    },
    [removeItem],
  )

  // ─── MAT-11 : Actions photos (authed) ────────────────────────────────────
  //
  // Miroir des actions photos token, via les variantes *Authed :
  //   - identité dérivée de auth.uid() côté RPC (pas de userName envoyé)
  //   - mêmes garanties XOR ancrage + limite 10 photos/ancre
  //   - même pipeline image (transcode HEIC, compression conditionnelle)
  //   - même logique "patch APRÈS succès" (pas de rollback optimiste —
  //     l'upload est assez long qu'afficher un thumb fantôme confondrait).
  //
  // Voir commentaires détaillés dans useCheckTokenSession.js.

  const uploadPhoto = useCallback(
    async ({ itemId = null, blockId = null, kind, file, caption = null, originalQuality = false }) => {
      if (!session?.version?.id) throw new Error('Version introuvable')
      const created = await MP.uploadPhotoAuthed({
        versionId: session.version.id,
        itemId,
        blockId,
        kind,
        file,
        caption,
        originalQuality,
      })
      appendPhoto(created)
      return created
    },
    [session, appendPhoto],
  )

  const deletePhoto = useCallback(
    async ({ photoId }) => {
      await MP.deletePhotoAuthed({ photoId })
      removePhoto(photoId)
    },
    [removePhoto],
  )

  const updatePhotoCaption = useCallback(
    async ({ photoId, caption }) => {
      const result = await MP.updatePhotoCaptionAuthed({ photoId, caption })
      patchPhoto(photoId, { caption: result?.caption ?? caption })
      return result
    },
    [patchPhoto],
  )

  // ─── Aperçu bilan (aucune écriture) ──────────────────────────────────────
  const preview = useCallback(async () => {
    if (!session) throw new Error('Aucune session chargée')
    const snapshot = aggregateBilanData(session)
    if (!snapshot.version?.id) throw new Error('Version introuvable')
    const { buildBilanZip } = await import('../features/materiel/matosBilanPdf')
    const zip = await buildBilanZip(snapshot, {})
    return zip
  }, [session])

  // ─── Clôture essais (authed — pas de token jetable) ──────────────────────
  //
  // Pipeline équivalent au chemin token (aggregate → build ZIP → upload →
  // RPC close) mais via `closeCheckEssaisAuthed`. L'identité est dérivée de
  // auth.uid() côté serveur — on n'envoie pas de userName. Le paramètre
  // `userName` n'est utilisé qu'en fallback d'affichage local.
  const close = useCallback(async () => {
    if (!session) throw new Error('Aucune session chargée')

    const snapshot = aggregateBilanData(session)
    if (!snapshot.version?.id) throw new Error('Version introuvable')

    const { buildBilanZip } = await import('../features/materiel/matosBilanPdf')
    const zip = await buildBilanZip(snapshot, {})

    const zipFilename = bilanZipFilename({
      project: snapshot.project,
      version: snapshot.version,
    })

    const upload = await uploadBilanArchive({
      versionId: snapshot.version.id,
      blob: zip.blob,
      filename: zipFilename,
    })

    const payload = await CA.closeCheckEssaisAuthed({
      versionId: snapshot.version.id,
      archivePath: upload.storagePath,
      archiveFilename: zipFilename,
      archiveSize: upload.sizeBytes,
      archiveMime: upload.mimeType,
    })

    // Patch local pour l'affichage immédiat de la bannière "Clôturé".
    setSession((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        version: {
          ...prev.version,
          closed_at: payload?.closed_at ?? new Date().toISOString(),
          closed_by_name: payload?.closed_by_name ?? userName ?? 'Utilisateur',
          bilan_archive_path: payload?.bilan_archive_path ?? null,
        },
      }
    })

    // Refetch pour récupérer l'attachment bilan ajouté par la RPC.
    refetch()

    return { payload, zip }
  }, [session, userName, refetch])

  return {
    // État brut
    loading,
    error,
    session,

    // Identité authed (passé par l'appelant, readonly côté hook)
    userName,

    // Dérivés (shape miroir de useCheckTokenSession)
    blocks,
    items,
    itemsByBlock,
    loueurs,
    loueursByItem,
    comments,
    commentsByItem,
    attachments,
    progressByBlock,
    // MAT-20 : infos logistique par loueur (read-only côté check)
    versionLoueurInfos,
    infosLogistiqueByLoueur,
    // MAT-11 : photos (kind='probleme'|'pack', ancrage XOR item|block)
    photos,
    photosByItem,
    photosByBlock,

    // Actions
    actions: {
      toggle,
      addItem,
      addComment,
      setFlag,
      setRemoved,
      deleteAdditif,
      preview,
      close,
      refetch,
      // MAT-11
      uploadPhoto,
      deletePhoto,
      updatePhotoCaption,
    },
  }
}
