// ════════════════════════════════════════════════════════════════════════════
// useNow — horloge réactive (re-render périodique)
// ════════════════════════════════════════════════════════════════════════════
//
// Force un re-render à intervalle régulier pour les countdowns vivants.
// Défaut : chaque minute.
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'

export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
