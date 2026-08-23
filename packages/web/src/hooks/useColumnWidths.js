// ════════════════════════════════════════════════════════════════════════════
// useColumnWidths — largeurs réglables, mémorisées par utilisateur
// ════════════════════════════════════════════════════════════════════════════
//
// Usage :
//   const cols = useColumnWidths('livrables', { nom: 240, statut: 108 })
//   <colgroup>{cols.col('nom')}</colgroup>
//   <th style={{ position: 'relative' }}>Nom<ColumnResizer {...cols.handle('nom')} /></th>
//
// Le réglage vit dans le navigateur : c'est un confort d'affichage propre à
// chacun, pas une donnée du projet.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  clampWidth,
  clearStoredWidths,
  mergeWidths,
  readStoredWidths,
  writeStoredWidths,
} from '../lib/columnWidths'

export default function useColumnWidths(storageKey, defaults) {
  const [widths, setWidths] = useState(() =>
    mergeWidths(defaults, readStoredWidths(storageKey)),
  )
  // Les défauts sont figés au montage : un objet littéral recréé à chaque
  // rendu relancerait la lecture sans fin.
  const defaultsRef = useRef(defaults)

  const setWidth = useCallback((key, px) => {
    setWidths((prev) => ({ ...prev, [key]: clampWidth(px) }))
  }, [])

  // Persistance à la fin du geste, pas à chaque pixel parcouru.
  const commit = useCallback(() => {
    setWidths((prev) => {
      writeStoredWidths(storageKey, prev)
      return prev
    })
  }, [storageKey])

  const resetColumn = useCallback((key) => {
    setWidths((prev) => {
      const next = { ...prev, [key]: defaultsRef.current[key] }
      writeStoredWidths(storageKey, next)
      return next
    })
  }, [storageKey])

  const resetAll = useCallback(() => {
    clearStoredWidths(storageKey)
    setWidths({ ...defaultsRef.current })
  }, [storageKey])

  const isCustom = useMemo(
    () => Object.keys(defaultsRef.current).some((k) => widths[k] !== defaultsRef.current[k]),
    [widths],
  )

  const handle = useCallback(
    (key) => ({
      width: widths[key],
      onResize: (px) => setWidth(key, px),
      onCommit: commit,
      onReset: () => resetColumn(key),
    }),
    [widths, setWidth, commit, resetColumn],
  )

  return { widths, setWidth, commit, resetColumn, resetAll, isCustom, handle }
}
