// ════════════════════════════════════════════════════════════════════════════
// CardDrawer — Détail d'une carte Moodboard (MOD-1.7)
// ════════════════════════════════════════════════════════════════════════════
//
// Modal centrée qui s'ouvre au click sur une carte. Affiche :
//   - Hero du média (image / video / link preview / note Tiptap éditable)
//   - Titre éditable inline
//   - Description éditable inline
//   - Métadonnées (créateur, date, URL source pour les liens)
//   - Barre de réactions emoji (4 boutons toggles)
//   - Fil de commentaires (avec ajout, suppression auteur)
//   - Bouton supprimer la carte (avec confirm)
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import {
  X,
  Trash2,
  ExternalLink,
  Send,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  updateCard,
  deleteCard,
  addComment,
  removeComment,
  toggleReaction,
  refreshLinkCard,
  REACTIONS,
  REACTION_EMOJI,
  REACTION_LABELS,
} from '../../lib/moodboard'
import { notify } from '../../lib/notify'
import { confirm } from '../../lib/confirm'
import RichEditor from '../../components/rich-editor'
import { OembedFrame } from './Card'

export default function CardDrawer({
  open,
  card,
  comments = [],
  reactionAgg = null,
  canEdit = true,
  currentUserId = null,
  onClose,
  onMutated,
}) {
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  // Reset draft quand on change de carte
  useEffect(() => {
    setDraft({})
    setNewComment('')
  }, [card?.id])

  if (!open || !card) return null

  // ─── Champs editables avec commit on blur ───────────────────────────────
  const titleValue = draft.title !== undefined ? draft.title : card.title || ''
  const descriptionValue =
    draft.description !== undefined
      ? draft.description
      : card.description || ''

  async function commitField(field) {
    const value = draft[field]
    if (value === undefined || value === card[field]) {
      setDraft((d) => {
        const n = { ...d }
        delete n[field]
        return n
      })
      return
    }
    setSaving(true)
    try {
      await updateCard(card.id, { [field]: value })
      onMutated?.()
      setDraft((d) => {
        const n = { ...d }
        delete n[field]
        return n
      })
    } catch (e) {
      notify.error(e?.message || 'Sauvegarde KO')
    } finally {
      setSaving(false)
    }
  }

  async function commitContentJson(json) {
    if (!canEdit) return
    setSaving(true)
    try {
      await updateCard(card.id, { content_json: json })
      onMutated?.()
    } catch (e) {
      notify.error(e?.message || 'Sauvegarde KO')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!canEdit) return
    const ok = await confirm({
      title: 'Supprimer la carte',
      message:
        'Cette carte sera supprimée définitivement (avec ses commentaires et réactions).',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      await deleteCard(card.id, { removeFile: true })
      notify.success('Carte supprimée', false)
      onMutated?.()
      onClose?.()
    } catch (e) {
      notify.error(e?.message || 'Suppression KO')
    } finally {
      setDeleting(false)
    }
  }

  async function handleAddComment() {
    const body = newComment.trim()
    if (!body) return
    setPostingComment(true)
    try {
      await addComment(card.id, body)
      setNewComment('')
      onMutated?.()
    } catch (e) {
      notify.error(e?.message || 'Impossible de poster')
    } finally {
      setPostingComment(false)
    }
  }

  async function handleRemoveComment(commentId) {
    const ok = await confirm({
      message: 'Supprimer ce commentaire ?',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await removeComment(commentId)
      onMutated?.()
    } catch (e) {
      notify.error(e?.message || 'Suppression KO')
    }
  }

  async function handleRefreshPreview() {
    if (!canEdit) return
    setRefreshing(true)
    try {
      await refreshLinkCard(card)
      notify.success('Preview rafraîchi', false)
      onMutated?.()
    } catch (e) {
      notify.error(e?.message || 'Rafraîchissement KO')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleToggleReaction(emoji) {
    if (!canEdit) return
    try {
      await toggleReaction(card.id, emoji)
      onMutated?.()
    } catch (e) {
      notify.error(e?.message || 'Réaction KO')
    }
  }

  const counts = reactionAgg?.counts || {
    thumbs_up: 0,
    heart: 0,
    fire: 0,
    zap: 0,
  }
  const mine = reactionAgg?.mine || new Set()

  return (
    <div
      onClick={() => !saving && !deleting && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 75,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ─── Header ─── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
            gap: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              padding: '2px 8px',
              background: typeBadgeBg(card.type),
              color: typeBadgeFg(card.type),
              borderRadius: 4,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
            }}
          >
            {card.type}
          </div>
          <div style={{ flex: 1 }} />
          {saving && (
            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--txt-3)' }} />
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving || deleting}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              display: 'inline-flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── Body scrollable ─── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* Hero média */}
          <HeroMedia card={card} />

          {/* Titre + URL source */}
          <div>
            <FieldLabel>Titre</FieldLabel>
            <input
              type="text"
              value={titleValue}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              onBlur={() => commitField('title')}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder="Titre de la carte…"
              disabled={!canEdit || saving}
              style={inputStyle()}
            />
            {card.type === 'link' && card.url && (
              <a
                href={card.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 11,
                  color: 'var(--blue, #3B82F6)',
                  marginTop: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <ExternalLink size={11} />
                {card.url.length > 60
                  ? card.url.slice(0, 57) + '…'
                  : card.url}
              </a>
            )}
          </div>

          {/* Description (non applicable pour note — la note a son propre éditeur) */}
          {card.type !== 'note' && (
            <div>
              <FieldLabel>Description</FieldLabel>
              <textarea
                value={descriptionValue}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                onBlur={() => commitField('description')}
                placeholder="Pourquoi cette ref ? Contexte, intention…"
                disabled={!canEdit || saving}
                rows={2}
                style={{
                  ...inputStyle(),
                  resize: 'vertical',
                  minHeight: 40,
                }}
              />
            </div>
          )}

          {/* Note : éditeur Tiptap */}
          {card.type === 'note' && (
            <div>
              <FieldLabel>Contenu</FieldLabel>
              <div
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                <RichEditor
                  value={card.content_json}
                  onChange={commitContentJson}
                  readOnly={!canEdit}
                  placeholder="Saisis ta note…"
                  minHeight={120}
                />
              </div>
            </div>
          )}

          {/* ─── Réactions ─── */}
          <div>
            <FieldLabel>Réactions</FieldLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {REACTIONS.map((emoji) => {
                const active = mine.has(emoji)
                const count = counts[emoji] || 0
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleToggleReaction(emoji)}
                    disabled={!canEdit}
                    title={REACTION_LABELS[emoji]}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      background: active
                        ? 'rgba(59,130,246,0.18)'
                        : 'var(--bg-elev)',
                      border: `1px solid ${
                        active ? 'var(--blue, #3B82F6)' : 'var(--brd-sub)'
                      }`,
                      borderRadius: 16,
                      cursor: canEdit ? 'pointer' : 'default',
                      color: active
                        ? 'var(--blue, #3B82F6)'
                        : 'var(--txt-2)',
                      fontSize: 13,
                      transition: 'all 80ms',
                    }}
                  >
                    <span style={{ fontSize: 14 }}>
                      {REACTION_EMOJI[emoji]}
                    </span>
                    {count > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 600 }}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ─── Commentaires ─── */}
          <div>
            <FieldLabel>
              Commentaires
              {comments.length > 0 && (
                <span
                  style={{
                    fontWeight: 400,
                    color: 'var(--txt-3)',
                    marginLeft: 4,
                  }}
                >
                  ({comments.length})
                </span>
              )}
            </FieldLabel>

            {/* Liste des commentaires */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginBottom: 10,
              }}
            >
              {comments.length === 0 && (
                <div
                  style={{
                    padding: 8,
                    fontSize: 12,
                    color: 'var(--txt-3)',
                    fontStyle: 'italic',
                    textAlign: 'center',
                  }}
                >
                  Aucun commentaire pour le moment
                </div>
              )}
              {comments.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  currentUserId={currentUserId}
                  onRemove={() => handleRemoveComment(c.id)}
                />
              ))}
            </div>

            {/* Champ d'ajout */}
            {canEdit && (
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start',
                }}
              >
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleAddComment()
                    }
                  }}
                  placeholder="Commenter… (Cmd+Entrée pour envoyer)"
                  disabled={postingComment}
                  rows={2}
                  style={{
                    ...inputStyle(),
                    flex: 1,
                    resize: 'vertical',
                    minHeight: 40,
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || postingComment}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--blue, #3B82F6)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor:
                      !newComment.trim() || postingComment
                        ? 'not-allowed'
                        : 'pointer',
                    opacity: !newComment.trim() ? 0.5 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                  title="Poster (Cmd+Entrée)"
                >
                  {postingComment ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* ─── Meta + suppression ─── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 0 0',
              borderTop: '1px solid var(--brd-sub)',
              fontSize: 11,
              color: 'var(--txt-3)',
            }}
          >
            <CreatorInfo card={card} />
            <div style={{ flex: 1 }} />
            {canEdit && card.type === 'link' && (
              <button
                type="button"
                onClick={handleRefreshPreview}
                disabled={refreshing || saving}
                title="Re-fetch les metadata depuis l'URL source (utile après une mise à jour de l'Edge Function og-fetch)"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  background: 'transparent',
                  color: 'var(--txt-2)',
                  border: '1px solid var(--brd)',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: refreshing ? 'not-allowed' : 'pointer',
                  marginRight: 6,
                }}
              >
                {refreshing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                Rafraîchir le preview
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  background: 'transparent',
                  color: '#EF4444',
                  border: '1px solid rgba(239,68,68,0.4)',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                }}
              >
                {deleting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                Supprimer la carte
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function FieldLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: 'var(--txt-3)',
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  )
}

function inputStyle() {
  return {
    width: '100%',
    padding: '6px 10px',
    background: 'var(--bg-elev)',
    border: '1px solid var(--brd-sub)',
    color: 'var(--txt)',
    borderRadius: 4,
    fontSize: 13,
    outline: 'none',
  }
}

function HeroMedia({ card }) {
  if (card.type === 'image' && card.image_url) {
    return (
      <div
        style={{
          background: 'var(--bg-elev)',
          borderRadius: 6,
          overflow: 'hidden',
          maxHeight: 360,
        }}
      >
        <img
          src={card.image_url}
          alt={card.title || ''}
          style={{
            width: '100%',
            height: 'auto',
            objectFit: 'contain',
            display: 'block',
            maxHeight: 360,
          }}
        />
      </div>
    )
  }
  if (card.type === 'video' && card.image_url) {
    return (
      <div style={{ background: '#000', borderRadius: 6, overflow: 'hidden' }}>
        <video
          src={card.image_url}
          controls
          preload="metadata"
          style={{
            width: '100%',
            height: 'auto',
            maxHeight: 360,
            display: 'block',
          }}
        />
      </div>
    )
  }
  if (card.type === 'link' && card.oembed_html) {
    // Instagram & TikTok : on délègue le sizing au script officiel de
    // chaque provider (embed.js), chargé automatiquement par OembedFrame.
    // Ces scripts auto-resize l'iframe via postMessage selon le contenu
    // réel (caption + likes + commentaires). On garantit juste un
    // min-height pour éviter le flash de chargement.
    if (card.provider === 'instagram' || card.provider === 'tiktok') {
      return (
        <OembedFrame
          html={card.oembed_html}
          provider={card.provider}
          minHeight={600}
        />
      )
    }
    // YouTube, Vimeo, Twitter, autres : aspect-ratio 16:9 plein largeur
    return (
      <OembedFrame
        html={card.oembed_html}
        provider={card.provider}
        aspectRatio="16 / 9"
      />
    )
  }
  if (card.type === 'link' && card.image_url) {
    return (
      <div
        style={{
          aspectRatio: '16/9',
          background: 'var(--bg-elev)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <img
          src={card.image_url}
          alt={card.title || ''}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </div>
    )
  }
  // Note ou pas de média → on ne render rien (le RichEditor se charge du
  // contenu pour les notes, et les link sans preview montrent juste l'URL)
  return null
}

function CommentRow({ comment, currentUserId, onRemove }) {
  const isAuthor = comment.user_id === currentUserId
  const author = comment.author || null
  const displayName =
    author?.full_name || author?.email?.split('@')[0] || '—'
  const dateStr = comment.created_at
    ? new Date(comment.created_at).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
  return (
    <div
      style={{
        padding: 8,
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--txt)',
          }}
        >
          {displayName}
          <span style={{ fontWeight: 400, color: 'var(--txt-3)', marginLeft: 6 }}>
            {dateStr}
          </span>
        </div>
        {isAuthor && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Supprimer"
            style={{
              padding: 2,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      <div
        style={{
          color: 'var(--txt-2)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.4,
        }}
      >
        {comment.body}
      </div>
    </div>
  )
}

function CreatorInfo({ card }) {
  const author = card.creator || null
  const name =
    author?.full_name || author?.email?.split('@')[0] || null
  const dateStr = card.created_at
    ? new Date(card.created_at).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : ''
  if (!name && !dateStr) return null
  return (
    <span>
      {name && <>Ajouté par <strong style={{ color: 'var(--txt-2)' }}>{name}</strong></>}
      {name && dateStr && ' · '}
      {dateStr && <span>{dateStr}</span>}
    </span>
  )
}

function typeBadgeBg(type) {
  return {
    link: 'rgba(59,130,246,0.18)',
    image: 'rgba(16,185,129,0.18)',
    video: 'rgba(239,68,68,0.18)',
    note: 'rgba(250,204,21,0.20)',
  }[type] || 'var(--bg-elev)'
}
function typeBadgeFg(type) {
  return {
    link: 'var(--blue, #3B82F6)',
    image: '#10B981',
    video: '#EF4444',
    note: '#A16207',
  }[type] || 'var(--txt-2)'
}

