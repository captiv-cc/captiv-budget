// ════════════════════════════════════════════════════════════════════════════
// AddPropositionModal — Modal d'ajout d'une proposition musicale
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.9
//
// Modal qui combine la barre de recherche unifiée + le rendu des résultats
// + la création de la proposition en BDD.
//
// 3 flows utilisateur :
//
//   FLOW 1 (Deezer) — Tape un texte libre
//     User : tape "horsegiirl eat sleep"
//     UnifiedSearchBar → resolveQuery → searchDeezer
//     Modal : affiche 5-10 résultats Deezer (cover, artist, title, BPM badge,
//             play preview 30s, bouton "Ajouter")
//     User : click "Ajouter" sur le bon match
//     Modal : getDeezerTrack pour BPM + détails → mapDeezerToProposition →
//             findByNomFlou(artiste) → createProposition → close
//
//   FLOW 2 (YouTube) — Colle un lien YouTube
//     User : colle "https://youtu.be/CfOYq4Dv4CQ"
//     UnifiedSearchBar → resolveQuery → resolveFromUrl (oEmbed)
//     Modal : affiche preview (titre extrait, artiste parsé, thumbnail).
//             Tente un searchDeezer en arrière-plan avec artiste+titre pour
//             matcher Deezer (preview 30s + BPM en bonus).
//             Si match Deezer trouvé → propose les deux + utilisateur
//             choisit.
//     User : click "Ajouter"
//     Modal : crée la proposition avec lien_youtube + (si match) Deezer
//
//   FLOW 3 (Manuel) — Click "Saisie manuelle"
//     User : click le lien sous la barre
//     Modal : remplace les résultats par un formulaire artist/title/yt/notes
//     User : remplit + Ajouter
//     Modal : findByNomFlou → createProposition
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import {
  X,
  Play,
  Plus,
  Check,
  Loader2,
  AlertCircle,
  Edit3,
  Youtube,
  ArrowLeft,
} from 'lucide-react'
import UnifiedSearchBar from './UnifiedSearchBar'
import {
  getDeezerTrack,
  searchDeezer,
  mapDeezerToProposition,
} from '../../lib/musiqueSearch'
import {
  createProposition,
  findSimilarProposition,
} from '../../lib/musiques'
import {
  findByNomFlou,
  searchSuggestions,
  normalizeNom,
} from '../../lib/projetArtistes'
import { notify } from '../../lib/notify'

export default function AddPropositionModal({
  open,
  projectId,
  onClose,
  onCreated,
}) {
  // ─── State ────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState({ kind: 'empty' })
  const [adding, setAdding] = useState(false)
  // Mode manuel = formulaire texte direct
  const [manualMode, setManualMode] = useState(false)
  // Preview du player Deezer audio (1 à la fois)
  const [playingId, setPlayingId] = useState(null)
  const [audioEl, setAudioEl] = useState(null)
  // Pour le mode YouTube : on tente un match Deezer en arrière-plan
  // pour bénéficier de preview 30s + BPM.
  const [youtubeDeezerMatch, setYoutubeDeezerMatch] = useState(null)
  // Détection doublons : warning à afficher avant la création
  // { artiste, titre, exact: [...], similar: [...], onConfirm }
  const [duplicateWarning, setDuplicateWarning] = useState(null)

  // Reset à chaque ouverture
  useEffect(() => {
    if (open) {
      setQuery('')
      setSearchResult({ kind: 'empty' })
      setAdding(false)
      setManualMode(false)
      setPlayingId(null)
      setYoutubeDeezerMatch(null)
      setDuplicateWarning(null)
    } else {
      // Stop le preview audio si on ferme
      audioEl?.pause?.()
    }
    // audioEl ne doit pas être dans deps (sinon boucle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape' && !adding) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, adding, onClose])

  // ─── Handler de résolution (passé à UnifiedSearchBar) ──────────────────────
  const handleResolve = useCallback(
    async (result) => {
      setSearchResult(result || { kind: 'empty' })
      // Pour le mode YouTube : tente un match Deezer en arrière-plan
      // pour proposer un fallback avec preview + BPM.
      if (result?.kind === 'youtube' && result.artiste && result.titre) {
        try {
          const dz = await searchDeezer(
            `${result.artiste} ${result.titre}`.trim(),
            { limit: 1 },
          )
          if (dz?.tracks?.length > 0) {
            setYoutubeDeezerMatch(dz.tracks[0])
          } else {
            setYoutubeDeezerMatch(null)
          }
        } catch (e) {
          console.warn('[AddProposition] Deezer fallback failed', e)
          setYoutubeDeezerMatch(null)
        }
      } else {
        setYoutubeDeezerMatch(null)
      }
    },
    [],
  )

  // ─── Audio preview helper ─────────────────────────────────────────────────
  const togglePlay = useCallback(
    (track) => {
      const id = String(track.deezer_id)
      if (playingId === id) {
        audioEl?.pause?.()
        setPlayingId(null)
        return
      }
      if (audioEl) audioEl.pause()
      if (!track.preview_url) {
        notify.error('Pas de preview audio disponible')
        return
      }
      const audio = new Audio(track.preview_url)
      audio.volume = 0.7
      audio.play().catch((e) => {
        console.warn('[preview] play failed', e)
        notify.error('Lecture impossible')
      })
      audio.addEventListener('ended', () => setPlayingId(null))
      setAudioEl(audio)
      setPlayingId(id)
    },
    [audioEl, playingId],
  )

  // Cleanup audio à l'unmount
  useEffect(
    () => () => {
      audioEl?.pause?.()
    },
    [audioEl],
  )

  // ─── Helper : check doublons avant create ────────────────────────────────
  // Renvoie true si on peut créer, false si on attend confirmation user.
  const checkDuplicateAndProceed = useCallback(
    async (artiste, titre, doCreate) => {
      try {
        const { exact } = await findSimilarProposition(
          projectId,
          artiste,
          titre,
        )
        if (exact.length > 0) {
          // Match certain → on stoppe et on demande confirmation
          setDuplicateWarning({
            artiste,
            titre,
            existing: exact,
            onConfirmAdd: async () => {
              setDuplicateWarning(null)
              await doCreate()
            },
          })
          return false
        }
        await doCreate()
        return true
      } catch (e) {
        // Si la check de doublons fail, on ne bloque pas l'ajout
        console.warn('[AddProposition] duplicate check failed', e)
        await doCreate()
        return true
      }
    },
    [projectId],
  )

  // ─── Action principale : Ajouter à partir d'un track Deezer ──────────────
  const handleAddFromDeezer = useCallback(
    async (track, opts = {}) => {
      if (!projectId) return
      setAdding(true)
      try {
        const doCreate = async () => {
          // 1. Récupère les détails track (BPM + isrc) si on n'a pas déjà
          const full = track.bpm != null ? track : await getDeezerTrack(track.deezer_id)
          const t = full || track
          // 2. Cherche un match dans l'annuaire (artiste connu déjà ?)
          const existing = await findByNomFlou(projectId, t.artist)
          // 3. Map vers payload createProposition
          const payload = mapDeezerToProposition(t, {
            artiste_id: existing?.id || null,
          })
          if (opts.lien_youtube) {
            payload.lien_youtube = opts.lien_youtube
          }
          const created = await createProposition(projectId, payload)
          notify.success(`"${t.artist} · ${t.title}" ajouté`, false)
          onCreated?.(created)
          onClose?.()
        }
        // Check doublons avant create
        if (opts.bypassDuplicateCheck) {
          await doCreate()
        } else {
          await checkDuplicateAndProceed(track.artist, track.title, doCreate)
        }
      } catch (e) {
        console.warn('[AddProposition] failed', e)
        notify.error(e?.message || 'Erreur de création')
      } finally {
        setAdding(false)
      }
    },
    [projectId, onCreated, onClose, checkDuplicateAndProceed],
  )

  // ─── Action : Ajouter avec YouTube seul (pas de match Deezer) ────────────
  const handleAddFromYouTube = useCallback(
    async (ytData) => {
      if (!projectId) return
      setAdding(true)
      try {
        const doCreate = async () => {
          const existing = ytData.artiste
            ? await findByNomFlou(projectId, ytData.artiste)
            : null
          const created = await createProposition(projectId, {
            artiste_id: existing?.id || null,
            artiste_text: existing ? null : ytData.artiste,
            titre: ytData.titre,
            lien_youtube: ytData.canonical_url,
            cover_url: ytData.thumbnail_url,
          })
          notify.success(`"${ytData.artiste} · ${ytData.titre}" ajouté`, false)
          onCreated?.(created)
          onClose?.()
        }
        await checkDuplicateAndProceed(ytData.artiste, ytData.titre, doCreate)
      } catch (e) {
        console.warn('[AddProposition] yt failed', e)
        notify.error(e?.message || 'Erreur de création')
      } finally {
        setAdding(false)
      }
    },
    [projectId, onCreated, onClose, checkDuplicateAndProceed],
  )

  if (!open) return null

  return (
    <div
      onClick={() => !adding && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
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
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {manualMode && (
              <button
                type="button"
                onClick={() => setManualMode(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--txt-3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
                title="Revenir à la recherche"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--txt)' }}>
              {manualMode ? 'Saisie manuelle' : 'Ajouter une proposition'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => !adding && onClose?.()}
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
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflow: 'auto',
          }}
        >
          {/* Warning doublon — surcouche prioritaire si présent */}
          {duplicateWarning && (
            <DuplicateWarning
              warning={duplicateWarning}
              onCancel={() => setDuplicateWarning(null)}
              busy={adding}
            />
          )}

          {!manualMode && !duplicateWarning ? (
            <>
              <UnifiedSearchBar
                value={query}
                onChange={setQuery}
                onResolve={handleResolve}
                autoFocus
                isBusy={adding}
                disabled={adding}
              />

              {/* Hint sous la barre */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: 'var(--txt-3)',
                }}
              >
                <AlertCircle size={12} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>
                  Tape un titre ou artiste, ou colle un lien YouTube
                  <span style={{ opacity: 0.6 }}>
                    {' · '}
                    Recherche par description bientôt (MVP5)
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setManualMode(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--blue, #3B82F6)',
                    cursor: 'pointer',
                    fontSize: 11,
                    textDecoration: 'underline',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    flexShrink: 0,
                  }}
                >
                  <Edit3 size={11} />
                  Saisie manuelle
                </button>
              </div>

              {/* ─── Résultats Deezer ──────────────────────────────────────── */}
              {searchResult.kind === 'deezer' && (
                <DeezerResults
                  tracks={searchResult.tracks || []}
                  playingId={playingId}
                  onPlay={togglePlay}
                  onAdd={handleAddFromDeezer}
                  adding={adding}
                />
              )}

              {/* ─── Résultat YouTube ──────────────────────────────────────── */}
              {searchResult.kind === 'youtube' && (
                <YouTubeResult
                  ytData={searchResult}
                  deezerMatch={youtubeDeezerMatch}
                  playingId={playingId}
                  onPlay={togglePlay}
                  onAddYT={() => handleAddFromYouTube(searchResult)}
                  onAddDeezer={() =>
                    handleAddFromDeezer(youtubeDeezerMatch, {
                      lien_youtube: searchResult.canonical_url,
                    })
                  }
                  adding={adding}
                />
              )}

              {/* ─── Erreur ─────────────────────────────────────────────── */}
              {searchResult.kind === 'error' && (
                <div
                  style={{
                    padding: 12,
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    color: '#EF4444',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  {searchResult.error || 'Erreur de recherche'}
                </div>
              )}

              {/* ─── Empty (rien tapé encore) ──────────────────────────────── */}
              {searchResult.kind === 'empty' && query.trim() === '' && (
                <div
                  style={{
                    padding: '24px 12px',
                    textAlign: 'center',
                    color: 'var(--txt-3)',
                    fontSize: 12,
                    fontStyle: 'italic',
                    background: 'var(--bg-elev)',
                    border: '1px dashed var(--brd-sub)',
                    borderRadius: 6,
                  }}
                >
                  Cherche un artiste ou titre, ou colle un lien YouTube
                  pour voir les résultats ici.
                </div>
              )}
            </>
          ) : manualMode && !duplicateWarning ? (
            <ManualForm
              projectId={projectId}
              onCancel={() => setManualMode(false)}
              onCreated={(p) => {
                onCreated?.(p)
                onClose?.()
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Sous-composants
// ═══════════════════════════════════════════════════════════════════════════

// ─── DuplicateWarning : panneau anti-doublon ─────────────────────────────
function DuplicateWarning({ warning, onCancel, busy }) {
  const { artiste, titre, existing, onConfirmAdd } = warning
  return (
    <div
      style={{
        padding: 14,
        background: 'rgba(245,158,11,0.06)',
        border: '1px solid rgba(245,158,11,0.4)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <AlertCircle
          size={16}
          style={{ color: '#F59E0B', marginTop: 1, flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)' }}
          >
            Doublon détecté
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--txt-2)',
              marginTop: 3,
            }}
          >
            <span style={{ fontWeight: 500 }}>
              {artiste} · {titre}
            </span>{' '}
            est déjà dans la liste :
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginLeft: 24,
        }}
      >
        {existing.map((p) => (
          <div
            key={p.id}
            style={{
              padding: '6px 10px',
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
              borderRadius: 4,
              fontSize: 12,
              color: 'var(--txt-2)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ flex: 1 }}>
              {p.artiste?.nom || p.artiste_text || '—'} · {p.titre}
            </span>
            <span
              style={{
                fontSize: 9,
                padding: '1px 5px',
                background: 'var(--bg-surf)',
                borderRadius: 6,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'var(--txt-3)',
              }}
            >
              {p.statut}
            </span>
            {p.created_at && (
              <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>
                {new Date(p.created_at).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: '7px 12px',
            background: 'transparent',
            border: '1px solid var(--brd-sub)',
            color: 'var(--txt-2)',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Annuler — ne pas ajouter
        </button>
        <button
          type="button"
          onClick={onConfirmAdd}
          disabled={busy}
          style={{
            padding: '7px 12px',
            background: '#F59E0B',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {busy ? (
            <Loader2 size={12} className="spin" />
          ) : (
            <Plus size={12} />
          )}
          Ajouter quand même
        </button>
      </div>
    </div>
  )
}

function DeezerResults({ tracks, playingId, onPlay, onAdd, adding }) {
  if (tracks.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: 'center',
          color: 'var(--txt-3)',
          fontSize: 12,
          fontStyle: 'italic',
          background: 'var(--bg-elev)',
          border: '1px dashed var(--brd-sub)',
          borderRadius: 6,
        }}
      >
        Aucun résultat Deezer pour cette recherche. Essaie d&apos;autres
        mots-clés ou utilise la saisie manuelle.
      </div>
    )
  }
  return (
    <div>
      <SectionLabel>{tracks.length} résultats Deezer</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tracks.map((t, idx) => (
          <DeezerRow
            key={t.deezer_id}
            track={t}
            isBest={idx === 0}
            isPlaying={playingId === String(t.deezer_id)}
            onPlay={() => onPlay(t)}
            onAdd={() => onAdd(t)}
            adding={adding}
          />
        ))}
      </div>
    </div>
  )
}

function DeezerRow({ track, isBest, isPlaying, onPlay, onAdd, adding }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 8,
        borderRadius: 6,
        border: isBest
          ? '2px solid rgba(59,130,246,0.5)'
          : '1px solid var(--brd-sub)',
        background: isBest ? 'rgba(59,130,246,0.06)' : 'transparent',
      }}
    >
      <img
        src={track.cover_small || ''}
        alt=""
        style={{
          width: 36,
          height: 36,
          borderRadius: 4,
          background: 'var(--bg-elev)',
          objectFit: 'cover',
          flexShrink: 0,
        }}
        onError={(e) => {
          e.target.style.visibility = 'hidden'
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--txt)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {track.artist} · {track.title}
          {isBest && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                color: 'var(--blue, #3B82F6)',
                fontWeight: 400,
              }}
            >
              Meilleur match
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2 }}>
          {track.album ? `${track.album} · ` : ''}
          {formatDuration(track.duration_sec)}
          {track.bpm ? ` · ${track.bpm} BPM` : ''}
          {track.rank ? ` · ${formatRank(track.rank)}` : ''}
          {track.explicit ? ' · explicit' : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={onPlay}
        disabled={!track.preview_url}
        title={
          track.preview_url
            ? isPlaying
              ? 'Mettre en pause'
              : 'Écouter les 30s preview'
            : 'Pas de preview disponible'
        }
        style={{
          width: 30,
          height: 30,
          padding: 0,
          borderRadius: '50%',
          background: track.preview_url ? '#FF6E37' : 'var(--bg-elev)',
          color: track.preview_url ? 'white' : 'var(--txt-3)',
          border: 'none',
          cursor: track.preview_url ? 'pointer' : 'not-allowed',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isPlaying ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
      </button>
      <button
        type="button"
        onClick={onAdd}
        disabled={adding}
        style={{
          padding: '6px 12px',
          fontSize: 11,
          fontWeight: 500,
          background: 'var(--blue, #3B82F6)',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: adding ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          opacity: adding ? 0.6 : 1,
          flexShrink: 0,
        }}
      >
        {adding ? <Loader2 size={11} className="spin" /> : <Plus size={11} />}
        Ajouter
      </button>
    </div>
  )
}

function YouTubeResult({
  ytData,
  deezerMatch,
  playingId,
  onPlay,
  onAddYT,
  onAddDeezer,
  adding,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          padding: '8px 12px',
          background: 'rgba(34,197,94,0.06)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 6,
          fontSize: 12,
          color: '#22C55E',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Check size={14} />
        Lien YouTube détecté · titre extrait via oEmbed
      </div>

      <div
        style={{
          padding: 12,
          border: '1px solid var(--brd-sub)',
          borderRadius: 6,
          display: 'flex',
          gap: 10,
        }}
      >
        {ytData.thumbnail_url && (
          <img
            src={ytData.thumbnail_url}
            alt=""
            style={{
              width: 90,
              aspectRatio: '16/9',
              borderRadius: 4,
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 2 }}>
            <Youtube
              size={12}
              style={{
                color: '#FF0000',
                verticalAlign: 'middle',
                marginRight: 4,
              }}
            />
            {ytData.author_name || 'Chaîne YouTube'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt)', marginBottom: 8 }}>
            {ytData.video_title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>Parsé en →</div>
          <div style={{ display: 'flex', gap: 12, fontSize: 13, marginTop: 4 }}>
            <span>
              <span style={{ color: 'var(--txt-3)' }}>Artiste : </span>
              <span style={{ fontWeight: 500 }}>{ytData.artiste || '?'}</span>
            </span>
            <span>
              <span style={{ color: 'var(--txt-3)' }}>Titre : </span>
              <span style={{ fontWeight: 500 }}>{ytData.titre || '?'}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Match Deezer secondaire si trouvé */}
      {deezerMatch && (
        <div>
          <SectionLabel>Match Deezer (preview 30s + BPM)</SectionLabel>
          <DeezerRow
            track={deezerMatch}
            isBest
            isPlaying={playingId === String(deezerMatch.deezer_id)}
            onPlay={() => onPlay(deezerMatch)}
            onAdd={onAddDeezer}
            adding={adding}
          />
          <div
            style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 6 }}
          >
            En cliquant Ajouter sur le match Deezer, on combine YouTube +
            Deezer (lien complet + preview rapide + BPM).
          </div>
        </div>
      )}

      {/* Bouton "Ajouter avec YouTube seul" */}
      <button
        type="button"
        onClick={onAddYT}
        disabled={adding || !ytData.titre}
        style={{
          padding: '8px 14px',
          fontSize: 12,
          fontWeight: 500,
          background: deezerMatch ? 'transparent' : 'var(--blue, #3B82F6)',
          color: deezerMatch ? 'var(--txt-2)' : 'white',
          border: deezerMatch
            ? '1px solid var(--brd-sub)'
            : '1px solid var(--blue, #3B82F6)',
          borderRadius: 4,
          cursor: adding ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          alignSelf: 'flex-end',
          opacity: adding ? 0.6 : 1,
        }}
      >
        {adding ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}
        {deezerMatch ? 'Ajouter YouTube seul' : 'Ajouter avec YouTube'}
      </button>
    </div>
  )
}

function ManualForm({ projectId, onCancel, onCreated }) {
  const [artisteText, setArtisteText] = useState('')
  const [matchedArtiste, setMatchedArtiste] = useState(null)
  const [titre, setTitre] = useState('')
  const [lienYoutube, setLienYoutube] = useState('')
  const [remarques, setRemarques] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [saving, setSaving] = useState(false)

  // Suggestion artiste en temps réel
  useEffect(() => {
    let cancelled = false
    if (!projectId || artisteText.trim().length < 2) {
      setSuggestions([])
      setMatchedArtiste(null)
      return undefined
    }
    const timer = setTimeout(async () => {
      try {
        const list = await searchSuggestions(projectId, artisteText, 5)
        if (cancelled) return
        setSuggestions(list || [])
        // Auto-match exact
        const norm = normalizeNom(artisteText)
        const exact = list?.find((a) => a.nom_normalise === norm)
        setMatchedArtiste(exact || null)
      } catch (e) {
        console.warn('[ManualForm] suggestion failed', e)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [artisteText, projectId])

  async function handleSubmit() {
    if (!titre.trim() || !artisteText.trim()) {
      notify.error('Artiste et titre requis')
      return
    }
    setSaving(true)
    try {
      const payload = {
        artiste_id: matchedArtiste?.id || null,
        artiste_text: matchedArtiste ? null : artisteText.trim(),
        titre: titre.trim(),
        lien_youtube: lienYoutube.trim() || null,
        remarques: remarques.trim() || null,
      }
      const created = await createProposition(projectId, payload)
      notify.success(`"${artisteText} · ${titre}" ajouté`, false)
      onCreated?.(created)
    } catch (e) {
      console.warn('[ManualForm] failed', e)
      notify.error(e?.message || 'Erreur de création')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Artiste avec suggestions */}
      <div style={{ position: 'relative' }}>
        <FormLabel>Artiste *</FormLabel>
        <input
          type="text"
          value={artisteText}
          onChange={(e) => setArtisteText(e.target.value)}
          placeholder="Nom de l'artiste"
          autoFocus
          style={inputStyle()}
        />
        {matchedArtiste && (
          <div
            style={{
              fontSize: 10,
              color: '#22C55E',
              marginTop: 3,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Check size={11} />
            Lié à l&apos;annuaire ({matchedArtiste.jour || 'jour non précisé'})
          </div>
        )}
        {!matchedArtiste && suggestions.length > 0 && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--txt-3)',
              marginTop: 3,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            <span>Suggestions :</span>
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setArtisteText(s.nom)}
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 8,
                  padding: '0 6px',
                  fontSize: 10,
                  color: 'var(--txt-2)',
                  cursor: 'pointer',
                }}
              >
                {s.nom}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <FormLabel>Titre *</FormLabel>
        <input
          type="text"
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          placeholder="Nom du morceau"
          style={inputStyle()}
        />
      </div>

      <div>
        <FormLabel>Lien YouTube</FormLabel>
        <input
          type="text"
          value={lienYoutube}
          onChange={(e) => setLienYoutube(e.target.value)}
          placeholder="https://youtu.be/…"
          style={inputStyle()}
        />
      </div>

      <div>
        <FormLabel>Remarques</FormLabel>
        <textarea
          value={remarques}
          onChange={(e) => setRemarques(e.target.value)}
          placeholder="Timecode précis, contexte, conditions…"
          rows={2}
          style={{ ...inputStyle(), resize: 'vertical' }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            padding: '8px 14px',
            background: 'transparent',
            border: '1px solid var(--brd-sub)',
            color: 'var(--txt-2)',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !artisteText.trim() || !titre.trim()}
          style={{
            padding: '8px 14px',
            background: 'var(--blue, #3B82F6)',
            color: 'white',
            border: '1px solid var(--blue, #3B82F6)',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            cursor: saving ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}
          Ajouter
        </button>
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers UI
// ═══════════════════════════════════════════════════════════════════════════

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: 'var(--txt-3)',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  )
}

function FormLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--txt-3)',
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  )
}

function inputStyle() {
  return {
    width: '100%',
    padding: '8px 10px',
    background: 'var(--bg-elev)',
    border: '1px solid var(--brd-sub)',
    borderRadius: 4,
    color: 'var(--txt)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  }
}

function formatDuration(sec) {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatRank(rank) {
  // Deezer rank = nombre absolu (millions). On compact pour lisibilité.
  if (rank >= 1_000_000) return `${(rank / 1_000_000).toFixed(1)}M plays`
  if (rank >= 1_000) return `${Math.round(rank / 1_000)}k plays`
  return `${rank} plays`
}
