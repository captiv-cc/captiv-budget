// ════════════════════════════════════════════════════════════════════════════
// useNotificationsFeed — flux de notifications in-app du desk (Notifs N4)
// ════════════════════════════════════════════════════════════════════════════
//
// Miroir web du NotificationsContext mobile : lit la table `notifications`
// (RLS = ses propres lignes), s'abonne aux INSERT en realtime (publication
// déjà active), expose lu / tout lu / suppression. À l'arrivée d'une notif
// pendant la session : toast discret en plus du badge.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { notify } from '../lib/notify'
import { setTabBadge } from '../lib/tabBadge'

const LIMIT = 50

export function useNotificationsFeed() {
  const { user } = useAuth()
  const userId = user?.id
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LIMIT)
    setNotifications(data || [])
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  // Realtime : nouvelles notifications (INSERT sur mes lignes uniquement)
  useEffect(() => {
    if (!userId) return undefined
    const channel = supabase
      .channel(`desk-notifs:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          setNotifications((prev) =>
            prev.some((n) => n.id === row.id) ? prev : [row, ...prev].slice(0, LIMIT),
          )
          notify.info(row.titre, { duration: 5000 })
        },
      )
      // UPDATE : notifications condensées (« devis modifié » incrémente la même
      // ligne) → on remplace l'entrée et on re-trie (created_at est bumpé).
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          setNotifications((prev) => {
            const next = prev.map((n) => (n.id === row.id ? row : n))
            next.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            return next
          })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  const markRead = useCallback(async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lu: true, lu_at: new Date().toISOString() } : n)),
    )
    await supabase
      .from('notifications')
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq('id', id)
  }, [])

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, lu: true })))
    if (userId) {
      await supabase
        .from('notifications')
        .update({ lu: true, lu_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('lu', false)
    }
  }, [userId])

  const remove = useCallback(async (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    await supabase.from('notifications').delete().eq('id', id)
  }, [])

  const unread = notifications.filter((n) => !n.lu).length

  // Badge onglet navigateur (titre + favicon), visible depuis un autre onglet
  useEffect(() => {
    setTabBadge(unread)
  }, [unread])

  return { notifications, unread, loading, markRead, markAllRead, remove, reload: load }
}
