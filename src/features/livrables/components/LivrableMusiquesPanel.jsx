// ════════════════════════════════════════════════════════════════════════════
// LivrableMusiquesPanel — onglet "Musiques" du drawer livrable (MUS cross-module)
// ════════════════════════════════════════════════════════════════════════════
//
// Panel cross-module qui affiche la setlist musique d'un livrable
// directement depuis le drawer Livrables natif, sans passer par le module
// Musiques. Réplique le pattern de la vue Livrables du module Musiques
// (3 sections : Proposition / Choix / Validé) mais focalisé sur UN seul
// livrable.
//
// Fonctionnalités :
//   - 3 sections empilées (proposition / choix / validé) avec count
//   - Cards compactes (cover + artiste · titre + meta + remarque inline)
//   - Drag entre sections = change statut_local
//   - Edition remarque inline
//   - Bouton "+" pour ouvrir picker (propositions du projet)
//   - Bouton X pour retirer un lien
//
// Le panel fetch ses propres données (links + propositions du projet)
// au mount + à chaque mutation.
//
// Props :
//   - livrable    : livrable parent (avec id, project_id, numero, nom)
//   - canEdit     : booléen
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Music,
  Plus,
  Star,
  X,
  Search as SearchIcon,
  Play,
  Pause,
} from 'lucide-react'
import {
  listMusiquesForLivrable,
  listPropositions,
  linkPropositionToLivrable,
  updateLink,
  removeLink,
  STATUTS_LOCAL,
  STATUT_LOCAL_LABELS,
  STATUT_LOCAL_COLORS,
} from '../../../lib/musiques'
import { notify } from '../../../lib/notify'

export default function LivrableMusiquesPanel({ livrable, canEdit = true }) {
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draggingLinkId, setDraggingLinkId] = useState(null)
  const [hoverStatut, setHoverStatut] = useState(null)
  const [playingId, setPlayingId] = useState(null)
  const [audioEl, setAudioEl] = useState(null)

  const reloadLinks = useCallback(async () => {
    if (!livrable?.id) return
    setLoading(true)
    try {
      const list = await listMusiquesForLivrable(livrable.id)
      setLinks(list || [])
    } catch (e) {
      console.warn('[LivrableMusiquesPanel] load failed', e)
      notify.error(e?.message || 'Chargement KO')
    } finally {
      setLoading(false)
    }
  }, [livrable?.id])

  useEffect(() => {
    reloadLinks()
  }, [reloadLinks])

  // Audio preview - simple toggle (UN seul track joué à la fois)
  useEffect(
    () => () => {
      audioEl?.pause?.()
    },
    [audioEl],
  )
  function togglePlay(p) {
    if (!p?.preview_url) return
    if (playingId === p.id) {
      audioEl?.pause?.()
      setPlayingId(null)
      return
    }
    audioEl?.pause?.()
    const a = new Audio(p.preview_url)
    a.volume = 0.7
    a.addEventListener('ended', () => setPlayingId(null))
    a.play()
      .then(() => {
        setAudioEl(a)
        setPlayingId(p.id)
      })
      .catch((err) => {
        console.warn('[LivrableMusiquesPanel] play failed', err)
      })
  }

  // Group by statut
  const linksByStatut = useMemo(() => {
    const m = new Map(STATUTS_LOCAL.map((s) => [s, []]))
    for (const lk of links) {
      const arr = m.get(lk.statut_local)
      if (arr) arr.push(lk)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        if (a.ordre == null && b.ordre == null) return 0
        if (a.ordre == null) return 1
        if (b.ordre == null) return -1
        return a.ordre - b.ordre
      })
    }
    return m
  }, [links])

  // Drag handler : change statut_local
  async function handleDrop(targetStatut) {
    setHoverStatut(null)
    const linkId = draggingLinkId
    setDraggingLinkId(null)
    if (!linkId || !canEdit) return
    const link = links.find((lk) => lk.id === linkId)
    if (!link || link.statut_local === targetStatut) return
    try {
      await updateLink(linkId, { statut_local: targetStatut })
      reloadLinks()
    } catch (e) {
      console.warn('[LivrableMusiquesPanel] updateLink failed', e)
      notify.error(e?.message || 'Update statut KO')
    }
  }

  const totalLinks = links.length

  if (!livrable?.id) return null

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-surf)' }}>
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--brd-sub)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--bg-elev)',
          position: 'sticky',
          top: 0,
          zIndex: 2,
        }}
      >
        <Music size={14} style={{ color: 'var(--purple, #9c5ffd)' }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)' }}>
          Setlist musique
        </span>
        <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>
          ({totalLinks})
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            style={{
              marginLeft: 'auto',
              padding: '4px 10px',
              fontSize: 11,
              background: 'var(--blue, #3B82F6)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Plus size={11} />
            Ajouter
          </button>
        )}
      </div>

      {loading && links.length === 0 && (
        <div
          style={{
            padding: 20,
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--txt-3)',
          }}
        >
          Chargement…
        </div>
      )}

      {/* 3 sections empilées */}
      {STATUTS_LOCAL.map((s) => (
        <SectionRow
          key={s}
          statut={s}
          links={linksByStatut.get(s) || []}
          canEdit={canEdit}
          playingId={playingId}
          draggingLinkId={draggingLinkId}
          isHover={hoverStatut === s}
          onDragStart={(linkId) => setDraggingLinkId(linkId)}
          onDragEnd={() => {
            setDraggingLinkId(null)
            setHoverStatut(null)
          }}
          onDragOver={(e) => {
            if (draggingLinkId) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setHoverStatut(s)
            }
          }}
          onDragLeave={() => {
            if (hoverStatut === s) setHoverStatut(null)
          }}
          onDrop={() => handleDrop(s)}
          onTogglePlay={togglePlay}
          onMutated={reloadLinks}
        />
      ))}

      {pickerOpen && (
        <PickerModal
          livrable={livrable}
          existingLinks={links}
          onClose={() => setPickerOpen(false)}
          onLinked={() => {
            setPickerOpen(false)
            reloadLinks()
          }}
        />
      )}
    </div>
  )
}

// ─── SectionRow : 1 bande horizontale par section ────────────────────────
function SectionRow({
  statut,
  links,
  canEdit,
  playingId,
  draggingLinkId,
  isHover,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onTogglePlay,
  onMutated,
}) {
  const palette = STATUT_LOCAL_COLORS[statut] || {
    bg: 'var(--bg-elev)',
    fg: 'var(--txt-3)',
  }
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop?.()
      }}
      style={{
        borderTop: '1px solid var(--brd-sub)',
        background: isHover
          ? `linear-gradient(90deg, ${palette.bg}, transparent 60%)`
          : 'transparent',
        transition: 'background 80ms',
      }}
    >
      <div
        style={{
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 9,
            padding: '2px 7px',
            background: palette.bg,
            color: palette.fg,
            borderRadius: 6,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          {STATUT_LOCAL_LABELS[statut]}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--txt-3)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {links.length}
        </span>
      </div>

      <div
        style={{
          padding: '0 6px 6px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        {links.length === 0 ? (
          <div
            style={{
              margin: '0 8px',
              padding: '8px 12px',
              textAlign: 'center',
              fontSize: 10,
              color: isHover ? palette.fg : 'var(--txt-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              opacity: isHover ? 1 : 0.6,
              border: `1px dashed ${
                isHover ? palette.fg : 'var(--brd-sub)'
              }`,
              borderRadius: 4,
            }}
          >
            <Plus size={11} style={{ opacity: 0.7 }} />
            <span>
              {isHover
                ? `Lâcher dans ${STATUT_LOCAL_LABELS[statut]}`
                : 'Glisser une track ici'}
            </span>
          </div>
        ) : (
          links.map((lk) => {
            const p = lk.proposition
            if (!p) return null
            return (
              <LinkItem
                key={lk.id}
                link={lk}
                proposition={p}
                canEdit={canEdit}
                isDragging={draggingLinkId === lk.id}
                isPlaying={playingId === p.id}
                onDragStart={() => onDragStart(lk.id)}
                onDragEnd={onDragEnd}
                onTogglePlay={() => onTogglePlay?.(p)}
                onMutated={onMutated}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── LinkItem : une track ────────────────────────────────────────────────
function LinkItem({
  link,
  proposition: p,
  canEdit,
  isDragging,
  isPlaying,
  onDragStart,
  onDragEnd,
  onTogglePlay,
  onMutated,
}) {
  const [hover, setHover] = useState(false)
  const [editRemarque, setEditRemarque] = useState(false)
  const [remarque, setRemarque] = useState(link.remarque || '')
  const [busy, setBusy] = useState(false)
  const artistName = p.artiste?.nom || p.artiste_text || '—'

  async function handleSaveRemarque() {
    setEditRemarque(false)
    if ((remarque || '') === (link.remarque || '')) return
    setBusy(true)
    try {
      await updateLink(link.id, { remarque: remarque || null })
      onMutated?.()
    } catch (e) {
      console.warn('[LivrableMusiquesPanel] remarque KO', e)
      notify.error(e?.message || 'Update remarque KO')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(e) {
    e.stopPropagation()
    setBusy(true)
    try {
      await removeLink(link.id)
      onMutated?.()
    } catch (err) {
      console.warn('[LivrableMusiquesPanel] remove KO', err)
      notify.error(err?.message || 'Retrait KO')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      draggable={canEdit && !editRemarque}
      onDragStart={(e) => {
        if (!canEdit || editRemarque) return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', link.id)
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '5px 8px',
        margin: '0 4px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        background: hover ? 'var(--bg-elev)' : 'transparent',
        borderRadius: 4,
        cursor: canEdit ? 'grab' : 'default',
        opacity: isDragging ? 0.4 : busy ? 0.6 : 1,
      }}
    >
      {/* Cover + play */}
      <div
        style={{
          position: 'relative',
          width: 24,
          height: 24,
          borderRadius: 3,
          background: p.cover_url ? 'transparent' : 'var(--bg-elev)',
          backgroundImage: p.cover_url ? `url(${p.cover_url})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {p.preview_url && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onTogglePlay?.()
            }}
            title={isPlaying ? 'Pause' : 'Écouter'}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.30)',
              backdropFilter: 'blur(1.5px)',
              WebkitBackdropFilter: 'blur(1.5px)',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: 'white',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              }}
            >
              {isPlaying ? (
                <Pause size={7} fill="#FF6E37" style={{ color: '#FF6E37' }} />
              ) : (
                <Play
                  size={7}
                  fill="#FF6E37"
                  style={{ color: '#FF6E37', marginLeft: 0.5 }}
                />
              )}
            </span>
          </button>
        )}
      </div>

      {/* Texte */}
      <div
        style={{
          flex: '0 1 auto',
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontWeight: 500, color: 'var(--txt)' }}>
            {artistName}
          </span>
          <span style={{ color: 'var(--txt-3)' }}> · {p.titre}</span>
        </span>
      </div>

      {/* Remarque (inline droite) */}
      <div
        style={{
          flex: '1 1 0',
          minWidth: 120,
          maxWidth: 360,
          display: 'flex',
          alignItems: 'center',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {editRemarque ? (
          <input
            type="text"
            value={remarque}
            onChange={(e) => setRemarque(e.target.value)}
            onBlur={handleSaveRemarque}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setRemarque(link.remarque || '')
                setEditRemarque(false)
              }
            }}
            placeholder="ex: intro, drop final…"
            autoFocus
            disabled={busy}
            style={{
              width: '100%',
              padding: '3px 6px',
              background: 'var(--bg-surf)',
              border: '1px solid var(--blue, #3B82F6)',
              color: 'var(--txt)',
              borderRadius: 3,
              fontSize: 11,
              outline: 'none',
            }}
          />
        ) : link.remarque ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (canEdit) setEditRemarque(true)
            }}
            disabled={!canEdit}
            style={{
              width: '100%',
              padding: '3px 7px',
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.25)',
              borderLeft: '2px solid #D97706',
              borderRadius: 3,
              color: 'var(--txt-2)',
              cursor: canEdit ? 'text' : 'default',
              fontSize: 10,
              textAlign: 'left',
              lineHeight: 1.35,
              whiteSpace: 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {link.remarque}
          </button>
        ) : (
          canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setEditRemarque(true)
              }}
              disabled={busy}
              style={{
                width: '100%',
                padding: '3px 7px',
                background: 'transparent',
                border: '1px dashed var(--brd-sub)',
                color: 'var(--txt-3)',
                cursor: 'text',
                fontSize: 10,
                fontStyle: 'italic',
                borderRadius: 3,
                textAlign: 'left',
                opacity: hover ? 0.7 : 0,
                transition: 'opacity 80ms',
              }}
            >
              + remarque
            </button>
          )
        )}
      </div>

      {/* Note + remove */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}
      >
        {/* On n'a pas la note moyenne ni 'explicit' ici (pas en BDD pour
            l'instant — viendra en V2 du module Musiques si besoin). */}
        {canEdit && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              opacity: hover ? 0.7 : 0,
              transition: 'opacity 80ms',
            }}
            title="Retirer du livrable"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── PickerModal : sélectionne une proposition à lier au livrable ─────────
function PickerModal({ livrable, existingLinks, onClose, onLinked }) {
  const [propositions, setPropositions] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!livrable?.project_id) return
    let cancelled = false
    setLoading(true)
    listPropositions(livrable.project_id, { sort: 'created_at_desc' })
      .then((data) => {
        if (cancelled) return
        setPropositions(data || [])
      })
      .catch((e) => {
        console.warn('[PickerModal] load failed', e)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [livrable?.project_id])

  const existingIds = useMemo(
    () => new Set((existingLinks || []).map((lk) => lk.proposition_id)),
    [existingLinks],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return propositions.filter((p) => {
      if (!q) return true
      const artist = (p.artiste?.nom || p.artiste_text || '').toLowerCase()
      const title = (p.titre || '').toLowerCase()
      return artist.includes(q) || title.includes(q)
    })
  }, [propositions, search])

  async function handleLink(propId) {
    setBusyId(propId)
    try {
      await linkPropositionToLivrable(propId, livrable.id)
      onLinked?.()
    } catch (e) {
      console.warn('[PickerModal] link failed', e)
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
        zIndex: 90,
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
          width: 'min(520px, 100%)',
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
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Music size={14} style={{ color: 'var(--purple, #9c5ffd)' }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--txt)' }}>
            Lier une musique
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--txt-3)',
              padding: 4,
            }}
          >
            <X size={14} />
          </button>
        </div>

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
              placeholder="Filtrer par artiste ou titre…"
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

        <div
          style={{
            padding: 8,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {loading && (
            <div
              style={{
                padding: 20,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--txt-3)',
              }}
            >
              Chargement…
            </div>
          )}
          {!loading && propositions.length === 0 && (
            <div
              style={{
                padding: 20,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--txt-3)',
                fontStyle: 'italic',
              }}
            >
              Aucune proposition dans le module Musiques. Va dans
              l&apos;onglet Musiques pour en créer.
            </div>
          )}
          {!loading && propositions.length > 0 && filtered.length === 0 && (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--txt-3)',
                fontStyle: 'italic',
              }}
            >
              Aucune proposition ne matche &quot;{search}&quot;.
            </div>
          )}
          {filtered.map((p) => {
            const linked = existingIds.has(p.id)
            const artistName = p.artiste?.nom || p.artiste_text || '—'
            const busy = busyId === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => !linked && handleLink(p.id)}
                disabled={linked || busy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
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
                  cursor: linked ? 'default' : busy ? 'wait' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!linked && !busy) {
                    e.currentTarget.style.background = 'var(--bg-elev)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!linked) {
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 3,
                    background: p.cover_url ? 'transparent' : 'var(--bg-elev)',
                    backgroundImage: p.cover_url
                      ? `url(${p.cover_url})`
                      : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ fontWeight: 500, color: 'var(--txt)' }}>
                    {artistName}
                  </span>
                  <span style={{ color: 'var(--txt-3)' }}> · {p.titre}</span>
                </span>
                {linked && (
                  <span
                    style={{
                      fontSize: 9,
                      color: '#16A34A',
                      fontWeight: 600,
                    }}
                  >
                    DÉJÀ LIÉE
                  </span>
                )}
                {!linked && (
                  <Star
                    size={11}
                    style={{ color: 'var(--txt-3)', opacity: 0 }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
