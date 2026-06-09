// ════════════════════════════════════════════════════════════════════════════
// Card — Rendu d'une carte Moodboard (MOD-1.5)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche une carte selon son type :
//   link  : OG card (hero image + titre + URL domain). Si oembed_html
//           présent → bouton "Lire" qui inject l'embed à la demande.
//   image : image plein cadre (object-fit cover)
//   video : <video> avec controls + poster
//   note  : aperçu texte (extrait du Tiptap JSON)
//
// Hover : overlay avec count commentaires + réactions + actions rapides.
// Click sur le corps → ouvre le drawer (props.onOpen).
//
// Drag-drop : props onDragStart / onDragEnd pour intégration au parent.
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  Play,
  Pause,
  ExternalLink,
  MessageCircle,
  GripVertical,
  Trash2,
  Image as ImageIcon,
  Video as VideoIcon,
  StickyNote,
  Link as LinkIcon,
} from 'lucide-react'
import { REACTION_EMOJI } from '../../lib/moodboard'

// Couleurs par provider connu pour le badge dans le coin
const PROVIDER_COLORS = {
  youtube: '#FF0000',
  tiktok: '#000000',
  vimeo: '#1AB7EA',
  twitter: '#1DA1F2',
  instagram: '#E4405F',
}

const PROVIDER_LABELS = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  vimeo: 'Vimeo',
  twitter: 'X',
  instagram: 'Instagram',
}

export default function Card({
  card,
  comments = [],
  reactionAgg = null,
  canEdit = true,
  onOpen,
  onDelete,
  // Drag-drop (intégration parent Section)
  draggable = false,
  onDragStart,
  onDragEnd,
}) {
  const [hovered, setHovered] = useState(false)
  // 'embed' = injection de l'oembed_html dans la carte (mode "lire dedans")
  const [embedOpen, setEmbedOpen] = useState(false)

  const commentCount = comments.length
  const reactionEntries = useMemo(() => {
    if (!reactionAgg) return []
    return Object.entries(reactionAgg.counts)
      .filter(([, n]) => n > 0)
      .map(([emoji, n]) => ({ emoji, n }))
  }, [reactionAgg])

  const provider = card.provider || null
  const hasOembed = Boolean(card.oembed_html)
  const domain = (() => {
    try {
      return new URL(card.url || '').hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()

  function renderBody() {
    switch (card.type) {
      case 'link':
        return <LinkBody card={card} embedOpen={embedOpen} />
      case 'image':
        return <ImageBody card={card} />
      case 'video':
        return <VideoBody card={card} />
      case 'note':
        return <NoteBody card={card} />
      default:
        return (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--txt-3)' }}>
            Type inconnu : {card.type}
          </div>
        )
    }
  }

  return (
    <div
      draggable={draggable && canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        // Don't open drawer si on clique sur le bouton play embed
        if (e.target.closest('[data-no-open]')) return
        onOpen?.(card)
      }}
      style={{
        position: 'relative',
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        breakInside: 'avoid',
        marginBottom: 8,
        transition: 'border-color 120ms, box-shadow 120ms',
        boxShadow: hovered ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
        borderColor: hovered ? 'var(--brd)' : 'var(--brd-sub)',
      }}
    >
      {/* Grip handle (visible au hover) pour signaler le drag */}
      {draggable && canEdit && hovered && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            zIndex: 4,
            padding: 4,
            background: 'rgba(0,0,0,0.55)',
            borderRadius: 4,
            color: 'white',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
          title="Glisser pour réorganiser"
        >
          <GripVertical size={12} />
        </div>
      )}

      {/* Badge provider (link uniquement) */}
      {provider && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            zIndex: 4,
            padding: '2px 6px',
            background: PROVIDER_COLORS[provider] || '#666',
            color: 'white',
            fontSize: 9,
            fontWeight: 600,
            borderRadius: 3,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {PROVIDER_LABELS[provider] || provider}
        </div>
      )}

      {/* ─── Corps de la carte ─── */}
      {renderBody()}

      {/* ─── Pied : title + meta ─── */}
      <div style={{ padding: '8px 10px 10px' }}>
        {card.title && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--txt)',
              lineHeight: 1.3,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
            title={card.title}
          >
            {card.title}
          </div>
        )}
        {card.type === 'link' && domain && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--txt-3)',
              marginTop: 2,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <LinkIcon size={9} />
            {domain}
          </div>
        )}

        {/* Réactions + commentaires en bas */}
        {(commentCount > 0 || reactionEntries.length > 0) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 6,
              flexWrap: 'wrap',
            }}
          >
            {reactionEntries.map(({ emoji, n }) => (
              <span
                key={emoji}
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <span>{REACTION_EMOJI[emoji] || emoji}</span>
                <span style={{ color: 'var(--txt-3)' }}>{n}</span>
              </span>
            ))}
            {commentCount > 0 && (
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  background: 'var(--bg-elev)',
                  borderRadius: 10,
                  color: 'var(--txt-3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <MessageCircle size={10} />
                {commentCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ─── Hover actions (top-right de la zone media) ─── */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            right: provider ? 70 : 6, // décale si badge provider
            zIndex: 4,
            display: 'flex',
            gap: 4,
          }}
          data-no-open
        >
          {hasOembed && card.type === 'link' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setEmbedOpen((v) => !v)
              }}
              title={embedOpen ? 'Replier' : 'Lire dans la carte'}
              style={{
                width: 26,
                height: 26,
                padding: 0,
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(6px)',
              }}
            >
              {embedOpen ? <Pause size={12} /> : <Play size={12} />}
            </button>
          )}
          {card.type === 'link' && card.url && (
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Ouvrir l'original"
              style={{
                width: 26,
                height: 26,
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                borderRadius: 4,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(6px)',
              }}
            >
              <ExternalLink size={12} />
            </a>
          )}
          {canEdit && onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm('Supprimer cette carte ?')) onDelete(card)
              }}
              title="Supprimer"
              style={{
                width: 26,
                height: 26,
                padding: 0,
                background: 'rgba(239,68,68,0.85)',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(6px)',
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Bodies par type ────────────────────────────────────────────────────────

function LinkBody({ card, embedOpen }) {
  if (embedOpen && card.oembed_html) {
    // Aspect ratio adapté au provider : 9:16 pour Insta/TikTok (format
    // vertical) sinon 16:9 (YouTube, Vimeo, Twitter).
    const aspect =
      card.provider === 'instagram' || card.provider === 'tiktok'
        ? '9 / 16'
        : '16 / 9'
    return <OembedFrame html={card.oembed_html} aspectRatio={aspect} />
  }
  if (card.image_url) {
    return (
      <div
        style={{
          aspectRatio: '16/9',
          background: 'var(--bg-elev)',
          overflow: 'hidden',
        }}
      >
        <img
          src={card.image_url}
          alt={card.title || ''}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>
    )
  }
  // Pas d'image → placeholder gris avec icône
  return (
    <div
      style={{
        aspectRatio: '16/9',
        background: 'var(--bg-elev)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--txt-3)',
      }}
    >
      <LinkIcon size={28} />
    </div>
  )
}

function ImageBody({ card }) {
  if (!card.image_url) {
    return <PlaceholderBody icon={ImageIcon} label="Image manquante" />
  }
  return (
    <div style={{ background: 'var(--bg-elev)', overflow: 'hidden' }}>
      <img
        src={card.image_url}
        alt={card.title || ''}
        loading="lazy"
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
        }}
      />
    </div>
  )
}

function VideoBody({ card }) {
  if (!card.image_url) {
    return <PlaceholderBody icon={VideoIcon} label="Vidéo manquante" />
  }
  return (
    <div style={{ background: '#000' }}>
      <video
        src={card.image_url}
        controls
        preload="metadata"
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
        }}
      />
    </div>
  )
}

function NoteBody({ card }) {
  const preview = useMemo(() => extractTextFromTiptap(card.content_json), [card.content_json])
  return (
    <div
      style={{
        padding: '14px 14px 0',
        minHeight: 60,
        background:
          'linear-gradient(135deg, rgba(250,204,21,0.10), rgba(250,204,21,0.02))',
        borderBottom: '1px solid var(--brd-sub)',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          background: 'rgba(250,204,21,0.18)',
          color: '#A16207',
          borderRadius: 4,
          fontSize: 9,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 8,
        }}
      >
        <StickyNote size={10} />
        Note
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--txt-2)',
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 5,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          marginBottom: 10,
        }}
      >
        {preview || (
          <span style={{ color: 'var(--txt-3)', fontStyle: 'italic' }}>
            Note vide
          </span>
        )}
      </div>
    </div>
  )
}

// Exporté pour réutilisation dans CardDrawer.
// OembedFrame — wrapper qui force l'iframe à 100% de son container.
// Nécessaire parce que les providers oEmbed (notamment YouTube) renvoient
// des iframes avec des attributs width/height fixes (200x113) qui priment
// sur le CSS. On les override en JS imperatively après injection.
export function OembedFrame({ html, aspectRatio = '16 / 9' }) {
  const wrapperRef = useRef(null)
  useEffect(() => {
    const iframe = wrapperRef.current?.querySelector('iframe')
    if (iframe) {
      iframe.removeAttribute('width')
      iframe.removeAttribute('height')
      iframe.style.width = '100%'
      iframe.style.height = '100%'
      iframe.style.border = '0'
    }
  }, [html])
  return (
    <div
      style={{
        aspectRatio,
        width: '100%',
        background: '#000',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        ref={wrapperRef}
        dangerouslySetInnerHTML={{ __html: html }}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  )
}

function PlaceholderBody({ icon: Icon, label }) {
  return (
    <div
      style={{
        aspectRatio: '4/3',
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        color: 'var(--txt-3)',
      }}
    >
      {Icon && <Icon size={28} />}
      <div style={{ fontSize: 11 }}>{label}</div>
    </div>
  )
}

// ─── Helper : extrait du texte plat depuis un doc Tiptap JSON ──────────────
function extractTextFromTiptap(json) {
  if (!json) return ''
  let out = ''
  function walk(node) {
    if (!node) return
    if (node.type === 'text' && typeof node.text === 'string') {
      out += node.text
      return
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child)
      if (node.type === 'paragraph' || node.type === 'heading') out += '\n'
    }
  }
  walk(json)
  return out.trim()
}

