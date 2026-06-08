// ════════════════════════════════════════════════════════════════════════════
// PropositionRow — Row d'une proposition musicale dans la liste
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.11
//
// Rendu d'une proposition dans la vue liste de MusiquesTab. Affiche :
//   - Cover (image Deezer/YouTube ou initiales artiste sur fond couleur
//     déterministe)
//   - Artiste · Titre + badge "Joue Jx · Scène" si lié à l'annuaire
//   - Tags chips compacts + badge BPM si audio_features.tempo
//   - Note moyenne ★ + nb votes (à droite)
//   - Statut badge si pas noté
//   - Bouton play preview 30s (Deezer/Spotify) si preview_url
//   - Bouton lien YouTube full
//
// Props :
//   - proposition : row depuis listPropositions (avec artiste joint)
//   - aggregate   : objet { noteAvg, noteCount, myNote, tags } depuis
//                   computeAggregates
//   - isPlaying   : true si cette row est en cours de lecture audio
//   - onTogglePlay(preview_url) : toggle play du preview
//   - onClick     : ouvre le détail (futur)
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  Play,
  Pause,
  Youtube,
  MoreHorizontal,
  Trash2,
  AlertTriangle,
  MessageCircle,
  CheckSquare,
  Square,
  GripVertical,
} from 'lucide-react'
import {
  STATUTS,
  STATUT_LABELS,
  upsertMyNote,
  removeMyNote,
  setStatut,
  deleteProposition,
} from '../../lib/musiques'
import { notify } from '../../lib/notify'
import StarRating from './StarRating'
import TagsEditor from './TagsEditor'

// Couleurs pâles déterministes pour les initiales artiste (Tailwind 300
// palette, cohérent avec la palette V3 des types de créneaux).
const INITIAL_COLORS = [
  { bg: '#FCD34D', fg: '#78350F' }, // amber
  { bg: '#93C5FD', fg: '#1E3A8A' }, // blue
  { bg: '#FDA4AF', fg: '#881337' }, // rose
  { bg: '#5EEAD4', fg: '#134E4A' }, // teal
  { bg: '#C4B5FD', fg: '#4338CA' }, // violet
  { bg: '#FDBA74', fg: '#7C2D12' }, // orange
  { bg: '#67E8F9', fg: '#155E75' }, // cyan
  { bg: '#A5B4FC', fg: '#3730A3' }, // indigo
  { bg: '#FCA5A5', fg: '#7F1D1D' }, // red
  { bg: '#D8B4FE', fg: '#581C87' }, // purple
]

function hashColorFromName(name) {
  let h = 0
  const s = name || '?'
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return INITIAL_COLORS[h % INITIAL_COLORS.length]
}

// ─── ProposerAvatar : mini avatar du proposeur (initiales + tooltip) ──────
function ProposerAvatar({ proposer, createdAt, onClick }) {
  const name =
    proposer?.full_name ||
    proposer?.email?.split('@')[0] ||
    'inconnu'
  const initials = (name.match(/[A-Za-zÀ-ÿ0-9]/g) || ['?'])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const color = hashColorFromName(name)
  const dateStr = createdAt
    ? new Date(createdAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
      })
    : ''
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation()
              onClick()
            }
          : undefined
      }
      title={
        onClick
          ? `Filtrer les propositions de ${name}${dateStr ? ` (ajoutée le ${dateStr})` : ''}`
          : `Proposé par ${name}${dateStr ? ` le ${dateStr}` : ''}`
      }
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: color.bg,
        color: color.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 8,
        fontWeight: 600,
        flexShrink: 0,
        cursor: onClick ? 'pointer' : 'help',
        opacity: 0.75,
        border: 'none',
        padding: 0,
      }}
    >
      {initials}
    </Comp>
  )
}

export default function PropositionRow({
  proposition: p,
  aggregate,
  isPlaying = false,
  onTogglePlay,
  onClick,
  // Permission + identité user pour les actions notes/tags
  canEdit = true,
  currentUserId = null,
  projectId = null,
  onMutated, // appelé après note/tag changes pour refetch optionnel
  // MUS-3.1 : filtres rapides
  onTagClick,
  onJourClick,
  onProposerClick,
  // MUS-3.3 : multi-sélection
  selected = false,
  onToggleSelected,
  anySelected = false,
  // MUS-3.5 : drag and drop
  enableDnD = false,
  isDragging = false,
  dropTarget = null, // 'above' | 'below' | null
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}) {
  const agg = aggregate || {
    noteAvg: null,
    noteCount: 0,
    myNote: null,
    tags: [],
  }
  const artistName = p.artiste?.nom || p.artiste_text || '—'

  // Handler vote
  async function handleSetNote(value) {
    if (!canEdit) return
    try {
      if (value === 0) {
        await removeMyNote(p.id)
      } else {
        await upsertMyNote(p.id, value)
      }
      onMutated?.()
    } catch (e) {
      console.warn('[PropositionRow] note failed', e)
      notify.error(e?.message || 'Impossible de noter')
    }
  }
  const initials = (artistName.match(/[A-Za-zÀ-ÿ0-9]/)?.[0] || '?').toUpperCase()
  const color = hashColorFromName(artistName)
  // Filtre bpm > 0 : Deezer renvoie parfois bpm=0 pour les tracks sans
  // tempo détecté. Sans ce filtre, React rend littéralement "0" à
  // l'écran (parce que `{bpm && ...}` avec bpm=0 retourne 0).
  const bpm = p.audio_features?.tempo > 0 ? p.audio_features.tempo : null
  const hasPreview = Boolean(p.preview_url)
  const hasYoutube = Boolean(p.lien_youtube)

  const [hovered, setHovered] = useState(false)
  // Réservation TOUJOURS de la col checkbox quand canEdit, pour éviter
  // le shift horizontal au hover. On joue juste sur la visibilité.
  const showCheckboxCol = canEdit
  const checkboxVisible = canEdit && (anySelected || hovered || selected)
  const showDnDCol = enableDnD
  const dndVisible = enableDnD && (hovered || isDragging)

  // DnD handlers (HTML5)
  function handleNativeDragStart(e) {
    if (!enableDnD) return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', p.id)
    onDragStart?.(p)
  }
  function handleNativeDragOver(e) {
    if (!enableDnD) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position = e.clientY < midY ? 'above' : 'below'
    onDragOver?.(p, position)
  }
  function handleNativeDrop(e) {
    if (!enableDnD) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position = e.clientY < midY ? 'above' : 'below'
    onDrop?.(p, position)
  }
  function handleNativeDragEnd() {
    onDragEnd?.()
  }

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      draggable={enableDnD}
      onDragStart={handleNativeDragStart}
      onDragOver={handleNativeDragOver}
      onDrop={handleNativeDrop}
      onDragEnd={handleNativeDragEnd}
      onMouseEnter={(e) => {
        setHovered(true)
        e.currentTarget.style.background = 'var(--bg-elev)'
      }}
      onMouseLeave={(e) => {
        setHovered(false)
        e.currentTarget.style.background = 'transparent'
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: `${showDnDCol ? '14px ' : ''}${showCheckboxCol ? '22px ' : ''}40px 1fr auto`,
        gap: 12,
        padding: '8px 14px',
        alignItems: 'center',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 80ms, opacity 80ms',
        opacity: isDragging ? 0.4 : 1,
        // Indicateur drop : bordure haut/bas selon position
        borderTop: dropTarget === 'above'
          ? '2px solid var(--blue, #3B82F6)'
          : '2px solid transparent',
        borderBottom: dropTarget === 'below'
          ? '2px solid var(--blue, #3B82F6)'
          : '2px solid transparent',
        marginTop: dropTarget === 'above' ? -2 : 0,
        marginBottom: dropTarget === 'below' ? -2 : 0,
      }}
    >
      {/* Drag handle (MUS-3.5) — col toujours réservée si enableDnD */}
      {showDnDCol && (
        <span
          style={{
            display: 'inline-flex',
            color: 'var(--txt-3)',
            cursor: 'grab',
            opacity: dndVisible ? 0.6 : 0,
            visibility: dndVisible ? 'visible' : 'hidden',
            transition: 'opacity 80ms',
          }}
          title="Glisser pour réordonner"
          aria-hidden={!dndVisible}
        >
          <GripVertical size={12} />
        </span>
      )}
      {/* Checkbox sélection (MUS-3.3) — col toujours réservée si canEdit */}
      {showCheckboxCol && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelected?.()
          }}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: selected ? 'var(--blue, #3B82F6)' : 'var(--txt-3)',
            display: 'inline-flex',
            opacity: selected ? 1 : checkboxVisible ? 0.6 : 0,
            visibility: checkboxVisible ? 'visible' : 'hidden',
            transition: 'opacity 80ms',
          }}
          aria-label={selected ? 'Désélectionner' : 'Sélectionner'}
          tabIndex={checkboxVisible ? 0 : -1}
        >
          {selected ? <CheckSquare size={16} /> : <Square size={16} />}
        </button>
      )}

      {/* ─── Cover ──────────────────────────────────────────────────── */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 4,
          background: p.cover_url ? 'transparent' : color.bg,
          backgroundImage: p.cover_url ? `url(${p.cover_url})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 500,
          color: color.fg,
          flexShrink: 0,
        }}
      >
        {!p.cover_url && initials}
      </div>

      {/* ─── Contenu : titre + tags + badges ───────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--txt)',
            }}
          >
            {artistName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>·</span>
          <span style={{ fontSize: 13, color: 'var(--txt-2)' }}>{p.titre}</span>
          {p.artiste?.jour && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onJourClick?.(p.artiste.jour)
              }}
              style={{
                fontSize: 10,
                padding: '1px 5px',
                background: 'rgba(59,130,246,0.12)',
                color: 'var(--blue, #3B82F6)',
                borderRadius: 6,
                border: 'none',
                cursor: onJourClick ? 'pointer' : 'default',
              }}
              title={
                p.artiste.scene
                  ? `Filtrer Joue ${p.artiste.jour} sur ${p.artiste.scene}`
                  : `Filtrer Joue ${p.artiste.jour}`
              }
            >
              Joue {p.artiste.jour}
              {p.artiste.scene ? ` · ${p.artiste.scene}` : ''}
            </button>
          )}
        </div>

        {/* Tags editor (collab) + audio-features badges sur la même ligne */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginTop: 4,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <TagsEditor
            propositionId={p.id}
            projectId={projectId}
            currentUserId={currentUserId}
            tags={agg.tags}
            canEdit={canEdit}
            onChange={onMutated}
            onTagClick={onTagClick}
          />
          {bpm && (
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                background: 'rgba(245,158,11,0.10)',
                color: '#D97706',
                borderRadius: 8,
                fontWeight: 500,
              }}
              title="BPM (Deezer audio-features)"
            >
              {Math.round(bpm)} BPM
            </span>
          )}
        </div>
      </div>

      {/* ─── Right : note + actions ─────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        {/* Compteur commentaires (visible si > 0) */}
        {agg.commentCount > 0 && (
          <div
            title={`${agg.commentCount} commentaire${agg.commentCount > 1 ? 's' : ''}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '2px 6px',
              background: 'var(--bg-elev)',
              borderRadius: 10,
              color: 'var(--txt-3)',
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            <MessageCircle size={11} />
            {agg.commentCount}
          </div>
        )}

        {/* Avatar proposeur (très discret, tooltip clair, click = filtre) */}
        {p.proposer && (
          <ProposerAvatar
            proposer={p.proposer}
            createdAt={p.created_at}
            onClick={
              onProposerClick
                ? () => onProposerClick(p.proposer.id)
                : null
            }
          />
        )}

        {/* Note ★ cliquable + statut compact */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 2,
            minWidth: 90,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <StarRating
            myValue={agg.myNote}
            avgValue={agg.noteAvg}
            count={agg.noteCount}
            onChange={handleSetNote}
            disabled={!canEdit}
            size={13}
          />
          {/* Sous les étoiles : soit la moyenne+count, soit juste le
              badge statut (sans "pas noté" qui était redondant avec
              les étoiles vides). */}
          <span
            style={{
              fontSize: 10,
              color: 'var(--txt-3)',
              display: 'inline-flex',
              gap: 4,
              alignItems: 'center',
            }}
          >
            {agg.noteCount > 0 && (
              <span style={{ color: '#D97706', fontWeight: 500 }}>
                {agg.noteAvg} · {agg.noteCount}
              </span>
            )}
            <span
              style={{
                padding: '1px 6px',
                background:
                  p.statut === 'vrac'
                    ? 'var(--bg-elev)'
                    : 'rgba(59,130,246,0.12)',
                color:
                  p.statut === 'vrac'
                    ? 'var(--txt-2)'
                    : 'var(--blue, #3B82F6)',
                borderRadius: 6,
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                fontSize: 9,
              }}
            >
              {STATUT_LABELS[p.statut] || p.statut}
            </span>
          </span>
        </div>

        {/* Bouton play preview */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (hasPreview) onTogglePlay?.(p)
          }}
          disabled={!hasPreview}
          title={
            hasPreview
              ? isPlaying
                ? 'Mettre en pause'
                : 'Écouter le preview 30s'
              : 'Pas de preview audio disponible'
          }
          style={{
            width: 32,
            height: 32,
            padding: 0,
            borderRadius: '50%',
            background: hasPreview ? '#FF6E37' : 'transparent',
            color: hasPreview ? 'white' : 'var(--txt-3)',
            border: hasPreview ? 'none' : '1px solid var(--brd-sub)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: hasPreview ? 'pointer' : 'not-allowed',
            opacity: hasPreview ? 1 : 0.4,
            flexShrink: 0,
          }}
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} />}
        </button>

        {/* Bouton lien YouTube */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (hasYoutube) window.open(p.lien_youtube, '_blank', 'noopener')
          }}
          disabled={!hasYoutube}
          title={hasYoutube ? 'Voir la version complète sur YouTube' : 'Pas de lien YouTube'}
          style={{
            width: 32,
            height: 32,
            padding: 0,
            borderRadius: '50%',
            background: 'transparent',
            border: '1px solid var(--brd-sub)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: hasYoutube ? 'pointer' : 'not-allowed',
            opacity: hasYoutube ? 1 : 0.3,
            flexShrink: 0,
          }}
        >
          <Youtube size={15} style={{ color: hasYoutube ? '#FF0000' : 'var(--txt-3)' }} />
        </button>

        {/* Menu actions rapides (statut + supprimer) */}
        {canEdit && (
          <QuickActionsMenu
            proposition={p}
            onMutated={onMutated}
          />
        )}
      </div>
    </div>
  )
}

// ─── QuickActionsMenu : "..." popover avec changer statut + supprimer ──────
function QuickActionsMenu({ proposition: p, onMutated }) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      if (ref.current?.contains(e.target)) return
      setOpen(false)
      setConfirmDelete(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        setOpen(false)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleStatutChange(newStatut) {
    if (newStatut === p.statut) {
      setOpen(false)
      return
    }
    setBusy(true)
    try {
      await setStatut(p.id, newStatut)
      onMutated?.()
      setOpen(false)
    } catch (e) {
      console.warn('[QuickActions] statut', e)
      notify.error(e?.message || 'Changement statut KO')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    try {
      await deleteProposition(p.id)
      notify.success('Proposition supprimée', false)
      onMutated?.()
      setOpen(false)
    } catch (e) {
      console.warn('[QuickActions] delete', e)
      notify.error(e?.message || 'Suppression KO')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={ref}
      style={{ position: 'relative', flexShrink: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title="Actions rapides"
        style={{
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: '50%',
          background: 'transparent',
          border: 'none',
          color: 'var(--txt-3)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            minWidth: 180,
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {/* Section statut */}
          <div
            style={{
              fontSize: 9,
              padding: '4px 8px',
              color: 'var(--txt-3)',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            Changer le statut
          </div>
          {STATUTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleStatutChange(s)}
              disabled={busy}
              style={{
                padding: '6px 10px',
                background:
                  s === p.statut ? 'var(--bg-elev)' : 'transparent',
                border: 'none',
                color: 'var(--txt-2)',
                fontSize: 12,
                textAlign: 'left',
                borderRadius: 4,
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onMouseEnter={(e) => {
                if (!busy) e.currentTarget.style.background = 'var(--bg-elev)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  s === p.statut ? 'var(--bg-elev)' : 'transparent'
              }}
            >
              {s === p.statut && (
                <span style={{ fontSize: 10, color: 'var(--blue, #3B82F6)' }}>
                  ✓
                </span>
              )}
              <span style={{ flex: 1 }}>{STATUT_LABELS[s]}</span>
            </button>
          ))}
          <div
            style={{
              borderTop: '1px solid var(--brd-sub)',
              margin: '4px 0',
            }}
          />
          {/* Supprimer */}
          {confirmDelete ? (
            <div
              style={{
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <AlertTriangle size={12} style={{ color: '#EF4444' }} />
              <span style={{ fontSize: 11, color: '#EF4444', flex: 1 }}>
                Sûr ?
              </span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                style={{
                  padding: '3px 8px',
                  background: '#EF4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: 3,
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                Supprimer
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                style={{
                  padding: '3px 6px',
                  background: 'transparent',
                  border: '1px solid var(--brd-sub)',
                  color: 'var(--txt-2)',
                  borderRadius: 3,
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                Annuler
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              style={{
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                color: '#EF4444',
                fontSize: 12,
                textAlign: 'left',
                borderRadius: 4,
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onMouseEnter={(e) => {
                if (!busy)
                  e.currentTarget.style.background = 'rgba(239,68,68,0.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <Trash2 size={11} />
              Supprimer la proposition
            </button>
          )}
        </div>
      )}
    </div>
  )
}
