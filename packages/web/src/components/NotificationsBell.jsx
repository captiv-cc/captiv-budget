// ════════════════════════════════════════════════════════════════════════════
// NotificationsBell — cloche + panneau de notifications du desk (Notifs N4)
// ════════════════════════════════════════════════════════════════════════════
//
// Monté dans le footer de la sidebar (Layout). Bouton 32x28 aligné sur les
// icônes voisines (iCal, feedback), badge non-lus, panneau ancré à droite de
// la sidebar. Clic sur une notification : marquage lu + navigation link_web.
// Roue crantée : réglages (opt-out devis par user ; délais de relance de
// l'org pour les admins, stockés dans org_settings).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bell, Settings, X, BellOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { notify } from '../lib/notify'
import { useNotificationsFeed } from '../hooks/useNotificationsFeed'
import {
  NOTIF_TYPE_STYLE as TYPE_STYLE,
  NOTIF_FALLBACK_STYLE,
  notifRelTime as relTime,
} from '../lib/notifDisplay'

// Libellé court d'un devis depuis le titre de la notif ("V2 « ZLAN 2026 »…")
function shortDevisLabel(titre) {
  const m = (titre || '').match(/V\d+\s*«[^»]*»/)
  return m ? m[0] : (titre || 'Devis').slice(0, 40)
}

export default function NotificationsBell() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { notifications, unread, markRead, markAllRead, remove } = useNotificationsFeed()
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const panelRef = useRef(null)
  const btnRef = useRef(null)

  // Mute ciblé : ajoute une sourdine {type: 'devis'|'project', id, label} dans
  // user_settings.notif_prefs.mutes (lecture-modification-écriture).
  async function addMute(mute) {
    if (!user?.id) return
    const { data } = await supabase
      .from('user_settings')
      .select('notif_prefs')
      .eq('user_id', user.id)
      .maybeSingle()
    const prefs = data?.notif_prefs || {}
    const mutes = Array.isArray(prefs.mutes) ? prefs.mutes : []
    if (mutes.some((m) => m.type === mute.type && m.id === mute.id)) return
    const { error } = await supabase
      .from('user_settings')
      .upsert(
        { user_id: user.id, notif_prefs: { ...prefs, mutes: [...mutes, mute] } },
        { onConflict: 'user_id' },
      )
    if (error) notify.error('Sourdine impossible')
    else notify.success(`Notifications coupées : ${mute.label}`)
  }

  // Regroupement par projet (ordre des groupes = notif la plus récente).
  // Actif seulement quand il y a du volume et plusieurs projets.
  const groups = []
  {
    const byKey = new Map()
    for (const n of notifications) {
      const key = n.project_id || '_autres'
      if (!byKey.has(key)) {
        const g = {
          key,
          projectId: n.project_id || null,
          label: n.data?.project_title || 'Autres',
          items: [],
        }
        byKey.set(key, g)
        groups.push(g)
      }
      byKey.get(key).items.push(n)
    }
  }
  const grouped = groups.length > 1 && notifications.length > 6

  // Fermeture au clic extérieur
  useEffect(() => {
    if (!open) return undefined
    function onDown(e) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      )
        setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function onClickNotif(n) {
    if (!n.lu) markRead(n.id)
    if (n.link_web) {
      setOpen(false)
      navigate(n.link_web)
    }
  }

  function renderItem(n) {
    const st = TYPE_STYLE[n.type] || NOTIF_FALLBACK_STYLE
    const Icon = st.icon
    return (
      <div
        key={n.id}
        onClick={() => onClickNotif(n)}
        className="flex gap-2.5 px-4 py-2.5 group/item"
        style={{
          borderBottom: '1px solid var(--brd-sub)',
          cursor: n.link_web ? 'pointer' : 'default',
          background: n.lu ? 'transparent' : 'rgba(59,130,246,.05)',
        }}
      >
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${st.color} 14%, transparent)`, marginTop: 1 }}
        >
          <Icon className="w-3 h-3" style={{ color: st.color }} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-xs leading-snug"
            style={{ color: 'var(--txt)', fontWeight: n.lu ? 400 : 600 }}
          >
            {n.titre}
          </p>
          {n.corps && (
            <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--txt-3)' }}>
              {n.corps}
            </p>
          )}
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {relTime(n.created_at)}
            {n.data?.project_title && (
              <span style={{ opacity: 0.75 }}> · {n.data.project_title}</span>
            )}
          </p>
        </div>
        {!n.lu && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
            style={{ background: 'var(--blue)' }}
          />
        )}
        <div className="flex flex-col gap-1.5 shrink-0 self-start mt-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation()
              remove(n.id)
            }}
            style={{ color: 'var(--txt-3)' }}
            title="Supprimer"
          >
            <X className="w-3 h-3" />
          </button>
          {n.data?.devis_id && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                addMute({
                  type: 'devis',
                  id: n.data.devis_id,
                  label: shortDevisLabel(n.titre),
                })
              }}
              style={{ color: 'var(--txt-3)' }}
              title="Couper les notifications de ce devis"
            >
              <BellOff className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="relative group">
        <button
          ref={btnRef}
          onClick={() => setOpen((v) => !v)}
          aria-label="Notifications"
          className="flex items-center justify-center rounded-md transition-all relative"
          style={{
            width: '32px',
            height: '28px',
            color: open ? 'var(--blue)' : 'var(--txt-3)',
            background: open ? 'var(--bg-hov)' : 'transparent',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--blue)'
            e.currentTarget.style.background = 'var(--bg-hov)'
          }}
          onMouseLeave={(e) => {
            if (!open) {
              e.currentTarget.style.color = 'var(--txt-3)'
              e.currentTarget.style.background = 'transparent'
            }
          }}
        >
          <Bell className="w-3.5 h-3.5" />
          {unread > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 inline-flex items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ background: 'var(--blue)' }}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        {!open && (
          <span
            className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-100"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt)',
              border: '1px solid var(--brd)',
              zIndex: 50,
            }}
          >
            Notifications
          </span>
        )}
      </div>

      {/* ── Panneau (portal : au-dessus de tout, y compris SynthBar) ────────── */}
      {open &&
        createPortal(
        <div
          ref={panelRef}
          className="fixed flex flex-col rounded-xl overflow-hidden"
          style={{
            left: '72px',
            bottom: '12px',
            width: '360px',
            maxWidth: 'calc(100vw - 84px)',
            maxHeight: '70vh',
            zIndex: 1000,
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            boxShadow: '0 16px 48px rgba(0,0,0,.45)',
          }}
        >
          <div
            className="flex items-center gap-2 px-4 py-2.5 shrink-0"
            style={{ borderBottom: '1px solid var(--brd)' }}
          >
            <Bell className="w-3.5 h-3.5" style={{ color: 'var(--blue)' }} />
            <span className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
              Notifications
            </span>
            <div className="ml-auto flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] px-2 py-0.5 rounded font-semibold"
                  style={{ color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
                >
                  Tout lu
                </button>
              )}
              <button
                onClick={() => setSettingsOpen(true)}
                className="btn-ghost btn-sm"
                title="Réglages des notifications"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="text-xs text-center py-10" style={{ color: 'var(--txt-3)' }}>
                Aucune notification.
              </p>
            )}
            {grouped
              ? groups.map((g) => (
                  <div key={g.key}>
                    <div
                      className="flex items-center gap-2 px-4 py-1.5 group/head sticky top-0"
                      style={{
                        background: 'var(--bg-elev)',
                        borderBottom: '1px solid var(--brd-sub)',
                      }}
                    >
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest truncate"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        {g.label}
                      </span>
                      {g.projectId && (
                        <button
                          onClick={() =>
                            addMute({ type: 'project', id: g.projectId, label: g.label })
                          }
                          className="ml-auto opacity-0 group-hover/head:opacity-100 transition-opacity"
                          style={{ color: 'var(--txt-3)' }}
                          title={`Couper les notifications du projet ${g.label}`}
                        >
                          <BellOff className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {g.items.map((n) => renderItem(n))}
                  </div>
                ))
              : notifications.map((n) => renderItem(n))}
          </div>
        </div>,
          document.body,
        )}

      {settingsOpen &&
        createPortal(<NotifSettingsModal onClose={() => setSettingsOpen(false)} />, document.body)}
    </>
  )
}

// ─── Réglages : opt-out devis (user) + délais de relance (org, admins) ────────

const ORG_KEYS = [
  { key: 'devis_relance_non_ouvert_jours', label: 'Relance si jamais ouvert après (jours)', def: 5 },
  { key: 'devis_relance_sans_reponse_jours', label: 'Relance si sans réponse après (jours)', def: 10 },
  { key: 'devis_relance_intervalle_jours', label: 'Re-proposition au plus tous les (jours)', def: 7 },
]

// Catégories de notifications devis (user_settings.notif_prefs, défaut activé)
const DEVIS_PREFS = [
  { key: 'devis_consultations', label: 'Consultations', hint: 'Le client ouvre le devis' },
  { key: 'devis_relances', label: 'Relances et expirations', hint: 'Suggestions de relance, offre qui expire' },
  { key: 'devis_decisions', label: 'Acceptations et refus', hint: 'Le client accepte, signe ou refuse' },
  { key: 'devis_modifications', label: 'Modifications', hint: 'Un membre modifie un devis que vous avez créé ou envoyé' },
]

// Catégories de notifications plans éditables (même mécanique)
const PLANS_PREFS = [
  { key: 'plans_commentaires', label: 'Commentaires', hint: 'Un destinataire du lien de partage annote le plan' },
  { key: 'plans_validations', label: 'Validations', hint: 'Un destinataire valide le plan' },
]

function NotifSettingsModal({ onClose }) {
  const { user, profile, org } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [prefs, setPrefs] = useState({}) // notif_prefs jsonb ; absence de clé = activé
  const [orgValues, setOrgValues] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    async function loadSettings() {
      if (user?.id) {
        const { data } = await supabase
          .from('user_settings')
          .select('notif_prefs')
          .eq('user_id', user.id)
          .maybeSingle()
        if (alive && data?.notif_prefs) setPrefs(data.notif_prefs)
      }
      if (isAdmin && org?.id) {
        const { data } = await supabase
          .from('org_settings')
          .select('key, value')
          .eq('org_id', org.id)
          .in('key', ORG_KEYS.map((k) => k.key))
        if (alive && data) {
          const vals = {}
          for (const r of data) vals[r.key] = r.value
          setOrgValues(vals)
        }
      }
    }
    loadSettings()
    return () => {
      alive = false
    }
  }, [user?.id, isAdmin, org?.id])

  async function save() {
    setSaving(true)
    try {
      if (user?.id) {
        await supabase
          .from('user_settings')
          .upsert({ user_id: user.id, notif_prefs: prefs }, { onConflict: 'user_id' })
      }
      if (isAdmin && org?.id) {
        const rows = ORG_KEYS.filter((k) => orgValues[k.key] !== undefined && orgValues[k.key] !== '')
          .map((k) => ({
            org_id: org.id,
            key: k.key,
            value: String(parseInt(orgValues[k.key], 10) || k.def),
            updated_at: new Date().toISOString(),
          }))
        if (rows.length) await supabase.from('org_settings').upsert(rows, { onConflict: 'org_id,key' })
      }
      notify.success('Réglages enregistrés')
      onClose()
    } catch (err) {
      console.error('[NotifSettings]', err)
      notify.error('Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.55)', zIndex: 1001 }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-5 mx-4"
        style={{
          width: '420px',
          maxWidth: '100%',
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          boxShadow: '0 16px 48px rgba(0,0,0,.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--txt)' }}>
          Réglages des notifications
        </h3>

        <div className="mb-4">
          <p
            className="text-[10px] font-bold uppercase tracking-widest mb-2"
            style={{ color: 'var(--txt-3)' }}
          >
            Devis
          </p>
          <div className="flex flex-col gap-2.5">
            {DEVIS_PREFS.map((p) => (
              <label
                key={p.key}
                className="flex items-center justify-between gap-3 cursor-pointer"
              >
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--txt)' }}>
                    {p.label}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                    {p.hint}
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={prefs[p.key] !== false}
                  onChange={(e) => setPrefs((prev) => ({ ...prev, [p.key]: e.target.checked }))}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <p
            className="text-[10px] font-bold uppercase tracking-widest mb-2"
            style={{ color: 'var(--txt-3)' }}
          >
            Plans
          </p>
          <div className="flex flex-col gap-2.5">
            {PLANS_PREFS.map((p) => (
              <label
                key={p.key}
                className="flex items-center justify-between gap-3 cursor-pointer"
              >
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--txt)' }}>
                    {p.label}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                    {p.hint}
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={prefs[p.key] !== false}
                  onChange={(e) => setPrefs((prev) => ({ ...prev, [p.key]: e.target.checked }))}
                />
              </label>
            ))}
          </div>
        </div>

        {Array.isArray(prefs.mutes) && prefs.mutes.length > 0 && (
          <div className="mb-4">
            <p
              className="text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: 'var(--txt-3)' }}
            >
              Sourdines
            </p>
            <div className="flex flex-col gap-1.5">
              {prefs.mutes.map((m) => (
                <div key={`${m.type}:${m.id}`} className="flex items-center gap-2">
                  <BellOff className="w-3 h-3 shrink-0" style={{ color: 'var(--txt-3)' }} />
                  <span className="text-xs truncate flex-1" style={{ color: 'var(--txt-2)' }}>
                    {m.label || m.id}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{
                      color: 'var(--txt-3)',
                      background: 'rgba(255,255,255,.06)',
                      border: '1px solid var(--brd)',
                    }}
                  >
                    {m.type === 'project' ? 'Projet' : 'Devis'}
                  </span>
                  <button
                    onClick={() =>
                      setPrefs((prev) => ({
                        ...prev,
                        mutes: (prev.mutes || []).filter(
                          (x) => !(x.type === m.type && x.id === m.id),
                        ),
                      }))
                    }
                    style={{ color: 'var(--txt-3)' }}
                    title="Réactiver les notifications"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="mb-4">
            <p
              className="text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: 'var(--txt-3)' }}
            >
              Relances devis (organisation)
            </p>
            <div className="flex flex-col gap-2">
              {ORG_KEYS.map((k) => (
                <label key={k.key} className="flex items-center justify-between gap-3">
                  <span className="text-xs" style={{ color: 'var(--txt-2)' }}>
                    {k.label}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={orgValues[k.key] ?? k.def}
                    onChange={(e) => setOrgValues((p) => ({ ...p, [k.key]: e.target.value }))}
                    className="w-16 px-2 py-1 rounded text-xs text-right outline-none"
                    style={{
                      background: 'rgba(255,255,255,.05)',
                      border: '1px solid var(--brd)',
                      color: 'var(--txt)',
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost btn-sm">
            Annuler
          </button>
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}
