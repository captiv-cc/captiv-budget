// ════════════════════════════════════════════════════════════════════════════
// LivrablesView — Vue centrée par livrable, 3 sections (MUS-6.8.c)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue de référence pour le workflow musique-livrable. Liste les livrables
// du projet, chacun avec 3 sections internes :
//
//   1. PROPOSITION : musiques candidates pour ce livrable (toutes les liaisons
//                    par défaut au moment où on attribue depuis le vrac)
//   2. CHOIX       : shortlist — tracks retenues comme candidates sérieuses
//   3. VALIDÉ      : la/les musique(s) finale(s) du livrable
//
// Drag-drop :
//   • Glisser une track entre les 3 sections du même livrable change son
//     statut_local (proposition / choix / valide)
//   • Glisser une track entre 2 livrables différents = 2e link supplémentaire
//     (la track existe sur les 2). Pour V1 on n'autorise QUE le drag intra-
//     livrable (changement de statut). Le dispatch inter-livrable se fait
//     déjà dans la vue Attribution.
//   • Glisser pour réordonner dans la même section change l'ordre (reorderLinks)
//
// Edition fine :
//   • Remarque par couple track+livrable éditable inline
//   • Bouton X pour retirer la track du livrable
//   • Click sur la track ouvre le drawer prop (édition globale)
//
// Layout :
//   • Livrables groupés par bloc (dot couleur du bloc)
//   • Chaque livrable = 1 card empilée verticalement
//   • Dans la card : 3 sous-colonnes côte à côte (Proposition / Choix / Validé)
//   • Sur petit écran : les 3 sous-colonnes passent en empilées verticales
//
// Props :
//   - propositions   : Array (brut, on a besoin de tout pour résoudre les links)
//   - aggregates     : Map<propId, { noteAvg, noteCount, ... }>
//   - livrables      : Array (filtré côté MusiquesTab des hidden_in_musique)
//   - blocks         : Array
//   - links          : Array<{ id, proposition_id, livrable_id, ordre,
//                             remarque, statut_local }>
//   - canEdit        : si false, pas de drag
//   - playingId      : id de la track en cours de lecture audio
//   - onTogglePlay(p): toggle preview
//   - onMutated()    : refetch parent
//   - onOpenDetail(p): ouvre le drawer prop
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react'
import {
  Play,
  Pause,
  Star,
  X,
  Plus,
} from 'lucide-react'
import {
  STATUTS_LOCAL,
  STATUT_LOCAL_LABELS,
  STATUT_LOCAL_COLORS,
  updateLink,
  removeLink,
} from '../../lib/musiques'
import { notify } from '../../lib/notify'

export default function LivrablesView({
  propositions = [],
  aggregates,
  livrables = [],
  blocks = [],
  links = [],
  canEdit = true,
  playingId = null,
  onTogglePlay,
  onMutated,
  onOpenDetail,
}) {
  const [draggingLinkId, setDraggingLinkId] = useState(null)
  const [hoverDrop, setHoverDrop] = useState(null) // { livrableId, statut }

  // Resolve propositions by id pour les setlists
  const propositionsById = useMemo(() => {
    const m = new Map()
    for (const p of propositions) m.set(p.id, p)
    return m
  }, [propositions])

  // Liens par livrable / par statut local
  const linksByLivrableStatut = useMemo(() => {
    const m = new Map()
    for (const lk of links) {
      const key = `${lk.livrable_id}|${lk.statut_local}`
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(lk)
    }
    // Tri par ordre puis création
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

  // Livrables groupés par bloc
  const livrablesByBlock = useMemo(() => {
    const m = new Map()
    for (const l of livrables) {
      if (!m.has(l.block_id)) m.set(l.block_id, [])
      m.get(l.block_id).push(l)
    }
    return blocks
      .map((b) => ({ block: b, items: m.get(b.id) || [] }))
      .filter((g) => g.items.length > 0)
  }, [livrables, blocks])

  // Handler drop : change le statut_local de la track draggée
  const handleDrop = useCallback(
    async (livrableId, newStatut) => {
      setHoverDrop(null)
      const linkId = draggingLinkId
      setDraggingLinkId(null)
      if (!linkId || !canEdit) return
      const link = links.find((lk) => lk.id === linkId)
      if (!link) return
      // Seul le drop dans le MÊME livrable change le statut_local. Si on
      // dropait sur un autre livrable, on créerait un 2e lien — mais
      // pour cette vue on garde la simplicité : drag intra-livrable
      // uniquement (le dispatch inter-livrable est dans Attribution).
      if (link.livrable_id !== livrableId) {
        notify.error(
          'Pour déplacer une track entre livrables, utilise la vue Attribution',
        )
        return
      }
      if (link.statut_local === newStatut) return
      try {
        await updateLink(linkId, { statut_local: newStatut })
        onMutated?.()
      } catch (e) {
        console.warn('[LivrablesView] updateLink failed', e)
        notify.error(e?.message || 'Update statut KO')
      }
    },
    [draggingLinkId, canEdit, links, onMutated],
  )

  if (livrablesByBlock.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          color: 'var(--txt-3)',
          background: 'var(--bg-surf)',
          border: '1px dashed var(--brd-sub)',
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        Aucun livrable visible dans la chaîne musique. Crée-en depuis
        l&apos;onglet Livrables ou réaffiche des livrables masqués.
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {livrablesByBlock.map(({ block, items }) => (
        <div key={block.id}>
          <div
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              color: 'var(--txt-3)',
              marginBottom: 6,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: block.couleur || 'var(--brd-sub)',
              }}
            />
            {block.nom || 'Sans nom'}
            <span style={{ opacity: 0.6 }}>· {items.length}</span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {items.map((l) => (
              <LivrableCard
                key={l.id}
                livrable={l}
                block={block}
                linksByStatut={(s) =>
                  linksByLivrableStatut.get(`${l.id}|${s}`) || []
                }
                propositionsById={propositionsById}
                aggregates={aggregates}
                canEdit={canEdit}
                playingId={playingId}
                draggingLinkId={draggingLinkId}
                hoverDrop={hoverDrop}
                onDragStart={(linkId) => setDraggingLinkId(linkId)}
                onDragEnd={() => {
                  setDraggingLinkId(null)
                  setHoverDrop(null)
                }}
                onDragOver={(e, statut) => {
                  if (draggingLinkId) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setHoverDrop({ livrableId: l.id, statut })
                  }
                }}
                onDragLeave={(statut) => {
                  if (
                    hoverDrop?.livrableId === l.id &&
                    hoverDrop?.statut === statut
                  ) {
                    setHoverDrop(null)
                  }
                }}
                onDrop={(statut) => handleDrop(l.id, statut)}
                onTogglePlay={onTogglePlay}
                onOpenDetail={onOpenDetail}
                onMutated={onMutated}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── LivrableCard : 1 livrable avec 3 sections ───────────────────────────
function LivrableCard({
  livrable: l,
  block,
  linksByStatut,
  propositionsById,
  aggregates,
  canEdit,
  playingId,
  draggingLinkId,
  hoverDrop,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onTogglePlay,
  onOpenDetail,
  onMutated,
}) {
  const totalLinks = STATUTS_LOCAL.reduce(
    (sum, s) => sum + linksByStatut(s).length,
    0,
  )

  return (
    <div
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Header livrable */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--brd-sub)',
          background: 'var(--bg-elev)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: block.couleur || 'var(--brd-sub)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: 'var(--txt-3)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
          }}
        >
          {l.numero}
        </span>
        <span
          style={{
            fontSize: 13,
            color: 'var(--txt)',
            fontWeight: 500,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={l.nom}
        >
          {l.nom}
        </span>
        {l.format && (
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              background: 'var(--bg-surf)',
              color: 'var(--txt-3)',
              borderRadius: 4,
              fontWeight: 500,
            }}
          >
            {l.format}
          </span>
        )}
        <span
          style={{
            fontSize: 11,
            color: 'var(--txt-3)',
            fontVariantNumeric: 'tabular-nums',
          }}
          title={`${totalLinks} musique${totalLinks > 1 ? 's' : ''} liée${
            totalLinks > 1 ? 's' : ''
          }`}
        >
          {totalLinks}
        </span>
      </div>

      {/* 3 sections en grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 0,
        }}
      >
        {STATUTS_LOCAL.map((s, idx) => (
          <SectionColumn
            key={s}
            statut={s}
            links={linksByStatut(s)}
            propositionsById={propositionsById}
            aggregates={aggregates}
            canEdit={canEdit}
            playingId={playingId}
            draggingLinkId={draggingLinkId}
            isHover={
              hoverDrop?.livrableId === l.id && hoverDrop?.statut === s
            }
            // Border-right entre colonnes (sauf la dernière)
            withRightBorder={idx < STATUTS_LOCAL.length - 1}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={(e) => onDragOver?.(e, s)}
            onDragLeave={() => onDragLeave?.(s)}
            onDrop={() => onDrop?.(s)}
            onTogglePlay={onTogglePlay}
            onOpenDetail={onOpenDetail}
            onMutated={onMutated}
          />
        ))}
      </div>
    </div>
  )
}

// ─── SectionColumn : une colonne (Proposition / Choix / Validé) ──────────
function SectionColumn({
  statut,
  links,
  propositionsById,
  aggregates,
  canEdit,
  playingId,
  draggingLinkId,
  isHover,
  withRightBorder,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onTogglePlay,
  onOpenDetail,
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
        borderRight: withRightBorder ? '1px solid var(--brd-sub)' : 'none',
        background: isHover
          ? `linear-gradient(180deg, ${palette.bg}, var(--bg-surf))`
          : 'transparent',
        transition: 'background 80ms',
        minHeight: 100,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Section header */}
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--brd-sub)',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
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
            marginLeft: 'auto',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {links.length}
        </span>
      </div>

      {/* Setlist de cette section */}
      <div
        style={{
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          flex: 1,
        }}
      >
        {links.length === 0 ? (
          <div
            style={{
              padding: '10px 6px',
              textAlign: 'center',
              fontSize: 10,
              color: isHover ? palette.fg : 'var(--txt-3)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              opacity: isHover ? 1 : 0.6,
              transition: 'opacity 80ms, color 80ms',
            }}
          >
            <Plus size={12} style={{ opacity: 0.6 }} />
            <span>{isHover ? 'Lâcher ici' : 'Vide'}</span>
          </div>
        ) : (
          links.map((lk) => {
            const p = propositionsById.get(lk.proposition_id)
            if (!p) return null
            return (
              <LinkItem
                key={lk.id}
                link={lk}
                proposition={p}
                aggregate={aggregates?.get?.(p.id)}
                canEdit={canEdit}
                isDragging={draggingLinkId === lk.id}
                isPlaying={playingId === p.id}
                onDragStart={() => onDragStart(lk.id)}
                onDragEnd={onDragEnd}
                onTogglePlay={() => onTogglePlay?.(p)}
                onClick={() => onOpenDetail?.(p)}
                onMutated={onMutated}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── LinkItem : une track dans une section ───────────────────────────────
function LinkItem({
  link,
  proposition: p,
  aggregate,
  canEdit,
  isDragging,
  isPlaying,
  onDragStart,
  onDragEnd,
  onTogglePlay,
  onClick,
  onMutated,
}) {
  const [hover, setHover] = useState(false)
  const [editRemarque, setEditRemarque] = useState(false)
  const [remarque, setRemarque] = useState(link.remarque || '')
  const [busy, setBusy] = useState(false)
  const agg = aggregate || { noteAvg: null, noteCount: 0 }
  const artistName = p.artiste?.nom || p.artiste_text || '—'

  async function handleSaveRemarque() {
    setEditRemarque(false)
    if ((remarque || '') === (link.remarque || '')) return
    setBusy(true)
    try {
      await updateLink(link.id, { remarque: remarque || null })
      onMutated?.()
    } catch (e) {
      console.warn('[LinkItem] remarque KO', e)
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
      console.warn('[LinkItem] remove KO', err)
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
      onClick={(e) => {
        if (e.target.closest('button, input')) return
        onClick?.()
      }}
      style={{
        padding: '4px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        background: hover ? 'var(--bg-elev)' : 'transparent',
        borderRadius: 4,
        cursor: canEdit ? 'grab' : 'pointer',
        opacity: isDragging ? 0.4 : busy ? 0.6 : 1,
        transition: 'background 80ms',
      }}
    >
      {/* Ligne principale */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {/* Cover + play overlay */}
        <div
          style={{
            position: 'relative',
            width: 22,
            height: 22,
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
              title={isPlaying ? 'Pause' : 'Écouter le preview'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              style={{
                position: 'absolute',
                inset: 0,
                border: 'none',
                background: 'rgba(0,0,0,0.30)',
                backdropFilter: 'blur(1.5px)',
                WebkitBackdropFilter: 'blur(1.5px)',
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
                  <Pause
                    size={7}
                    fill="#FF6E37"
                    style={{ color: '#FF6E37' }}
                  />
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
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontWeight: 500, color: 'var(--txt)' }}>
            {artistName}
          </span>
          <span style={{ color: 'var(--txt-3)' }}> · {p.titre}</span>
        </div>

        {/* Note */}
        {agg.noteCount > 0 && (
          <span
            style={{
              fontSize: 10,
              color: '#D97706',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              flexShrink: 0,
            }}
            title={`Moyenne ${
              Math.round((agg.noteAvg || 0) * 10) / 10
            }/5 · ${agg.noteCount} vote${agg.noteCount > 1 ? 's' : ''}`}
          >
            <Star size={9} style={{ fill: '#D97706', color: '#D97706' }} />
            {Math.round((agg.noteAvg || 0) * 10) / 10}
          </span>
        )}

        {/* Remove */}
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
              flexShrink: 0,
            }}
            title="Retirer ce lien"
            aria-label="Retirer"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Remarque (inline editable). Si vide ET non hover ET non édition,
          on n'affiche rien pour gagner de la place. */}
      {(editRemarque || link.remarque || hover) && (
        <div style={{ paddingLeft: 27 }}>
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
                padding: '2px 5px',
                background: 'var(--bg-surf)',
                border: '1px solid var(--blue, #3B82F6)',
                color: 'var(--txt)',
                borderRadius: 3,
                fontSize: 10,
                outline: 'none',
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (canEdit) setEditRemarque(true)
              }}
              disabled={!canEdit}
              style={{
                background: 'transparent',
                border: 'none',
                color: link.remarque ? 'var(--txt-2)' : 'var(--txt-3)',
                cursor: canEdit ? 'text' : 'default',
                fontSize: 10,
                fontStyle: link.remarque ? 'normal' : 'italic',
                padding: 0,
                textAlign: 'left',
                opacity: link.remarque ? 0.85 : 0.5,
              }}
            >
              {link.remarque || (canEdit ? '+ remarque' : '')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
