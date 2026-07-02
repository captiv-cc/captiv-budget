// ════════════════════════════════════════════════════════════════════════════
// NotificationsWidget — résumé des notifications non lues sur la homepage
// ════════════════════════════════════════════════════════════════════════════
//
// Fetch simple au montage (PAS de realtime ni de toast : la cloche du Layout
// s'en charge déjà, doubler l'abonnement doublerait les toasts). Affiche les
// 5 dernières non lues + compteur ; clic → marquage lu + navigation ; « Tout
// marquer lu » vide le widget. Rendu null quand rien de non lu : la homepage
// reste propre.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { NOTIF_TYPE_STYLE, NOTIF_FALLBACK_STYLE, notifRelTime } from '../lib/notifDisplay'

const SHOWN = 5

export default function NotificationsWidget() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .eq('lu', false)
      .order('created_at', { ascending: false })
      .limit(SHOWN)
      .then(({ data, count }) => {
        if (!alive) return
        setItems(data || [])
        setTotal(count || 0)
      })
    return () => {
      alive = false
    }
  }, [user?.id])

  if (items.length === 0) return null

  async function openNotif(n) {
    setItems((prev) => prev.filter((x) => x.id !== n.id))
    setTotal((t) => Math.max(0, t - 1))
    await supabase
      .from('notifications')
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq('id', n.id)
    if (n.link_web) navigate(n.link_web)
  }

  async function markAllRead() {
    setItems([])
    setTotal(0)
    await supabase
      .from('notifications')
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('lu', false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p
          className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2"
          style={{ color: 'var(--txt-3)' }}
        >
          Notifications
          <span
            className="min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ background: 'var(--blue)' }}
          >
            {total > 99 ? '99+' : total}
          </span>
        </p>
        <button
          onClick={markAllRead}
          className="flex items-center gap-1 text-[11px] font-semibold"
          style={{ color: 'var(--txt-3)' }}
          title="Tout marquer comme lu"
        >
          <CheckCheck className="w-3 h-3" />
          Tout lu
        </button>
      </div>
      <div className="card overflow-hidden">
        {items.map((n) => {
          const st = NOTIF_TYPE_STYLE[n.type] || NOTIF_FALLBACK_STYLE
          const Icon = st.icon
          return (
            <div
              key={n.id}
              onClick={() => openNotif(n)}
              className="flex gap-2.5 px-4 py-2.5 cursor-pointer transition-colors"
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: `color-mix(in srgb, ${st.color} 14%, transparent)`,
                  marginTop: 1,
                }}
              >
                <Icon className="w-3 h-3" style={{ color: st.color }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--txt)' }}>
                  {n.titre}
                </p>
                {n.corps && (
                  <p
                    className="text-[11px] mt-0.5 leading-snug truncate"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    {n.corps}
                  </p>
                )}
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                  {notifRelTime(n.created_at)}
                  {n.data?.project_title && (
                    <span style={{ opacity: 0.75 }}> · {n.data.project_title}</span>
                  )}
                </p>
              </div>
            </div>
          )
        })}
        {total > SHOWN && (
          <p className="px-4 py-2 text-[11px] text-center" style={{ color: 'var(--txt-3)' }}>
            + {total - SHOWN} autres dans la cloche
          </p>
        )}
      </div>
    </div>
  )
}
