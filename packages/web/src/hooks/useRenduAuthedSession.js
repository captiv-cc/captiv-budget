// ════════════════════════════════════════════════════════════════════════════
// useRenduAuthedSession — Hook React pour le rendu en mode authentifié (MAT-13)
// ════════════════════════════════════════════════════════════════════════════
//
// Miroir de `useCheckAuthedSession` pour la phase RENDU, route privée
// `/projets/:id/materiel/rendu/:versionId?` (MAT-13C). Différences clés :
//
//   - Même bundle fetch (`fetchCheckSessionAuthed`) — depuis MAT-13A le
//     builder renvoie post_check_* (items) et rendu_closed_* (version).
//
//   - `progressByBlock` basé sur `post_check_at` (param phase='rendu').
//
//   - `toggle(itemId)` → `toggleCheckAuthed({ itemId, phase: 'rendu' })` — la
//     RPC route vers post_check_at / post_check_by_name / post_check_by.
//
//   - `addComment({ kind })` : forcé à 'rendu' (le kind n'est pas paramétré
//     côté consommateur — le hook tranche pour garantir la cohérence UI).
//
//   - `uploadPhoto` : kind forcé à 'retour' (même logique).
//
//   - `close()` : build PDF bon-retour + upload Storage + RPC
//     `check_action_close_rendu_authed`. Pose rendu_closed_at + attachment.
//     Pas de userName envoyé — l'identité est dérivée de auth.uid() serveur.
//
//   - Surface d'actions volontairement réduite vs hook essais authed : pas de
//     `addItem` / `setFlag` / `setRemoved` / `deleteAdditif`. Ces mutations
//     structurelles appartiennent à la phase essais (l'équipe a figé la
//     liste à la clôture essais). Pendant le rendu, on documente via
//     comments kind='rendu' + photos kind='retour' — pas de modif struct.
//
// Shape de retour IDENTIQUE en surface à `useCheckAuthedSession` (sauf actions
// absentes listées ci-dessus) pour que le même arbre de composants UI puisse
// se brancher sans condition. Les composants lisent directement post_check_at
// vs pre_check_at sur l'item — pas d'aliasing côté hook.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as CA from '../lib/matosCheckAuthed'
import * as MP from '../lib/matosItemPhotos'
import {
  uploadBonRetourArchive,
  closeCheckRenduAuthed,
  bonRetourPdfFilename,
  setRenduFeedbackAuthed,
  setRenduFeedbackLoueurAuthed,
} from '../lib/matosRendu'
import { computeProgressByBlock } from '../lib/matosCheckFilter'
import { aggregateBilanData } from '../lib/matosBilanData'

/**
 * @param {string} versionId — UUID de la version matériel
 * @param {object} opts
 * @param {string} [opts.userName] — full_name authentifié (fallback 'Utilisateur')
 */
export function useRenduAuthedSession(versionId, { userName = null } = {}) {
  // ─── État principal ──────────────────────────────────────────────────────
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Ref anti-unmount.
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

  // ─── Dérivés mémoïsés (strict mirror de useCheckAuthedSession) ──────────
  const blocks = useMemo(() => session?.blocks || [], [session])
  const items = useMemo(() => session?.items || [], [session])
  const loueurs = useMemo(() => session?.loueurs || [], [session])
  const itemLoueurs = useMemo(() => session?.item_loueurs || [], [session])
  const comments = useMemo(() => session?.comments || [], [session])
  const attachments = useMemo(() => session?.attachments || [], [session])
  const versionLoueurInfos = useMemo(
    () => session?.version_loueur_infos || [],
    [session],
  )
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

  // Tous kinds de comments sont indexés ici — l'UI rendu filtrera kind='rendu'
  // pour les threads. Garder l'index complet évite de ré-indexer en aval.
  const commentsByItem = useMemo(() => {
    const map = new Map()
    for (const c of comments) {
      if (!c.item_id) continue
      if (!map.has(c.item_id)) map.set(c.item_id, [])
      map.get(c.item_id).push(c)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    }
    return map
  }, [comments])

  const commentsByBlock = useMemo(() => {
    const map = new Map()
    for (const c of comments) {
      if (!c.block_id) continue
      if (!map.has(c.block_id)) map.set(c.block_id, [])
      map.get(c.block_id).push(c)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    }
    return map
  }, [comments])

  // MAT-13 : progression basée sur post_check_at via phase='rendu'.
  const progressByBlock = useMemo(
    () => computeProgressByBlock(blocks, itemsByBlock, { phase: 'rendu' }),
    [blocks, itemsByBlock],
  )

  const infosLogistiqueByLoueur = useMemo(() => {
    const map = new Map()
    for (const vli of versionLoueurInfos) {
      if (!vli?.loueur_id) continue
      map.set(vli.loueur_id, vli)
    }
    return map
  }, [versionLoueurInfos])

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

  const appendComment = useCallback((newComment) => {
    if (!newComment?.id) return
    setSession((prev) => {
      if (!prev) return prev
      if (prev.comments.some((c) => c.id === newComment.id)) return prev
      return { ...prev, comments: [...prev.comments, newComment] }
    })
  }, [])

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
  // Identique au hook essais authed : identité serveur-side (auth.uid()),
  // userName seulement pour le patch local d'affichage instantané avant
  // refetch. La RPC `_authed` lit `profiles.full_name` pour peupler les
  // colonnes *_by_name de façon autoritaire.

  /**
   * Toggle le post_check_at d'un item. Appelle la RPC
   * `check_action_toggle_authed(p_item_id, p_phase='rendu')`.
   */
  const toggle = useCallback(
    async (itemId) => {
      const updated = await CA.toggleCheckAuthed({ itemId, phase: 'rendu' })
      patchItem(itemId, {
        post_check_at: updated?.post_check_at ?? null,
        post_check_by_name: updated?.post_check_by_name ?? null,
        post_check_by: updated?.post_check_by ?? null,
      })
      return updated
    },
    [patchItem],
  )

  /**
   * Ajoute un commentaire rendu (kind forcé à 'rendu'). XOR item|block.
   */
  const addComment = useCallback(
    async ({ itemId = null, blockId = null, body }) => {
      const created = await CA.addCheckCommentAuthed({
        itemId,
        blockId,
        kind: 'rendu',
        body,
      })
      appendComment(created)
      return created
    },
    [appendComment],
  )

  // ─── Actions photos (kind='retour' forcé) ───────────────────────────────

  const uploadPhoto = useCallback(
    async ({ itemId = null, blockId = null, file, caption = null, originalQuality = false }) => {
      if (!session?.version?.id) throw new Error('Version introuvable')
      const created = await MP.uploadPhotoAuthed({
        versionId: session.version.id,
        itemId,
        blockId,
        kind: 'retour',
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

  // ─── MAT-13G : Feedback rendu (global + par loueur) ─────────────────────
  //
  // Deux champs libres :
  //   - global  : `session.version.rendu_feedback` (string)
  //   - loueur  : `session.version_loueur_infos[*].rendu_feedback`
  //
  // Les deux actions font un patch optimiste pour que le textarea ne flash pas
  // entre submit et refetch. Pas de refetch systématique — le RPC renvoie la
  // valeur canonique et on la propage dans l'état.

  /**
   * Patch la valeur de rendu_feedback sur session.version (optimistic).
   * Helper privé — partagé entre setter et le handler RPC.
   */
  const patchVersionFeedback = useCallback((body) => {
    setSession((prev) => {
      if (!prev?.version) return prev
      return { ...prev, version: { ...prev.version, rendu_feedback: body ?? '' } }
    })
  }, [])

  /**
   * Upsert la valeur de rendu_feedback sur session.version_loueur_infos[loueur]
   * (optimistic).
   */
  const patchLoueurFeedback = useCallback((loueurId, body, extra = {}) => {
    if (!loueurId) return
    setSession((prev) => {
      if (!prev) return prev
      const list = prev.version_loueur_infos || []
      const idx = list.findIndex((vli) => vli?.loueur_id === loueurId)
      if (idx >= 0) {
        const next = [...list]
        next[idx] = { ...next[idx], rendu_feedback: body ?? '', ...extra }
        return { ...prev, version_loueur_infos: next }
      }
      // Pas encore de ligne : on en crée une virtuelle avec infos_logistique=''.
      const synthetic = {
        id: extra.id ?? `optimistic-${loueurId}`,
        version_id: prev?.version?.id ?? null,
        loueur_id: loueurId,
        infos_logistique: '',
        rendu_feedback: body ?? '',
        updated_at: new Date().toISOString(),
        ...extra,
      }
      return { ...prev, version_loueur_infos: [...list, synthetic] }
    })
  }, [])

  /**
   * Set du feedback global (authed). Optimistic patch → RPC → reconciliation.
   */
  const setRenduFeedback = useCallback(
    async (body) => {
      const versionId = session?.version?.id
      if (!versionId) throw new Error('Version introuvable')
      const prev = session?.version?.rendu_feedback ?? ''
      const next = body ?? ''
      patchVersionFeedback(next)
      try {
        const result = await setRenduFeedbackAuthed({ versionId, body: next })
        // RPC renvoie la valeur persistée — patch final pour couvrir trim/etc.
        patchVersionFeedback(result?.rendu_feedback ?? next)
        return result
      } catch (err) {
        // Rollback en cas d'erreur réseau.
        patchVersionFeedback(prev)
        throw err
      }
    },
    [session, patchVersionFeedback],
  )

  /**
   * Set du feedback par loueur (authed). Upsert via RPC.
   */
  const setRenduFeedbackLoueur = useCallback(
    async ({ loueurId, body }) => {
      const versionId = session?.version?.id
      if (!versionId) throw new Error('Version introuvable')
      if (!loueurId) throw new Error('loueurId requis')
      const prevRow = (session?.version_loueur_infos || []).find(
        (vli) => vli?.loueur_id === loueurId,
      )
      const prev = prevRow?.rendu_feedback ?? ''
      const next = body ?? ''
      patchLoueurFeedback(loueurId, next)
      try {
        const result = await setRenduFeedbackLoueurAuthed({ versionId, loueurId, body: next })
        patchLoueurFeedback(loueurId, result?.rendu_feedback ?? next, {
          id: result?.id,
          version_id: result?.version_id,
        })
        return result
      } catch (err) {
        patchLoueurFeedback(loueurId, prev)
        throw err
      }
    },
    [session, patchLoueurFeedback],
  )

  // ─── Aperçu bon-retour (aucune écriture) ─────────────────────────────────
  //
  // Lazy-import du builder MAT-13E `buildBonRetourPdf`. Tant que le module
  // n'existe pas (MAT-13E non livré), l'appel lève une erreur module-not-found
  // claire — c'est attendu pendant le dev incrémental.
  const preview = useCallback(async () => {
    if (!session) throw new Error('Aucune session chargée')
    const snapshot = aggregateBilanData(session)
    if (!snapshot.version?.id) throw new Error('Version introuvable')
    const { buildBonRetourPdf } = await import('../features/materiel/matosBonRetourPdf')
    return buildBonRetourPdf(snapshot, {})
  }, [session])

  // ─── Clôture rendu (authed — pas de token) ──────────────────────────────
  //
  // Pipeline équivalent au chemin token (aggregate → build PDF → upload →
  // RPC close) mais via `closeCheckRenduAuthed`. Identité serveur-side.
  const close = useCallback(async () => {
    if (!session) throw new Error('Aucune session chargée')

    const snapshot = aggregateBilanData(session)
    if (!snapshot.version?.id) throw new Error('Version introuvable')

    const { buildBonRetourPdf } = await import('../features/materiel/matosBonRetourPdf')
    const pdf = await buildBonRetourPdf(snapshot, {})

    const pdfFilename = bonRetourPdfFilename({
      project: snapshot.project,
      version: snapshot.version,
    })

    const upload = await uploadBonRetourArchive({
      versionId: snapshot.version.id,
      blob: pdf.blob,
      filename: pdfFilename,
    })

    const payload = await closeCheckRenduAuthed({
      versionId: snapshot.version.id,
      archivePath: upload.storagePath,
      archiveFilename: pdfFilename,
      archiveSize: upload.sizeBytes,
      archiveMime: upload.mimeType,
    })

    // Patch local pour la bannière "Rendu clôturé" instant.
    setSession((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        version: {
          ...prev.version,
          rendu_closed_at: payload?.rendu_closed_at ?? new Date().toISOString(),
          rendu_closed_by_name: payload?.rendu_closed_by_name ?? userName ?? 'Utilisateur',
          bon_retour_archive_path: payload?.bon_retour_archive_path ?? null,
        },
      }
    })

    // Refetch pour récupérer l'attachment "Bon de retour V{n}".
    refetch()

    return { payload, pdf }
  }, [session, userName, refetch])

  return {
    // État brut
    loading,
    error,
    session,

    // Identité authed (readonly côté hook)
    userName,

    // Dérivés (shape miroir de useCheckAuthedSession)
    blocks,
    items,
    itemsByBlock,
    loueurs,
    loueursByItem,
    comments,
    commentsByItem,
    commentsByBlock,
    attachments,
    progressByBlock,
    versionLoueurInfos,
    infosLogistiqueByLoueur,
    photos,
    photosByItem,
    photosByBlock,

    // Actions (surface réduite — pas d'addItem/setFlag/setRemoved/deleteAdditif)
    actions: {
      toggle,
      addComment,
      preview,
      close,
      refetch,
      uploadPhoto,
      deletePhoto,
      updatePhotoCaption,
      setRenduFeedback,
      setRenduFeedbackLoueur,
    },
  }
}
