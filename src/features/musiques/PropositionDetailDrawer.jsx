// ════════════════════════════════════════════════════════════════════════════
// PropositionDetailDrawer — Détail d'une proposition (édition + commentaires)
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1.5 — MUS-2.4 + MUS-2.5
//
// Modal centrée plus large que AddProposition, qui s'ouvre au click sur
// une row de la liste. Permet de :
//   - Visualiser tous les détails (cover, BPM, audio features,
//     proposeur, ancienneté)
//   - Éditer : titre, artiste_text, lien_youtube, remarques
//   - Voir + ajouter + éditer + supprimer des commentaires
//   - Gérer les liens vers les livrables (statut_local par lien)
//   - Supprimer la proposition (avec confirm)
//
// MUS-6.9 : le statut global de la track a été supprimé. Le workflow vit
// désormais sur les liens livrable (proposition / choix / valide).
//
// L'édition est inline : click sur un champ → input, blur ou Enter pour
// commit. Pattern Notion-like.
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Star,
  Tag as TagIcon,
  Clock,
  Volume2,
  Film,
  Search as SearchIcon,
  Plus as PlusIcon,
} from 'lucide-react'
import {
  updateProposition,
  deleteProposition,
  listComments,
  addComment,
  updateComment,
  removeComment,
  subscribeComments,
  listNotesForProposition,
  upsertMyNote,
  removeMyNote,
  listLivrablesForProposition,
  linkPropositionToLivrable,
  updateLink,
  removeLink,
  STATUTS_LOCAL,
  STATUT_LOCAL_LABELS,
  STATUT_LOCAL_COLORS,
} from '../../lib/musiques'
import { fetchLivrables, fetchBlocks } from '../../lib/livrables'
import { getDeezerTrack } from '../../lib/musiqueSearch'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../lib/notify'
import StarRating from './StarRating'
import TagsEditor from './TagsEditor'


export default function PropositionDetailDrawer({
  open,
  proposition,
  canEdit = true,
  // MUS-4.2 : nouveaux props pour wiring Notes + Tags
  projectId = null,
  currentUserId: currentUserIdProp = null,
  aggregate = null,
  onClose,
  onMutated,
}) {
  const { user } = useAuth() || {}
  const currentUserId = currentUserIdProp || user?.id || null

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

  // MUS-4.2 : Notes détail voteurs
  const [notesList, setNotesList] = useState([])
  const [notesLoading, setNotesLoading] = useState(false)

  // MUS-6.3 : livrables liés à cette proposition
  const [linksList, setLinksList] = useState([])
  const [linksLoading, setLinksLoading] = useState(false)

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

  // MUS-4.2 : reload notes détaillées (avec voteurs) à chaque open et à
  // chaque mutation parent (qui touche `aggregate.noteCount`).
  const reloadNotes = useCallback(async () => {
    if (!proposition?.id) return
    setNotesLoading(true)
    try {
      const list = await listNotesForProposition(proposition.id)
      setNotesList(list || [])
    } catch (e) {
      console.warn('[Drawer] loadNotes failed', e)
    } finally {
      setNotesLoading(false)
    }
  }, [proposition?.id])

  useEffect(() => {
    if (!open || !proposition?.id) return
    reloadNotes()
    // Re-trigger quand aggregate.noteCount change (Realtime parent → refetch
    // → nouveau aggregate avec compteur différent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposition?.id, aggregate?.noteCount, aggregate?.noteAvg])

  // MUS-6.3 : load des livrables liés à l'ouverture
  const reloadLinks = useCallback(async () => {
    if (!proposition?.id) return
    setLinksLoading(true)
    try {
      const list = await listLivrablesForProposition(proposition.id)
      setLinksList(list || [])
    } catch (e) {
      console.warn('[Drawer] loadLinks failed', e)
    } finally {
      setLinksLoading(false)
    }
  }, [proposition?.id])

  useEffect(() => {
    if (!open || !proposition?.id) return
    reloadLinks()
  }, [open, proposition?.id, reloadLinks])

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

  // MUS-4.2 : note de l'utilisateur courant dans le drawer
  async function handleSetMyNote(value) {
    if (!canEdit) return
    try {
      if (value === 0) await removeMyNote(p.id)
      else await upsertMyNote(p.id, value)
      onMutated?.()
      reloadNotes()
    } catch (e) {
      console.warn('[Drawer] note failed', e)
      notify.error(e?.message || 'Impossible de noter')
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
        {/* ─── Header amélioré (MUS-4.2) ──────────────────────────────────
            Titre + artiste plus lisibles, fermeture à droite. MUS-6.9 :
            badge statut global retiré (statut vit par lien livrable). */}
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
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minWidth: 0,
              flex: 1,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                lineHeight: 1.2,
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--txt)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={p.titre}
              >
                {p.titre || '—'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--txt-3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={artistName}
              >
                {artistName}
              </span>
            </div>
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
              flexShrink: 0,
            }}
            aria-label="Fermer"
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
            gap: 6,
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
                  title={isPlaying ? 'Mettre en pause' : 'Écouter le preview 30s'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    // MUS-6.4 polish : cover floutée + bouton blanc pour
                    // que la pastille ressorte sur n'importe quelle cover
                    // sans clasher (notamment cover orange).
                    background: 'rgba(0,0,0,0.30)',
                    backdropFilter: 'blur(2px)',
                    WebkitBackdropFilter: 'blur(2px)',
                    border: 'none',
                    borderRadius: 5,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'white',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                      transition: 'transform 80ms',
                    }}
                  >
                    {isPlaying ? (
                      <Pause size={14} fill="#FF6E37" style={{ color: '#FF6E37' }} />
                    ) : (
                      <Play
                        size={14}
                        fill="#FF6E37"
                        style={{ color: '#FF6E37', marginLeft: 1 }}
                      />
                    )}
                  </span>
                </button>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* MUS-4.5 : labels Titre/Artiste supprimés (déjà présents dans
                  le header). Placeholders + tooltip suffisent. */}
              <input
                type="text"
                value={titreValue}
                onChange={(e) => setField('titre', e.target.value)}
                onBlur={() => commitField('titre')}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                disabled={!canEdit || saving}
                placeholder="Titre du morceau"
                title="Titre"
                style={{
                  ...inputStyleCompact(),
                  fontSize: 14,
                  fontWeight: 500,
                }}
              />
              <input
                type="text"
                value={artisteValue}
                onChange={(e) => setField('artiste_text', e.target.value)}
                onBlur={() => commitField('artiste_text')}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                disabled={!canEdit || saving || Boolean(p.artiste?.nom)}
                placeholder="Artiste"
                title={
                  p.artiste?.nom
                    ? 'Lié à l\'annuaire — clic = supprime le lien pour saisir libre'
                    : 'Artiste'
                }
                style={inputStyleCompact()}
              />
              <InlineMetaChips
                bpm={bpm}
                durationMs={p.duration_ms}
                loudness={p.audio_features?.loudness}
                source={p.audio_features?.source}
                jour={p.artiste?.jour}
                scene={p.artiste?.scene}
              />
            </div>
          </div>

          {/* MUS-6.9 : le select Statut a été retiré (statuts globaux
              supprimés). Le Lien YouTube prend désormais toute la largeur. */}
          <div>
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
                      flexShrink: 0,
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
                      flexShrink: 0,
                    }}
                    title="Ouvrir sur Deezer"
                  >
                    Deezer
                    <ExternalLink size={10} />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Remarques — 1 row par défaut (resize si besoin) */}
          <div>
            <FieldLabel>Remarques</FieldLabel>
            <textarea
              value={remarquesValue}
              onChange={(e) => setField('remarques', e.target.value)}
              onBlur={() => commitField('remarques')}
              placeholder="Timecode précis, contexte, conditions…"
              disabled={!canEdit || saving}
              rows={1}
              style={{ ...inputStyleCompact(), resize: 'vertical', minHeight: 28 }}
            />
          </div>

          {/* ═══ Tags (MUS-4.5) — label inline dans la même row ═══ */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--txt-3)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
                width: 50,
              }}
            >
              <TagIcon size={11} />
              Tags
            </span>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                minHeight: 22,
              }}
            >
              <TagsEditor
                propositionId={p.id}
                projectId={projectId}
                currentUserId={currentUserId}
                tags={aggregate?.tags || []}
                canEdit={canEdit}
                onChange={onMutated}
              />
            </div>
          </div>

          {/* ═══ Notes ★ + détail voteurs (MUS-4.2 / compacté MUS-4.5) ═══
              Header inline avec la rating row pour gagner de la hauteur :
              ★ Notes (1)    [Ta note ★★★★☆]  moy 4    Retirer */}
          <div
            style={{
              borderTop: '1px solid var(--brd-sub)',
              paddingTop: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 8px',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                borderRadius: 4,
                marginBottom: notesList.length > 0 ? 6 : 0,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--txt-2)',
                  flexShrink: 0,
                }}
              >
                <Star size={12} />
                Notes
                {(aggregate?.noteCount || 0) > 0 && (
                  <span style={{ color: 'var(--txt-3)', fontWeight: 400 }}>
                    ({aggregate.noteCount})
                  </span>
                )}
              </span>
              <span
                style={{
                  width: 1,
                  height: 14,
                  background: 'var(--brd-sub)',
                  flexShrink: 0,
                }}
              />
              <StarRating
                myValue={aggregate?.myNote ?? null}
                avgValue={aggregate?.noteAvg ?? null}
                count={aggregate?.noteCount || 0}
                onChange={handleSetMyNote}
                disabled={!canEdit}
                size={15}
              />
              {aggregate?.noteAvg != null && (
                <span
                  style={{
                    fontSize: 11,
                    color: '#D97706',
                    fontWeight: 500,
                    flexShrink: 0,
                  }}
                  title={`Moyenne ${Math.round(aggregate.noteAvg * 10) / 10}/5`}
                >
                  moy {Math.round(aggregate.noteAvg * 10) / 10}
                </span>
              )}
              {aggregate?.myNote != null && canEdit && (
                <button
                  type="button"
                  onClick={() => handleSetMyNote(0)}
                  style={{
                    marginLeft: 'auto',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--txt-3)',
                    fontSize: 10,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  title="Retirer ma note"
                >
                  Retirer
                </button>
              )}
            </div>

            {/* Liste voteurs (détail comme commentaires) */}
            {notesLoading && notesList.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                Chargement…
              </div>
            )}
            {notesList.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {notesList.map((n) => (
                  <NoteVoterRow
                    key={n.user_id}
                    note={n}
                    isMine={n.user_id === currentUserId}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ═══ Utilisée dans (MUS-6.3) — livrables liés ═══
              Liste les livrables où cette track est dans la setlist, avec
              statut local + remarque. Bouton "+ Lier" ouvre un picker
              listant les livrables non-encore-liés. */}
          <LivrablesUsedInSection
            propositionId={proposition.id}
            projectId={projectId}
            canEdit={canEdit}
            links={linksList}
            loading={linksLoading}
            onMutated={reloadLinks}
          />

          {/* ═══ Commentaires (compacté MUS-4.5) ═══
              Header inline + plus de "aucun commentaire encore" (le
              placeholder de la textarea suffit). */}
          <div
            style={{
              borderTop: '1px solid var(--brd-sub)',
              paddingTop: 8,
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
                marginBottom: comments.length > 0 ? 6 : 4,
              }}
            >
              <MessageCircle size={13} />
              Commentaires
              {comments.length > 0 && (
                <span style={{ color: 'var(--txt-3)', fontWeight: 400 }}>
                  ({comments.length})
                </span>
              )}
            </div>

            {/* Liste comments — skeleton seulement si loading */}
            {commentsLoading && comments.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                Chargement…
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

            {/* Input nouveau commentaire — 1 row par défaut (expand
                naturellement quand on tape). Placeholder fait office de
                CTA d'empty state pour les propositions sans commentaire. */}
            {canEdit && (
              <div
                style={{
                  marginTop: comments.length > 0 ? 8 : 4,
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
                  placeholder={
                    comments.length === 0
                      ? 'Lance la discussion… (⌘/Ctrl+Enter pour envoyer)'
                      : 'Écris un commentaire… (⌘/Ctrl+Enter)'
                  }
                  rows={1}
                  disabled={postingComment}
                  style={{
                    ...inputStyle(),
                    resize: 'vertical',
                    flex: 1,
                    minHeight: 32,
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
            {/* MUS-6.4 polish : avatar proposeur visible dans le footer
                à côté du nom (cohérence avec la liste classique qui montre
                déjà l'avatar). */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>
                Proposé{' '}
                <RelativeTime date={p.created_at} />
              </span>
              {p.proposer && (
                <>
                  <span style={{ opacity: 0.5 }}>·</span>
                  <ProposerAvatarInline proposer={p.proposer} />
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

// InlineField : retiré dans MUS-4.5 (labels Titre/Artiste supprimés au
// profit de placeholders + tooltip pour économiser de la hauteur).

// ─── InlineMetaChips : chips compactes (BPM, durée, gain, Joue Jx) ───────
// MUS-4.3 v2 — Hugo a jugé l'ancien panneau "Audio features" trop lourd
// pour la quantité d'info (3 valeurs). Au lieu d'un encadré dédié + label
// + tag source, on intègre les infos comme petites chips inline juste
// sous l'artiste, au même niveau que le badge "Joue Vendredi". Le tag
// de provenance (Deezer / client-detected) est dégradé en tooltip sur
// la pill BPM. Aucune chip = aucun rendu (placeholder discret).
function InlineMetaChips({ bpm, durationMs, loudness, source, jour, scene }) {
  const items = []
  if (jour) {
    items.push(
      <span
        key="jour"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          fontSize: 11,
          padding: '1px 6px',
          background: 'rgba(59,130,246,0.12)',
          color: 'var(--blue, #3B82F6)',
          borderRadius: 6,
          fontWeight: 500,
        }}
      >
        Joue {jour}
        {scene ? ` · ${scene}` : ''}
      </span>,
    )
  }
  if (bpm) {
    items.push(
      <span
        key="bpm"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11,
          padding: '1px 6px',
          background: 'rgba(245,158,11,0.15)',
          color: '#D97706',
          borderRadius: 6,
          fontWeight: 500,
        }}
        title={
          source
            ? `Tempo : ${bpm} BPM (source ${source})`
            : `Tempo : ${bpm} BPM`
        }
      >
        {bpm} BPM
      </span>,
    )
  }
  if (durationMs > 0) {
    items.push(
      <span
        key="dur"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11,
          color: 'var(--txt-3)',
          fontVariantNumeric: 'tabular-nums',
        }}
        title="Durée"
      >
        <Clock size={10} />
        {formatDuration(durationMs / 1000)}
      </span>,
    )
  }
  if (loudness != null && typeof loudness === 'number') {
    items.push(
      <span
        key="loud"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11,
          color: 'var(--txt-3)',
          fontVariantNumeric: 'tabular-nums',
        }}
        title="Loudness — sortie nominale du master"
      >
        <Volume2 size={10} />
        {loudness > 0 ? '+' : ''}
        {loudness.toFixed(1)} dB
      </span>,
    )
  }
  if (items.length === 0) return null
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'center',
        marginTop: 6,
      }}
    >
      {items}
    </div>
  )
}

// ─── NoteVoterRow : une ligne par voteur (MUS-4.2) ───────────────────────
// Pattern visuel calqué sur CommentRow : avatar circulaire + nom + ★ +
// horodatage. Plus compact (pas de body texte). "Toi" en gras si c'est
// ma propre note.
function NoteVoterRow({ note, isMine }) {
  const v = note.voter || {}
  const name = v.full_name || v.email?.split('@')[0] || 'inconnu'
  const initials = (name.match(/[A-Za-zÀ-ÿ0-9]/g) || ['?'])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const color = hashColorFromName(name)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 6px',
        borderRadius: 4,
        background: isMine ? 'rgba(59,130,246,0.06)' : 'transparent',
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: color.bg,
          color: color.fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
      <span
        style={{
          fontSize: 12,
          color: 'var(--txt-2)',
          fontWeight: isMine ? 600 : 400,
        }}
      >
        {isMine ? 'Toi' : name}
      </span>
      <span style={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            size={11}
            style={{
              color: s <= note.note ? '#D97706' : 'var(--brd-sub)',
              fill: s <= note.note ? '#D97706' : 'transparent',
            }}
          />
        ))}
      </span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 10,
          color: 'var(--txt-3)',
        }}
      >
        <RelativeTime date={note.updated_at || note.created_at} />
      </span>
    </div>
  )
}

// ─── LivrablesUsedInSection : section "Utilisée dans" (MUS-6.3) ──────────
// Affiche la liste des livrables où cette track est dans la setlist, avec
// statut local + remarque. Bouton "+ Lier à un livrable" ouvre un picker
// listant les livrables du projet (groupés par bloc) avec marquage des
// déjà-liés (clic dessus → toggle remove).
function LivrablesUsedInSection({
  propositionId,
  projectId,
  canEdit,
  links,
  loading,
  onMutated,
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busyLinkId, setBusyLinkId] = useState(null)

  async function handleStatutChange(linkId, newStatut) {
    setBusyLinkId(linkId)
    try {
      await updateLink(linkId, { statut_local: newStatut })
      onMutated?.()
    } catch (e) {
      console.warn('[Drawer] updateLink statut', e)
      notify.error(e?.message || 'Update statut impossible')
    } finally {
      setBusyLinkId(null)
    }
  }

  async function handleRemarqueChange(linkId, newRemarque) {
    setBusyLinkId(linkId)
    try {
      await updateLink(linkId, { remarque: newRemarque || null })
      onMutated?.()
    } catch (e) {
      console.warn('[Drawer] updateLink remarque', e)
      notify.error(e?.message || 'Update remarque impossible')
    } finally {
      setBusyLinkId(null)
    }
  }

  async function handleRemove(linkId) {
    setBusyLinkId(linkId)
    try {
      await removeLink(linkId)
      onMutated?.()
    } catch (e) {
      console.warn('[Drawer] removeLink', e)
      notify.error(e?.message || 'Suppression impossible')
    } finally {
      setBusyLinkId(null)
    }
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--brd-sub)',
        paddingTop: 8,
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
          marginBottom: 6,
        }}
      >
        <Film size={13} />
        Utilisée dans
        {links.length > 0 && (
          <span style={{ color: 'var(--txt-3)', fontWeight: 400 }}>
            ({links.length})
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px dashed var(--brd-sub)',
              color: 'var(--txt-3)',
              padding: '2px 8px',
              fontSize: 10,
              borderRadius: 8,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <PlusIcon size={10} />
            Lier
          </button>
        )}
      </div>

      {loading && links.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
          Chargement…
        </div>
      )}

      {!loading && links.length === 0 && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--txt-3)',
            fontStyle: 'italic',
            padding: '4px 0',
          }}
        >
          Pas encore attribuée à un livrable.
        </div>
      )}

      {links.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {links.map((lk) => (
            <LivrableLinkRow
              key={lk.id}
              link={lk}
              canEdit={canEdit}
              busy={busyLinkId === lk.id}
              onStatutChange={(s) => handleStatutChange(lk.id, s)}
              onRemarqueChange={(r) => handleRemarqueChange(lk.id, r)}
              onRemove={() => handleRemove(lk.id)}
            />
          ))}
        </div>
      )}

      {pickerOpen && (
        <LivrablesPickerModal
          projectId={projectId}
          propositionId={propositionId}
          existingLinks={links}
          onClose={() => setPickerOpen(false)}
          onLinked={() => {
            setPickerOpen(false)
            onMutated?.()
          }}
        />
      )}
    </div>
  )
}

// ─── LivrableLinkRow : une row livrable lié ──────────────────────────────
function LivrableLinkRow({
  link,
  canEdit,
  busy,
  onStatutChange,
  onRemarqueChange,
  onRemove,
}) {
  const liv = link.livrable
  const [editRemarque, setEditRemarque] = useState(false)
  const [remarque, setRemarque] = useState(link.remarque || '')
  const palette = STATUT_LOCAL_COLORS[link.statut_local] || {
    bg: 'var(--bg-elev)',
    fg: 'var(--txt-3)',
  }

  if (!liv) return null

  const blockColor = liv.block?.couleur || 'var(--brd-sub)'
  const livrableLabel = liv.numero ? `${liv.numero} · ${liv.nom}` : liv.nom

  return (
    <div
      style={{
        padding: '6px 8px',
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 6,
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
        }}
      >
        {/* Dot couleur du block */}
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: blockColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: 'var(--txt)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
          title={liv.block?.nom ? `${liv.block.nom} · ${livrableLabel}` : livrableLabel}
        >
          {livrableLabel}
          {liv.format && (
            <span style={{ color: 'var(--txt-3)', marginLeft: 4 }}>
              · {liv.format}
            </span>
          )}
        </span>

        {/* Statut local — dropdown si canEdit */}
        {canEdit ? (
          <select
            value={link.statut_local}
            onChange={(e) => onStatutChange(e.target.value)}
            disabled={busy}
            style={{
              fontSize: 9,
              padding: '2px 6px',
              background: palette.bg,
              color: palette.fg,
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              cursor: 'pointer',
              outline: 'none',
              flexShrink: 0,
            }}
          >
            {STATUTS_LOCAL.map((s) => (
              <option key={s} value={s}>
                {STATUT_LOCAL_LABELS[s]}
              </option>
            ))}
          </select>
        ) : (
          <span
            style={{
              fontSize: 9,
              padding: '2px 6px',
              background: palette.bg,
              color: palette.fg,
              borderRadius: 6,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              flexShrink: 0,
            }}
          >
            {STATUT_LOCAL_LABELS[link.statut_local]}
          </span>
        )}

        {canEdit && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              opacity: 0.6,
              flexShrink: 0,
            }}
            title="Retirer du livrable"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Remarque : éditable inline */}
      {editRemarque ? (
        <input
          type="text"
          value={remarque}
          onChange={(e) => setRemarque(e.target.value)}
          onBlur={() => {
            setEditRemarque(false)
            if ((remarque || '') !== (link.remarque || '')) {
              onRemarqueChange(remarque)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setRemarque(link.remarque || '')
              setEditRemarque(false)
            }
          }}
          placeholder="ex: intro, drop final, version 30s…"
          autoFocus
          disabled={busy}
          style={{
            width: '100%',
            padding: '3px 6px',
            background: 'var(--bg-surf)',
            border: '1px solid var(--blue, #3B82F6)',
            color: 'var(--txt)',
            borderRadius: 4,
            fontSize: 11,
            outline: 'none',
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => canEdit && setEditRemarque(true)}
          disabled={!canEdit}
          style={{
            background: 'transparent',
            border: 'none',
            color: link.remarque ? 'var(--txt-2)' : 'var(--txt-3)',
            cursor: canEdit ? 'text' : 'default',
            fontSize: 11,
            fontStyle: link.remarque ? 'normal' : 'italic',
            padding: 0,
            textAlign: 'left',
            opacity: link.remarque ? 1 : 0.7,
          }}
          title={canEdit ? 'Cliquer pour éditer la remarque' : undefined}
        >
          {link.remarque || (canEdit ? '+ ajouter une remarque' : '—')}
        </button>
      )}
    </div>
  )
}

// ─── LivrablesPickerModal : modal pour choisir un/des livrables (MUS-6.3) ─
// Liste les livrables du projet groupés par bloc, marque les déjà liés
// (clic = remove), permet de chercher par nom/numéro.
function LivrablesPickerModal({
  projectId,
  propositionId,
  existingLinks,
  onClose,
  onLinked,
}) {
  const [livrables, setLivrables] = useState([])
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setLoading(true)
    Promise.all([fetchLivrables(projectId), fetchBlocks(projectId)])
      .then(([livs, blks]) => {
        if (cancelled) return
        setLivrables(livs || [])
        setBlocks(blks || [])
      })
      .catch((e) => {
        console.warn('[Picker] load failed', e)
        if (!cancelled) notify.error('Chargement des livrables KO')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Index des liens existants par livrable_id pour marquer "déjà lié"
  const linkedByLivrable = useMemo(() => {
    const m = new Map()
    for (const lk of existingLinks || []) m.set(lk.livrable_id, lk)
    return m
  }, [existingLinks])

  // Filtrage + groupage par bloc
  // MUS-6.7 : on exclut les livrables marqués hidden_in_musique
  // (masquage global) — ils ne doivent pas apparaître dans le picker.
  const filteredByBlock = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = livrables.filter((l) => {
      if (l.hidden_in_musique) return false
      if (!q) return true
      const text = `${l.numero || ''} ${l.nom || ''} ${l.format || ''}`.toLowerCase()
      return text.includes(q)
    })
    const byBlock = new Map()
    for (const l of filtered) {
      if (!byBlock.has(l.block_id)) byBlock.set(l.block_id, [])
      byBlock.get(l.block_id).push(l)
    }
    return blocks
      .map((b) => ({ block: b, items: byBlock.get(b.id) || [] }))
      .filter((g) => g.items.length > 0)
  }, [livrables, blocks, search])

  async function handleToggle(livrableId) {
    setBusyId(livrableId)
    const existing = linkedByLivrable.get(livrableId)
    try {
      if (existing) {
        await removeLink(existing.id)
      } else {
        await linkPropositionToLivrable(propositionId, livrableId)
      }
      onLinked?.()
    } catch (e) {
      console.warn('[Picker] toggle failed', e)
      notify.error(e?.message || 'Lien KO')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
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
          width: 'min(480px, 100%)',
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
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <Film size={14} style={{ color: 'var(--txt-2)' }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)' }}>
            Lier à un livrable
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: 'var(--txt-3)',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div
          style={{
            padding: 10,
            borderBottom: '1px solid var(--brd-sub)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
              borderRadius: 6,
            }}
          >
            <SearchIcon size={12} style={{ color: 'var(--txt-3)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer par numéro, nom, format…"
              autoFocus
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
        </div>

        {/* Liste */}
        <div
          style={{
            padding: 10,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {loading && (
            <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
              Chargement…
            </div>
          )}
          {!loading && filteredByBlock.length === 0 && livrables.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--txt-3)',
                fontStyle: 'italic',
                padding: 8,
              }}
            >
              Aucun livrable dans ce projet. Crée-en depuis l&apos;onglet
              Livrables d&apos;abord.
            </div>
          )}
          {!loading && filteredByBlock.length === 0 && livrables.length > 0 && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--txt-3)',
                fontStyle: 'italic',
                padding: 8,
              }}
            >
              Aucun livrable ne matche &quot;{search}&quot;.
            </div>
          )}
          {filteredByBlock.map(({ block, items }) => (
            <div key={block.id}>
              <div
                style={{
                  fontSize: 9,
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                  color: 'var(--txt-3)',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: block.couleur || 'var(--brd-sub)',
                  }}
                />
                {block.nom || 'Sans nom'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {items.map((l) => {
                  const linked = linkedByLivrable.has(l.id)
                  const busy = busyId === l.id
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => handleToggle(l.id)}
                      disabled={busy}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '5px 8px',
                        background: linked
                          ? 'rgba(34,197,94,0.08)'
                          : 'transparent',
                        border: `1px solid ${
                          linked ? 'rgba(34,197,94,0.35)' : 'var(--brd-sub)'
                        }`,
                        borderRadius: 4,
                        color: 'var(--txt-2)',
                        fontSize: 12,
                        textAlign: 'left',
                        cursor: busy ? 'wait' : 'pointer',
                        opacity: busy ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!busy && !linked) {
                          e.currentTarget.style.background = 'var(--bg-elev)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!linked) {
                          e.currentTarget.style.background = 'transparent'
                        }
                      }}
                    >
                      {linked ? (
                        <Check size={11} style={{ color: '#16A34A' }} />
                      ) : (
                        <PlusIcon size={11} style={{ color: 'var(--txt-3)' }} />
                      )}
                      <span style={{ flex: 1 }}>
                        {l.numero && (
                          <span
                            style={{
                              color: 'var(--txt-3)',
                              marginRight: 6,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {l.numero}
                          </span>
                        )}
                        {l.nom}
                        {l.format && (
                          <span
                            style={{ color: 'var(--txt-3)', marginLeft: 4 }}
                          >
                            · {l.format}
                          </span>
                        )}
                      </span>
                      {linked && (
                        <span
                          style={{
                            fontSize: 9,
                            color: '#16A34A',
                            fontWeight: 500,
                          }}
                        >
                          LIÉ
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
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

// ─── ProposerAvatarInline : mini avatar + nom pour le footer drawer ──────
// Pattern aligné avec celui de PropositionRow (cohérence visuelle).
// Avatar 16px + initiales + nom à droite.
function ProposerAvatarInline({ proposer }) {
  if (!proposer) return null
  const name =
    proposer.full_name ||
    proposer.email?.split('@')[0] ||
    'inconnu'
  const initials = (name.match(/[A-Za-zÀ-ÿ0-9]/g) || ['?'])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const color = hashColorFromName(name)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: color.bg,
          color: color.fg,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 8,
          fontWeight: 600,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {initials}
      </span>
      <span style={{ color: 'var(--txt-2)' }}>{name}</span>
    </span>
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
