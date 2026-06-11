// ════════════════════════════════════════════════════════════════════════════
// NotificationsContext — état notifications partagé (single source)
// ════════════════════════════════════════════════════════════════════════════
//
// Une seule instance de fetch + un seul channel Realtime pour toute l'app.
// Indispensable : plusieurs `useNotifications()` (badge tab bar + écran)
// créeraient sinon plusieurs channels au MÊME nom `notifications:${user.id}`,
// ce que supabase-js refuse ("cannot add postgres_changes callbacks after
// subscribe()").
//
// ════════════════════════════════════════════════════════════════════════════

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { supabase } from './supabase'
import { useAuth } from './AuthContext'

const LIMIT = 50

const NotificationsContext = createContext(null)

export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchNotifs = useCallback(async () => {
    if (!user?.id) return
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(LIMIT)
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[Notifications] fetch error', error.message)
      return
    }
    setNotifications(data ?? [])
    setLoading(false)
  }, [user?.id])

  useEffect(() => {
    fetchNotifs()
  }, [fetchNotifs])

  // Subscribe Realtime (une seule fois par user)
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new, ...prev])
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.lu).length,
    [notifications],
  )

  const markRead = useCallback(async (id) => {
    const now = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lu: true, lu_at: now } : n)),
    )
    await supabase.from('notifications').update({ lu: true, lu_at: now }).eq('id', id)
  }, [])

  const markAllRead = useCallback(async () => {
    if (!user?.id) return
    const now = new Date().toISOString()
    setNotifications((prev) => prev.map((n) => ({ ...n, lu: true, lu_at: now })))
    await supabase
      .from('notifications')
      .update({ lu: true, lu_at: now })
      .eq('user_id', user.id)
      .eq('lu', false)
  }, [user?.id])

  const deleteNotif = useCallback(async (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    const { error } = await supabase.from('notifications').delete().eq('id', id)
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[Notifications] delete error', error.message)
    }
  }, [])

  const value = useMemo(
    () => ({ notifications, unreadCount, loading, markRead, markAllRead, deleteNotif, refetch: fetchNotifs }),
    [notifications, unreadCount, loading, markRead, markAllRead, deleteNotif, fetchNotifs],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error('useNotifications doit être utilisé dans <NotificationsProvider>')
  }
  return ctx
}
