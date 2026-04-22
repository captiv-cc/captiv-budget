// ════════════════════════════════════════════════════════════════════════════
// useCheckTokenSession — Hook React pour la route anonyme /check/:token (MAT-10)
// ════════════════════════════════════════════════════════════════════════════
//
// Ce hook orchestre l'état de la session "checklist terrain" côté client :
//   - Charge le bundle complet via `check_session_fetch` (RPC SECURITY DEFINER)
//   - Expose blocks, itemsByBlock, loueursByItem, commentsByItem, attachments…
//   - Encapsule les actions (toggle, addItem, addComment, setFlag) avec des
//     updates OPTIMISTES : l'UI bouge instantanément, on refetche/rollback
//     en cas d'erreur.
//   - Gère le nom utilisateur anon (localStorage scopé par token).
//
// Pattern miroir de useMateriel (refetch global via bumpReload + applyPatch
// pour les optimistic updates).
//
// Exemple :
//   const {
//     loading, error, session, userName, setUserName,
//     blocks, itemsByBlock, loueursByItem, commentsByItem, attachments,
//     progressByBlock, actions: { toggle, addItem, addComment, setFlag, refetch },
//   } = useCheckTokenSession(token)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as CT from '../lib/matosCheckToken'
import { computeProgressByBlock } from '../lib/matosCheckFilter'
import { aggregateBilanData, bilanZipFilename } from '../lib/matosBilanData'
import { closeEssaisWithArchive } from '../lib/matosCloture'

export function useCheckTokenSession(token) {
  // ─── État principal ──────────────────────────────────────────────────────
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Nom utilisateur anon : lu depuis localStorage au mount, persisté au set.
  const [userName, setUserNameState] = useState(() => CT.getCheckUserName(token))
  const setUserName = useCallback(
    (name) => {
      CT.setCheckUserName(token, name)
      setUserNameState(name?.trim() || null)
    },
    [token],
  )

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

  // Si le token change, relit le userName depuis localStorage (scopé par token).
  useEffect(() => {
    setUserNameState(CT.getCheckUserName(token))
  }, [token])

  // ─── Dérivés mémoïsés ────────────────────────────────────────────────────
  const blocks = useMemo(() => session?.blocks || [], [session])
  const items = useMemo(() => session?.items || [], [session])
  const loueurs = useMemo(() => session?.loueurs || [], [session])
  // ⚠️ La RPC `check_session_fetch` renvoie la clé en snake_case (`item_loueurs`) —
  // jamais `itemLoueurs`. Un ancien bug lisait la camelCase et laissait
  // `loueursByItem` vide en permanence → plus aucune pastille loueur sur
  // /check/:token. Respecter strictement le shape serveur (cf. migration
  // MAT-10J §4 / MAT-10N).
  const itemLoueurs = useMemo(() => session?.item_loueurs || [], [session])
  const comments = useMemo(() => session?.comments || [], [session])
  const attachments = useMemo(() => session?.attachments || [], [session])

  // Index par block_id → items.
  const itemsByBlock = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      if (!map.has(it.block_id)) map.set(it.block_id, [])
      map.get(it.block_id).push(it)
    }
    // Tri sort_order puis created_at (miroir de useMateriel).
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const so = (a.sort_order ?? 0) - (b.sort_order ?? 0)
        if (so !== 0) return so
        return new Date(a.created_at) - new Date(b.created_at)
      })
    }
    return map
  }, [items])

  // Index par item_id → [loueurs résolus].
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

  // Index par item_id → [commentaires] (ordre chrono ascendant).
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

  // Progression par bloc : { checked, total, ratio } pour la barre de progress.
  //
  // Délègue au helper pur `computeProgressByBlock` (matosCheckFilter) qui :
  //   - exclut les items retirés (removed_at) du total ET du compteur —
  //     rationale : si on retire la caméra PLV100 d'un bloc de 10, on veut
  //     9/9 (bloc fini) pas 9/10 qui resterait orange à vie.
  //   - calcule `ratio` et `allChecked` pour l'affichage de la barre.
  const progressByBlock = useMemo(
    () => computeProgressByBlock(blocks, itemsByBlock),
    [blocks, itemsByBlock],
  )

  // ─── Helpers pour patcher `session` localement (optimistic updates) ──────
  //
  // On évite de refetch systématiquement après une action : on patch juste la
  // slice concernée du bundle. Les RPC check_* renvoient des payloads partiels
  // (ex. toggle renvoie `{item_id, pre_check_at, pre_check_by_name}` — pas
  // l'item complet), donc on passe explicitement `(itemId, patch)` pour éviter
  // toute ambiguïté de shape.
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
      if (prev.items.some((it) => it.id === newItem.id)) return prev // dedup
      return { ...prev, items: [...prev.items, newItem] }
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

  // Retire un item du bundle (hard delete d'un additif côté client).
  // Supprime aussi ses commentaires orphelins en local (le DELETE SQL CASCADE
  // s'en occupe côté serveur, on s'aligne côté client pour cohérence).
  const removeItem = useCallback((itemId) => {
    if (!itemId) return
    setSession((prev) => {
      if (!prev) return prev
      const nextItems = prev.items.filter((it) => it.id !== itemId)
      const nextComments = prev.comments.filter((c) => c.item_id !== itemId)
      return { ...prev, items: nextItems, comments: nextComments }
    })
  }, [])

  // ─── Actions publiques ───────────────────────────────────────────────────

  /**
   * Toggle le pre_check d'un item. La RPC renvoie `{item_id, pre_check_at,
   * pre_check_by_name}` — on merge ces 2 champs dans l'item local. On force
   * aussi `pre_check_by` à null côté client car la RPC le reset (anon token
   * = pas d'uuid auteur, cf. migration).
   */
  const toggle = useCallback(
    async (itemId) => {
      if (!userName) throw new Error('Nom utilisateur requis')
      const updated = await CT.toggleCheck({ token, itemId, userName })
      patchItem(itemId, {
        pre_check_at: updated?.pre_check_at ?? null,
        pre_check_by_name: updated?.pre_check_by_name ?? null,
        pre_check_by: null,
      })
      return updated
    },
    [token, userName, patchItem],
  )

  /**
   * Ajoute un additif à un bloc. La RPC ne renvoie que `{id}` — on reconstruit
   * la shape complète côté client pour pouvoir l'afficher immédiatement sans
   * refetch. sort_order est mis à une grosse valeur pour qu'il apparaisse à
   * la fin ; au prochain fetch, le vrai sort_order serveur prendra le relai.
   */
  const addItem = useCallback(
    async ({ blockId, designation, quantite = 1 }) => {
      if (!userName) throw new Error('Nom utilisateur requis')
      const created = await CT.addCheckItem({
        token,
        blockId,
        designation,
        quantite,
        userName,
      })
      appendItem({
        id: created?.id,
        block_id: blockId,
        designation: designation.trim(),
        quantite,
        added_during_check: true,
        added_by_name: userName,
        added_at: new Date().toISOString(),
        pre_check_at: null,
        pre_check_by_name: null,
        flag: null,
        sort_order: 99999,
      })
      return created
    },
    [token, userName, appendItem],
  )

  /** Ajoute un commentaire sur un item. */
  const addComment = useCallback(
    async ({ itemId, body }) => {
      if (!userName) throw new Error('Nom utilisateur requis')
      const created = await CT.addCheckComment({ token, itemId, body, userName })
      // La RPC renvoie déjà le row complet côté comment (id, item_id, body,
      // author_name, created_at) — on peut l'ajouter tel quel.
      appendComment(created)
      return created
    },
    [token, userName, appendComment],
  )

  /**
   * Change le flag d'un item. La RPC renvoie `{item_id, flag}`, on merge
   * juste le flag dans l'item local.
   */
  const setFlag = useCallback(
    async ({ itemId, flag }) => {
      const updated = await CT.setCheckFlag({ token, itemId, flag })
      patchItem(itemId, { flag: updated?.flag ?? flag })
      return updated
    },
    [token, patchItem],
  )

  /**
   * Marque un item comme "retiré du tournage" (soft, toggle). La RPC renvoie
   * `{item_id, removed_at, removed_by_name, removed_reason}`. On patche ces
   * 3 champs. Quand on retire un item coché, on reset aussi le pre_check
   * côté client (un item non-pris ne peut pas être coché).
   */
  const setRemoved = useCallback(
    async ({ itemId, removed, reason = null }) => {
      if (removed && !userName) throw new Error('Nom utilisateur requis')
      const updated = await CT.setItemRemoved({
        token,
        itemId,
        removed,
        reason,
        userName,
      })
      const patch = {
        removed_at: updated?.removed_at ?? null,
        removed_by_name: updated?.removed_by_name ?? null,
        removed_reason: updated?.removed_reason ?? null,
      }
      // Si on vient de retirer, on décoche visuellement l'item pour éviter
      // la confusion "l'item est retiré mais reste coché".
      if (removed) {
        patch.pre_check_at = null
        patch.pre_check_by_name = null
      }
      patchItem(itemId, patch)
      return updated
    },
    [token, userName, patchItem],
  )

  /**
   * Supprime définitivement un additif (hard DELETE). La RPC renvoie
   * `{item_id, deleted}`. Côté client, on retire l'item ET ses commentaires
   * du bundle local. La RPC lève une exception si l'item n'est pas un additif,
   * mais on garde la vérification côté UI pour ne même pas proposer l'action.
   */
  const deleteAdditif = useCallback(
    async ({ itemId }) => {
      const result = await CT.deleteCheckAdditif({ token, itemId })
      removeItem(itemId)
      return result
    },
    [token, removeItem],
  )

  /**
   * Prévisualise le bilan (ZIP : PDF global + un PDF par loueur) **sans**
   * clôturer la version. Aucun appel réseau (pas de RPC, pas d'upload) — on
   * réutilise juste `session` déjà chargé pour l'agrégation. Utile pour que
   * l'utilisateur vérifie le rendu + items manquants avant de geler la version.
   *
   * Retourne le même shape `{ blob, url, filename, isZip: true, download,
   * revoke }` que `close()` (côté UI, mêmes handlers de téléchargement).
   */
  const preview = useCallback(async () => {
    if (!session) throw new Error('Aucune session chargée')
    const snapshot = aggregateBilanData(session)
    if (!snapshot.version?.id) throw new Error('Version introuvable')
    const { buildBilanZip } = await import('../features/materiel/matosBilanPdf')
    const zip = await buildBilanZip(snapshot, {})
    return zip
  }, [session])

  /**
   * Clôture les essais : agrège le bilan, build le ZIP (global + par loueur),
   * upload l'archive dans Storage et appelle la RPC qui marque la version
   * comme clôturée + enregistre l'attachment "Bilan essais V{n}".
   *
   * Déclenchable depuis /check/:token (anon) OU depuis l'admin. Le builder PDF
   * est chargé en dynamic import pour ne pas gonfler le bundle de la route
   * anon tant que le bouton n'est pas tapé.
   *
   * Met à jour localement `session.version.closed_at/...` après succès pour
   * que la bannière "Essais clôturés" apparaisse immédiatement, sans refetch.
   *
   * Retourne le payload de la RPC (incluant `attachment_id`) pour que l'UI
   * puisse afficher un toast de succès.
   */
  const close = useCallback(
    async ({ userName: overrideName } = {}) => {
      const effectiveUserName = (overrideName || userName || '').trim()
      if (!effectiveUserName) throw new Error('Nom utilisateur requis pour clôturer')
      if (!session) throw new Error('Aucune session chargée')

      // 1. Agrégation (pure, synchrone)
      const snapshot = aggregateBilanData(session)
      if (!snapshot.version?.id) throw new Error('Version introuvable')

      // 2. Build ZIP (lazy-load jsPDF + jspdf-autotable + jszip)
      const { buildBilanZip } = await import('../features/materiel/matosBilanPdf')
      const zip = await buildBilanZip(snapshot, {})

      // 3. Upload + RPC
      try {
        const payload = await closeEssaisWithArchive({
          token,
          versionId: snapshot.version.id,
          userName: effectiveUserName,
          zipBlob: zip.blob,
          zipFilename: bilanZipFilename({
            project: snapshot.project,
            version: snapshot.version,
          }),
        })

        // 4. Patch local : pose closed_at/closed_by_name/bilan_archive_path
        //    sans refetch, pour que la bannière apparaisse instant.
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            version: {
              ...prev.version,
              closed_at: payload?.closed_at ?? new Date().toISOString(),
              closed_by_name: payload?.closed_by_name ?? effectiveUserName,
              bilan_archive_path: payload?.bilan_archive_path ?? null,
            },
            // L'attachment créé par la RPC doit apparaître dans le viewer docs.
            // On refetch pour le récupérer proprement (simple + robuste).
          }
        })

        // Refetch pour que l'attachment bilan apparaisse dans le viewer.
        refetch()

        return { payload, zip }
      } finally {
        // URL.revokeObjectURL(zip.url) ? non, l'appelant peut vouloir download()
        // l'archive juste après. Le composant parent est responsable du revoke.
      }
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

    // Dérivés (shape miroir de useMateriel)
    blocks,
    items,
    itemsByBlock,
    loueurs,
    loueursByItem,
    comments,
    commentsByItem,
    attachments,
    progressByBlock,

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
    },
  }
}
