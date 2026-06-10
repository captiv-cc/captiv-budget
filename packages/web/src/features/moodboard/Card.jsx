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
import { confirm } from '../../lib/confirm'
import UserAvatar, { userDisplayName } from './UserAvatar'

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
  tags = [],
  canEdit = true,
  onOpen,
  onDelete,
  onTagClick,
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

        {/* Tags chips (cliquables → filtrent au niveau page) */}
        {tags.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 3,
              marginTop: 5,
            }}
          >
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onTagClick?.(t.tag)
                }}
                title={`Filtrer par tag "${t.tag}"`}
                style={{
                  fontSize: 9,
                  padding: '1px 5px',
                  background: 'rgba(99,102,241,0.10)',
                  color: 'var(--indigo, #6366F1)',
                  border: '1px solid rgba(99,102,241,0.25)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                {t.tag}
              </button>
            ))}
          </div>
        )}

        {/* Bottom row : réactions + commentaires (à gauche) + avatar créateur (à droite) */}
        {(commentCount > 0 ||
          reactionEntries.length > 0 ||
          card.creator) && (
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
            {/* Avatar créateur poussé à droite */}
            {card.creator && (
              <div style={{ marginLeft: 'auto', opacity: 0.85 }}>
                <UserAvatar
                  user={card.creator}
                  size={16}
                  title={`Ajouté par ${userDisplayName(card.creator)}`}
                />
              </div>
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
              onClick={async (e) => {
                e.stopPropagation()
                const ok = await confirm({
                  title: 'Supprimer la carte',
                  message: 'Cette carte sera supprimée définitivement (avec ses commentaires et réactions).',
                  confirmLabel: 'Supprimer',
                  danger: true,
                })
                if (ok) onDelete(card)
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
    // Le script officiel d'Instagram/TikTok dimensionnera l'iframe
    // automatiquement (hauteur ~600-1200px selon le contenu). En in-grid
    // (masonry) ça peut être grand mais l'utilisateur a explicitement
    // cliqué pour "lire dans la carte".
    return <OembedFrame html={card.oembed_html} provider={card.provider} />
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
          <span
            style={{
              color: 'var(--txt-3)',
              fontStyle: 'italic',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            ✎ Clique pour écrire…
          </span>
        )}
      </div>
    </div>
  )
}

// Charge un script externe une seule fois (singleton). Retourne une
// Promise qui résout quand le script est prêt.
const _scriptPromises = new Map()
function loadScriptOnce(src) {
  if (_scriptPromises.has(src)) return _scriptPromises.get(src)
  const promise = new Promise((resolve, reject) => {
    // Vérifie s'il existe déjà dans le DOM
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve()
      else existing.addEventListener('load', resolve, { once: true })
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => {
      s.dataset.loaded = 'true'
      resolve()
    }
    s.onerror = reject
    document.body.appendChild(s)
  })
  _scriptPromises.set(src, promise)
  return promise
}

// Exporté pour réutilisation dans CardDrawer.
// OembedFrame — wrapper qui injecte le HTML d'embed et configure le bon
// runtime selon le provider.
//
// Important : on injecte le HTML *impératif* via innerHTML dans useEffect
// (pas via dangerouslySetInnerHTML) pour éviter les conflits avec les
// scripts officiels d'Instagram/TikTok qui modifient le DOM par-dessus
// React. Sans ça, on a observé des doubles rendus de l'iframe ou des
// chevauchements visuels.
//
// Providers à blockquote (Instagram, TikTok) :
//   Le HTML est un <blockquote> placeholder. On charge le script officiel
//   du provider (embed.js) puis on appelle Embeds.process() pour qu'il
//   transforme le blockquote en iframe avec hauteur auto-ajustée par
//   postMessage entre l'iframe Insta/TT et notre page.
//
// Providers à iframe direct (YouTube, Vimeo, Twitter) :
//   Le HTML est un iframe avec width/height fixes que les providers
//   imposent. On les retire imperatively et force 100% du container.
export function OembedFrame({
  html,
  provider = null,
  aspectRatio = '16 / 9',
  minHeight = null,
  maxWidth = null,
}) {
  const wrapperRef = useRef(null)
  useEffect(() => {
    const root = wrapperRef.current
    if (!root || !html) return

    // Injection impérative pour échapper à React. Si le HTML a déjà été
    // injecté (cas re-render avec même html), pas besoin de re-injecter
    // — le iframe transformé par embed.js est déjà en place.
    if (root.dataset.injected !== html) {
      root.innerHTML = html
      root.dataset.injected = html
    }

    if (provider === 'instagram') {
      loadScriptOnce('https://www.instagram.com/embed.js')
        .then(() => {
          if (window.instgrm?.Embeds?.process) {
            window.instgrm.Embeds.process()
          }
        })
        .catch((e) => console.warn('[OembedFrame] Instagram script KO', e))
      return
    }
    if (provider === 'tiktok') {
      loadScriptOnce('https://www.tiktok.com/embed.js').catch((e) =>
        console.warn('[OembedFrame] TikTok script KO', e),
      )
      return
    }
    // YouTube/Vimeo : iframe direct, force le sizing
    const iframe = root.querySelector('iframe')
    if (iframe) {
      iframe.removeAttribute('width')
      iframe.removeAttribute('height')
      iframe.style.width = '100%'
      iframe.style.height = '100%'
      iframe.style.border = '0'
    }
  }, [html, provider])

  const isOfficialScript = provider === 'instagram' || provider === 'tiktok'

  const containerStyle = isOfficialScript
    ? {
        // Bloc simple, centré via les inline styles du blockquote
        // (max-width baked in). Pas de flex pour éviter les conflits
        // de sizing avec le iframe inséré par embed.js.
        width: '100%',
        minHeight: minHeight || 540,
        overflow: 'hidden', // clippe toute fuite visuelle
      }
    : {
        aspectRatio,
        width: '100%',
        maxWidth: maxWidth || '100%',
        background: '#000',
        overflow: 'hidden',
        position: 'relative',
      }
  return (
    <div style={containerStyle}>
      <div
        ref={wrapperRef}
        style={{
          width: '100%',
          ...(isOfficialScript ? {} : { height: '100%' }),
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

