// ════════════════════════════════════════════════════════════════════════════
// useMaterielPresence — Présence collaborative + soft-lock per-item
// ════════════════════════════════════════════════════════════════════════════
//
// Branche un canal Supabase Realtime Presence scopé au projet courant pour la
// page Matériel admin. Pendant Hugo / Marie / etc. travaillent simultanément
// sur la techlist matos d'un même projet :
//   1. Liste les admins actuellement sur la page (avatars header — comme la
//      tab Équipe).
//   2. Indique quelle ligne d'item est actuellement en cours d'édition par
//      qui (soft lock visuel sur ItemRow → on voit qu'un collègue tape dans
//      cette ligne, on attend ou on part sur une autre).
//
// Ce hook est le pendant de useEquipePresence pour la tab Matériel. Mêmes
// principes :
//   - 1 channel par projet : `matos-presence:${projectId}`
//   - Clé de presence unique par TAB (user_id + tabKey aléatoire) → un user
//     ouvert dans 2 onglets compte 2 (mais l'avatar list dédoublonne par
//     user_id).
//   - Payload : { user_id, full_name, email, editing_item_id, ts }
//   - track() ré-appelée à chaque changement local de editingItemId
//
// Mode chantier (route /check/:token, /rendu/:token) : NON couvert ici. Le
// chantier a déjà sa propre presence via useCheckPresence (avec slug `check`
// / `rendu`). Ce hook est exclusivement pour la page admin MaterielTab.
//
// Returns :
//   - othersOnPage : [{user_id, full_name, email}] — autres tabs (= sans moi),
//     dédoublonnés par user_id, triés alpha
//   - othersEditingByItem : Map<itemId, {user_id, full_name}> — qui édite quoi
//   - setMyEditingItemId(itemId | null) : broadcast mon état d'édition courant
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// Clé unique pour CET onglet — permet de différencier 2 tabs du même user
function makeTabKey() {
  return Math.random().toString(36).slice(2, 10)
}

export function useMaterielPresence(projectId) {
  const { user, profile } = useAuth()
  const [presences, setPresences] = useState([])
  const channelRef = useRef(null)
  const tabKeyRef = useRef(null)
  const myEditingRef = useRef(null)
  if (!tabKeyRef.current) tabKeyRef.current = makeTabKey()

  const myUserId = user?.id || null
  const myFullName =
    profile?.full_name?.trim() || user?.email?.split('@')[0] || 'Inconnu'
  const myEmail = user?.email || ''

  // Construit le payload courant à pousser via channel.track()
  const buildPayload = useCallback(
    (editingItemId) => ({
      user_id: myUserId,
      full_name: myFullName,
      email: myEmail,
      tab_key: tabKeyRef.current,
      editing_item_id: editingItemId || null,
      ts: Date.now(),
    }),
    [myUserId, myFullName, myEmail],
  )

  // ─── Setup channel ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId || !myUserId) return undefined
    const presenceKey = `${myUserId}:${tabKeyRef.current}`
    const channel = supabase.channel(`matos-presence:${projectId}`, {
      config: { presence: { key: presenceKey } },
    })

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      // state is { [presenceKey]: [payload, ...] } — flatten + dedupe par
      // (user_id + tab_key) en gardant le plus récent (ts).
      const flat = []
      for (const arr of Object.values(state)) {
        for (const p of arr) flat.push(p)
      }
      const byTab = new Map()
      for (const p of flat) {
        const k = `${p.user_id}:${p.tab_key}`
        const prev = byTab.get(k)
        if (!prev || (p.ts || 0) > (prev.ts || 0)) byTab.set(k, p)
      }
      setPresences([...byTab.values()])
    })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track(buildPayload(myEditingRef.current))
      }
    })

    channelRef.current = channel
    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [projectId, myUserId, buildPayload])

  // ─── API publique : setMyEditingItemId ─────────────────────────────────────
  const setMyEditingItemId = useCallback(
    (itemId) => {
      if (myEditingRef.current === itemId) return
      myEditingRef.current = itemId
      const ch = channelRef.current
      if (!ch) return
      ch.track(buildPayload(itemId)).catch((e) => {
        console.warn('[useMaterielPresence] track error:', e)
      })
    },
    [buildPayload],
  )

  // ─── Dérivés ──────────────────────────────────────────────────────────────

  // othersOnPage : autres users sur la page (pas moi), dédoublonnés par
  // user_id, triés par nom. Si j'ai 2 onglets, mes 2 entrées sont filtrées.
  const othersOnPage = useMemo(() => {
    const byUser = new Map()
    for (const p of presences) {
      if (!p.user_id || p.user_id === myUserId) continue
      const prev = byUser.get(p.user_id)
      if (!prev || (p.ts || 0) > (prev.ts || 0)) byUser.set(p.user_id, p)
    }
    return [...byUser.values()].sort((a, b) =>
      (a.full_name || '').localeCompare(b.full_name || ''),
    )
  }, [presences, myUserId])

  // othersEditingByItem : Map<itemId, {user_id, full_name}> — pour chaque
  // itemId édité par un AUTRE user, on liste qui. Si plusieurs users éditent
  // le même item (rare), on prend le plus récent.
  const othersEditingByItem = useMemo(() => {
    const map = new Map()
    for (const p of presences) {
      if (!p.editing_item_id) continue
      if (p.user_id === myUserId) continue
      const prev = map.get(p.editing_item_id)
      if (!prev || (p.ts || 0) > (prev.ts || 0)) {
        map.set(p.editing_item_id, {
          user_id: p.user_id,
          full_name: p.full_name || 'Quelqu’un',
        })
      }
    }
    return map
  }, [presences, myUserId])

  return {
    othersOnPage,
    othersEditingByItem,
    setMyEditingItemId,
  }
}
