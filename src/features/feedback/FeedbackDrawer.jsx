// ════════════════════════════════════════════════════════════════════════════
// FeedbackDrawer — Détail d'un ticket bug/idée (FBK-1.5)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche :
//   - Header : type + statut + priorité + titre
//   - Meta : auteur + date + page + catégorie
//   - Description + steps (bugs)
//   - Pièces jointes (preview image + download)
//   - Commentaires (avec ajout)
//   - Actions admin : changer statut, marquer comme doublon de…, supprimer
//   - Bouton "Copier pour Claude" → markdown complet dans le presse-papier
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import {
  X,
  Trash2,
  Send,
  Loader2,
  Copy,
  Download,
  Bug,
  Lightbulb,
  ExternalLink,
} from 'lucide-react'
import {
  getTicket,
  updateTicket,
  deleteTicket,
  listAttachmentsForTicket,
  removeAttachment,
  getSignedUrl,
  listCommentsForTicket,
  addComment,
  removeComment,
  exportTicketAsMarkdown,
  copyTicketToClipboard,
  TICKET_STATUSES,
  STATUS_LABELS,
  STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  TYPE_LABELS,
} from '../../lib/feedback'
import { notify } from '../../lib/notify'
import { confirm } from '../../lib/confirm'
import UserAvatar, { userDisplayName } from '../moodboard/UserAvatar'

export default function FeedbackDrawer({
  open,
  ticketId,
  currentUserId,
  isAdmin,
  onClose,
  onMutated,
}) {
  const [ticket, setTicket] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [comments, setComments] = useState([])
  const [signedUrls, setSignedUrls] = useState({})
  const [loading, setLoading] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Fetch initial + signed URLs pour les images
  useEffect(() => {
    if (!open || !ticketId) {
      setTicket(null)
      setAttachments([])
      setComments([])
      setSignedUrls({})
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      getTicket(ticketId),
      listAttachmentsForTicket(ticketId),
      listCommentsForTicket(ticketId),
    ])
      .then(async ([t, a, c]) => {
        if (cancelled) return
        setTicket(t)
        setAttachments(a)
        setComments(c)
        // Pré-fetch signed URLs pour preview (7j)
        const urls = {}
        for (const att of a) {
          urls[att.id] = await getSignedUrl(att.file_path)
        }
        if (!cancelled) setSignedUrls(urls)
      })
      .catch((e) => {
        console.warn('[FeedbackDrawer] fetch failed', e)
        notify.error(e?.message || 'Chargement KO')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, ticketId])

  if (!open) return null

  async function handleStatusChange(newStatus) {
    if (!ticket) return
    if (newStatus === ticket.status) return
    setSaving(true)
    try {
      const updated = await updateTicket(ticket.id, { status: newStatus })
      setTicket(updated)
      onMutated?.()
      if (newStatus === 'done') {
        notify.success('Ticket terminé (archivé)', false)
      }
    } catch (e) {
      notify.error(e?.message || 'Changement statut KO')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddComment() {
    const body = newComment.trim()
    if (!body) return
    setPostingComment(true)
    try {
      await addComment(ticket.id, body)
      setNewComment('')
      // Refetch comments
      const fresh = await listCommentsForTicket(ticket.id)
      setComments(fresh)
      onMutated?.()
    } catch (e) {
      notify.error(e?.message || 'Comment KO')
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
      const fresh = await listCommentsForTicket(ticket.id)
      setComments(fresh)
      onMutated?.()
    } catch (e) {
      notify.error(e?.message || 'Suppression KO')
    }
  }

  async function handleRemoveAttachment(att) {
    const ok = await confirm({
      message: `Supprimer la pièce jointe "${att.file_name}" ?`,
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await removeAttachment(att.id)
      setAttachments((cur) => cur.filter((a) => a.id !== att.id))
      onMutated?.()
    } catch (e) {
      notify.error(e?.message || 'Suppression KO')
    }
  }

  async function handleDeleteTicket() {
    const ok = await confirm({
      title: 'Supprimer le ticket',
      message:
        'Le ticket, ses pièces jointes et tous ses commentaires seront définitivement supprimés.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteTicket(ticket.id)
      notify.success('Ticket supprimé', false)
      onMutated?.()
      onClose?.()
    } catch (e) {
      notify.error(e?.message || 'Suppression KO')
    }
  }

  async function handleCopyForClaude() {
    setExporting(true)
    try {
      const ok = await copyTicketToClipboard(ticket, attachments, comments)
      if (ok) {
        notify.success(
          'Markdown copié — colle dans Claude pour résolution',
          false,
        )
      } else {
        notify.error('Copie KO — autorise le presse-papier ?')
      }
    } finally {
      setExporting(false)
    }
  }

  async function handleDownloadMarkdown() {
    setExporting(true)
    try {
      const md = await exportTicketAsMarkdown(ticket, attachments, comments)
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ticket-${ticket.id.slice(0, 8)}-${(ticket.title || 'sans-titre')
        .replace(/[^\w-]/g, '_')
        .slice(0, 40)}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      notify.error(e?.message || 'Export KO')
    } finally {
      setExporting(false)
    }
  }

  /**
   * Télécharge toutes les images du ticket en local. Workflow Claude :
   * Hugo copie le markdown (1 clic) + télécharge les images (1 clic),
   * puis colle le markdown dans Claude + drag-drop les PNGs.
   */
  async function handleDownloadAllImages() {
    if (attachments.length === 0) return
    setExporting(true)
    let ok = 0
    try {
      for (const att of attachments) {
        const url = signedUrls[att.id] || (await getSignedUrl(att.file_path))
        if (!url) continue
        try {
          const res = await fetch(url)
          if (!res.ok) continue
          const blob = await res.blob()
          const objUrl = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = objUrl
          a.download = att.file_name
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(objUrl)
          ok += 1
          // Petit délai entre chaque téléchargement pour ne pas saturer
          // le browser (sinon il bloque les multi-downloads).
          await new Promise((r) => setTimeout(r, 200))
        } catch (e) {
          console.warn('[FeedbackDrawer] download image KO', att.file_name, e)
        }
      }
      if (ok > 0) {
        notify.success(
          `${ok} image${ok > 1 ? 's' : ''} téléchargée${ok > 1 ? 's' : ''}`,
          false,
        )
      } else {
        notify.error('Téléchargement KO')
      }
    } finally {
      setExporting(false)
    }
  }

  const TypeIcon = ticket?.type === 'bug' ? Bug : Lightbulb
  const typeColor = ticket?.type === 'bug' ? '#EF4444' : '#A855F7'

  return (
    <div
      onClick={() => !saving && onClose?.()}
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
            padding: '10px 14px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
            gap: 10,
          }}
        >
          {ticket && (
            <>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 8px',
                  background: `${typeColor}1f`,
                  color: typeColor,
                  border: `1px solid ${typeColor}`,
                  borderRadius: 4,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                <TypeIcon size={11} />
                {TYPE_LABELS[ticket.type]}
              </div>
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
            </>
          )}
          <div style={{ flex: 1 }} />
          {saving && (
            <Loader2
              size={14}
              className="animate-spin"
              style={{ color: 'var(--txt-3)' }}
            />
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              display: 'inline-flex',
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── Body ─── */}
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
          {loading && (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--txt-3)',
                fontSize: 13,
              }}
            >
              Chargement…
            </div>
          )}

          {!loading && ticket && (
            <>
              {/* Titre + meta auteur/date */}
              <div>
                <h1
                  style={{
                    fontSize: 17,
                    fontWeight: 600,
                    color: 'var(--txt)',
                    margin: 0,
                    lineHeight: 1.3,
                  }}
                >
                  {ticket.title}
                </h1>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 6,
                    fontSize: 11,
                    color: 'var(--txt-3)',
                  }}
                >
                  {ticket.author && (
                    <>
                      <UserAvatar user={ticket.author} size={18} />
                      <span style={{ color: 'var(--txt-2)' }}>
                        {userDisplayName(ticket.author)}
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span>
                    {new Date(ticket.created_at).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              {/* Page + catégorie */}
              {(ticket.page || ticket.category) && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  {ticket.page && (
                    <Chip label="Page" value={ticket.page} />
                  )}
                  {ticket.category && (
                    <Chip
                      label={ticket.type === 'bug' ? 'Type' : 'Thématique'}
                      value={ticket.category}
                    />
                  )}
                </div>
              )}

              {/* Description */}
              <Section title="Description">
                <pre
                  style={{
                    margin: 0,
                    fontFamily: 'inherit',
                    fontSize: 13,
                    color: 'var(--txt)',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {ticket.description}
                </pre>
              </Section>

              {/* Steps to reproduce (bugs) */}
              {ticket.steps_to_reproduce && (
                <Section title="Étapes pour reproduire">
                  <pre
                    style={{
                      margin: 0,
                      fontFamily: 'inherit',
                      fontSize: 12,
                      color: 'var(--txt-2)',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {ticket.steps_to_reproduce}
                  </pre>
                </Section>
              )}

              {/* Attachments */}
              {attachments.length > 0 && (
                <Section title={`Pièces jointes (${attachments.length})`}>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    {attachments.map((att) => (
                      <AttachmentTile
                        key={att.id}
                        att={att}
                        url={signedUrls[att.id]}
                        canDelete={
                          isAdmin || att.uploaded_by === currentUserId
                        }
                        onRemove={() => handleRemoveAttachment(att)}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Contexte technique (auto-capturé) — affiché pour les admins,
                  collapsé par défaut pour les users (juste un récap) */}
              {ticket.context_metadata && (
                <ContextMetadataBlock
                  ctx={ticket.context_metadata}
                  defaultExpanded={isAdmin}
                />
              )}

              {/* Commentaires */}
              <Section title={`Commentaires (${comments.length})`}>
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
                    isAdmin={isAdmin}
                    onRemove={() => handleRemoveComment(c.id)}
                  />
                ))}

                {/* Ajout commentaire */}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
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
                      flex: 1,
                      padding: '6px 10px',
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--brd-sub)',
                      color: 'var(--txt)',
                      borderRadius: 4,
                      fontSize: 12,
                      outline: 'none',
                      resize: 'vertical',
                      minHeight: 40,
                      fontFamily: 'inherit',
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
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: !newComment.trim() ? 0.5 : 1,
                    }}
                  >
                    {postingComment ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                  </button>
                </div>
              </Section>
            </>
          )}
        </div>

        {/* ─── Footer actions ─── */}
        {!loading && ticket && (
          <div
            style={{
              padding: '10px 14px',
              borderTop: '1px solid var(--brd-sub)',
              background: 'var(--bg-elev)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {/* Ligne 1 : actions admin (changement statut) */}
            {isAdmin && (
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--txt-3)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginRight: 4,
                  }}
                >
                  Statut
                </span>
                {TICKET_STATUSES.map((s) => {
                  const isActive = ticket.status === s
                  const c = STATUS_COLORS[s]
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStatusChange(s)}
                      disabled={saving || isActive}
                      style={{
                        padding: '3px 8px',
                        background: isActive ? c.bg : 'transparent',
                        color: isActive ? c.fg : 'var(--txt-2)',
                        border: `1px solid ${isActive ? c.fg : 'var(--brd-sub)'}`,
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: isActive ? 600 : 400,
                        cursor: saving || isActive ? 'default' : 'pointer',
                      }}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Ligne 2 : export + supprimer */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleCopyForClaude}
                disabled={exporting}
                title="Copie un markdown complet dans le presse-papier (titre + contexte + description + steps + signed URLs des screenshots + commentaires). À coller directement dans Claude pour résolution."
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  background: 'rgba(168,85,247,0.12)',
                  color: '#A855F7',
                  border: '1px solid #A855F7',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: exporting ? 'not-allowed' : 'pointer',
                }}
              >
                {exporting ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Copy size={11} />
                )}
                Copier pour Claude
              </button>
              <button
                type="button"
                onClick={handleDownloadMarkdown}
                disabled={exporting}
                title="Télécharger le ticket en .md"
                style={{
                  padding: 5,
                  background: 'transparent',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt-3)',
                  borderRadius: 4,
                  cursor: exporting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                }}
              >
                <Download size={11} />
              </button>
              {attachments.length > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadAllImages}
                  disabled={exporting}
                  title={`Télécharger les ${attachments.length} image${attachments.length > 1 ? 's' : ''} (pour attacher dans Claude)`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '5px 8px',
                    background: 'transparent',
                    border: '1px solid var(--brd)',
                    color: 'var(--txt-3)',
                    borderRadius: 4,
                    cursor: exporting ? 'not-allowed' : 'pointer',
                    fontSize: 10,
                  }}
                >
                  <Download size={11} />
                  Images ({attachments.length})
                </button>
              )}

              <div style={{ flex: 1 }} />

              {isAdmin && (
                <button
                  type="button"
                  onClick={handleDeleteTicket}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '5px 10px',
                    background: 'transparent',
                    color: '#EF4444',
                    border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={11} />
                  Supprimer
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--txt-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Chip({ label, value }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 10,
        fontSize: 11,
        color: 'var(--txt-2)',
      }}
    >
      <span style={{ color: 'var(--txt-3)' }}>{label}</span>
      <strong style={{ color: 'var(--txt)', fontWeight: 500 }}>{value}</strong>
    </span>
  )
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || {
    bg: 'var(--bg-elev)',
    fg: 'var(--txt-3)',
  }
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 7px',
        background: c.bg,
        color: c.fg,
        borderRadius: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: 600,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

function PriorityBadge({ priority }) {
  const c = PRIORITY_COLORS[priority] || {
    bg: 'var(--bg-elev)',
    fg: 'var(--txt-3)',
  }
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 7px',
        background: c.bg,
        color: c.fg,
        borderRadius: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: 600,
      }}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  )
}

function AttachmentTile({ att, url, canDelete, onRemove }) {
  const isImage = (att.mime_type || '').startsWith('image/')
  return (
    <div
      style={{
        position: 'relative',
        width: 140,
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {isImage && url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title="Ouvrir en grand"
        >
          <img
            src={url}
            alt={att.file_name}
            style={{
              width: '100%',
              height: 100,
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </a>
      ) : (
        <div
          style={{
            width: '100%',
            height: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--txt-3)',
          }}
        >
          {att.file_name.split('.').pop()?.toUpperCase() || 'FILE'}
        </div>
      )}
      <div
        style={{
          padding: '4px 6px',
          fontSize: 10,
          color: 'var(--txt-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {url && (
          <a
            href={url}
            download={att.file_name}
            title="Télécharger"
            style={{
              color: 'var(--txt-3)',
              display: 'inline-flex',
            }}
          >
            <Download size={10} />
          </a>
        )}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          title={att.file_name}
        >
          {att.file_name}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={onRemove}
            title="Supprimer"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              padding: 1,
              display: 'inline-flex',
            }}
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

function ContextMetadataBlock({ ctx, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <div
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 11,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--txt-3)',
          cursor: 'pointer',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontWeight: 600,
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        Contexte technique {expanded ? '▾' : '▸'}
      </button>
      {expanded && (
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            color: 'var(--txt-2)',
            fontFamily: 'monospace',
            fontSize: 10,
          }}
        >
          {ctx.url && (
            <div>
              <strong>URL :</strong>{' '}
              <a
                href={ctx.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--blue, #3B82F6)' }}
              >
                {ctx.url}
                <ExternalLink size={9} style={{ marginLeft: 3 }} />
              </a>
            </div>
          )}
          {ctx.user_agent && (
            <div style={{ wordBreak: 'break-all' }}>
              <strong>User-Agent :</strong> {ctx.user_agent}
            </div>
          )}
          {ctx.viewport_w && ctx.viewport_h && (
            <div>
              <strong>Viewport :</strong> {ctx.viewport_w}×{ctx.viewport_h}{' '}
              (DPR {ctx.device_pixel_ratio || 1})
            </div>
          )}
          {ctx.language && (
            <div>
              <strong>Langue :</strong> {ctx.language}
            </div>
          )}
          {ctx.timezone && (
            <div>
              <strong>Timezone :</strong> {ctx.timezone}
            </div>
          )}
          {ctx.build && (
            <div>
              <strong>Build :</strong> {ctx.build}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CommentRow({ comment, currentUserId, isAdmin, onRemove }) {
  const isAuthor = comment.user_id === currentUserId
  const canDelete = isAuthor || isAdmin
  const author = comment.author || null
  const date = comment.created_at
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
        display: 'flex',
        gap: 8,
        padding: 8,
        marginBottom: 6,
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <UserAvatar user={author} size={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--txt)',
            marginBottom: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            justifyContent: 'space-between',
          }}
        >
          <span>
            {userDisplayName(author)}
            <span
              style={{
                fontWeight: 400,
                color: 'var(--txt-3)',
                marginLeft: 6,
              }}
            >
              {date}
            </span>
          </span>
          {canDelete && (
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
    </div>
  )
}
