// ════════════════════════════════════════════════════════════════════════════
// PipelineView — Vue Kanban des propositions musicales (MUS-5.2)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche les propositions en colonnes par statut (vrac → refusé).
// Drag-drop d'une card entre colonnes = change le statut (setStatut +
// optimistic UI via refetch parent).
//
// Pattern HTML5 DnD natif (cohérent avec MUS-3.5 sur la liste vrac).
// Pas de réordonnancement dans la colonne (pour V1) — l'ordre interne
// est trié par note moyenne desc + created_at desc.
//
// Props :
//   - propositions   : Array (filtrées par MusiquesTab)
//   - aggregates     : Map<propId, { noteAvg, noteCount, myNote, tags, commentCount }>
//   - canEdit        : si false, pas de drag
//   - currentUserId  : pour highlight personnel éventuel
//   - onMutated()    : appelé après setStatut pour refetch
//   - onOpenDetail(p): ouvre le drawer détail
//
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
import {
  Youtube,
  Star,
  MessageCircle,
} from 'lucide-react'
import {
  STATUTS,
  STATUT_LABELS,
  STATUT_COLORS,
  setStatut,
} from '../../lib/musiques'
import { notify } from '../../lib/notify'

export default function PipelineView({
  propositions,
  aggregates,
  canEdit = true,
  onMutated,
  onOpenDetail,
}) {
  const [draggingId, setDraggingId] = useState(null)
  const [hoverColumn, setHoverColumn] = useState(null)

  // Group by statut, trier dans chaque colonne par note desc puis date desc
  const byStatut = useMemo(() => {
    const groups = new Map(STATUTS.map((s) => [s, []]))
    for (const p of propositions) {
      const arr = groups.get(p.statut)
      if (arr) arr.push(p)
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => {
        const aAvg = aggregates.get(a.id)?.noteAvg ?? -1
        const bAvg = aggregates.get(b.id)?.noteAvg ?? -1
        if (bAvg !== aAvg) return bAvg - aAvg
        return new Date(b.created_at) - new Date(a.created_at)
      })
    }
    return groups
  }, [propositions, aggregates])

  async function handleDrop(targetStatut, propId) {
    setDraggingId(null)
    setHoverColumn(null)
    if (!propId || !canEdit) return
    const prop = propositions.find((p) => p.id === propId)
    if (!prop || prop.statut === targetStatut) return
    try {
      await setStatut(propId, targetStatut)
      onMutated?.()
    } catch (e) {
      console.warn('[Pipeline] setStatut failed', e)
      notify.error(e?.message || 'Changement de statut impossible')
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        // 6 colonnes égales sur desktop. Sur mobile/tablette → grid auto-fit
        // pour scrollage horizontal naturel.
        gridTemplateColumns: 'repeat(6, minmax(220px, 1fr))',
        gap: 10,
        overflowX: 'auto',
        paddingBottom: 4,
      }}
    >
      {STATUTS.map((s) => (
        <Column
          key={s}
          statut={s}
          items={byStatut.get(s) || []}
          aggregates={aggregates}
          canEdit={canEdit}
          isDragHover={hoverColumn === s}
          onDragOver={(e) => {
            if (!canEdit || !draggingId) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setHoverColumn(s)
          }}
          onDragLeave={() => {
            if (hoverColumn === s) setHoverColumn(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            const id = e.dataTransfer.getData('text/plain') || draggingId
            handleDrop(s, id)
          }}
          onCardDragStart={(p) => setDraggingId(p.id)}
          onCardDragEnd={() => {
            setDraggingId(null)
            setHoverColumn(null)
          }}
          onCardClick={(p) => onOpenDetail?.(p)}
        />
      ))}
    </div>
  )
}

// ─── Column : 1 colonne de statut ─────────────────────────────────────────
function Column({
  statut,
  items,
  aggregates,
  canEdit,
  isDragHover,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  onCardClick,
}) {
  const palette = STATUT_COLORS[statut] || {
    bg: 'var(--bg-elev)',
    fg: 'var(--txt-3)',
  }
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: isDragHover
          ? `linear-gradient(180deg, ${palette.bg}, var(--bg-surf))`
          : 'var(--bg-surf)',
        border: `1px solid ${
          isDragHover ? palette.fg : 'var(--brd-sub)'
        }`,
        borderRadius: 8,
        minWidth: 220,
        minHeight: 200,
        transition: 'border-color 80ms, background 80ms',
      }}
    >
      {/* Header colonne */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--brd-sub)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            padding: '2px 7px',
            background: palette.bg,
            color: palette.fg,
            borderRadius: 6,
          }}
        >
          {STATUT_LABELS[statut] || statut}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--txt-3)',
            marginLeft: 'auto',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {items.length}
        </span>
      </div>

      {/* Cards */}
      <div
        style={{
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          minHeight: 80,
        }}
      >
        {items.length === 0 ? (
          <div
            style={{
              fontSize: 11,
              color: 'var(--txt-3)',
              fontStyle: 'italic',
              padding: '14px 6px',
              textAlign: 'center',
            }}
          >
            {isDragHover ? `→ ${STATUT_LABELS[statut]}` : '—'}
          </div>
        ) : (
          items.map((p) => (
            <Card
              key={p.id}
              proposition={p}
              aggregate={aggregates.get(p.id)}
              canEdit={canEdit}
              onDragStart={() => onCardDragStart(p)}
              onDragEnd={onCardDragEnd}
              onClick={() => onCardClick(p)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Card : card compacte d'une proposition ──────────────────────────────
function Card({
  proposition: p,
  aggregate,
  canEdit,
  onDragStart,
  onDragEnd,
  onClick,
}) {
  const [hovered, setHovered] = useState(false)
  const agg = aggregate || { noteAvg: null, noteCount: 0, tags: [] }
  const artistName = p.artiste?.nom || p.artiste_text || '—'
  const bpm = p.audio_features?.tempo > 0 ? Math.round(p.audio_features.tempo) : null

  return (
    <div
      draggable={canEdit}
      onDragStart={(e) => {
        if (!canEdit) return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', p.id)
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        // Ne pas trigger sur les boutons enfants
        if (e.target.closest('button')) return
        onClick?.()
      }}
      style={{
        padding: 6,
        background: hovered ? 'var(--bg-elev)' : 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 6,
        cursor: canEdit ? 'grab' : 'pointer',
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        transition: 'background 80ms',
      }}
      title={canEdit ? 'Glisser vers une autre colonne pour changer le statut' : undefined}
    >
      {/* Cover */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 4,
          background: p.cover_url ? 'transparent' : 'var(--bg-elev)',
          backgroundImage: p.cover_url ? `url(${p.cover_url})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          flexShrink: 0,
        }}
      />

      {/* Titre + artiste */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--txt)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {p.titre || '—'}
        </div>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {artistName}
          {bpm && (
            <span style={{ marginLeft: 4, color: '#D97706' }}>· {bpm} BPM</span>
          )}
        </div>
      </div>

      {/* Note + comments + youtube */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 2,
          flexShrink: 0,
        }}
      >
        {agg.noteCount > 0 ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              fontSize: 10,
              fontWeight: 500,
              color: '#D97706',
            }}
            title={`Moyenne ${Math.round((agg.noteAvg || 0) * 10) / 10}/5 · ${agg.noteCount} vote${agg.noteCount > 1 ? 's' : ''}`}
          >
            <Star size={9} style={{ fill: '#D97706', color: '#D97706' }} />
            {Math.round((agg.noteAvg || 0) * 10) / 10}
            <span style={{ color: 'var(--txt-3)', fontWeight: 400 }}>
              ·{agg.noteCount}
            </span>
          </span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>—</span>
        )}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {agg.commentCount > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                fontSize: 9,
                color: 'var(--txt-3)',
              }}
              title={`${agg.commentCount} commentaire${agg.commentCount > 1 ? 's' : ''}`}
            >
              <MessageCircle size={9} />
              {agg.commentCount}
            </span>
          )}
          {p.lien_youtube && (
            <a
              href={p.lien_youtube}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: '#FF0000',
                display: 'inline-flex',
                opacity: 0.7,
              }}
              title="Ouvrir sur YouTube"
            >
              <Youtube size={11} />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
