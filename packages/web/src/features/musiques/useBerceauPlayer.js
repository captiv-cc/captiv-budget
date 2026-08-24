// ════════════════════════════════════════════════════════════════════════════
// useBerceauPlayer — lecture continue d'un berceau
// ════════════════════════════════════════════════════════════════════════════
//
// Enchaîne les blocs sans coupure : chacun est joué de son point d'entrée à
// son point de sortie, puis on passe au suivant.
//
// Deux éléments audio en alternance plutôt qu'un seul : le suivant est
// préchargé et positionné pendant que le précédent finit, sinon chaque
// jonction attend le réseau et le berceau hoquette. C'est aussi ce qui rend
// le fondu possible — il faut deux sources qui sonnent en même temps.
//
// Le fondu se fait au volume (pas de Web Audio) : suffisant pour juger d'un
// enchaînement, et ça marche aussi sur les extraits 30 s distants.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { getPropositionAudioUrl } from '../../lib/musiqueAudio'
import { timelinePositions } from '../../lib/musiqueBerceaux'

// En deçà, le fondu s'entend comme une coupure ; au-delà, on ne juge plus
// l'enchaînement mais le fondu lui-même.
const FADE_MIN_MS = 120

export default function useBerceauPlayer({ blocs, propById }) {
  const [playing, setPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [activeBlocId, setActiveBlocId] = useState(null)

  // Deux lecteurs alternés + l'index du bloc courant.
  const players = useRef([])
  const currentSlot = useRef(0)
  const rafRef = useRef(null)
  const stateRef = useRef({ index: 0, startedAt: 0, offsetMs: 0 })
  const blocsRef = useRef([])

  const positions = timelinePositions(blocs)
  blocsRef.current = positions

  const ensurePlayers = useCallback(() => {
    if (players.current.length === 0) {
      players.current = [new Audio(), new Audio()]
      for (const a of players.current) a.preload = 'auto'
    }
    return players.current
  }, [])

  const stopAll = useCallback(() => {
    for (const a of players.current) {
      a.pause()
      a.ontimeupdate = null
      a.onended = null
    }
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
    setActiveBlocId(null)
  }, [])

  // Source jouable d'un bloc : le fichier déposé, sinon l'extrait.
  const srcFor = useCallback(
    async (bloc) => {
      const p = propById.get(bloc.proposition_id)
      if (!p) return null
      if (p.audio_path) return getPropositionAudioUrl(p)
      return p.preview_url || null
    },
    [propById],
  )

  const playFrom = useCallback(
    async (index, offsetDansBlocMs = 0) => {
      const items = blocsRef.current
      if (index >= items.length) {
        stopAll()
        setPositionMs(0)
        return
      }
      const { bloc } = items[index]
      const [a, b] = ensurePlayers()
      const player = currentSlot.current === 0 ? a : b
      const autre = currentSlot.current === 0 ? b : a
      autre.pause()

      const src = await srcFor(bloc)
      if (!src) {
        // Rien à jouer sur ce bloc : on ne bloque pas le berceau dessus.
        playFrom(index + 1, 0)
        return
      }

      player.src = src
      player.volume = Math.min(1, bloc.gain ?? 1)
      player.currentTime = (bloc.in_ms + offsetDansBlocMs) / 1000

      stateRef.current = { index, startedAt: performance.now(), offsetMs: offsetDansBlocMs }
      setActiveBlocId(bloc.id)

      try {
        await player.play()
        setPlaying(true)
      } catch (err) {
        // Lecture refusée (geste utilisateur requis, ou source injoignable).
        console.warn('[berceau] lecture', err)
        stopAll()
        return
      }

      // Prépare le bloc suivant pendant que celui-ci joue : c'est ce qui
      // évite le blanc à la jonction.
      const suivant = items[index + 1]
      if (suivant) {
        srcFor(suivant.bloc).then((s) => {
          if (!s) return
          autre.src = s
          autre.currentTime = suivant.bloc.in_ms / 1000
        })
      }

      const boucle = () => {
        const dansBloc = player.currentTime * 1000 - bloc.in_ms
        const restant = bloc.out_ms - player.currentTime * 1000
        setPositionMs(items[index].start_ms + Math.max(0, dansBloc))

        // Fondu de sortie sur la fin du bloc.
        const fadeOut = Math.max(FADE_MIN_MS, bloc.fade_out_ms || 0)
        if (bloc.fade_out_ms && restant < fadeOut) {
          player.volume = Math.max(0, (restant / fadeOut) * (bloc.gain ?? 1))
        }

        if (restant <= 0) {
          player.pause()
          currentSlot.current = currentSlot.current === 0 ? 1 : 0
          playFrom(index + 1, 0)
          return
        }
        rafRef.current = requestAnimationFrame(boucle)
      }
      rafRef.current = requestAnimationFrame(boucle)
    },
    [ensurePlayers, srcFor, stopAll],
  )

  const toggle = useCallback(() => {
    if (playing) {
      stopAll()
      return
    }
    if (blocsRef.current.length === 0) return
    // Reprise là où on s'était arrêté, sinon depuis le début.
    const items = blocsRef.current
    const idx = items.findIndex((i) => positionMs >= i.start_ms && positionMs < i.end_ms)
    const index = idx >= 0 ? idx : 0
    const offset = idx >= 0 ? positionMs - items[idx].start_ms : 0
    playFrom(index, offset)
  }, [playing, positionMs, playFrom, stopAll])

  /** Saut à une position de la timeline (clic sur la règle). */
  const seek = useCallback(
    (ms) => {
      const items = blocsRef.current
      const idx = items.findIndex((i) => ms >= i.start_ms && ms < i.end_ms)
      setPositionMs(ms)
      if (idx < 0) return
      if (playing) playFrom(idx, ms - items[idx].start_ms)
      else setActiveBlocId(items[idx].bloc.id)
    },
    [playing, playFrom],
  )

  // Un démontage en pleine lecture laisserait le son tourner.
  useEffect(() => () => stopAll(), [stopAll])

  return { playing, positionMs, activeBlocId, toggle, seek, stop: stopAll }
}
