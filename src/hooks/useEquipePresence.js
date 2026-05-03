// ════════════════════════════════════════════════════════════════════════════
// useEquipePresence — Présence collaborative + soft-lock per-row
// ════════════════════════════════════════════════════════════════════════════
//
// Branche un canal Supabase Realtime Presence scopé au projet courant pour :
//   1. Lister les admins actuellement sur la page Équipe (avatars header)
//   2. Indiquer quelle row est actuellement en cours d'édition par qui
//      (soft lock visuel sur les AttributionRow → l'utilisateur qui voit
//      qu'un collègue édite peut attendre / ouvrir le dialog de coord.)
//
// Pattern :
//   - 1 channel par projet : `equipe-presence:${projectId}`
//   - Clé de presence unique par TAB (user_id + tabKey aléatoire) → si je
//     suis ouvert dans 2 onglets, je compte pour 2 (mais l'avatar list
//     dédoublonne par user_id pour ne pas avoir 2 fois mon avatar)
//   - Payload : { user_id, full_name, email, editing_row_id, ts }
//   - track() ré-appelée à chaque changement local de editingRowId pour
//     pousser le nouvel état à tous les subscribers
//
// Returns :
//   - othersOnPage : array<{user_id, full_name, email}> — autres tabs (= sans
//     moi), dédoublonnés par user_id, triés alpha
//   - othersEditingByRow : Map<rowId, {user_id, full_name}> — qui édite quoi
//   - setMyEditingRowId(rowId | null) : broadcast mon état d'édition courant
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// Clé unique pour CET onglet — permet de différencier 2 tabs du même user
function makeTabKey() {
  return Math.random().toString(36).slice(2, 10)
}

export function useEquipePresence(projectId) {
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
    (editingRowId) => ({
      user_id: myUserId,
      full_name: myFullName,
      email: myEmail,
      tab_key: tabKeyRef.current,
      editing_row_id: editingRowId || null,
      ts: Date.now(),
    }),
    [myUserId, myFullName, myEmail],
  )

  // ─── Setup channel ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId || !myUserId) return undefined
    const presenceKey = `${myUserId}:${tabKeyRef.current}`
    const channel = supabase.channel(`equipe-presence:${projectId}`, {
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
      // dedupe par tab_key (au cas où Supabase pousse 2 events rapides)
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

  // ─── API publique : setMyEditingRowId ─────────────────────────────────────
  const setMyEditingRowId = useCallback(
    (rowId) => {
      if (myEditingRef.current === rowId) return
      myEditingRef.current = rowId
      const ch = channelRef.current
      if (!ch) return
      // track() retourne une Promise mais on n'a pas besoin d'await ici
      ch.track(buildPayload(rowId)).catch((e) => {
        console.warn('[useEquipePresence] track error:', e)
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

  // othersEditingByRow : Map<rowId, {user_id, full_name}> — pour chaque rowId
  // édité par un AUTRE user, on liste qui. Si plusieurs users éditent la même
  // row (rare), on prend le plus récent.
  const othersEditingByRow = useMemo(() => {
    const map = new Map()
    for (const p of presences) {
      if (!p.editing_row_id) continue
      if (p.user_id === myUserId) continue
      const prev = map.get(p.editing_row_id)
      if (!prev || (p.ts || 0) > (prev.ts || 0)) {
        map.set(p.editing_row_id, {
          user_id: p.user_id,
          full_name: p.full_name || 'Quelqu\u2019un',
        })
      }
    }
    return map
  }, [presences, myUserId])

  return {
    othersOnPage,
    othersEditingByRow,
    setMyEditingRowId,
  }
}
