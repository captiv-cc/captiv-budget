// ════════════════════════════════════════════════════════════════════════════
// ColumnResizer — poignée de redimensionnement d'une colonne
// ════════════════════════════════════════════════════════════════════════════
//
// À poser dans un <th> en position relative, sur un tableau en
// table-layout: fixed piloté par un <colgroup>. Invisible au repos, elle
// s'éclaire au survol : le tableau doit rester lisible, pas quadrillé de
// barres.
//
// Double-clic = largeur d'origine de cette colonne.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'

export default function ColumnResizer({ width, onResize, onCommit, onReset }) {
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, w: 0 })

  useEffect(() => {
    if (!dragging) return undefined

    function onMove(e) {
      onResize(start.current.w + (e.clientX - start.current.x))
    }
    function onUp() {
      setDragging(false)
      onCommit?.()
    }

    // Pendant le geste, le curseur reste celui du redimensionnement et le
    // texte ne se sélectionne pas, même en sortant du tableau.
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging, onResize, onCommit])

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      title="Glisser pour redimensionner · double-clic pour rétablir"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        start.current = { x: e.clientX, w: width }
        setDragging(true)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onReset?.()
      }}
      className="absolute top-0 bottom-0 right-0 z-10"
      style={{
        width: 7,
        marginRight: -3,
        cursor: 'col-resize',
        // Trait fin centré dans la zone de préhension.
        background: dragging
          ? 'linear-gradient(to right, transparent 3px, var(--blue) 3px 4px, transparent 4px)'
          : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!dragging) {
          e.currentTarget.style.background =
            'linear-gradient(to right, transparent 3px, var(--brd) 3px 4px, transparent 4px)'
        }
      }}
      onMouseLeave={(e) => {
        if (!dragging) e.currentTarget.style.background = 'transparent'
      }}
    />
  )
}
