// ════════════════════════════════════════════════════════════════════════════
// PropositionDetailDrawer — Détail d'une proposition (édition + commentaires)
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1.5 — MUS-2.4 + MUS-2.5
//
// Modal centrée plus large que AddProposition, qui s'ouvre au click sur
// une row de la liste. Permet de :
//   - Visualiser tous les détails (cover, BPM, audio features, statut,
//     proposeur, ancienneté)
//   - Éditer : titre, artiste_text, lien_youtube, remarques
//   - Changer le statut (vrac → selectionne → ...)
//   - Voir + ajouter + éditer + supprimer des commentaires
//   - Supprimer la proposition (avec confirm)
//
// L'édition est inline : click sur un champ → input, blur ou Enter pour
// commit. Pattern Notion-like.
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import {
  X,
  Trash2,
  Play,
  Pause,
  Youtube,
  ExternalLink,
  MessageCircle,
  Send,
  Loader2,
  AlertTriangle,
  Edit3,
  Check,
} from 'lucide-react'
import {
  updateProposition,
  deleteProposition,
  setStatut,
  STATUTS,
  STATUT_LABELS,
  STATUT_COLORS,
  listComments,
  addComment,
  updateComment,
  removeComment,
  subscribeComments,
} from '../../lib/musiques'
import { getDeezerTrack } from '../../lib/musiqueSearch'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../lib/notify'


export default function PropositionDetailDrawer({
  open,
  proposition,
  canEdit = true,
  onClose,
  onMutated,
}) {
  const { user } = useAuth() || {}
  const currentUserId = user?.id || null

  // Local state pour l'édition optimiste
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Commentaires
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  // Audio preview
  const [audioEl, setAudioEl] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)

  // Reset à chaque ouverture
  useEffect(() => {
    if (open && proposition) {
      setDraft({})
      setConfirmDelete(false)
      setNewComment('')
    }
    if (!open) {
      audioEl?.pause?.()
      setIsPlaying(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposition?.id])

  // Esc to close
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape' && !saving && !deleting) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, saving, deleting, onClose])

  // Load + subscribe comments
  const reloadComments = useCallback(async () => {
    if (!proposition?.id) return
    setCommentsLoading(true)
    try {
      const list = await listComments(proposition.id)
      setComments(list || [])
    } catch (e) {
      console.warn('[Drawer] loadComments failed', e)
    } finally {
      setCommentsLoading(false)
    }
  }, [proposition?.id])

  useEffect(() => {
    if (!open || !proposition?.id) return undefined
    reloadComments()
    const sub = subscribeComments(proposition.id, () => reloadComments())
    return () => sub.unsubscribe()
  }, [open, proposition?.id, reloadComments])

  // Audio cleanup
  useEffect(
    () => () => {
      audioEl?.pause?.()
    },
    [audioEl],
  )

  if (!open || !proposition) return null

  const p = proposition
  const artistName = p.artiste?.nom || draft.artiste_text || p.artiste_text || '—'

  // Patch helper : update local draft + persistance lazy via commitField
  const setField = (field, value) => setDraft((d) => ({ ...d, [field]: value }))

  async function commitField(field) {
    if (!canEdit) return
    const value = draft[field]
    if (value === undefined) return
    const currentValue = p[field]
    if (value === currentValue) {
      // Pas de changement → on retire du draft
      setDraft((d) => {
        const next = { ...d }
        delete next[field]
        return next
      })
      return
    }
    setSaving(true)
    try {
      await updateProposition(p.id, { [field]: value })
      onMutated?.()
      setDraft((d) => {
        const next = { ...d }
        delete next[field]
        return next
      })
    } catch (e) {
      console.warn('[Drawer] commit failed', e)
      notify.error(e?.message || 'Erreur sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatutChange(newStatut) {
    if (!canEdit || newStatut === p.statut) return
    setSaving(true)
    try {
      await setStatut(p.id, newStatut)
      onMutated?.()
    } catch (e) {
      console.warn('[Drawer] statut failed', e)
      notify.error(e?.message || 'Erreur changement statut')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!canEdit) return
    setDeleting(true)
    try {
      await deleteProposition(p.id)
      notify.success('Proposition supprimée', false)
      onMutated?.()
      onClose?.()
    } catch (e) {
      console.warn('[Drawer] delete failed', e)
      notify.error(e?.message || 'Erreur suppression')
    } finally {
      setDeleting(false)
    }
  }

  async function togglePlay() {
    if (isPlaying) {
      audioEl?.pause?.()
      setIsPlaying(false)
      return
    }
    if (!p.preview_url && !p.spotify_id) return
    setIsPlaying(true)
    let url = p.preview_url
    let audio = null
    const tryPlay = (u) => {
      const a = new Audio(u)
      a.volume = 0.7
      a.addEventListener('ended', () => setIsPlaying(false))
      return { a, pp: a.play() }
    }
    let played = false
    if (url) {
      try {
        const r = tryPlay(url)
        await r.pp
        audio = r.a
        played = true
      } catch {
        /* refresh below */
      }
    }
    if (!played && p.spotify_id) {
      try {
        const fresh = await getDeezerTrack(p.spotify_id)
        if (fresh?.preview_url && fresh.preview_url !== url) {
          url = fresh.preview_url
          updateProposition(p.id, { preview_url: url }).catch(() => {})
          const r = tryPlay(url)
          audio = r.a
          await r.pp
          played = true
        }
      } catch {
        /* abort */
      }
    }
    if (!played) {
      setIsPlaying(false)
      notify.error('Lecture impossible (preview Deezer indisponible)')
      return
    }
    setAudioEl(audio)
  }

  async function handleAddComment() {
    const body = newComment.trim()
    if (!body) return
    setPostingComment(true)
    try {
      await addComment(p.id, body)
      setNewComment('')
      // Realtime catch via subscribe + reloadComments
    } catch (e) {
      notify.error(e?.message || 'Impossible de poster')
    } finally {
      setPostingComment(false)
    }
  }

  const titreValue = draft.titre !== undefined ? draft.titre : p.titre || ''
  const remarquesValue =
    draft.remarques !== undefined ? draft.remarques : p.remarques || ''
  const youtubeValue =
    draft.lien_youtube !== undefined ? draft.lien_youtube : p.lien_youtube || ''
  const artisteValue =
    draft.artiste_text !== undefined
      ? draft.artiste_text
      : p.artiste?.nom || p.artiste_text || ''
  const bpm =
    p.audio_features?.tempo > 0 ? Math.round(p.audio_features.tempo) : null

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
          width: 'min(560px, 100%)',
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
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--txt)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 8,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                background: STATUT_COLORS[p.statut]?.bg || 'var(--bg-elev)',
                color: STATUT_COLORS[p.statut]?.fg || 'var(--txt-2)',
                fontWeight: 600,
              }}
            >
              {STATUT_LABELS[p.statut]}
            </span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>
              {artistName} · {p.titre}
            </span>
          </div>
          <button
            type="button"
            onClick={() => !saving && !deleting && onClose?.()}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: 'var(--txt-3)',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── Body ───────────────────────────────────────────────────── */}
        <div
          style={{
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflow: 'auto',
          }}
        >
          {/* Cover + titre + artiste */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 5,
                background: p.cover_url ? 'transparent' : 'var(--bg-elev)',
                backgroundImage: p.cover_url ? `url(${p.cover_url})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                flexShrink: 0,
                position: 'relative',
              }}
            >
              {p.preview_url && (
                <button
                  type="button"
                  onClick={togglePlay}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.35)',
                    border: 'none',
                    borderRadius: 5,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FF6E37',
                  }}
                >
                  {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <InlineField
                label="Titre"
                value={titreValue}
                onChange={(v) => setField('titre', v)}
                onCommit={() => commitField('titre')}
                disabled={!canEdit || saving}
                big
              />
              <InlineField
                label="Artiste"
                value={artisteValue}
                onChange={(v) => setField('artiste_text', v)}
                onCommit={() => commitField('artiste_text')}
                disabled={!canEdit || saving || Boolean(p.artiste?.nom)}
                hint={
                  p.artiste?.nom
                    ? 'Lié à l\'annuaire (clic supprime le lien pour saisir libre)'
                    : null
                }
              />
              {p.artiste?.jour && (
                <div
                  style={{
                    fontSize: 11,
                    padding: '1px 6px',
                    background: 'rgba(59,130,246,0.12)',
                    color: 'var(--blue, #3B82F6)',
                    borderRadius: 6,
                    display: 'inline-block',
                    marginTop: 6,
                  }}
                >
                  Joue {p.artiste.jour}
                  {p.artiste.scene ? ` · ${p.artiste.scene}` : ''}
                </div>
              )}
            </div>
          </div>

          {/* Statut + YouTube + Deezer sur une ligne compacte 2-col */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            <div>
              <FieldLabel>Statut</FieldLabel>
              <select
                value={p.statut}
                onChange={(e) => handleStatutChange(e.target.value)}
                disabled={!canEdit || saving}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd-sub)',
                  color: 'var(--txt)',
                  borderRadius: 4,
                  fontSize: 12,
                  outline: 'none',
                  cursor: canEdit ? 'pointer' : 'default',
                }}
              >
                {STATUTS.map((s) => (
                  <option key={s} value={s}>
                    {STATUT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Audio features</FieldLabel>
              <div
                style={{
                  padding: '5px 8px',
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 4,
                  fontSize: 11,
                  color: 'var(--txt-2)',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  height: 26,
                  flexWrap: 'wrap',
                }}
              >
                {bpm ? (
                  <span style={{ color: '#D97706', fontWeight: 500 }}>
                    {bpm} BPM
                  </span>
                ) : (
                  <span style={{ color: 'var(--txt-3)', fontStyle: 'italic' }}>
                    BPM non détecté
                  </span>
                )}
                {p.duration_ms && (
                  <span>{formatDuration(p.duration_ms / 1000)}</span>
                )}
              </div>
            </div>
          </div>

          {/* Lien YouTube — full row */}
          <div>
            <FieldLabel>Lien YouTube</FieldLabel>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                value={youtubeValue}
                onChange={(e) => setField('lien_youtube', e.target.value)}
                onBlur={() => commitField('lien_youtube')}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                placeholder="https://youtu.be/…"
                disabled={!canEdit || saving}
                style={inputStyleCompact()}
              />
              {p.lien_youtube && (
                <a
                  href={p.lien_youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: 5,
                    color: '#FF0000',
                    display: 'inline-flex',
                  }}
                  title="Ouvrir dans YouTube"
                >
                  <Youtube size={14} />
                </a>
              )}
              {p.spotify_url && (
                <a
                  href={p.spotify_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '4px 8px',
                    fontSize: 11,
                    color: '#FF6E37',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    border: '1px solid var(--brd-sub)',
                    borderRadius: 4,
                  }}
                  title="Ouvrir sur Deezer"
                >
                  Deezer
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>

          {/* Remarques */}
          <div>
            <FieldLabel>Remarques</FieldLabel>
            <textarea
              value={remarquesValue}
              onChange={(e) => setField('remarques', e.target.value)}
              onBlur={() => commitField('remarques')}
              placeholder="Timecode précis, contexte, conditions…"
              disabled={!canEdit || saving}
              rows={2}
              style={{ ...inputStyleCompact(), resize: 'vertical' }}
            />
          </div>

          {/* ═══ Commentaires ═══ */}
          <div
            style={{
              borderTop: '1px solid var(--brd-sub)',
              paddingTop: 10,
              marginTop: 2,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--txt-2)',
                marginBottom: 10,
              }}
            >
              <MessageCircle size={14} />
              Commentaires
              {comments.length > 0 && (
                <span style={{ color: 'var(--txt-3)', fontWeight: 400 }}>
                  ({comments.length})
                </span>
              )}
            </div>

            {/* Liste comments */}
            {commentsLoading && comments.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                Chargement…
              </div>
            )}
            {!commentsLoading && comments.length === 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--txt-3)',
                  fontStyle: 'italic',
                  padding: '8px 0',
                }}
              >
                Aucun commentaire encore. Lance la discussion ↓
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {comments.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  isMine={c.user_id === currentUserId}
                  onUpdate={async (newBody) => {
                    try {
                      await updateComment(c.id, newBody)
                      // Realtime catch
                    } catch (e) {
                      notify.error(e?.message || 'Édit impossible')
                    }
                  }}
                  onDelete={async () => {
                    try {
                      await removeComment(c.id)
                    } catch (e) {
                      notify.error(e?.message || 'Suppression impossible')
                    }
                  }}
                />
              ))}
            </div>

            {/* Input nouveau commentaire */}
            {canEdit && (
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-end',
                }}
              >
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleAddComment()
                    }
                  }}
                  placeholder="Écris un commentaire…  (⌘/Ctrl+Enter pour envoyer)"
                  rows={2}
                  disabled={postingComment}
                  style={{
                    ...inputStyle(),
                    resize: 'vertical',
                    flex: 1,
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || postingComment}
                  style={{
                    padding: '8px 12px',
                    background: newComment.trim()
                      ? 'var(--blue, #3B82F6)'
                      : 'var(--brd)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: newComment.trim() ? 'pointer' : 'not-allowed',
                    fontSize: 12,
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  {postingComment ? (
                    <Loader2 size={12} className="spin-d" />
                  ) : (
                    <Send size={12} />
                  )}
                  Envoyer
                </button>
              </div>
            )}
          </div>

          {/* Footer : proposeur + ancienneté + supprimer */}
          <div
            style={{
              borderTop: '1px solid var(--brd-sub)',
              paddingTop: 8,
              marginTop: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--txt-3)',
            }}
          >
            <div>
              Proposé{' '}
              <RelativeTime date={p.created_at} />
              {p.proposer && (
                <>
                  {' '}· par{' '}
                  <span style={{ color: 'var(--txt-2)' }}>
                    {p.proposer.full_name ||
                      p.proposer.email?.split('@')[0] ||
                      'inconnu'}
                  </span>
                </>
              )}
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {confirmDelete ? (
                  <>
                    <AlertTriangle size={13} style={{ color: '#EF4444' }} />
                    <span style={{ color: '#EF4444', fontSize: 11 }}>
                      Sûr ?
                    </span>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      style={{
                        padding: '4px 10px',
                        background: '#EF4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {deleting ? (
                        <Loader2 size={11} className="spin-d" />
                      ) : (
                        'Supprimer'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      style={{
                        padding: '4px 10px',
                        background: 'transparent',
                        border: '1px solid var(--brd-sub)',
                        color: 'var(--txt-2)',
                        borderRadius: 4,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Annuler
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    style={{
                      padding: '4px 10px',
                      background: 'transparent',
                      border: '1px solid var(--brd-sub)',
                      color: '#EF4444',
                      borderRadius: 4,
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Trash2 size={11} />
                    Supprimer
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .spin-d { animation: spin-d 1s linear infinite; }
        @keyframes spin-d {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function InlineField({
  label,
  value,
  onChange,
  onCommit,
  disabled,
  hint,
  big,
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        disabled={disabled}
        style={{
          ...inputStyleCompact(),
          fontSize: big ? 14 : 12,
          fontWeight: big ? 500 : 400,
        }}
      />
      {hint && (
        <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function CommentRow({ comment, isMine, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)

  const author = comment.author || {}
  const name =
    author.full_name ||
    author.email?.split('@')[0] ||
    `user…${comment.user_id?.slice(0, 4) || ''}`
  const initials = (name.match(/[A-Za-zÀ-ÿ0-9]/g) || ['?'])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: hashColorFromName(name).bg,
          color: hashColorFromName(name).fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            marginBottom: 2,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--txt)' }}>
            {name}
          </span>
          <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>
            <RelativeTime date={comment.created_at} />
            {comment.updated_at !== comment.created_at && ' (édité)'}
          </span>
        </div>
        {editing ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              style={{ ...inputStyle(), resize: 'vertical', flex: 1 }}
              autoFocus
            />
            <button
              type="button"
              onClick={async () => {
                await onUpdate(draft)
                setEditing(false)
              }}
              style={{
                padding: '4px 8px',
                background: 'var(--blue, #3B82F6)',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                fontSize: 11,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <Check size={11} />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setDraft(comment.body)
              }}
              style={{
                padding: '4px 8px',
                background: 'transparent',
                border: '1px solid var(--brd-sub)',
                color: 'var(--txt-2)',
                borderRadius: 4,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: 'var(--txt-2)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {comment.body}
          </div>
        )}
        {isMine && !editing && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginTop: 3,
            }}
          >
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--txt-3)',
                cursor: 'pointer',
                fontSize: 10,
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <Edit3 size={10} />
              Éditer
            </button>
            <button
              type="button"
              onClick={onDelete}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#EF4444',
                cursor: 'pointer',
                fontSize: 10,
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                opacity: 0.7,
              }}
            >
              <Trash2 size={10} />
              Supprimer
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function FieldLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--txt-3)',
        marginBottom: 4,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {children}
    </div>
  )
}

function RelativeTime({ date }) {
  if (!date) return null
  const d = new Date(date)
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  let label
  if (diff < 60) label = "à l'instant"
  else if (diff < 3600) label = `il y a ${Math.floor(diff / 60)}min`
  else if (diff < 86400) label = `il y a ${Math.floor(diff / 3600)}h`
  else if (diff < 86400 * 7) label = `il y a ${Math.floor(diff / 86400)}j`
  else
    label = d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: diff > 86400 * 365 ? 'numeric' : undefined,
    })
  return <span>{label}</span>
}

const INITIAL_COLORS = [
  { bg: '#FCD34D', fg: '#78350F' },
  { bg: '#93C5FD', fg: '#1E3A8A' },
  { bg: '#FDA4AF', fg: '#881337' },
  { bg: '#5EEAD4', fg: '#134E4A' },
  { bg: '#C4B5FD', fg: '#4338CA' },
  { bg: '#FDBA74', fg: '#7C2D12' },
  { bg: '#67E8F9', fg: '#155E75' },
  { bg: '#A5B4FC', fg: '#3730A3' },
]

function hashColorFromName(name) {
  let h = 0
  const s = name || '?'
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return INITIAL_COLORS[h % INITIAL_COLORS.length]
}

function inputStyle() {
  return {
    width: '100%',
    padding: '6px 10px',
    background: 'var(--bg-elev)',
    border: '1px solid var(--brd-sub)',
    borderRadius: 4,
    color: 'var(--txt)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  }
}

function inputStyleCompact() {
  return {
    width: '100%',
    padding: '5px 8px',
    background: 'var(--bg-elev)',
    border: '1px solid var(--brd-sub)',
    borderRadius: 4,
    color: 'var(--txt)',
    fontSize: 12,
    outline: 'none',
    boxSizing: 'border-box',
  }
}

function formatDuration(sec) {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
