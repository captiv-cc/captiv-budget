// ════════════════════════════════════════════════════════════════════════════
// BerceauEditor — montage d'un enchaînement musical
// ════════════════════════════════════════════════════════════════════════════
//
// À gauche les morceaux disponibles, à droite la timeline : des blocs qui
// s'enchaînent bout à bout, réordonnables au glisser-déposer, chacun coupé
// sur sa forme d'onde.
//
// Un bloc sans fichier déposé porte sur l'extrait 30 s. C'est signalé
// explicitement : on ne construit pas un berceau de quatre minutes avec des
// extraits, mais on teste très bien un ordre d'enchaînement.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical, Pause, Play, Plus, Trash2 } from 'lucide-react'
import {
  blocDureeMs,
  blocSource,
  clampCoupe,
  dureeExploitableMs,
  ecartCibleMs,
  timelineDureeMs,
  timelinePositions,
} from '../../lib/musiqueBerceaux'
import { formatMs, getPropositionAudioUrl } from '../../lib/musiqueAudio'
import WaveformMini from './WaveformMini'
import { notify } from '../../lib/notify'

export default function BerceauEditor({
  berceau,
  blocs = [],
  propositions = [],
  links = [],
  canEdit = true,
  onAddBloc,
  onUpdateBloc,
  onDeleteBloc,
  onReorder,
}) {
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  // Un berceau se monte à partir des musiques déjà attribuées au livrable ;
  // le vrac complet reste accessible d'un cran, pour aller y piocher.
  const [sourceListe, setSourceListe] = useState('livrable')

  const propById = useMemo(
    () => new Map(propositions.map((p) => [p.id, p])),
    [propositions],
  )

  // Propositions attribuées au livrable du berceau (tous statuts : une piste
  // encore au stade de proposition a toute sa place dans une maquette).
  const propsDuLivrable = useMemo(() => {
    if (!berceau?.livrable_id) return []
    const ids = new Set(
      links
        .filter((l) => l.livrable_id === berceau.livrable_id)
        .map((l) => l.proposition_id),
    )
    return propositions.filter((p) => ids.has(p.id))
  }, [links, propositions, berceau?.livrable_id])

  const listeAffichee =
    sourceListe === 'livrable' && berceau?.livrable_id ? propsDuLivrable : propositions
  const positions = useMemo(() => timelinePositions(blocs), [blocs])
  const total = timelineDureeMs(blocs)
  const ecart = ecartCibleMs(blocs, berceau?.duree_cible_ms)

  // Morceaux pas encore posés : on ne masque pas ceux déjà utilisés (un
  // même titre peut revenir deux fois dans un berceau), on les signale.
  const posesCount = useMemo(() => {
    const m = new Map()
    for (const b of blocs) m.set(b.proposition_id, (m.get(b.proposition_id) || 0) + 1)
    return m
  }, [blocs])

  function handleDrop(cibleId) {
    if (!dragId || dragId === cibleId) return
    const ordered = [...blocs].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    const from = ordered.findIndex((b) => b.id === dragId)
    const to = ordered.findIndex((b) => b.id === cibleId)
    if (from < 0 || to < 0) return
    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onReorder?.(next)
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* ── Morceaux disponibles ─────────────────────────────────────────── */}
      <aside
        className="lg:w-72 shrink-0 rounded-xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', maxHeight: 560 }}
      >
        <header
          className="px-3 py-2 shrink-0 flex items-center gap-2"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
            Morceaux
          </p>
          <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {listeAffichee.length}
          </span>
          {berceau?.livrable_id && (
            <select
              value={sourceListe}
              onChange={(e) => setSourceListe(e.target.value)}
              className="ml-auto text-[10px] px-1 py-0.5 rounded outline-none"
              style={{
                background: 'transparent',
                border: '1px solid var(--brd-sub)',
                color: 'var(--txt-3)',
              }}
              title="Où piocher les morceaux"
            >
              <option value="livrable">Du livrable</option>
              <option value="vrac">Tout le vrac</option>
            </select>
          )}
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
          {listeAffichee.length === 0 && (
            <p className="text-[11px] italic p-2" style={{ color: 'var(--txt-3)' }}>
              {berceau?.livrable_id && sourceListe === 'livrable'
                ? 'Aucune musique attribuée à ce livrable — bascule sur « Tout le vrac ».'
                : 'Aucune proposition sur ce projet.'}
            </p>
          )}
          {listeAffichee.map((p) => {
            const source = blocSource(p)
            const dejaPose = posesCount.get(p.id) || 0
            return (
              <button
                key={p.id}
                type="button"
                disabled={!canEdit || source === 'aucune'}
                onClick={() => onAddBloc?.(p)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-left disabled:opacity-40"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
                title={
                  source === 'aucune'
                    ? 'Ni fichier déposé ni extrait — rien à jouer'
                    : 'Ajouter à la fin du berceau'
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--txt)' }}>
                    {p.titre}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
                    {p.artiste_text || p.artiste?.nom || '—'}
                    {dejaPose > 0 && ` · déjà posé ${dejaPose}×`}
                  </p>
                </div>
                <SourceBadge source={source} />
                {canEdit && source !== 'aucune' && (
                  <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
                )}
              </button>
            )
          })}
        </div>
      </aside>

      {/* ── Timeline ─────────────────────────────────────────────────────── */}
      <section className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--txt)' }}>
            {formatMs(total)}
          </span>
          {berceau?.duree_cible_ms ? (
            <span
              className="text-xs font-semibold"
              style={{
                color:
                  Math.abs(ecart) < 3000
                    ? '#22c55e'
                    : ecart < 0
                      ? 'var(--txt-3)'
                      : 'var(--amber, #f59e0b)',
              }}
            >
              cible {formatMs(berceau.duree_cible_ms)} ·{' '}
              {ecart === 0
                ? 'pile'
                : ecart < 0
                  ? `il manque ${formatMs(-ecart)}`
                  : `${formatMs(ecart)} de trop`}
            </span>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              aucune durée cible
            </span>
          )}
          <span className="text-[11px] ml-auto" style={{ color: 'var(--txt-3)' }}>
            {blocs.length} bloc{blocs.length > 1 ? 's' : ''}
          </span>
        </div>

        {blocs.length === 0 && (
          <div
            className="rounded-xl p-8 text-center text-xs"
            style={{ background: 'var(--bg-surf)', border: '1px dashed var(--brd)', color: 'var(--txt-3)' }}
          >
            Ajoute un morceau depuis la colonne de gauche pour commencer.
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {positions.map(({ bloc, start_ms }) => (
            <BlocRow
              key={bloc.id}
              bloc={bloc}
              proposition={propById.get(bloc.proposition_id)}
              startMs={start_ms}
              canEdit={canEdit}
              selected={selectedId === bloc.id}
              onSelect={() => setSelectedId(selectedId === bloc.id ? null : bloc.id)}
              dragging={dragId === bloc.id}
              isOver={overId === bloc.id}
              onDragStart={() => setDragId(bloc.id)}
              onDragEnter={() => setOverId(bloc.id)}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onDrop={() => {
                handleDrop(bloc.id)
                setDragId(null)
                setOverId(null)
              }}
              onUpdate={(patch) => onUpdateBloc?.(bloc, patch)}
              onDelete={() => onDeleteBloc?.(bloc)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function SourceBadge({ source }) {
  if (source === 'fichier') return null
  const label = source === 'extrait' ? '30 s' : 'aucun'
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
      style={{
        background: 'rgba(245,158,11,0.14)',
        color: 'var(--amber, #f59e0b)',
      }}
      title={
        source === 'extrait'
          ? 'Pas de fichier déposé : seul l’extrait de 30 s est jouable'
          : 'Ni fichier ni extrait'
      }
    >
      {label}
    </span>
  )
}

// ─── Un bloc de la timeline ─────────────────────────────────────────────────

function BlocRow({
  bloc,
  proposition,
  startMs,
  canEdit,
  selected,
  onSelect,
  dragging,
  isOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  onUpdate,
  onDelete,
}) {
  const source = blocSource(proposition)
  const dureeMax = dureeExploitableMs(proposition)
  const duree = blocDureeMs(bloc)

  return (
    <div
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      className="rounded-lg px-3 py-2 flex flex-col gap-2"
      style={{
        background: 'var(--bg-surf)',
        border: `1px solid ${isOver ? 'var(--blue)' : selected ? 'var(--purple, #a78bfa)' : 'var(--brd-sub)'}`,
        opacity: dragging ? 0.5 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        {canEdit && (
          <GripVertical
            className="w-3.5 h-3.5 shrink-0 cursor-grab"
            style={{ color: 'var(--txt-3)' }}
          />
        )}
        <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--txt-3)' }}>
          {formatMs(startMs)}
        </span>
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-xs font-semibold truncate" style={{ color: 'var(--txt)' }}>
            {proposition?.titre || 'Morceau supprimé'}
          </p>
          <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
            {proposition?.artiste_text || proposition?.artiste?.nom || '—'}
          </p>
        </button>
        <SourceBadge source={source} />
        <span className="text-[11px] font-semibold tabular-nums shrink-0" style={{ color: 'var(--txt-2)' }}>
          {formatMs(duree)}
        </span>
        <BlocPreview proposition={proposition} bloc={bloc} />
        {canEdit && (
          <button
            type="button"
            onClick={onDelete}
            className="p-1 shrink-0"
            style={{ color: 'var(--txt-3)' }}
            title="Retirer du berceau"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {selected && (
        <CoupeEditor
          bloc={bloc}
          proposition={proposition}
          dureeMax={dureeMax}
          canEdit={canEdit}
          onUpdate={onUpdate}
        />
      )}
    </div>
  )
}

// ─── Coupe : poignées sur la forme d'onde ───────────────────────────────────

function CoupeEditor({ bloc, proposition, dureeMax, canEdit, onUpdate }) {
  const barRef = useRef(null)
  const [drag, setDrag] = useState(null) // 'in' | 'out' | null

  useEffect(() => {
    if (!drag || !canEdit) return undefined
    function onMove(e) {
      const rect = barRef.current?.getBoundingClientRect()
      if (!rect) return
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const ms = Math.round(ratio * dureeMax)
      const next =
        drag === 'in' ? { in_ms: ms, out_ms: bloc.out_ms } : { in_ms: bloc.in_ms, out_ms: ms }
      onUpdate(clampCoupe(next, dureeMax))
    }
    function onUp() {
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, canEdit, dureeMax, bloc.in_ms, bloc.out_ms, onUpdate])

  if (!dureeMax) return null
  const inPct = (bloc.in_ms / dureeMax) * 100
  const outPct = (bloc.out_ms / dureeMax) * 100

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={barRef}
        className="relative rounded"
        style={{ height: 40, background: 'var(--bg)', border: '1px solid var(--brd-sub)' }}
      >
        <div className="absolute inset-0 flex items-center px-0.5">
          <WaveformMini peaks={proposition?.audio_peaks} width={9999} height={36} className="w-full" />
        </div>
        {/* Hors coupe : assombri, la partie retenue reste franche. */}
        <div
          className="absolute top-0 bottom-0 left-0 rounded-l"
          style={{ width: `${inPct}%`, background: 'rgba(0,0,0,0.55)' }}
        />
        <div
          className="absolute top-0 bottom-0 right-0 rounded-r"
          style={{ width: `${100 - outPct}%`, background: 'rgba(0,0,0,0.55)' }}
        />
        {canEdit && (
          <>
            <Poignee pct={inPct} onDown={() => setDrag('in')} />
            <Poignee pct={outPct} onDown={() => setDrag('out')} />
          </>
        )}
      </div>
      <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--txt-3)' }}>
        <span>entrée {formatMs(bloc.in_ms)}</span>
        <span>sortie {formatMs(bloc.out_ms)}</span>
        {!proposition?.audio_path && (
          <span style={{ color: 'var(--amber, #f59e0b)' }}>
            extrait 30 s — dépose le fichier pour couper dans le morceau entier
          </span>
        )}
      </div>
    </div>
  )
}

function Poignee({ pct, onDown }) {
  return (
    <span
      onMouseDown={(e) => {
        e.preventDefault()
        onDown()
      }}
      className="absolute top-0 bottom-0"
      style={{
        left: `calc(${pct}% - 4px)`,
        width: 8,
        cursor: 'col-resize',
        background:
          'linear-gradient(to right, transparent 3px, var(--purple, #a78bfa) 3px 5px, transparent 5px)',
      }}
    />
  )
}

// ─── Écoute d'un bloc ───────────────────────────────────────────────────────

function BlocPreview({ proposition, bloc }) {
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)

  useEffect(() => () => audioRef.current?.pause(), [])

  async function toggle() {
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
      return
    }
    try {
      const src = proposition?.audio_path
        ? await getPropositionAudioUrl(proposition)
        : proposition?.preview_url
      if (!src) return
      const audio = audioRef.current || new Audio()
      audioRef.current = audio
      audio.src = src
      audio.currentTime = bloc.in_ms / 1000
      // On s'arrête au point de sortie : écouter la coupe, pas le morceau.
      audio.ontimeupdate = () => {
        if (audio.currentTime * 1000 >= bloc.out_ms) {
          audio.pause()
          setPlaying(false)
        }
      }
      audio.onended = () => setPlaying(false)
      await audio.play()
      setPlaying(true)
    } catch (err) {
      notify.error('Lecture : ' + (err?.message || err))
      setPlaying(false)
    }
  }

  const jouable = proposition?.audio_path || proposition?.preview_url
  if (!jouable) return null

  return (
    <button
      type="button"
      onClick={toggle}
      className="p-1 shrink-0"
      style={{ color: playing ? 'var(--purple, #a78bfa)' : 'var(--txt-3)' }}
      title="Écouter la coupe"
    >
      {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
    </button>
  )
}
