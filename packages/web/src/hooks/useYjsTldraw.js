// ════════════════════════════════════════════════════════════════════════════
// useYjsTldraw — bridge collab tldraw ↔ Yjs (sur useYjsCollab / Supabase)
// ════════════════════════════════════════════════════════════════════════════
//
// `y-tldraw` n'existe pas sur npm : ce bridge (~100 lignes utiles) suit le
// modèle officiel tldraw/tldraw-yjs-example, adapté à notre transport
// Supabase Realtime broadcast (useYjsCollab, déjà utilisé par les Notes).
//
// Principe :
//   - doc.getMap('tldraw_records') : record.id → record (JSON tldraw).
//     Seuls les records scope 'document' (shapes, pages, assets, bindings)
//     sont synchronisés — caméra / instance / présence restent locaux.
//   - local → Yjs   : store.listen({source:'user', scope:'document'})
//                     → doc.transact(set/delete, origin 'local')
//   - Yjs → store   : yRecords.observe (origin remote ou 'persist')
//                     → store.mergeRemoteChanges(put/remove)
//   - restauration  : Y.applyUpdate(doc, ydoc_state base64, 'persist')
//   - autosave      : doc.on('update') → onDirty() (le caller debounce et
//                     écrit Y.encodeStateAsUpdate(doc) en base64 via
//                     saveCanvasState).
//
// L'undo local tldraw se propage comme une modif normale : comportement
// attendu en collab (on n'annule que ses propres actions).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef } from 'react'
import * as Y from 'yjs'
import { createTLStore, defaultShapeUtils, defaultBindingUtils } from 'tldraw'
import { useYjsCollab } from './useYjsCollab'

const Y_MAP_KEY = 'tldraw_records'

export function uint8ToBase64(arr) {
  let binary = ''
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i])
  return btoa(binary)
}

export function base64ToUint8(str) {
  const binary = atob(str)
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) arr[i] = binary.charCodeAt(i)
  return arr
}

/** Encode l'état complet du doc pour la persistance (colonne ydoc_state). */
export function encodeDocState(doc) {
  return uint8ToBase64(Y.encodeStateAsUpdate(doc))
}

/**
 * @param {object} opts
 * @param {string}  opts.canvasId        — plans_canvas.id (docId du channel)
 * @param {string}  [opts.initialStateB64] — ydoc_state persisté (base64), appliqué
 *                                          au doc à l'init (origin 'persist')
 * @param {function} [opts.onDirty]      — appelé à chaque update du doc (local
 *                                          ou distant) pour déclencher l'autosave
 * @param {object}  [opts.assetStore]    — TLAssetStore custom (upload/resolve),
 *                                          cf. makeCaptivAssetStore
 * @param {Array}   [opts.extraShapeUtils] — ShapeUtils custom (caméra, items…),
 *                                          à passer aussi à <Tldraw shapeUtils>
 * @param {boolean} [opts.enabled=true]
 *
 * @returns {{ store, doc, status, peers, myUserMeta }}
 */
export function useYjsTldraw({
  canvasId,
  initialStateB64,
  onDirty,
  assetStore,
  extraShapeUtils,
  enabled = true,
}) {
  const { doc, status, peers, myUserMeta } = useYjsCollab({
    docId: canvasId,
    scope: 'plan-canvas',
    enabled,
  })

  // Un TLStore par canvas. Recréé si on change de plan (clé = canvasId).
  // assetStore / extraShapeUtils volontairement hors deps : figés à la création.
  const store = useMemo(
    () =>
      createTLStore({
        shapeUtils: [...defaultShapeUtils, ...(extraShapeUtils || [])],
        bindingUtils: [...defaultBindingUtils],
        ...(assetStore ? { assets: assetStore } : {}),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasId],
  )

  // Refs pour éviter de re-binder le bridge quand ces props changent.
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty
  const initialStateRef = useRef(initialStateB64)
  initialStateRef.current = initialStateB64

  useEffect(() => {
    if (!doc || !store) return undefined

    const yRecords = doc.getMap(Y_MAP_KEY)

    // ── 1. Restauration de l'état persisté ─────────────────────────────────
    // Idempotent côté CRDT : si un peer a déjà le même état, le merge ne
    // change rien. Origin 'persist' → pas re-broadcasté par erreur (le
    // broadcast se fait quand même via doc.on('update') de useYjsCollab,
    // ce qui est voulu : un client qui restaure alimente les autres).
    if (initialStateRef.current) {
      try {
        Y.applyUpdate(doc, base64ToUint8(initialStateRef.current), 'persist')
      } catch (e) {
        console.warn('[useYjsTldraw] restauration ydoc_state échouée', e)
      }
    }

    // ── 2. État initial Yjs → store ────────────────────────────────────────
    if (yRecords.size > 0) {
      const records = []
      yRecords.forEach((record) => {
        if (record?.id) records.push(record)
      })
      store.mergeRemoteChanges(() => {
        store.put(records)
      })
    }

    // ── 3. Local (interactions user) → Yjs ─────────────────────────────────
    const unlisten = store.listen(
      ({ changes }) => {
        doc.transact(() => {
          Object.values(changes.added).forEach((record) => {
            yRecords.set(record.id, record)
          })
          Object.values(changes.updated).forEach(([, next]) => {
            yRecords.set(next.id, next)
          })
          Object.values(changes.removed).forEach((record) => {
            yRecords.delete(record.id)
          })
        }, 'local')
      },
      { source: 'user', scope: 'document' },
    )

    // ── 4. Yjs (remote / persist) → store ──────────────────────────────────
    const onYChange = (event, txn) => {
      if (txn.origin === 'local') return
      const toPut = []
      const toRemove = []
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'delete') toRemove.push(key)
        else {
          const record = yRecords.get(key)
          if (record?.id) toPut.push(record)
        }
      })
      if (!toPut.length && !toRemove.length) return
      store.mergeRemoteChanges(() => {
        if (toRemove.length) store.remove(toRemove)
        if (toPut.length) store.put(toPut)
      })
    }
    yRecords.observe(onYChange)

    // ── 5. Autosave : tout update du doc marque dirty ───────────────────────
    // Y compris les updates distants : chaque client persiste, dernier écrit
    // gagne — même état CRDT des deux côtés, donc sans conséquence.
    const onDocUpdate = () => {
      onDirtyRef.current?.()
    }
    doc.on('update', onDocUpdate)

    return () => {
      unlisten()
      yRecords.unobserve(onYChange)
      doc.off('update', onDocUpdate)
    }
  }, [doc, store])

  return { store, doc, status, peers, myUserMeta }
}
