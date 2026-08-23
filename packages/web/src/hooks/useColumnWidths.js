// ════════════════════════════════════════════════════════════════════════════
// useColumnWidths — largeurs réglables, mémorisées par utilisateur
// ════════════════════════════════════════════════════════════════════════════
//
// Usage :
//   const cols = useColumnWidths('livrables', { nom: 240, statut: 108 })
//   <colgroup>{...}<col style={{ width: cols.widths.nom }} /></colgroup>
//   <th style={{ position: 'relative' }}>Nom<ColumnResizer {...cols.handle('nom')} /></th>
//
// Tous les tableaux qui partagent une clé partagent aussi leurs largeurs EN
// DIRECT (store commun) : sur une page qui empile un tableau par bloc, un
// geste dans l'un déplace tous les autres, et les colonnes restent alignées.
//
// Le réglage vit dans le navigateur : c'est un confort d'affichage propre à
// chacun, pas une donnée du projet.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  clampWidth,
  clearStoredWidths,
  getWidths,
  resetWidthsStore,
  subscribeWidths,
  updateWidths,
  writeStoredWidths,
} from '../lib/columnWidths'

export default function useColumnWidths(storageKey, defaults) {
  // Les défauts sont figés au montage : un objet littéral recréé à chaque
  // rendu relancerait la lecture sans fin.
  const defaultsRef = useRef(defaults)

  const subscribe = useCallback(
    (listener) => subscribeWidths(storageKey, listener),
    [storageKey],
  )
  const getSnapshot = useCallback(
    () => getWidths(storageKey, defaultsRef.current),
    [storageKey],
  )
  const widths = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const setWidth = useCallback(
    (key, px) => {
      updateWidths(storageKey, (prev) => ({ ...prev, [key]: clampWidth(px) }))
    },
    [storageKey],
  )

  // Persistance à la fin du geste, pas à chaque pixel parcouru.
  const commit = useCallback(() => {
    writeStoredWidths(storageKey, getWidths(storageKey, defaultsRef.current))
  }, [storageKey])

  const resetColumn = useCallback(
    (key) => {
      updateWidths(storageKey, (prev) => ({ ...prev, [key]: defaultsRef.current[key] }))
      writeStoredWidths(storageKey, getWidths(storageKey, defaultsRef.current))
    },
    [storageKey],
  )

  const resetAll = useCallback(() => {
    clearStoredWidths(storageKey)
    resetWidthsStore(storageKey, defaultsRef.current)
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
