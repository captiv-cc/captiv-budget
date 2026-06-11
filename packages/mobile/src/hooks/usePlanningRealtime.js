// ════════════════════════════════════════════════════════════════════════════
// usePlanningRealtime — refetch live du planning sur changements déroulé
// ════════════════════════════════════════════════════════════════════════════
//
// S'abonne aux 4 tables du déroulé (toutes publiées en Realtime) et déclenche
// un refetch debouncé quand un créneau / une lane / un membre change (décalage
// d'horaire, statut, réassignation…). Même approche que le web (useDeroule).
//
// Les tables enfant n'ont pas de project_id → on écoute large et le refetch
// re-scope les données par projet/jour. Debounce 400ms pour grouper les rafales.
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const TABLES = [
  'projet_deroules',
  'projet_deroule_lanes',
  'projet_deroule_creneaux',
  'projet_deroule_creneau_membres',
]

export function usePlanningRealtime(projetId, onChange) {
  // Garde la dernière callback sans re-souscrire à chaque render
  const cbRef = useRef(onChange)
  cbRef.current = onChange

  useEffect(() => {
    if (!projetId) return
    let timer = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => cbRef.current?.(), 400)
    }

    let channel = supabase.channel(`planning:${projetId}`)
    for (const table of TABLES) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        schedule,
      )
    }
    channel.subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [projetId])
}
