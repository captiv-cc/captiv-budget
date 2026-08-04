// ════════════════════════════════════════════════════════════════════════════
// AttributionView — Vue Kanban d'attribution musiques ↔ livrables (MUS-6.4)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue dédiée au triage de masse depuis le vrac vers les livrables.
//
// Layout :
//   • Gauche : panneau vrac compact (cover + artiste·titre + ★) avec
//     filtres (recherche, statut global) et multi-sélection.
//   • Droite : panneau livrables en colonnes Kanban (1 par livrable),
//     groupées par bloc. Chaque colonne = setlist du livrable.
//
// Interactions :
//   • Drag d'une track (vrac) → drop sur livrable = link auto en fin de
//     setlist du livrable.
//   • Multi-sélect (checkbox) + drag du groupe = link N tracks d'un coup.
//   • Drag d'une track depuis une setlist livrable → autre livrable = link
//     supplémentaire (la track reste sur le précédent aussi). Drag vers le
//     vrac = retirer du livrable.
//   • Hover d'une track vrac → halo sur les livrables où elle est déjà liée.
//
// Pas de modif de l'ordre intra-livrable depuis cette vue (ça se fait
// dans le drawer livrable, MUS-6.5). Ici on dispatch.
//
// Props :
//   - propositions   : Array (filtres locaux gérés dans le composant)
//   - aggregates     : Map<propId, { noteAvg, noteCount, ... }>
//   - livrables      : Array (du projet)
//   - blocks         : Array (du projet, pour grouper les colonnes)
//   - links          : Array<{ id, proposition_id, livrable_id, statut_local }>
//   - canEdit        : si false, pas de drag possible
//   - onMutated      : appelé après link/unlink (refetch parent)
//   - onOpenDetail(p): ouvre le drawer détail
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react'
import {
  Search as SearchIcon,
  CheckSquare,
  Square,
  Film,
  Star,
  Inbox,
  Play,
  Pause,
  ArrowUpDown,
  EyeOff,
  Eye,
  PlusCircle,
} from 'lucide-react'
import {
  linkPropositionToLivrable,
  removeLink,
  STATUT_LOCAL_COLORS,
} from '../../lib/musiques'
import { setLivrableHiddenInMusique } from '../../lib/livrables'
import { notify } from '../../lib/notify'

// Helper : format compact du jour de présence artiste pour mini-pill
// ("Vendredi 21 août" → "Ven 21", "Day 1" → "Day 1"). Renvoie null si
// pas de jour.
function formatJourShort(jour) {
  if (!jour) return null
  const trimmed = jour.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s+/)
  const first = parts[0] || ''
  const second = parts[1] || ''
  // Si le premier mot fait <=4 chars (Day, J1, etc) → garder tel quel
  // sinon abréger à 3 lettres ("Vendredi" → "Ven")
  const day = first.length <= 4 ? first : first.slice(0, 3)
  // Si le 2e mot est un numéro → l'inclure
  if (second && /^\d+/.test(second)) return `${day} ${second.match(/^\d+/)[0]}`
  return day
}

// Tri du vrac dans la vue Attribution. Note desc en défaut (logique de
// triage : on commence par les meilleures).
const SORT_OPTIONS = [
  { key: 'note_desc', label: 'Mieux notées d\'abord' },
  { key: 'created_desc', label: 'Plus récentes' },
  { key: 'created_asc', label: 'Plus anciennes' },
  { key: 'artiste_asc', label: 'Artiste A→Z' },
  { key: 'titre_asc', label: 'Titre A→Z' },
  { key: 'jour_asc', label: 'Jour festival' },
]

export default function AttributionView({
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
  // ─── State : filtres vrac + sélection multiple + drag ────────────────────
  const [vracSearch, setVracSearch] = useState('')
  const [vracSort, setVracSort] = useState('note_desc')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  // Set des IDs en cours de drag (la track draggée + le reste de la
  // sélection multiple si applicable). Sert au visuel sur le vrac et
  // au drop côté livrable.
  const [draggingIds, setDraggingIds] = useState(() => new Set())
  const [hoverLivrableId, setHoverLivrableId] = useState(null)
  const [hoverVrac, setHoverVrac] = useState(false)
  // ID de la track dont on hover dans le vrac → affiche un halo sur les
  // livrables où elle est déjà liée (feedback "déjà piockée")
  const [hoverPropId, setHoverPropId] = useState(null)

  // ─── Index des liens par livrable et par proposition ─────────────────────
  const linksByLivrable = useMemo(() => {
    const m = new Map()
    for (const lk of links) {
      if (!m.has(lk.livrable_id)) m.set(lk.livrable_id, [])
      m.get(lk.livrable_id).push(lk)
    }
    return m
  }, [links])
  const linksByProposition = useMemo(() => {
    const m = new Map()
    for (const lk of links) {
      if (!m.has(lk.proposition_id)) m.set(lk.proposition_id, [])
      m.get(lk.proposition_id).push(lk)
    }
    return m
  }, [links])

  // Index propositions par id pour résolution depuis links
  const propositionsById = useMemo(() => {
    const m = new Map()
    for (const p of propositions) m.set(p.id, p)
    return m
  }, [propositions])

  // ─── Vrac filtré (search) + trié ─────────────────────────────────────────
  // Note : on retire le filtre par statut local — la barre du haut de la
  // page (header MusiquesTab) reste le seul endroit pour filtrer par statut
  // global, on évite le doublon dans le panneau vrac.
  const filteredVrac = useMemo(() => {
    const q = vracSearch.trim().toLowerCase()
    const filtered = propositions.filter((p) => {
      if (q) {
        const artist = `${p.artiste_text || ''} ${p.artiste?.nom || ''}`.toLowerCase()
        const title = (p.titre || '').toLowerCase()
        if (!artist.includes(q) && !title.includes(q)) return false
      }
      return true
    })
    const sorted = [...filtered]
    const artistName = (p) =>
      (p.artiste_text || p.artiste?.nom || '').toLowerCase()
    switch (vracSort) {
      case 'note_desc':
        sorted.sort((a, b) => {
          const aAvg = aggregates?.get?.(a.id)?.noteAvg ?? -1
          const bAvg = aggregates?.get?.(b.id)?.noteAvg ?? -1
          if (bAvg !== aAvg) return bAvg - aAvg
          return new Date(b.created_at) - new Date(a.created_at)
        })
        break
      case 'created_asc':
        sorted.sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at),
        )
        break
      case 'artiste_asc':
        sorted.sort((a, b) =>
          artistName(a).localeCompare(artistName(b), 'fr', {
            sensitivity: 'base',
          }),
        )
        break
      case 'titre_asc':
        sorted.sort((a, b) =>
          (a.titre || '').localeCompare(b.titre || '', 'fr', {
            sensitivity: 'base',
          }),
        )
        break
      case 'jour_asc':
        sorted.sort((a, b) => {
          const aj = a.artiste?.jour || ''
          const bj = b.artiste?.jour || ''
          if (aj !== bj) return aj.localeCompare(bj, 'fr')
          return artistName(a).localeCompare(artistName(b), 'fr')
        })
        break
      case 'created_desc':
      default:
        sorted.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at),
        )
    }
    return sorted
  }, [propositions, vracSearch, vracSort, aggregates])

  // ─── Livrables groupés par bloc (hors masqués) ──────────────────────────
  // MUS-6.7 : on filtre les livrables hidden_in_musique pour ne pas
  // les afficher dans la grille principale. Ils restent comptés à part
  // pour le badge "+N masqués".
  const visibleLivrables = useMemo(
    () => livrables.filter((l) => !l.hidden_in_musique),
    [livrables],
  )
  const hiddenLivrables = useMemo(
    () => livrables.filter((l) => l.hidden_in_musique),
    [livrables],
  )
  const livrablesByBlock = useMemo(() => {
    const m = new Map()
    for (const l of visibleLivrables) {
      if (!m.has(l.block_id)) m.set(l.block_id, [])
      m.get(l.block_id).push(l)
    }
    return blocks
      .map((b) => ({ block: b, items: m.get(b.id) || [] }))
      .filter((g) => g.items.length > 0)
  }, [visibleLivrables, blocks])

  // ─── Toggle hide / show livrable (MUS-6.7) ──────────────────────────────
  const handleToggleHidden = useCallback(
    async (livrable) => {
      if (!livrable?.id || !canEdit) return
      const next = !livrable.hidden_in_musique
      try {
        await setLivrableHiddenInMusique(livrable.id, next)
        notify.success(
          next
            ? `${livrable.nom || 'Livrable'} masqué de la chaîne musique`
            : `${livrable.nom || 'Livrable'} réaffiché`,
          false,
        )
        onMutated?.()
      } catch (e) {
        console.warn('[Attribution] toggleHidden failed', e)
        notify.error(e?.message || 'Toggle impossible')
      }
    },
    [canEdit, onMutated],
  )

  // ─── Multi-sélection ─────────────────────────────────────────────────────
  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  // ─── Drag & drop : link bulk ─────────────────────────────────────────────
  const handleDragStart = useCallback(
    (propId) => {
      // Si la track draggée fait partie de la sélection multiple → on drag
      // tout le groupe. Sinon → juste cette track.
      if (selectedIds.has(propId)) {
        setDraggingIds(new Set(selectedIds))
      } else {
        setDraggingIds(new Set([propId]))
      }
    },
    [selectedIds],
  )

  const handleDragEnd = useCallback(() => {
    setDraggingIds(new Set())
    setHoverLivrableId(null)
    setHoverVrac(false)
  }, [])

  const handleDropOnLivrable = useCallback(
    async (livrableId) => {
      setHoverLivrableId(null)
      const ids = [...draggingIds]
      setDraggingIds(new Set())
      if (!ids.length || !canEdit) return
      // Filter : on link seulement les pas-encore-liées à ce livrable
      // (idempotent en BDD mais évite le bruit notify).
      const existingForLivrable = new Set(
        (linksByLivrable.get(livrableId) || []).map((lk) => lk.proposition_id),
      )
      const toLink = ids.filter((id) => !existingForLivrable.has(id))
      if (!toLink.length) {
        notify.info?.(
          `Déjà ${ids.length === 1 ? 'liée' : 'liées'} à ce livrable`,
        )
        return
      }
      try {
        await Promise.allSettled(
          toLink.map((id) => linkPropositionToLivrable(id, livrableId)),
        )
        notify.success(
          `${toLink.length} ${toLink.length === 1 ? 'liée' : 'liées'}`,
          false,
        )
        onMutated?.()
      } catch (e) {
        console.warn('[Attribution] drop link failed', e)
        notify.error(e?.message || 'Lien KO')
      }
      clearSelection()
    },
    [draggingIds, canEdit, linksByLivrable, onMutated, clearSelection],
  )

  // Drag d'une chip livrable → drop sur le vrac = retire du livrable
  // (source du drag = link.id, on le passe via state local)
  const [draggingLinkId, setDraggingLinkId] = useState(null)
  const handleDropOnVrac = useCallback(async () => {
    setHoverVrac(false)
    if (!draggingLinkId || !canEdit) return
    const linkId = draggingLinkId
    setDraggingLinkId(null)
    try {
      await removeLink(linkId)
      onMutated?.()
    } catch (e) {
      console.warn('[Attribution] unlink failed', e)
      notify.error(e?.message || 'Retrait KO')
    }
  }, [draggingLinkId, canEdit, onMutated])

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 360px) 1fr',
        gap: 12,
        height: 'calc(100vh - 260px)',
        minHeight: 480,
      }}
    >
      {/* ─── PANNEAU VRAC (gauche) ──────────────────────────────────── */}
      <VracPanel
        propositions={filteredVrac}
        totalCount={propositions.length}
        aggregates={aggregates}
        linksByProposition={linksByProposition}
        selectedIds={selectedIds}
        draggingIds={draggingIds}
        hoverPropId={hoverPropId}
        onHoverProp={setHoverPropId}
        canEdit={canEdit}
        playingId={playingId}
        onTogglePlay={onTogglePlay}
        // Drop zone : si on drop un livrable-link ici, on l'unlink
        hoverActive={hoverVrac && Boolean(draggingLinkId)}
        onDragOver={(e) => {
          if (draggingLinkId) {
            e.preventDefault()
            setHoverVrac(true)
          }
        }}
        onDragLeave={() => setHoverVrac(false)}
        onDrop={handleDropOnVrac}
        search={vracSearch}
        onSearchChange={setVracSearch}
        sort={vracSort}
        onSortChange={setVracSort}
        onToggleSelected={toggleSelected}
        onClearSelection={clearSelection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onOpenDetail={onOpenDetail}
      />

      {/* ─── PANNEAU LIVRABLES (droite) ─────────────────────────────── */}
      <LivrablesPanel
        livrablesByBlock={livrablesByBlock}
        hiddenLivrables={hiddenLivrables}
        linksByLivrable={linksByLivrable}
        propositionsById={propositionsById}
        hoverPropId={hoverPropId}
        hoverLivrableId={hoverLivrableId}
        canEdit={canEdit}
        onToggleHidden={handleToggleHidden}
        onDragOver={(e, livrableId) => {
          if (draggingIds.size > 0) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setHoverLivrableId(livrableId)
          }
        }}
        onDragLeave={(livrableId) => {
          if (hoverLivrableId === livrableId) setHoverLivrableId(null)
        }}
        onDrop={handleDropOnLivrable}
        onLinkDragStart={(linkId) => setDraggingLinkId(linkId)}
        onLinkDragEnd={() => setDraggingLinkId(null)}
        onOpenDetail={(propId) => {
          const p = propositionsById.get(propId)
          if (p) onOpenDetail?.(p)
        }}
      />
    </div>
  )
}

// ─── VracPanel ────────────────────────────────────────────────────────────
function VracPanel({
  propositions,
  totalCount,
  aggregates,
  linksByProposition,
  selectedIds,
  draggingIds,
  hoverPropId,
  onHoverProp,
  canEdit,
  playingId,
  onTogglePlay,
  hoverActive,
  onDragOver,
  onDragLeave,
  onDrop,
  search,
  onSearchChange,
  sort,
  onSortChange,
  onToggleSelected,
  onClearSelection,
  onDragStart,
  onDragEnd,
  onOpenDetail,
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop?.()
      }}
      style={{
        background: 'var(--bg-surf)',
        border: `1px solid ${
          hoverActive ? 'var(--red, #EF4444)' : 'var(--brd-sub)'
        }`,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'border-color 80ms',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--brd-sub)',
          background: 'var(--bg-elev)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Inbox size={13} style={{ color: 'var(--txt-2)' }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--txt)' }}>
          Vrac
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--txt-3)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          ({propositions.length}
          {propositions.length !== totalCount ? `/${totalCount}` : ''})
        </span>
        {selectedIds.size > 0 && (
          <>
            <span style={{ color: 'var(--txt-3)', opacity: 0.5 }}>·</span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--blue, #3B82F6)',
                fontWeight: 500,
              }}
            >
              {selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={onClearSelection}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--txt-3)',
                fontSize: 10,
                cursor: 'pointer',
                padding: 0,
                textDecoration: 'underline',
              }}
            >
              clear
            </button>
          </>
        )}
      </div>

      {/* Filtres */}
      <div
        style={{
          padding: 8,
          borderBottom: '1px solid var(--brd-sub)',
          display: 'flex',
          gap: 6,
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 8px',
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd-sub)',
            borderRadius: 4,
          }}
        >
          <SearchIcon size={11} style={{ color: 'var(--txt-3)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filtrer…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--txt)',
              fontSize: 11,
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px 4px 8px',
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd-sub)',
            borderRadius: 4,
          }}
        >
          <ArrowUpDown size={10} style={{ color: 'var(--txt-3)' }} />
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
            style={{
              flex: 1,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-2)',
              fontSize: 11,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Liste */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 4,
        }}
      >
        {propositions.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: 'center',
              color: 'var(--txt-3)',
              fontSize: 11,
              fontStyle: 'italic',
            }}
          >
            {hoverActive
              ? '→ Lâcher pour retirer du livrable'
              : 'Aucune proposition.'}
          </div>
        ) : (
          propositions.map((p) => (
            <VracItem
              key={p.id}
              proposition={p}
              aggregate={aggregates?.get?.(p.id)}
              linkCount={linksByProposition.get(p.id)?.length || 0}
              selected={selectedIds.has(p.id)}
              dragging={draggingIds.has(p.id)}
              hovered={hoverPropId === p.id}
              canEdit={canEdit}
              isPlaying={playingId === p.id}
              onTogglePlay={() => onTogglePlay?.(p)}
              onMouseEnter={() => onHoverProp(p.id)}
              onMouseLeave={() => onHoverProp(null)}
              onToggleSelected={() => onToggleSelected(p.id)}
              onDragStart={() => onDragStart(p.id)}
              onDragEnd={onDragEnd}
              onClick={() => onOpenDetail?.(p)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── VracItem : 1 row track du vrac ───────────────────────────────────────
function VracItem({
  proposition: p,
  aggregate,
  linkCount,
  selected,
  dragging,
  hovered,
  canEdit,
  isPlaying,
  onTogglePlay,
  onMouseEnter,
  onMouseLeave,
  onToggleSelected,
  onDragStart,
  onDragEnd,
  onClick,
}) {
  const agg = aggregate || { noteAvg: null, noteCount: 0 }
  const artistName = p.artiste_text || p.artiste?.nom || '—'
  return (
    <div
      draggable={canEdit}
      onDragStart={(e) => {
        if (!canEdit) return
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('text/plain', p.id)
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => {
        if (e.target.closest('button, input')) return
        onClick?.()
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '18px 28px 1fr',
        gap: 6,
        alignItems: 'center',
        padding: '4px 6px',
        borderRadius: 4,
        cursor: canEdit ? 'grab' : 'pointer',
        background: selected
          ? 'rgba(59,130,246,0.10)'
          : hovered
            ? 'var(--bg-elev)'
            : 'transparent',
        opacity: dragging ? 0.4 : 1,
        transition: 'background 80ms',
      }}
    >
      {/* Checkbox sélection */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelected()
        }}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: selected ? 'var(--blue, #3B82F6)' : 'var(--txt-3)',
          cursor: 'pointer',
          display: 'inline-flex',
        }}
        aria-label={selected ? 'Désélectionner' : 'Sélectionner'}
      >
        {selected ? <CheckSquare size={13} /> : <Square size={13} />}
      </button>

      {/* Cover + bouton play overlay. La cover est légèrement floutée
          (backdrop-filter) sous l'overlay sombre subtil pour que la
          pastille play blanche ressorte sur n'importe quelle pochette
          sans clasher (notamment sur une cover orange comme PARCELS).
          Pastille play blanche unie + icône orange pour rappeler
          discrètement l'identité Deezer. */}
      <div
        style={{
          position: 'relative',
          width: 28,
          height: 28,
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
            title={
              isPlaying ? 'Pause' : 'Écouter le preview 30s'
            }
            aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{
              position: 'absolute',
              inset: 0,
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              padding: 0,
              background: 'rgba(0,0,0,0.30)',
              backdropFilter: 'blur(1.5px)',
              WebkitBackdropFilter: 'blur(1.5px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'white',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow:
                  '0 1px 3px rgba(0,0,0,0.35)',
              }}
            >
              {isPlaying ? (
                <Pause size={9} fill="#FF6E37" style={{ color: '#FF6E37' }} />
              ) : (
                <Play
                  size={9}
                  fill="#FF6E37"
                  style={{ color: '#FF6E37', marginLeft: 0.5 }}
                />
              )}
            </span>
          </button>
        )}
      </div>

      {/* Texte */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--txt)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontWeight: 500 }}>{artistName}</span>
          <span style={{ color: 'var(--txt-3)' }}> · {p.titre || '—'}</span>
        </div>
        <div
          style={{
            fontSize: 9,
            color: 'var(--txt-3)',
            display: 'flex',
            gap: 4,
            alignItems: 'center',
          }}
        >
          {/* MUS-6.4 polish : mini-pill jour de présence de l'artiste si
              connue (récupéré via projet_artistes). Bleue cohérent avec
              le badge "Joue Vendredi" du drawer. */}
          {p.artiste?.jour && (
            <span
              style={{
                padding: '0 4px',
                background: 'rgba(59,130,246,0.14)',
                color: 'var(--blue, #3B82F6)',
                borderRadius: 3,
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
          {agg.noteCount > 0 && (
            <span
              style={{
                color: '#D97706',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Star size={8} style={{ fill: '#D97706', color: '#D97706' }} />
              {Math.round((agg.noteAvg || 0) * 10) / 10}
              <span style={{ color: 'var(--txt-3)' }}>·{agg.noteCount}</span>
            </span>
          )}
          {linkCount > 0 && (
            <span
              style={{
                color: 'var(--blue, #3B82F6)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                fontWeight: 500,
              }}
              title={`Liée à ${linkCount} livrable${linkCount > 1 ? 's' : ''}`}
            >
              <Film size={8} />
              {linkCount}
            </span>
          )}
        </div>
      </div>

      {/* MUS-6.4 polish : badge statut global retiré du vrac — peu utile
          ici (on filtre déjà par statut dans la barre du haut) et libère
          de la place pour les autres meta. */}
    </div>
  )
}

// ─── LivrablesPanel ──────────────────────────────────────────────────────
function LivrablesPanel({
  livrablesByBlock,
  hiddenLivrables = [],
  linksByLivrable,
  propositionsById,
  hoverPropId,
  hoverLivrableId,
  canEdit,
  onToggleHidden,
  onDragOver,
  onDragLeave,
  onDrop,
  onLinkDragStart,
  onLinkDragEnd,
  onOpenDetail,
}) {
  const [hiddenPanelOpen, setHiddenPanelOpen] = useState(false)
  // Set des livrable_ids où la track hover est déjà liée — pour halo
  const livrablesHoverLinked = useMemo(() => {
    if (!hoverPropId) return new Set()
    const s = new Set()
    for (const [livId, lks] of linksByLivrable.entries()) {
      if (lks.some((lk) => lk.proposition_id === hoverPropId)) s.add(livId)
    }
    return s
  }, [hoverPropId, linksByLivrable])

  if (livrablesByBlock.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--txt-3)',
          background: 'var(--bg-surf)',
          border: '1px dashed var(--brd-sub)',
          borderRadius: 8,
          fontSize: 12,
        }}
      >
        Aucun livrable dans ce projet. Crée-en depuis l&apos;onglet
        Livrables d&apos;abord.
      </div>
    )
  }

  return (
    <div
      style={{
        overflowY: 'auto',
        overflowX: 'auto',
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 8,
        padding: 8,
      }}
    >
      {/* MUS-6.7 : badge "+N masqués" — visible si au moins 1 livrable
          est marqué hidden_in_musique. Cliquable pour ouvrir un panneau
          listant les masqués avec bouton ré-afficher par item. */}
      {hiddenLivrables.length > 0 && (
        <div
          style={{
            marginBottom: 10,
            padding: 0,
            background: 'transparent',
          }}
        >
          <button
            type="button"
            onClick={() => setHiddenPanelOpen((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 8px',
              fontSize: 11,
              background: 'var(--bg-elev)',
              color: 'var(--txt-3)',
              border: '1px dashed var(--brd-sub)',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            <EyeOff size={11} />
            {hiddenLivrables.length} masqué
            {hiddenLivrables.length > 1 ? 's' : ''}
            <span style={{ opacity: 0.6, marginLeft: 2 }}>
              {hiddenPanelOpen ? '▲' : '▼'}
            </span>
          </button>
          {hiddenPanelOpen && (
            <div
              style={{
                marginTop: 6,
                padding: 8,
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
                  fontSize: 9,
                  color: 'var(--txt-3)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                  marginBottom: 2,
                }}
              >
                Livrables masqués de la chaîne musique
              </div>
              {hiddenLivrables.map((l) => (
                <div
                  key={l.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 6px',
                    background: 'var(--bg-surf)',
                    borderRadius: 4,
                    fontSize: 11,
                    color: 'var(--txt-2)',
                  }}
                >
                  <span
                    style={{
                      color: 'var(--txt-3)',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                    }}
                  >
                    {l.numero}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {l.nom}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onToggleHidden?.(l)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '2px 6px',
                        background: 'transparent',
                        border: '1px solid var(--brd-sub)',
                        borderRadius: 4,
                        color: 'var(--txt-2)',
                        fontSize: 10,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-hov)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <Eye size={9} />
                      Réafficher
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {livrablesByBlock.map(({ block, items }) => (
          <div key={block.id}>
            <div
              style={{
                fontSize: 9,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                color: 'var(--txt-3)',
                marginBottom: 6,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: block.couleur || 'var(--brd-sub)',
                }}
              />
              {block.nom || 'Sans nom'}
              <span style={{ opacity: 0.6 }}>· {items.length}</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 8,
                alignItems: 'start',
              }}
            >
              {items.map((l) => (
                <LivrableColumn
                  key={l.id}
                  livrable={l}
                  block={block}
                  links={linksByLivrable.get(l.id) || []}
                  propositionsById={propositionsById}
                  hover={hoverLivrableId === l.id}
                  alreadyLinkedToHover={livrablesHoverLinked.has(l.id)}
                  canEdit={canEdit}
                  onToggleHidden={() => onToggleHidden?.(l)}
                  onDragOver={(e) => onDragOver?.(e, l.id)}
                  onDragLeave={() => onDragLeave?.(l.id)}
                  onDrop={() => onDrop?.(l.id)}
                  onLinkDragStart={onLinkDragStart}
                  onLinkDragEnd={onLinkDragEnd}
                  onOpenDetail={onOpenDetail}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── LivrableColumn : 1 card livrable avec mini-setlist + drop zone ──────
function LivrableColumn({
  livrable: l,
  block,
  links,
  propositionsById,
  hover,
  alreadyLinkedToHover,
  canEdit,
  onToggleHidden,
  onDragOver,
  onDragLeave,
  onDrop,
  onLinkDragStart,
  onLinkDragEnd,
  onOpenDetail,
}) {
  const [headerHover, setHeaderHover] = useState(false)
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop?.()
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: hover
          ? `linear-gradient(180deg, ${block.couleur ? block.couleur + '14' : 'rgba(59,130,246,0.06)'}, var(--bg-elev))`
          : 'var(--bg-elev)',
        border: `1px solid ${
          hover
            ? block.couleur || 'var(--blue, #3B82F6)'
            : alreadyLinkedToHover
              ? 'rgba(34,197,94,0.5)'
              : 'var(--brd-sub)'
        }`,
        borderRadius: 6,
        minHeight: 100,
        overflow: 'hidden',
        boxShadow: alreadyLinkedToHover
          ? '0 0 0 2px rgba(34,197,94,0.15)'
          : 'none',
        transition: 'border-color 80ms, box-shadow 80ms',
      }}
    >
      {/* Header */}
      <div
        onMouseEnter={() => setHeaderHover(true)}
        onMouseLeave={() => setHeaderHover(false)}
        style={{
          padding: '5px 8px',
          borderBottom: '1px solid var(--brd-sub)',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--txt-3)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
          }}
        >
          {l.numero}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--txt)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
          title={l.nom}
        >
          {l.nom}
        </span>
        {/* MUS-6.7 : bouton EyeOff hover-only pour masquer ce livrable
            de la chaîne musique (action globale, gated par canEdit). */}
        {canEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleHidden?.()
            }}
            title="Masquer ce livrable de la chaîne musique"
            aria-label="Masquer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              padding: 0,
              opacity: headerHover ? 0.7 : 0,
              transition: 'opacity 80ms',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = headerHover ? '0.7' : '0'
            }}
          >
            <EyeOff size={11} />
          </button>
        )}
        <span
          style={{
            fontSize: 10,
            color: 'var(--txt-3)',
            fontVariantNumeric: 'tabular-nums',
          }}
          title={`${links.length} musique${links.length > 1 ? 's' : ''}`}
        >
          {links.length}
        </span>
      </div>

      {/* Setlist mini */}
      <div
        style={{
          padding: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minHeight: 40,
        }}
      >
        {links.length === 0 ? (
          <div
            style={{
              fontSize: 10,
              color: hover ? 'var(--blue, #3B82F6)' : 'var(--txt-3)',
              padding: '8px 4px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              opacity: hover ? 1 : 0.7,
              transition: 'opacity 80ms, color 80ms',
            }}
          >
            <PlusCircle size={14} style={{ opacity: 0.6 }} />
            <span>{hover ? 'Lâcher ici' : 'Glisse une track'}</span>
          </div>
        ) : (
          links.map((lk) => {
            const p = propositionsById.get(lk.proposition_id)
            if (!p) return null
            const artistName = p.artiste_text || p.artiste?.nom || '—'
            const palette = STATUT_LOCAL_COLORS[lk.statut_local] || {
              bg: 'var(--bg-surf)',
              fg: 'var(--txt-3)',
            }
            return (
              // MUS-6.4 polish v2 : aplatissement — plus de background +
              // border par track. Juste un mini-dot couleur statut_local à
              // gauche (3px) qui sert d'indicateur sans alourdir le visuel.
              // Hover discret pour signaler la cliquabilité.
              <div
                key={lk.id}
                draggable={canEdit}
                onDragStart={(e) => {
                  if (!canEdit) return
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', lk.id)
                  onLinkDragStart?.(lk.id)
                }}
                onDragEnd={onLinkDragEnd}
                onClick={() => onOpenDetail?.(p.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 4px 2px 2px',
                  cursor: canEdit ? 'grab' : 'pointer',
                  fontSize: 10,
                  borderRadius: 3,
                  transition: 'background 80ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-surf)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
                title={
                  lk.remarque
                    ? `${artistName} · ${p.titre} — ${lk.remarque}`
                    : `${artistName} · ${p.titre}`
                }
              >
                {/* Dot couleur statut_local (3px barre verticale) */}
                <span
                  style={{
                    width: 3,
                    height: 14,
                    background: palette.fg,
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 2,
                    background: p.cover_url
                      ? 'transparent'
                      : 'var(--bg-surf)',
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
                    color: 'var(--txt-2)',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{artistName}</span>
                  <span style={{ color: 'var(--txt-3)' }}> · {p.titre}</span>
                </span>
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
                      flexShrink: 0,
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
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
