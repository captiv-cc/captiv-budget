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
  MessageCircle,
  MessageSquarePlus,
  Youtube,
} from 'lucide-react'

// Helper : format compact jour ("Vendredi 21 août" → "Ven 21")
function formatJourShort(jour) {
  if (!jour) return null
  const trimmed = jour.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s+/)
  const first = parts[0] || ''
  const second = parts[1] || ''
  const day = first.length <= 4 ? first : first.slice(0, 3)
  if (second && /^\d+/.test(second)) return `${day} ${second.match(/^\d+/)[0]}`
  return day
}
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

  // Livrables groupés par bloc — on filtre les masqués (cohérence avec
  // la vue Attribution : hidden_in_musique cache le livrable de toute
  // la chaîne musique).
  const livrablesByBlock = useMemo(() => {
    const m = new Map()
    for (const l of livrables) {
      if (l.hidden_in_musique) continue
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

      {/* MUS-6.8 v2 : 3 sections empilées VERTICALEMENT pour plus de
          largeur sur chaque track (meta + remarque visibles en ligne). */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {STATUTS_LOCAL.map((s) => (
          <SectionRow
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

// ─── SectionRow : une bande horizontale (Proposition / Choix / Validé) ──
// Layout vertical : les 3 sections d'un livrable sont empilées les unes
// sous les autres. Chaque section = bandeau header + liste de tracks
// pleine largeur de la card. Plus de place pour les meta + remarques.
function SectionRow({
  statut,
  links,
  propositionsById,
  aggregates,
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
  onOpenDetail,
  onMutated,
}) {
  const palette = STATUT_LOCAL_COLORS[statut] || {
    bg: 'var(--bg-elev)',
    fg: 'var(--txt-3)',
  }
  // MUS-6.8 v2 : sections vides en CHOIX / VALIDÉ pliables au démarrage
  // pour densifier la vue. Proposition reste toujours ouverte (la plus
  // utilisée). On déplie automatiquement quand on drop dessus.
  const [collapsed, setCollapsed] = useState(
    statut !== 'proposition' && links.length === 0,
  )
  // Déplie en cas de hover drop (UX : on doit voir où ça va atterrir)
  const effectiveCollapsed = collapsed && !isHover && links.length === 0
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
      {/* Section header */}
      <button
        type="button"
        onClick={() => {
          if (links.length > 0) return // pas de toggle si contenu
          setCollapsed((v) => !v)
        }}
        style={{
          width: '100%',
          padding: '6px 12px',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: links.length > 0 ? 'default' : 'pointer',
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
        {effectiveCollapsed && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: 'var(--txt-3)',
              fontStyle: 'italic',
            }}
          >
            vide
          </span>
        )}
      </button>

      {/* Setlist de cette section */}
      {!effectiveCollapsed && (
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
                padding: '10px 12px',
                textAlign: 'center',
                fontSize: 11,
                color: isHover ? palette.fg : 'var(--txt-3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                opacity: isHover ? 1 : 0.6,
                transition: 'opacity 80ms, color 80ms',
                border: `1px dashed ${
                  isHover ? palette.fg : 'var(--brd-sub)'
                }`,
                borderRadius: 4,
              }}
            >
              <Plus size={12} style={{ opacity: 0.7 }} />
              <span>
                {isHover ? `Lâcher dans ${STATUT_LOCAL_LABELS[statut]}` : 'Glisser une track ici'}
              </span>
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
      )}
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
  const agg = aggregate || { noteAvg: null, noteCount: 0, commentCount: 0 }
  const artistName = p.artiste_text || p.artiste?.nom || '—'
  const bpm = p.audio_features?.tempo > 0 ? Math.round(p.audio_features.tempo) : null

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
        // MUS-6.8 v5 : layout sur UNE seule ligne horizontale.
        // Cover + texte block (titre+meta) + remarque + X retire.
        // Tout aligné verticalement. La remarque utilise l'espace
        // restant à droite (flex grow).
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        background: hover ? 'var(--bg-elev)' : 'transparent',
        borderRadius: 4,
        cursor: canEdit ? 'grab' : 'pointer',
        opacity: isDragging ? 0.4 : busy ? 0.6 : 1,
        transition: 'background 80ms',
      }}
    >
      {/* Cover + texte (titre + meta) — pris en un seul groupe.
          Ce wrapper reste compact selon le contenu, la remarque à
          droite consomme le reste. */}
      <div
        style={{
          display: 'flex',
          flex: '0 1 auto',
          minWidth: 0,
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

        {/* Texte + meta sur 2 lignes (artiste·titre puis chips meta) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
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
          {/* Ligne meta : note, jour, BPM, commentaires, YouTube */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              alignItems: 'center',
              fontSize: 9,
              color: 'var(--txt-3)',
              marginTop: 1,
              flexWrap: 'wrap',
            }}
          >
            {agg.noteCount > 0 && (
              <span
                style={{
                  color: '#D97706',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                }}
                title={`Moyenne ${
                  Math.round((agg.noteAvg || 0) * 10) / 10
                }/5 · ${agg.noteCount} vote${agg.noteCount > 1 ? 's' : ''}`}
              >
                <Star size={8} style={{ fill: '#D97706', color: '#D97706' }} />
                {Math.round((agg.noteAvg || 0) * 10) / 10}
                <span style={{ color: 'var(--txt-3)' }}>·{agg.noteCount}</span>
              </span>
            )}
            {p.artiste?.jour && (
              <span
                style={{
                  padding: '0 3px',
                  background: 'rgba(59,130,246,0.14)',
                  color: 'var(--blue, #3B82F6)',
                  borderRadius: 2,
                  fontWeight: 600,
                  fontSize: 8,
                  lineHeight: '12px',
                }}
                title={
                  p.artiste.scene
                    ? `Joue ${p.artiste.jour} · ${p.artiste.scene}`
                    : `Joue ${p.artiste.jour}`
                }
              >
                {formatJourShort(p.artiste.jour)}
              </span>
            )}
            {bpm && (
              <span
                style={{
                  color: '#D97706',
                  fontWeight: 500,
                }}
                title="BPM"
              >
                {bpm}
              </span>
            )}
            {agg.commentCount > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                  color: 'var(--txt-3)',
                }}
                title={`${agg.commentCount} commentaire${
                  agg.commentCount > 1 ? 's' : ''
                }`}
              >
                <MessageCircle size={8} />
                {agg.commentCount}
              </span>
            )}
            {p.lien_youtube && (
              <a
                href={p.lien_youtube}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: '#FF0000',
                  display: 'inline-flex',
                  opacity: 0.75,
                  flexShrink: 0,
                }}
                title="Voir sur YouTube"
              >
                <Youtube size={10} />
              </a>
            )}
          </div>
        </div>
      </div>{/* /Cover + texte wrapper */}

      {/* MUS-6.8 v5 : zone remarque INLINE à droite (plus en dessous).
          La zone occupe l'espace restant horizontal grâce à flex 1 1 0
          avec minWidth 120 → réserve toujours sa place donc pas de
          décalage au hover. 3 états dans la zone :
            - editRemarque : input
            - link.remarque : pill amber visible toujours
            - vide : bouton "+ remarque" opacity 0→0.7 au hover */}
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
              placeholder="ex: intro, drop final, version 30s…"
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
              title={canEdit ? `${link.remarque} (cliquer pour éditer)` : link.remarque}
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
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: hover ? 0.7 : 0,
                  transition: 'opacity 80ms',
                }}
                title="Ajouter une remarque"
              >
                <MessageSquarePlus size={9} />
                remarque
              </button>
            )
          )}
        </div>

        {/* Remove (hover only) */}
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
              alignSelf: 'center',
            }}
            title="Retirer ce lien"
            aria-label="Retirer"
          >
            <X size={11} />
          </button>
        )}
    </div>
  )
}
