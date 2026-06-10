// ════════════════════════════════════════════════════════════════════════════
// useNotifications — liste des notifications de l'utilisateur courant
// ════════════════════════════════════════════════════════════════════════════
//
// Récupère les notifs depuis Supabase + subscribe Realtime pour push in-app.
//
// Utilisation :
//   const { notifications, unreadCount, markRead, markAllRead, refetch } = useNotifications()
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const LIMIT = 50

export function useNotifications() {
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
      console.warn('[useNotifications] fetch error', error.message)
      return
    }
    setNotifications(data ?? [])
    setLoading(false)
  }, [user?.id])

  useEffect(() => {
    fetchNotifs()
  }, [fetchNotifs])

  // Subscribe Realtime
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

  const markRead = useCallback(
    async (id) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, lu: true, lu_at: new Date().toISOString() } : n)),
      )
      await supabase
        .from('notifications')
        .update({ lu: true, lu_at: new Date().toISOString() })
        .eq('id', id)
    },
    [],
  )

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

  return {
    notifications,
    unreadCount,
    loading,
    markRead,
    markAllRead,
    refetch: fetchNotifs,
  }
}
