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

import { Play, Pause, Youtube } from 'lucide-react'
import {
  STATUT_LABELS,
  upsertMyNote,
  removeMyNote,
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
  const bpm = p.audio_features?.tempo
  const hasPreview = Boolean(p.preview_url)
  const hasYoutube = Boolean(p.lien_youtube)

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr auto',
        gap: 12,
        padding: '10px 14px',
        alignItems: 'center',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 80ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-elev)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
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
            <span
              style={{
                fontSize: 10,
                padding: '1px 5px',
                background: 'rgba(59,130,246,0.12)',
                color: 'var(--blue, #3B82F6)',
                borderRadius: 6,
              }}
              title={
                p.artiste.scene
                  ? `Joue ${p.artiste.jour} sur ${p.artiste.scene}`
                  : `Joue ${p.artiste.jour}`
              }
            >
              Joue {p.artiste.jour}
              {p.artiste.scene ? ` · ${p.artiste.scene}` : ''}
            </span>
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
          <span
            style={{
              fontSize: 10,
              color: 'var(--txt-3)',
              display: 'inline-flex',
              gap: 4,
              alignItems: 'center',
            }}
          >
            {agg.noteCount > 0 ? (
              <span>
                {agg.noteAvg} · {agg.noteCount} vote{agg.noteCount > 1 ? 's' : ''}
              </span>
            ) : (
              <span style={{ opacity: 0.7 }}>pas noté</span>
            )}
            <span
              style={{
                padding: '0 5px',
                background: 'var(--bg-elev)',
                borderRadius: 6,
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
      </div>
    </div>
  )
}
