// ════════════════════════════════════════════════════════════════════════════
// useLaneWidths (FEST-5.5.4) — Largeur des lanes par TYPE, persistée locale
// ════════════════════════════════════════════════════════════════════════════
//
// Hugo : "Possibilité de réduire la largeur de lanes, comme dans gsheets ?
//         Il faut pouvoir 'savoir' la largeur faite, pour qu'on puisse la
//         répliquer sur les autres lanes et qu'un même groupe ait toute la
//         même largeur."
//
// Décision : on stocke UNE largeur PAR TYPE (et non par lane individuelle).
// Resize d'une lane scène → toutes les lanes scène prennent cette taille.
// → cohérence visuelle automatique entre lanes du même groupe.
//
// Persistence : localStorage par projet. Clé `deroule.laneWidths.{projectId}`.
// Pas de BDD pour V1 : c'est une préférence locale par utilisateur, pas une
// règle d'organisation à partager.
//
// API :
//   const { getWidth, setWidth, resetWidth } = useLaneWidths(projectId)
//   getWidth('lieu')           → 100 (défaut) ou la valeur sauvée
//   setWidth('lieu', 140)      → toutes les lanes lieu passeront à 140px
//   resetWidth('lieu')         → revient au défaut
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'

export const LANE_WIDTH_DEFAULTS = {
  global: 100,
  equipe: 100,
  lieu: 100,
  personne: 100,
}

export const LANE_WIDTH_MIN = 60
export const LANE_WIDTH_MAX = 300

function storageKey(projectId) {
  return `deroule.laneWidths.${projectId || 'unknown'}`
}

function clamp(v) {
  if (!Number.isFinite(v)) return null
  return Math.max(LANE_WIDTH_MIN, Math.min(LANE_WIDTH_MAX, Math.round(v)))
}

function readFromStorage(projectId) {
  if (!projectId || typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out = {}
    for (const k of Object.keys(parsed)) {
      const v = clamp(parsed[k])
      if (v != null) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeToStorage(projectId, widths) {
  if (!projectId || typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(widths))
  } catch {
    /* ignore quota errors */
  }
}

export function useLaneWidths(projectId) {
  const [widths, setWidths] = useState(() => readFromStorage(projectId))

  // Re-load quand on change de projet
  useEffect(() => {
    setWidths(readFromStorage(projectId))
  }, [projectId])

  const getWidth = useCallback(
    (type) => {
      const t = type || 'equipe'
      return widths[t] ?? LANE_WIDTH_DEFAULTS[t] ?? LANE_WIDTH_DEFAULTS.equipe
    },
    [widths],
  )

  const setWidth = useCallback(
    (type, width) => {
      const t = type || 'equipe'
      const clamped = clamp(width)
      if (clamped == null) return
      setWidths((prev) => {
        const next = { ...prev, [t]: clamped }
        writeToStorage(projectId, next)
        return next
      })
    },
    [projectId],
  )

  const resetWidth = useCallback(
    (type) => {
      const t = type || 'equipe'
      setWidths((prev) => {
        const next = { ...prev }
        delete next[t]
        writeToStorage(projectId, next)
        return next
      })
    },
    [projectId],
  )

  return { widths, getWidth, setWidth, resetWidth }
}

export default useLaneWidths
