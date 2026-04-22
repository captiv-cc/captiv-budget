// ════════════════════════════════════════════════════════════════════════════
// useCheckPresence — Presence live sur /check/:token via Supabase Realtime (MAT-10H)
// ════════════════════════════════════════════════════════════════════════════
//
// Pourquoi :
//   Pendant les essais, plusieurs personnes (cadreur, DIT, loueur) ouvrent le
//   même lien tokenisé en simultané. On veut voir en un coup d'œil qui est
//   connecté en direct — sans badge "en ligne" compliqué, juste la liste des
//   prénoms sous forme de pills colorées en haut de l'écran.
//
// Architecture :
//   - 1 channel Supabase par token : `check-presence:${token}`
//   - Chaque client tracke `{ name, color, joinedAt }` dès qu'il est SUBSCRIBED
//   - On écoute l'event 'sync' + 'join' + 'leave' et on recalcule le roster
//
// Notes d'implémentation :
//   - `presenceKey` : clé unique par client (on utilise un uuid-like local,
//     régénéré à chaque mount). Même token + même nom sur 2 appareils = 2 pills
//     distinctes (voulu : on veut voir si 2 cadreurs utilisent le même lien).
//   - Couleur : dérivée hash(name) pour stabilité visuelle (Camille = toujours
//     la même couleur). Palette picked dans une liste courte pour que les pills
//     restent lisibles en light et dark.
//   - Cleanup : on untrack + removeChannel au unmount pour libérer le slot
//     de presence côté serveur.
//
// Exemple :
//   const { users } = useCheckPresence({ token, userName, enabled })
//   // users = [{ key, name, color, joinedAt }, …]
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Palette de 8 couleurs distinctes, lisibles sur fond sombre (contraste AA).
// Hash(name) % 8 → index. Volontairement courte pour éviter que 2 personnes
// ait la même couleur (collisions rares en pratique : < 8 personnes connectées).
const PRESENCE_COLORS = [
  '#60a5fa', // blue-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#f87171', // red-400
  '#a78bfa', // violet-400
  '#22d3ee', // cyan-400
  '#fb923c', // orange-400
  '#f472b6', // pink-400
]

function colorForName(name) {
  if (!name) return PRESENCE_COLORS[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0 // force 32-bit int
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]
}

/**
 * Génère une clé de présence unique pour ce client. Pas besoin de vraie
 * unicité cryptographique — c'est juste pour distinguer plusieurs instances
 * sur un même nom. crypto.randomUUID() si dispo, sinon fallback timestamp+random.
 */
function generatePresenceKey() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * @param {object} opts
 * @param {string} opts.token    — token anon de la session (clé du channel)
 * @param {string} opts.userName — prénom à annoncer (null/empty = pas de track)
 * @param {boolean} [opts.enabled=true] — short-circuit pour désactiver temporairement
 *
 * @returns {{ users: Array<{ key, name, color, joinedAt }> }}
 */
export function useCheckPresence({ token, userName, enabled = true }) {
  const [roster, setRoster] = useState([])
  // Clé stable sur la durée du mount (et du token).
  const presenceKeyRef = useRef(null)
  if (!presenceKeyRef.current) presenceKeyRef.current = generatePresenceKey()

  useEffect(() => {
    if (!enabled || !token || !userName) {
      setRoster([])
      return undefined
    }

    const presenceKey = presenceKeyRef.current
    const channel = supabase.channel(`check-presence:${token}`, {
      config: {
        presence: { key: presenceKey },
        broadcast: { self: false }, // pas besoin d'écho broadcast
      },
    })

    function syncRoster() {
      // presenceState() renvoie { [key]: [meta1, meta2, ...] } — normalement
      // un seul meta par key, mais on aplatit au cas où.
      const state = channel.presenceState()
      const flat = []
      for (const [key, metas] of Object.entries(state)) {
        if (!Array.isArray(metas) || metas.length === 0) continue
        // On prend le premier meta (plus ancien). Supabase les garde ordonnés.
        const meta = metas[0]
        flat.push({
          key,
          name: meta?.name || 'Anonyme',
          color: meta?.color || colorForName(meta?.name),
          joinedAt: meta?.joinedAt || 0,
        })
      }
      // Tri par joinedAt ASC (premier arrivé = premier affiché).
      flat.sort((a, b) => a.joinedAt - b.joinedAt)
      setRoster(flat)
    }

    channel
      .on('presence', { event: 'sync' }, syncRoster)
      .on('presence', { event: 'join' }, syncRoster)
      .on('presence', { event: 'leave' }, syncRoster)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              name: userName.trim(),
              color: colorForName(userName.trim()),
              joinedAt: Date.now(),
            })
          } catch {
            // track peut échouer si channel fermé pendant le handshake — ignoré.
          }
        }
      })

    return () => {
      // Untrack proprement pour libérer le slot + removeChannel pour tear down.
      try {
        channel.untrack()
      } catch {
        // no-op
      }
      supabase.removeChannel(channel)
    }
  }, [token, userName, enabled])

  // Memo stable — évite re-renders aval si roster content unchanged.
  return useMemo(
    () => ({ users: roster, currentKey: presenceKeyRef.current }),
    [roster],
  )
}
