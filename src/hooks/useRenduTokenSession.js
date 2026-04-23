// ════════════════════════════════════════════════════════════════════════════
// useRenduTokenSession — Hook React pour la route anonyme /rendu/:token (MAT-13)
// ════════════════════════════════════════════════════════════════════════════
//
// Miroir de `useCheckTokenSession` mais scopé pour la phase RENDU :
//
//   - Même RPC de fetch (`check_session_fetch`) — le bundle renvoyé inclut
//     désormais les champs post_check_* (items) et rendu_closed_* (version)
//     depuis MAT-13A. Le token doit être phase='rendu' (validé côté serveur
//     par les RPC d'action qui appellent _check_token_get_phase).
//
//   - `progressByBlock` calculé sur `post_check_at` (via le param `{ phase }`
//     de `computeProgressByBlock`). Les items retirés restent exclus du total
//     et du compteur (rationale identique à essais).
//
//   - `toggle(itemId)` appelle `check_action_toggle(..., p_phase='rendu')` →
//     route vers post_check_at / post_check_by_name côté DB.
//
//   - `addComment({ kind })` : seul kind='rendu' est permis pour un token
//     phase='rendu' (le serveur rejette sinon avec SQLSTATE 42501).
//
//   - `uploadPhoto({ kind })` : seul kind='retour' est permis (même règle).
//
//   - `close({ pdfBlob, pdfFilename })` : upload le PDF bon-retour + RPC
//     `check_action_close_rendu`. Pose rendu_closed_at + attachment.
//
//   - Les items retirés sont exposés inchangés (removed_at, removed_by_name,
//     removed_reason) pour que l'UI les affiche en bas "pour mémoire" — aucun
//     traitement supplémentaire côté hook.
//
//   - Le userName anon est stocké dans la MÊME clé localStorage que le hook
//     essais (`matos.check.username:<token>`). Un même utilisateur ouvrant
//     les deux liens (cas rare mais possible) garde son identité.
//
// Shape de retour IDENTIQUE en surface à useCheckTokenSession pour que les
// composants UI (CheckItemRow, CheckBlockCard, ActionSheet, photos…) puissent
// se brancher sans condition. Les champs phase-spécifiques (post_check_at vs
// pre_check_at) sont lus directement sur l'item par les composants, ce hook
// ne fait pas d'aliasing — on garde la shape DB transparente.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as CT from '../lib/matosCheckToken'
import * as MP from '../lib/matosItemPhotos'
import {
  closeRenduWithArchive,
  bonRetourPdfFilename,
  setRenduFeedback as setRenduFeedbackApi,
  setRenduFeedbackLoueur as setRenduFeedbackLoueurApi,
} from '../lib/matosRendu'
import { computeProgressByBlock } from '../lib/matosCheckFilter'
import { aggregateBilanData } from '../lib/matosBilanData'

export function useRenduTokenSession(token) {
  // ─── État principal ──────────────────────────────────────────────────────
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Nom utilisateur anon : on réutilise la MÊME clé localStorage que le hook
  // essais — un anon qui ouvre un lien essais puis un lien rendu garde son
  // identité. Les deux tokens étant différents, les clés restent scopées.
  const [userName, setUserNameState] = useState(() => CT.getCheckUserName(token))
  const setUserName = useCallback(
    (name) => {
      CT.setCheckUserName(token, name)
      setUserNameState(name?.trim() || null)
    },
    [token],
  )

  // Ref anti-unmount.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // ─── Chargement initial + refetch ────────────────────────────────────────
  const [reloadKey, setReloadKey] = useState(0)
  const refetch = useCallback(() => {
    setReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setSession(null)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await CT.fetchCheckSession(token)
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
  }, [token, reloadKey])

  useEffect(() => {
    setUserNameState(CT.getCheckUserName(token))
  }, [token])

  // ─── Dérivés mémoïsés ────────────────────────────────────────────────────
  // Shape strictement identique à useCheckTokenSession (snake_case). La SEULE
  // différence fonctionnelle est le calcul de progressByBlock (phase='rendu').
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

  // Les comments essais (kind='probleme'|'note') ET rendu (kind='rendu') sont
  // tous retournés par le bundle ; l'UI rendu filtrera pour afficher uniquement
  // les kind='rendu' dans les threads. On garde l'index complet ici (simple).
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

  // MAT-13 : progress basé sur post_check_at via le param phase='rendu'.
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

  // ─── Patch helpers ───────────────────────────────────────────────────────
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

  /**
   * Toggle le post_check_at d'un item. La RPC `check_action_toggle` est
   * appelée avec phase='rendu'. Le token doit être phase='rendu' sinon
   * SQLSTATE 42501.
   *
   * Patch local : `post_check_at` + `post_check_by_name` (pas pre_*).
   */
  const toggle = useCallback(
    async (itemId) => {
      if (!userName) throw new Error('Nom utilisateur requis')
      const updated = await CT.toggleCheck({
        token,
        itemId,
        userName,
        phase: 'rendu',
      })
      patchItem(itemId, {
        post_check_at: updated?.post_check_at ?? null,
        post_check_by_name: updated?.post_check_by_name ?? null,
        post_check_by: null,
      })
      return updated
    },
    [token, userName, patchItem],
  )

  /**
   * Ajoute un commentaire rendu sur un item OU un bloc. Seul kind='rendu'
   * est accepté côté token phase='rendu'.
   */
  const addComment = useCallback(
    async ({ itemId = null, blockId = null, body }) => {
      if (!userName) throw new Error('Nom utilisateur requis')
      const created = await CT.addCheckComment({
        token,
        itemId,
        blockId,
        kind: 'rendu',
        body,
        userName,
      })
      appendComment(created)
      return created
    },
    [token, userName, appendComment],
  )

  /**
   * Upload une photo kind='retour'. XOR item|block. Pipeline identique aux
   * photos essais (compression HEIC, limite 10 par ancre, etc.).
   */
  const uploadPhoto = useCallback(
    async ({ itemId = null, blockId = null, file, caption = null, originalQuality = false }) => {
      if (!userName) throw new Error('Nom utilisateur requis')
      if (!session?.version?.id) throw new Error('Version introuvable')
      const created = await MP.uploadPhotoToken({
        token,
        versionId: session.version.id,
        itemId,
        blockId,
        kind: 'retour',
        file,
        userName,
        caption,
        originalQuality,
      })
      appendPhoto(created)
      return created
    },
    [token, userName, session, appendPhoto],
  )

  const deletePhoto = useCallback(
    async ({ photoId }) => {
      if (!userName) throw new Error('Nom utilisateur requis')
      await MP.deletePhotoToken({ token, photoId, userName })
      removePhoto(photoId)
    },
    [token, userName, removePhoto],
  )

  const updatePhotoCaption = useCallback(
    async ({ photoId, caption }) => {
      if (!userName) throw new Error('Nom utilisateur requis')
      const result = await MP.updatePhotoCaptionToken({
        token,
        photoId,
        caption,
        userName,
      })
      patchPhoto(photoId, { caption: result?.caption ?? caption })
      return result
    },
    [token, userName, patchPhoto],
  )

  // ─── MAT-13G : Feedback rendu (global + par loueur) ─────────────────────
  //
  // Token path. RPC dédiées (set_rendu_feedback / set_rendu_feedback_loueur)
  // gatées par _check_token_get_phase + phase='rendu'. Pas besoin de userName
  // pour le global (feedback collectif) mais on l'envoie si connu pour
  // homogénéité avec les autres actions.

  const patchVersionFeedback = useCallback((body) => {
    setSession((prev) => {
      if (!prev?.version) return prev
      return { ...prev, version: { ...prev.version, rendu_feedback: body ?? '' } }
    })
  }, [])

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

  const setRenduFeedback = useCallback(
    async (body) => {
      if (!token) throw new Error('Token requis')
      const prev = session?.version?.rendu_feedback ?? ''
      const next = body ?? ''
      patchVersionFeedback(next)
      try {
        const result = await setRenduFeedbackApi({
          token,
          userName: userName || '',
          body: next,
        })
        patchVersionFeedback(result?.rendu_feedback ?? next)
        return result
      } catch (err) {
        patchVersionFeedback(prev)
        throw err
      }
    },
    [token, userName, session, patchVersionFeedback],
  )

  const setRenduFeedbackLoueur = useCallback(
    async ({ loueurId, body }) => {
      if (!token) throw new Error('Token requis')
      if (!loueurId) throw new Error('loueurId requis')
      const prevRow = (session?.version_loueur_infos || []).find(
        (vli) => vli?.loueur_id === loueurId,
      )
      const prev = prevRow?.rendu_feedback ?? ''
      const next = body ?? ''
      patchLoueurFeedback(loueurId, next)
      try {
        const result = await setRenduFeedbackLoueurApi({
          token,
          userName: userName || '',
          loueurId,
          body: next,
        })
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
    [token, userName, session, patchLoueurFeedback],
  )

  /**
   * Preview du bon de retour (aucune écriture). Lazy-import du builder
   * MAT-13E `buildBonRetourPdf` — le module sera ajouté dans MAT-13E.
   * Tant qu'il n'existe pas, l'appel lève une erreur claire (module not found).
   */
  const preview = useCallback(async () => {
    if (!session) throw new Error('Aucune session chargée')
    const snapshot = aggregateBilanData(session)
    if (!snapshot.version?.id) throw new Error('Version introuvable')
    const { buildBonRetourPdf } = await import('../features/materiel/matosBonRetourPdf')
    return buildBonRetourPdf(snapshot, {})
  }, [session])

  /**
   * Clôture du rendu : build le PDF bon-retour, upload Storage, appelle
   * `check_action_close_rendu`. Le token DOIT être phase='rendu' (validé
   * côté SQL). Patch local pour afficher la bannière "Rendu clôturé"
   * instantanément.
   *
   * @param {object} [opts]
   * @param {string} [opts.userName] — override local du nom
   */
  const close = useCallback(
    async ({ userName: overrideName } = {}) => {
      const effectiveUserName = (overrideName || userName || '').trim()
      if (!effectiveUserName) throw new Error('Nom utilisateur requis pour clôturer')
      if (!session) throw new Error('Aucune session chargée')

      const snapshot = aggregateBilanData(session)
      if (!snapshot.version?.id) throw new Error('Version introuvable')

      // Lazy-import du builder PDF (ajouté en MAT-13E).
      const { buildBonRetourPdf } = await import('../features/materiel/matosBonRetourPdf')
      const pdf = await buildBonRetourPdf(snapshot, {})

      const pdfFilename = bonRetourPdfFilename({
        project: snapshot.project,
        version: snapshot.version,
      })

      const payload = await closeRenduWithArchive({
        token,
        versionId: snapshot.version.id,
        userName: effectiveUserName,
        pdfBlob: pdf.blob,
        pdfFilename,
      })

      // Patch local pour la bannière instant.
      setSession((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          version: {
            ...prev.version,
            rendu_closed_at: payload?.rendu_closed_at ?? new Date().toISOString(),
            rendu_closed_by_name: payload?.rendu_closed_by_name ?? effectiveUserName,
            bon_retour_archive_path: payload?.bon_retour_archive_path ?? null,
          },
        }
      })

      // Refetch pour récupérer l'attachment "Bon de retour V{n}".
      refetch()

      return { payload, pdf }
    },
    [session, token, userName, refetch],
  )

  return {
    // État brut
    loading,
    error,
    session,

    // Identité anon
    userName,
    setUserName,

    // Dérivés (shape miroir de useCheckTokenSession)
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

    // Actions
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
