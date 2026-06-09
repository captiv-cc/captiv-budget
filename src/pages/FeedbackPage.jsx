// ════════════════════════════════════════════════════════════════════════════
// FeedbackPage — Page liste des tickets Retours / Idées (FBK-1.3)
// ════════════════════════════════════════════════════════════════════════════
//
// User : voit ses propres tickets (RLS-filtré)
// Admin/charge_prod : voit tous les tickets de l'équipe
//
// Filtres : type (bug/idée) + statut + recherche + masquer terminés
//
// Actions :
//   - Bouton "Nouveau retour" → CreateFeedbackModal
//   - Click sur une row → FeedbackDrawer
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Search,
  Bug,
  Lightbulb,
  MessageSquare,
  Inbox,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  listTickets,
  subscribeToFeedback,
  TYPE_LABELS,
  STATUS_LABELS,
  STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  TICKET_STATUSES,
  TICKET_TYPES,
} from '../lib/feedback'
import { useAuth } from '../contexts/AuthContext'
import CreateFeedbackModal from '../features/feedback/CreateFeedbackModal'
import FeedbackDrawer from '../features/feedback/FeedbackDrawer'
import UserAvatar, { userDisplayName } from '../features/moodboard/UserAvatar'

const ADMIN_ROLES = ['admin', 'charge_prod']

export default function FeedbackPage() {
  const { user, profile } = useAuth() || {}
  const role = profile?.role || 'coordinateur'
  const isAdmin = ADMIN_ROLES.includes(role)

  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filtres
  const [filterType, setFilterType] = useState(null)
  const [filterStatus, setFilterStatus] = useState(null)
  const [search, setSearch] = useState('')
  const [includeDone, setIncludeDone] = useState(false)

  // UI
  const [createOpen, setCreateOpen] = useState(false)
  const [drawerTicketId, setDrawerTicketId] = useState(null)

  // ─── Fetch initial ────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    try {
      setError(null)
      const data = await listTickets({ includeDone: true })
      setTickets(data)
    } catch (e) {
      console.warn('[FeedbackPage] fetch failed', e)
      setError(e?.message || 'Chargement KO')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  // ─── Realtime subscriptions ──────────────────────────────────────────
  useEffect(() => {
    const sub = subscribeToFeedback({
      onTicketChange: () => refetch(),
      onCommentChange: () => refetch(),
      onAttachmentChange: () => refetch(),
    })
    return () => sub.unsubscribe()
  }, [refetch])

  // ─── Filtrage local ──────────────────────────────────────────────────
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase()
    return tickets.filter((t) => {
      if (filterType && t.type !== filterType) return false
      if (filterStatus && t.status !== filterStatus) return false
      if (!includeDone && t.status === 'done') return false
      if (s) {
        const hay = `${t.title || ''} ${t.description || ''} ${t.category || ''} ${t.page || ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [tickets, filterType, filterStatus, search, includeDone])

  // ─── Compteurs ────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const byStatus = { proposed: 0, in_progress: 0, done: 0 }
    const byType = { bug: 0, idea: 0 }
    for (const t of tickets) {
      if (byStatus[t.status] !== undefined) byStatus[t.status] += 1
      if (byType[t.type] !== undefined) byType[t.type] += 1
    }
    return { byStatus, byType, total: tickets.length }
  }, [tickets])

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      {/* ─── Header ─── */}
      <div
        className="flex flex-col gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(245,158,11,0.15)' }}
          >
            <MessageSquare className="w-5 h-5" style={{ color: '#F59E0B' }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
              Retours / Idées
            </h1>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {isAdmin
                ? 'Tous les retours de l’équipe sur DESK'
                : 'Mes retours et idées d’amélioration'}
              {counts.total > 0 && (
                <>
                  {' '}· {counts.total} ticket{counts.total > 1 ? 's' : ''}
                  {counts.byStatus.proposed > 0 && (
                    <> · {counts.byStatus.proposed} en attente</>
                  )}
                </>
              )}
            </p>
          </div>

          {/* Stat pills */}
          <div className="flex items-center gap-2 flex-wrap ml-0 sm:ml-4">
            <StatPill
              label="Bugs"
              value={counts.byType.bug}
              icon={Bug}
              color="#EF4444"
              dim={counts.byType.bug === 0}
            />
            <StatPill
              label="Idées"
              value={counts.byType.idea}
              icon={Lightbulb}
              color="#A855F7"
              dim={counts.byType.idea === 0}
            />
            <StatPill
              label="En cours"
              value={counts.byStatus.in_progress}
              icon={Inbox}
              color="var(--blue, #3B82F6)"
              dim={counts.byStatus.in_progress === 0}
            />
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="sm:ml-auto"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'var(--blue, #3B82F6)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus size={12} />
            Nouveau retour
          </button>
        </div>

        {/* Filtres */}
        <div
          className="flex items-center gap-2 flex-wrap"
          style={{ fontSize: 12 }}
        >
          {/* Search */}
          <div
            className="flex items-center gap-2 px-2.5 rounded"
            style={{
              height: 28,
              minWidth: 220,
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
            }}
          >
            <Search size={12} style={{ color: 'var(--txt-3)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher titre, description, page…"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--txt)',
                fontSize: 12,
              }}
            />
          </div>

          {/* Type filter */}
          <FilterChip
            label="Type"
            value={filterType}
            options={[
              { key: null, label: 'Tous' },
              ...TICKET_TYPES.map((t) => ({ key: t, label: TYPE_LABELS[t] })),
            ]}
            onSelect={setFilterType}
          />

          {/* Status filter */}
          <FilterChip
            label="Statut"
            value={filterStatus}
            options={[
              { key: null, label: 'Tous' },
              ...TICKET_STATUSES.map((s) => ({
                key: s,
                label: STATUS_LABELS[s],
              })),
            ]}
            onSelect={setFilterStatus}
          />

          {/* Toggle terminés */}
          <button
            type="button"
            onClick={() => setIncludeDone((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              background: includeDone
                ? 'var(--bg-elev)'
                : 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd-sub)',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {includeDone ? <EyeOff size={11} /> : <Eye size={11} />}
            {includeDone ? 'Masquer terminés' : 'Afficher terminés'}
          </button>
        </div>
      </div>

      {/* ─── Body ─── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
        }}
      >
        {error && (
          <div
            style={{
              padding: 12,
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#EF4444',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {loading && (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--txt-3)',
              fontSize: 13,
            }}
          >
            Chargement des tickets…
          </div>
        )}

        {!loading && visible.length === 0 && (
          <EmptyState
            isAdmin={isAdmin}
            hasFilters={
              filterType ||
              filterStatus ||
              search.trim() ||
              tickets.length === 0
            }
            totalTickets={tickets.length}
            onCreate={() => setCreateOpen(true)}
          />
        )}

        {!loading && visible.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visible.map((t) => (
              <TicketRow
                key={t.id}
                ticket={t}
                showAuthor={isAdmin}
                onClick={() => setDrawerTicketId(t.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── Modale création ─── */}
      <CreateFeedbackModal
        open={createOpen}
        initialPage={window?.location?.pathname || ''}
        onClose={() => setCreateOpen(false)}
        onCreated={(ticket) => {
          setCreateOpen(false)
          setDrawerTicketId(ticket.id)
          refetch()
        }}
      />

      {/* ─── Drawer détail ─── */}
      <FeedbackDrawer
        open={Boolean(drawerTicketId)}
        ticketId={drawerTicketId}
        currentUserId={user?.id || null}
        isAdmin={isAdmin}
        onClose={() => setDrawerTicketId(null)}
        onMutated={refetch}
      />
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────

function StatPill({ label, value, icon: Icon, color, dim = false }) {
  return (
    <div
      className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full shrink-0"
      style={{
        background: `${color}1f`,
        color,
        border: `1px solid ${color}`,
        opacity: dim ? 0.5 : 1,
      }}
    >
      {Icon && <Icon className="w-3 h-3" />}
      <span className="tabular-nums">{value}</span>
      <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
        {label}
      </span>
    </div>
  )
}

function FilterChip({ label, value, options, onSelect }) {
  const selected = options.find((o) => o.key === value)
  const isActive = value !== null && value !== options[0]?.key
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          background: isActive
            ? 'var(--blue-bg, rgba(59,130,246,0.18))'
            : 'transparent',
          color: isActive ? 'var(--blue, #3B82F6)' : 'var(--txt-2)',
          border: `1px solid ${isActive ? 'var(--blue, #3B82F6)' : 'var(--brd-sub)'}`,
          borderRadius: 4,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {label}
        {isActive && selected && (
          <span
            style={{
              padding: '0 5px',
              background: 'var(--blue, #3B82F6)',
              color: 'white',
              borderRadius: 8,
              fontSize: 10,
            }}
          >
            {selected.label}
          </span>
        )}
        <span style={{ fontSize: 8 }}>▾</span>
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 2,
              zIndex: 11,
              minWidth: 140,
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              borderRadius: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              padding: 2,
            }}
          >
            {options.map((opt) => (
              <button
                key={opt.key || 'all'}
                type="button"
                onClick={() => {
                  onSelect(opt.key)
                  setOpen(false)
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '5px 10px',
                  background:
                    opt.key === value ? 'var(--bg-elev)' : 'transparent',
                  border: 'none',
                  color: 'var(--txt-2)',
                  fontSize: 11,
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderRadius: 3,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TicketRow({ ticket, showAuthor, onClick }) {
  const TypeIcon = ticket.type === 'bug' ? Bug : Lightbulb
  const typeColor = ticket.type === 'bug' ? '#EF4444' : '#A855F7'
  const stColors = STATUS_COLORS[ticket.status] || {}
  const prColors = PRIORITY_COLORS[ticket.priority] || {}

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'border-color 120ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--brd)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--brd-sub)'
      }}
    >
      {/* Type icon */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: `${typeColor}1f`,
          color: typeColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <TypeIcon size={14} />
      </div>

      {/* Title + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: 'var(--txt)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {ticket.title}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginTop: 2,
            fontSize: 11,
            color: 'var(--txt-3)',
          }}
        >
          {showAuthor && ticket.author && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <UserAvatar user={ticket.author} size={14} />
              {userDisplayName(ticket.author)}
            </span>
          )}
          {ticket.page && (
            <>
              <span>·</span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 200,
                }}
              >
                {ticket.page}
              </span>
            </>
          )}
          <span>·</span>
          <span>
            {new Date(ticket.created_at).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'short',
            })}
          </span>
        </div>
      </div>

      {/* Badges statut + priorité */}
      <span
        style={{
          fontSize: 10,
          padding: '2px 7px',
          background: prColors.bg,
          color: prColors.fg,
          borderRadius: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {PRIORITY_LABELS[ticket.priority]}
      </span>
      <span
        style={{
          fontSize: 10,
          padding: '2px 7px',
          background: stColors.bg,
          color: stColors.fg,
          borderRadius: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {STATUS_LABELS[ticket.status]}
      </span>
    </div>
  )
}

function EmptyState({ isAdmin, totalTickets, onCreate }) {
  if (totalTickets === 0) {
    return (
      <div
        style={{
          padding: '60px 12px',
          textAlign: 'center',
          color: 'var(--txt-3)',
          background: 'var(--bg-elev)',
          border: '1px dashed var(--brd-sub)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <MessageSquare size={32} style={{ opacity: 0.5 }} />
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--txt-2)' }}>
          {isAdmin
            ? 'Aucun retour pour le moment'
            : 'Tu n’as pas encore signalé de bug ou proposé d’idée'}
        </div>
        <div style={{ fontSize: 12, maxWidth: 420 }}>
          Cet outil est là pour récolter tes retours sur DESK. Signale les
          bugs que tu rencontres ou propose des améliorations à l’interface.
        </div>
        <button
          type="button"
          onClick={onCreate}
          style={{
            marginTop: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: 'var(--blue, #3B82F6)',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Plus size={12} />
          Premier retour
        </button>
      </div>
    )
  }
  return (
    <div
      style={{
        padding: 32,
        textAlign: 'center',
        color: 'var(--txt-3)',
        fontSize: 13,
      }}
    >
      Aucun ticket ne correspond aux filtres actifs.
    </div>
  )
}
