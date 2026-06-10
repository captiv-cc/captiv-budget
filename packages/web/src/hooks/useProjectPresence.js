// ════════════════════════════════════════════════════════════════════════════
// useProjectPresence — Hook générique de présence collaborative
// ════════════════════════════════════════════════════════════════════════════
//
// Hook unifié pour la couche "présence Realtime Supabase" sur n'importe quel
// onglet d'un projet. Factorise le pattern utilisé par useEquipePresence,
// useMaterielPresence, et bientôt tous les autres onglets projet.
//
// Cf. CHANTIER_PRESENCE_GLOBALE.md pour la vision et le séquencement.
//
// Fonctionnalités :
//   1. Liste les autres admins sur la même page (= même channel) → avatars
//      header via <ProjectPresenceBadge> ou <PresenceAvatars>.
//   2. Indique qui édite quelle row/item via soft-lock per-row (badge inline
//      "Sophie édite ici" + désactivation édition locale optionnelle).
//
// Pattern :
//   - 1 channel par projet+outil : `${channelSlug}:${projectId}`
//   - Clé de presence unique par TAB (user_id + tabKey) pour différencier
//     plusieurs onglets ouverts du même user.
//   - Payload générique : { user_id, full_name, email, tab_key, editing_row_id, ts }
//   - `editing_row_id` est optionnel — si l'onglet n'a pas de notion de row
//     (ex : Dashboard projet), on ne s'en sert juste pas.
//
// Usage :
//   const { othersOnPage, othersEditingByRow, setMyEditingRowId } =
//     useProjectPresence({ projectId, channelSlug: 'devis-presence' })
//
// Returns :
//   - othersOnPage : Array<{user_id, full_name, email}> — autres tabs (sans
//     moi), dédoublonnés par user_id, triés alpha.
//   - othersEditingByRow : Map<rowId, {user_id, full_name}> — qui édite quoi.
//   - setMyEditingRowId(rowId | null) : broadcast mon état d'édition.
//   - myColor : couleur déterministe dérivée du user_id (utile pour curseurs
//     Y.js plus tard).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// Clé unique pour CET onglet — permet de différencier 2 tabs du même user.
function makeTabKey() {
  return Math.random().toString(36).slice(2, 10)
}

// Couleur déterministe dérivée du user_id. Utilisé pour les curseurs Y.js
// futurs et pour cohérence visuelle (même couleur dans avatar + curseur).
// Palette : 12 teintes vibrantes mais lisibles sur fond clair/sombre.
const COLOR_PALETTE = [
  '#EF4444', // rouge
  '#F97316', // orange
  '#F59E0B', // ambre
  '#EAB308', // jaune
  '#84CC16', // citron
  '#22C55E', // vert
  '#14B8A6', // teal
  '#06B6D4', // cyan
  '#3B82F6', // bleu
  '#6366F1', // indigo
  '#A855F7', // violet
  '#EC4899', // rose
]
function colorFromUserId(userId) {
  if (!userId) return COLOR_PALETTE[0]
  let h = 0
  for (let i = 0; i < userId.length; i += 1) {
    h = (h * 31 + userId.charCodeAt(i)) | 0
  }
  return COLOR_PALETTE[Math.abs(h) % COLOR_PALETTE.length]
}

export function useProjectPresence({ projectId, channelSlug }) {
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
  const myColor = useMemo(() => colorFromUserId(myUserId), [myUserId])

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
    if (!projectId || !myUserId || !channelSlug) return undefined
    const presenceKey = `${myUserId}:${tabKeyRef.current}`
    const channel = supabase.channel(`${channelSlug}:${projectId}`, {
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
  }, [projectId, myUserId, channelSlug, buildPayload])

  // ─── API publique : setMyEditingRowId ─────────────────────────────────────
  const setMyEditingRowId = useCallback(
    (rowId) => {
      if (myEditingRef.current === rowId) return
      myEditingRef.current = rowId
      const ch = channelRef.current
      if (!ch) return
      ch.track(buildPayload(rowId)).catch((e) => {
        console.warn(`[useProjectPresence:${channelSlug}] track error:`, e)
      })
    },
    [buildPayload, channelSlug],
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
    return [...byUser.values()]
      .map((p) => ({ ...p, color: colorFromUserId(p.user_id) }))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  }, [presences, myUserId])

  // othersEditingByRow : Map<rowId, {user_id, full_name, color}> — pour
  // chaque rowId édité par un AUTRE user, on liste qui. Si plusieurs users
  // éditent la même row (rare), on prend le plus récent.
  const othersEditingByRow = useMemo(() => {
    const map = new Map()
    for (const p of presences) {
      if (!p.editing_row_id) continue
      if (p.user_id === myUserId) continue
      const prev = map.get(p.editing_row_id)
      if (!prev || (p.ts || 0) > (prev.ts || 0)) {
        map.set(p.editing_row_id, {
          user_id: p.user_id,
          full_name: p.full_name || 'Quelqu’un',
          color: colorFromUserId(p.user_id),
        })
      }
    }
    return map
  }, [presences, myUserId])

  return {
    othersOnPage,
    othersEditingByRow,
    setMyEditingRowId,
    myColor,
  }
}

// Helper exporté pour les composants qui veulent dériver une couleur user
// sans avoir à utiliser le hook (ex : avatars d'historique, badges).
export { colorFromUserId }
