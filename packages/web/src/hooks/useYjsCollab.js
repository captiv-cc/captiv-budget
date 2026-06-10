// ════════════════════════════════════════════════════════════════════════════
// useYjsCollab — Bridge collab temps réel Y.js ↔ Supabase Realtime
// ════════════════════════════════════════════════════════════════════════════
//
// Hook réutilisable qui matérialise un document collaboratif CRDT (Y.Doc)
// synchronisé entre tous les clients via un channel Supabase Realtime
// broadcast. Aucun serveur dédié (Hocuspocus / y-websocket) — on reste 100%
// sur la stack Supabase existante.
//
// Architecture :
//
//   ┌──────────────┐    Y.Doc updates     ┌──────────────┐
//   │ Client A     │ ──────────────────▶  │ Client B     │
//   │ (Tiptap +    │    via Supabase      │ (Tiptap +    │
//   │  Y.Doc)      │ ◀──────────────────  │  Y.Doc)      │
//   └──────────────┘    broadcast channel └──────────────┘
//                       (1 par docId)
//
// Messages broadcast (channel.send → event=...) :
//   - 'yjs-update'    : { update: base64(Y.encodeStateAsUpdate diff) }
//   - 'awareness'     : { update: base64(encodeAwarenessUpdate) }
//   - 'sync-request'  : { from: tabKey } — nouveau client demande l'état
//                       complet ; les peers en place répondent avec
//                       'yjs-update' contenant leur encodeStateAsUpdate().
//
// Persistence : NON gérée ici. Le caller (ex : CreneauInspector) snapshot
// le doc en BDD via debounce sur les events. Le hook retourne `doc` et
// `editor.getJSON()` (côté Tiptap) suffit pour récupérer le JSON ProseMirror.
//
// Bootstrap initial : si `initialContent` (JSON ProseMirror) est fourni, le
// caller doit l'injecter dans le Y.Doc une seule fois APRÈS le 1er sync
// (ou immédiatement si on est le 1er client). Cf. RichEditor : l'extension
// @tiptap/extension-collaboration prend `document` (Y.Doc) et `field` —
// elle setContent initial automatiquement si le fragment est vide.
//
// Cf. CHANTIER_NOTES_DOCS.md pour la vision long-terme et la migration
// éventuelle vers Hocuspocus si on dépasse les limites Supabase Realtime.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useMemo } from 'react'
import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { colorFromUserId } from './useProjectPresence'

// ─── Helpers binaire ↔ base64 ───────────────────────────────────────────────
// Les channels Realtime acceptent du JSON, donc on encode les Uint8Array en
// base64 avant broadcast. ~33% d'overhead vs binaire brut — acceptable pour
// les notes (petits docs). Pour des docs lourds (Notes & Docs futurs), on
// envisagera Hocuspocus binaire pur.

function uint8ToBase64(arr) {
  let binary = ''
  for (let i = 0; i < arr.length; i += 1) {
    binary += String.fromCharCode(arr[i])
  }
  // btoa lance si caractères non-Latin1 → on passe par String.fromCharCode
  return btoa(binary)
}

function base64ToUint8(str) {
  const binary = atob(str)
  const len = binary.length
  const arr = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) {
    arr[i] = binary.charCodeAt(i)
  }
  return arr
}

// Clé unique par TAB (évite de se faire écho à soi-même quand on broadcast).
function makeTabKey() {
  return Math.random().toString(36).slice(2, 10)
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.docId    — identifiant unique du doc (ex : creneau.id)
 * @param {string} opts.scope    — préfixe channel, ex 'deroule-creneau'
 * @param {boolean} [opts.enabled=true] — désactive le hook (ex : créneau pas
 *                  encore sauvé en BDD, pas de collab possible).
 *
 * @returns {object}
 *   - doc       : Y.Doc | null
 *   - awareness : Y.Awareness | null
 *   - status    : 'idle' | 'connecting' | 'connected' | 'error'
 *   - peers     : Array<{ clientId, user_id, name, color, cursor? }> — autres
 *                  utilisateurs présents dans le doc (excluant soi-même).
 *   - myUserMeta : { name, color, user_id } — info locale pour Tiptap collab cursor.
 */
export function useYjsCollab({ docId, scope, enabled = true }) {
  const { user, profile } = useAuth()
  const myUserId = user?.id || null
  const myFullName =
    profile?.full_name?.trim() || user?.email?.split('@')[0] || 'Inconnu'
  const myColor = useMemo(() => colorFromUserId(myUserId), [myUserId])

  const myUserMeta = useMemo(
    () => ({ user_id: myUserId, name: myFullName, color: myColor }),
    [myUserId, myFullName, myColor],
  )

  // Y.Doc et Y.Awareness recréés à chaque changement de docId / scope. On
  // les garde stables via useRef sinon Tiptap (qui s'abonne au Y.Doc) doit
  // re-init à chaque render → pas viable.
  const docRef = useRef(null)
  const awarenessRef = useRef(null)
  const channelRef = useRef(null)
  const tabKeyRef = useRef(null)
  if (!tabKeyRef.current) tabKeyRef.current = makeTabKey()

  const [status, setStatus] = useState('idle')
  const [peers, setPeers] = useState([])

  // Re-création complète si la combinaison change. Important : si docId
  // devient null (créneau pas encore sauvé), on tear-down proprement.
  const sessionKey = enabled && docId && scope ? `${scope}:${docId}` : null

  useEffect(() => {
    if (!sessionKey || !myUserId) {
      // Tear-down si on était actif et qu'on devient inactif.
      if (docRef.current) {
        docRef.current.destroy()
        docRef.current = null
      }
      if (awarenessRef.current) {
        awarenessRef.current.destroy()
        awarenessRef.current = null
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      setStatus('idle')
      setPeers([])
      return undefined
    }

    setStatus('connecting')

    // ─── 1. Création du Y.Doc + Awareness ─────────────────────────────────
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    awareness.setLocalState({
      user: {
        name: myFullName,
        color: myColor,
        user_id: myUserId,
      },
    })
    docRef.current = doc
    awarenessRef.current = awareness

    // ─── 2. Setup channel Supabase Realtime broadcast ─────────────────────
    // self: false → on ne reçoit pas nos propres broadcasts (économise CPU).
    // ack: false → on ne s'attend pas à des acquittements (broadcast best-effort).
    const channel = supabase.channel(sessionKey, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: `${myUserId}:${tabKeyRef.current}` },
      },
    })
    channelRef.current = channel

    // ─── 3. Listeners broadcast → applique au Y.Doc / awareness ───────────
    channel.on('broadcast', { event: 'yjs-update' }, ({ payload }) => {
      if (!payload?.update) return
      try {
        const update = base64ToUint8(payload.update)
        // 'remote' = origin → permet à Tiptap de distinguer remote vs local
        Y.applyUpdate(doc, update, 'remote')
      } catch (e) {
        console.warn(`[useYjsCollab:${sessionKey}] applyUpdate failed`, e)
      }
    })

    channel.on('broadcast', { event: 'awareness' }, ({ payload }) => {
      if (!payload?.update) return
      try {
        const update = base64ToUint8(payload.update)
        applyAwarenessUpdate(awareness, update, 'remote')
      } catch (e) {
        console.warn(`[useYjsCollab:${sessionKey}] applyAwareness failed`, e)
      }
    })

    // Quand un nouveau client demande l'état complet, on lui envoie le
    // notre. C'est notre "sync initial" pseudo-protocole.
    channel.on('broadcast', { event: 'sync-request' }, ({ payload }) => {
      if (!payload?.from || payload.from === tabKeyRef.current) return
      const fullState = Y.encodeStateAsUpdate(doc)
      channel.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload: { update: uint8ToBase64(fullState) },
      })
    })

    // ─── 4. Listeners Y.Doc / Awareness → broadcast aux peers ─────────────
    // origin='remote' = update vient de Y.applyUpdate (autre client), on ne
    // re-broadcast PAS sinon boucle infinie. Tout autre origin = changement
    // local (transaction Tiptap, init, etc.) → broadcast.
    const onDocUpdate = (update, origin) => {
      if (origin === 'remote') return
      channel.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload: { update: uint8ToBase64(update) },
      })
    }
    doc.on('update', onDocUpdate)

    const onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === 'remote') return
      const changedClients = added.concat(updated).concat(removed)
      if (changedClients.length === 0) return
      const update = encodeAwarenessUpdate(awareness, changedClients)
      channel.send({
        type: 'broadcast',
        event: 'awareness',
        payload: { update: uint8ToBase64(update) },
      })
      // Met à jour la liste des peers (pour l'UI ex : avatars collab).
      // States courants à parcourir : exclut clientID local + entrées vides.
      const peersList = []
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return
        if (state?.user) {
          peersList.push({
            clientId,
            user_id: state.user.user_id || null,
            name: state.user.name || '?',
            color: state.user.color || '#666',
            cursor: state.cursor || null,
          })
        }
      })
      setPeers(peersList)
    }
    awareness.on('update', onAwarenessUpdate)

    // ─── 5. Subscribe au channel + demande de sync initial ────────────────
    channel.subscribe(async (channelStatus) => {
      if (channelStatus === 'SUBSCRIBED') {
        setStatus('connected')
        // Demande aux peers leur état complet pour rattraper.
        channel.send({
          type: 'broadcast',
          event: 'sync-request',
          payload: { from: tabKeyRef.current },
        })
        // Push notre awareness initial (sinon les peers ne nous voient pas
        // tant qu'on n'a pas bougé le curseur).
        const myUpdate = encodeAwarenessUpdate(awareness, [awareness.clientID])
        channel.send({
          type: 'broadcast',
          event: 'awareness',
          payload: { update: uint8ToBase64(myUpdate) },
        })
      } else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
        setStatus('error')
      }
    })

    // ─── 6. Cleanup ───────────────────────────────────────────────────────
    return () => {
      doc.off('update', onDocUpdate)
      awareness.off('update', onAwarenessUpdate)
      // Notifie les peers qu'on part (efface notre awareness).
      try {
        awareness.setLocalState(null)
      } catch {
        // best-effort, peut throw si déjà destroyed
      }
      awareness.destroy()
      supabase.removeChannel(channel)
      doc.destroy()
      docRef.current = null
      awarenessRef.current = null
      channelRef.current = null
      setStatus('idle')
      setPeers([])
    }
  }, [sessionKey, myUserId, myFullName, myColor])

  return {
    doc: docRef.current,
    awareness: awarenessRef.current,
    status,
    peers,
    myUserMeta,
  }
}
