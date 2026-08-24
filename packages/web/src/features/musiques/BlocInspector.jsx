// ════════════════════════════════════════════════════════════════════════════
// BlocInspector — recoupage fin du bloc sélectionné
// ════════════════════════════════════════════════════════════════════════════
//
// La timeline montre la portion retenue ; ici on voit le MORCEAU ENTIER avec
// la zone gardée en clair. C'est le seul endroit où l'on peut décider de
// prendre le refrain plutôt que l'intro : sur la bande, un bloc de dix
// secondes est trop étroit pour viser.
//
// Écoute bornée à la coupe, saisie des points au clavier pour la précision,
// et fondus.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Scissors } from 'lucide-react'
import { formatMs, getPropositionAudioUrl } from '../../lib/musiqueAudio'
import { clampCoupe, dureeExploitableMs } from '../../lib/musiqueBerceaux'
import WaveformMini from './WaveformMini'
import { notify } from '../../lib/notify'

export default function BlocInspector({ bloc, proposition, canEdit, onUpdate }) {
  const barRef = useRef(null)
  const audioRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [tete, setTete] = useState(null) // position d'écoute, en ms du morceau

  const dureeMax = dureeExploitableMs(proposition)

  useEffect(() => {
    if (!drag || !canEdit) return undefined
    function onMove(e) {
      const rect = barRef.current?.getBoundingClientRect()
      if (!rect) return
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const ms = Math.round(ratio * dureeMax)
      onUpdate(
        clampCoupe(
          drag === 'in' ? { in_ms: ms, out_ms: bloc.out_ms } : { in_ms: bloc.in_ms, out_ms: ms },
          dureeMax,
        ),
      )
    }
    const onUp = () => setDrag(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, canEdit, dureeMax, bloc.in_ms, bloc.out_ms, onUpdate])

  useEffect(() => {
    // Changer de bloc coupe l'écoute en cours : sinon deux morceaux
    // se superposent.
    audioRef.current?.pause()
    setPlaying(false)
    setTete(null)
  }, [bloc.id])

  useEffect(() => () => audioRef.current?.pause(), [])

  async function toggleEcoute(depuisMs = bloc.in_ms) {
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
      if (audio.src !== src) audio.src = src
      audio.currentTime = depuisMs / 1000
      audio.ontimeupdate = () => {
        setTete(audio.currentTime * 1000)
        if (audio.currentTime * 1000 >= bloc.out_ms) {
          audio.pause()
          setPlaying(false)
        }
      }
      await audio.play()
      setPlaying(true)
    } catch (err) {
      notify.error('Lecture : ' + (err?.message || err))
    }
  }

  /** Pose un point à la volée pendant l'écoute : le geste naturel. */
  function poserPoint(quel) {
    if (tete == null) return
    const ms = Math.round(tete)
    onUpdate(
      clampCoupe(
        quel === 'in' ? { in_ms: ms, out_ms: bloc.out_ms } : { in_ms: bloc.in_ms, out_ms: ms },
        dureeMax,
      ),
    )
  }

  if (!proposition) return null
  const inPct = dureeMax ? (bloc.in_ms / dureeMax) * 100 : 0
  const outPct = dureeMax ? (bloc.out_ms / dureeMax) * 100 : 100
  const tetePct = dureeMax && tete != null ? (tete / dureeMax) * 100 : null

  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => toggleEcoute()}
          className="p-1.5 rounded-lg shrink-0"
          style={{ background: 'var(--bg-elev)', color: 'var(--purple, #a78bfa)' }}
          title="Écouter la coupe"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <div className="min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: 'var(--txt)' }}>
            {proposition.titre}
          </p>
          <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
            {proposition.artiste_text || proposition.artiste?.nom || ''}
            {!proposition.audio_path && ' · extrait 30 s'}
          </p>
        </div>
        <span className="ml-auto text-xs font-bold tabular-nums" style={{ color: 'var(--txt-2)' }}>
          {formatMs(bloc.out_ms - bloc.in_ms)}
        </span>
      </div>

      {/* Morceau entier, zone retenue en clair */}
      <div
        ref={barRef}
        className="relative rounded"
        style={{ height: 72, background: 'var(--bg)', border: '1px solid var(--brd-sub)' }}
        onDoubleClick={(e) => {
          // Double-clic : écouter à partir d'ici, sans changer la coupe.
          const rect = e.currentTarget.getBoundingClientRect()
          const ms = ((e.clientX - rect.left) / rect.width) * dureeMax
          toggleEcoute(ms)
        }}
      >
        <div className="absolute inset-0 flex items-center px-1 pointer-events-none">
          <WaveformMini peaks={proposition.audio_peaks} width={2000} height={64} className="w-full" />
        </div>
        <div
          className="absolute top-0 bottom-0 left-0 rounded-l pointer-events-none"
          style={{ width: `${inPct}%`, background: 'rgba(0,0,0,0.6)' }}
        />
        <div
          className="absolute top-0 bottom-0 right-0 rounded-r pointer-events-none"
          style={{ width: `${100 - outPct}%`, background: 'rgba(0,0,0,0.6)' }}
        />
        {tetePct != null && (
          <span
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${tetePct}%`, width: 2, background: 'var(--blue)' }}
          />
        )}
        {canEdit && (
          <>
            <PoigneeVerticale pct={inPct} onDown={() => setDrag('in')} />
            <PoigneeVerticale pct={outPct} onDown={() => setDrag('out')} />
          </>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <ChampTemps
            label="Entrée"
            valueMs={bloc.in_ms}
            onCommit={(ms) => onUpdate(clampCoupe({ in_ms: ms, out_ms: bloc.out_ms }, dureeMax))}
          />
          <ChampTemps
            label="Sortie"
            valueMs={bloc.out_ms}
            onCommit={(ms) => onUpdate(clampCoupe({ in_ms: bloc.in_ms, out_ms: ms }, dureeMax))}
          />
          <button
            type="button"
            onClick={() => poserPoint('in')}
            disabled={tete == null}
            className="flex items-center gap-1 px-2 py-1 rounded-md disabled:opacity-40"
            style={{ color: 'var(--txt-2)', border: '1px solid var(--brd-sub)' }}
            title="Poser l'entrée là où on écoute"
          >
            <Scissors className="w-3 h-3" />
            entrée ici
          </button>
          <button
            type="button"
            onClick={() => poserPoint('out')}
            disabled={tete == null}
            className="flex items-center gap-1 px-2 py-1 rounded-md disabled:opacity-40"
            style={{ color: 'var(--txt-2)', border: '1px solid var(--brd-sub)' }}
            title="Poser la sortie là où on écoute"
          >
            <Scissors className="w-3 h-3" />
            sortie ici
          </button>

          <label className="flex items-center gap-1 ml-auto" style={{ color: 'var(--txt-3)' }}>
            fondu entrée
            <input
              type="number"
              min={0}
              step={100}
              value={bloc.fade_in_ms || 0}
              onChange={(e) => onUpdate({ fade_in_ms: Math.max(0, Number(e.target.value) || 0) })}
              className="w-14 px-1 py-0.5 rounded outline-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd-sub)', color: 'var(--txt)' }}
            />
          </label>
          <label className="flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
            sortie
            <input
              type="number"
              min={0}
              step={100}
              value={bloc.fade_out_ms || 0}
              onChange={(e) => onUpdate({ fade_out_ms: Math.max(0, Number(e.target.value) || 0) })}
              className="w-14 px-1 py-0.5 rounded outline-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd-sub)', color: 'var(--txt)' }}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function PoigneeVerticale({ pct, onDown }) {
  return (
    <span
      onMouseDown={(e) => {
        e.preventDefault()
        onDown()
      }}
      className="absolute top-0 bottom-0"
      style={{
        left: `calc(${pct}% - 5px)`,
        width: 10,
        cursor: 'col-resize',
        background:
          'linear-gradient(to right, transparent 4px, var(--purple, #a78bfa) 4px 6px, transparent 6px)',
      }}
    />
  )
}

/** Saisie « 1:24 » ou secondes — pour viser au dixième près. */
function ChampTemps({ label, valueMs, onCommit }) {
  return (
    <label className="flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
      {label}
      <input
        type="text"
        defaultValue={formatMs(valueMs)}
        key={`${label}-${valueMs}`}
        onBlur={(e) => {
          const ms = parseTemps(e.target.value)
          if (ms != null && ms !== valueMs) onCommit(ms)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="w-14 px-1 py-0.5 rounded outline-none tabular-nums"
        style={{ background: 'var(--bg)', border: '1px solid var(--brd-sub)', color: 'var(--txt)' }}
      />
    </label>
  )
}

export function parseTemps(txt) {
  const s = String(txt || '').trim()
  if (!s) return null
  const mmss = /^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(s)
  if (mmss) {
    const ms = (Number(mmss[1]) * 60 + Number(mmss[2])) * 1000
    return ms + (mmss[3] ? Number(mmss[3].padEnd(3, '0')) : 0)
  }
  const secondes = Number(s)
  return Number.isFinite(secondes) && secondes >= 0 ? Math.round(secondes * 1000) : null
}
