// ════════════════════════════════════════════════════════════════════════════
// DashboardView — Tableau de bord du module Musiques (MUS-5.3)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue agrégée du processus de sélection musicale du projet :
//   1. Cartes KPI : Total · À traiter · Accordés · Refusés
//   2. Distribution par statut : barres horizontales colorées + counts
//   3. Top tags du projet (top 8 par occurrence)
//   4. Top contributeurs (qui propose le plus / qui note le plus)
//   5. Top notées (top 5 propositions par note moyenne)
//
// Pas de migration ni RPC — tout est calculé côté front depuis le state
// (propositions + aggregates) via useMemo. Pas de lib chart, pur CSS bars
// + pattern Tailwind aligné Livrables Dashboard.
//
// Props :
//   - propositions   : Array (BRUTES, pas filtrées — totaux projet)
//   - aggregates     : Map<propId, { noteAvg, noteCount, myNote, tags }>
//   - onOpenDetail(p): ouvre le drawer détail
//   - onClickStatut(s): bascule en vue liste avec filtre statut
//
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'
import {
  Inbox,
  Clock,
  CheckCircle2,
  XCircle,
  Tag as TagIcon,
  Users,
  Star,
} from 'lucide-react'
import { STATUTS, STATUT_LABELS, STATUT_COLORS } from '../../lib/musiques'

export default function DashboardView({
  propositions = [],
  aggregates,
  onOpenDetail,
  onClickStatut,
}) {
  // ─── Compteurs par statut ────────────────────────────────────────────────
  const statutCounts = useMemo(() => {
    const c = { total: propositions.length }
    for (const s of STATUTS) c[s] = 0
    for (const p of propositions) {
      if (p.statut in c) c[p.statut] += 1
    }
    return c
  }, [propositions])

  // "À traiter" = tout sauf accordé + refusé (les terminaux)
  const aTraiter =
    statutCounts.vrac +
    statutCounts.selectionne +
    statutCounts.valide_festival +
    statutCounts.en_nego
  const decided = statutCounts.accorde + statutCounts.refuse
  const tauxAccord =
    decided > 0
      ? Math.round((statutCounts.accorde / decided) * 100)
      : null

  // ─── Top tags ────────────────────────────────────────────────────────────
  const topTags = useMemo(() => {
    const tagCount = new Map()
    for (const p of propositions) {
      const tags = aggregates.get(p.id)?.tags || []
      const seen = new Set()
      for (const t of tags) {
        // Compter chaque tag UNE FOIS par proposition (peu importe qui l'a posé)
        if (seen.has(t.tag)) continue
        seen.add(t.tag)
        tagCount.set(t.tag, (tagCount.get(t.tag) || 0) + 1)
      }
    }
    return [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
  }, [propositions, aggregates])

  // ─── Top contributeurs (qui propose le plus) ─────────────────────────────
  const topProposeurs = useMemo(() => {
    const byUser = new Map()
    for (const p of propositions) {
      const uid = p.proposer_id || '__none__'
      const name =
        p.proposer?.full_name ||
        p.proposer?.email?.split('@')[0] ||
        'Inconnu'
      const entry = byUser.get(uid) || { count: 0, name }
      entry.count += 1
      byUser.set(uid, entry)
    }
    return [...byUser.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [propositions])

  // ─── Top notées ──────────────────────────────────────────────────────────
  const topNotees = useMemo(() => {
    const withNotes = propositions
      .map((p) => ({
        p,
        agg: aggregates.get(p.id),
      }))
      .filter(({ agg }) => (agg?.noteCount || 0) >= 2 && agg?.noteAvg != null)
    return withNotes
      .sort((a, b) => {
        if (b.agg.noteAvg !== a.agg.noteAvg) return b.agg.noteAvg - a.agg.noteAvg
        return b.agg.noteCount - a.agg.noteCount
      })
      .slice(0, 5)
  }, [propositions, aggregates])

  if (propositions.length === 0) {
    return (
      <div
        style={{
          padding: '40px 12px',
          textAlign: 'center',
          color: 'var(--txt-3)',
          fontSize: 13,
        }}
      >
        Aucune proposition pour le moment. Le dashboard se peuplera une fois
        que tu auras ajouté des propositions.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ─── KPI cards ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <KPICard
          icon={Inbox}
          label="Total"
          value={statutCounts.total}
          color="var(--txt-2)"
        />
        <KPICard
          icon={Clock}
          label="À traiter"
          value={aTraiter}
          color="var(--blue, #3B82F6)"
          subtitle={
            statutCounts.vrac > 0
              ? `${statutCounts.vrac} en vrac`
              : undefined
          }
        />
        <KPICard
          icon={CheckCircle2}
          label="Accordés"
          value={statutCounts.accorde}
          color="#16A34A"
          subtitle={
            tauxAccord != null
              ? `${tauxAccord}% taux d'accord`
              : undefined
          }
        />
        <KPICard
          icon={XCircle}
          label="Refusés"
          value={statutCounts.refuse}
          color={statutCounts.refuse > 0 ? '#EF4444' : 'var(--txt-3)'}
        />
      </div>

      {/* ─── Distribution par statut (barres) ────────────────────────── */}
      <Section title="Répartition par statut">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {STATUTS.map((s) => {
            const v = statutCounts[s]
            const pct =
              statutCounts.total > 0
                ? Math.round((v / statutCounts.total) * 100)
                : 0
            const palette = STATUT_COLORS[s] || {
              bg: 'var(--bg-elev)',
              fg: 'var(--txt-3)',
            }
            return (
              <button
                key={s}
                type="button"
                onClick={() => v > 0 && onClickStatut?.(s)}
                disabled={v === 0}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr 40px',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: v > 0 ? 'pointer' : 'default',
                  borderRadius: 4,
                  opacity: v === 0 ? 0.5 : 1,
                  transition: 'background 80ms',
                }}
                onMouseEnter={(e) => {
                  if (v > 0) e.currentTarget.style.background = 'var(--bg-elev)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
                title={
                  v > 0 ? `Filtrer la liste sur ${STATUT_LABELS[s]}` : undefined
                }
              >
                <span
                  style={{
                    fontSize: 11,
                    color: palette.fg,
                    fontWeight: 500,
                  }}
                >
                  {STATUT_LABELS[s]}
                </span>
                <div
                  style={{
                    height: 8,
                    background: 'var(--bg-elev)',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: palette.fg,
                      opacity: 0.85,
                      transition: 'width 250ms',
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--txt-2)',
                    fontVariantNumeric: 'tabular-nums',
                    textAlign: 'right',
                  }}
                >
                  {v}
                </span>
              </button>
            )
          })}
        </div>
      </Section>

      {/* ─── Top tags + Contributeurs en grid 2-col ──────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 10,
        }}
      >
        <Section
          title="Tags les plus utilisés"
          icon={TagIcon}
          empty={topTags.length === 0 ? 'Aucun tag posé' : null}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {topTags.map(([tag, count]) => (
              <span
                key={tag}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 10,
                  fontSize: 11,
                  color: 'var(--txt-2)',
                }}
              >
                {tag}
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--txt-3)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  ×{count}
                </span>
              </span>
            ))}
          </div>
        </Section>

        <Section
          title="Plus actifs (propositions)"
          icon={Users}
          empty={topProposeurs.length === 0 ? 'Aucune proposition' : null}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topProposeurs.map((u, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 60px 30px',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    color: 'var(--txt-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {u.name}
                </span>
                <div
                  style={{
                    height: 6,
                    background: 'var(--bg-elev)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width:
                        topProposeurs[0]?.count > 0
                          ? `${(u.count / topProposeurs[0].count) * 100}%`
                          : '0%',
                      height: '100%',
                      background: 'var(--blue, #3B82F6)',
                      opacity: 0.75,
                    }}
                  />
                </div>
                <span
                  style={{
                    color: 'var(--txt-3)',
                    fontVariantNumeric: 'tabular-nums',
                    textAlign: 'right',
                  }}
                >
                  {u.count}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ─── Top notées ──────────────────────────────────────────────── */}
      <Section
        title="Mieux notées du projet"
        icon={Star}
        empty={
          topNotees.length === 0
            ? 'Aucune proposition avec au moins 2 notes'
            : null
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {topNotees.map(({ p, agg }) => {
            const artistName = p.artiste?.nom || p.artiste_text || '—'
            const palette = STATUT_COLORS[p.statut] || {
              bg: 'var(--bg-elev)',
              fg: 'var(--txt-3)',
            }
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenDetail?.(p)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr 80px 70px',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderRadius: 4,
                  transition: 'background 80ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-elev)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 4,
                    background: p.cover_url
                      ? 'transparent'
                      : 'var(--bg-elev)',
                    backgroundImage: p.cover_url
                      ? `url(${p.cover_url})`
                      : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--txt)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{artistName}</span>
                  <span style={{ color: 'var(--txt-3)' }}> · {p.titre}</span>
                </span>
                <span
                  style={{
                    fontSize: 9,
                    padding: '1px 6px',
                    background: palette.bg,
                    color: palette.fg,
                    borderRadius: 6,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    textAlign: 'center',
                  }}
                >
                  {STATUT_LABELS[p.statut]}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: '#D97706',
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    justifyContent: 'flex-end',
                  }}
                >
                  <Star
                    size={10}
                    style={{ fill: '#D97706', color: '#D97706' }}
                  />
                  {Math.round(agg.noteAvg * 10) / 10}
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--txt-3)',
                      fontWeight: 400,
                    }}
                  >
                    ·{agg.noteCount}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

// ─── KPICard : carte KPI compacte ────────────────────────────────────────
function KPICard({ icon: Icon, label, value, color, subtitle }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10,
          color: 'var(--txt-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.8,
        }}
      >
        {Icon && <Icon size={11} style={{ color }} />}
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          color,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 10, color: 'var(--txt-3)' }}>{subtitle}</div>
      )}
    </div>
  )
}

// ─── Section : wrapper avec titre ────────────────────────────────────────
function Section({ title, icon: Icon, empty, children }) {
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--txt-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          marginBottom: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {Icon && <Icon size={11} />}
        {title}
      </div>
      {empty ? (
        <div
          style={{
            fontSize: 11,
            color: 'var(--txt-3)',
            fontStyle: 'italic',
          }}
        >
          {empty}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
