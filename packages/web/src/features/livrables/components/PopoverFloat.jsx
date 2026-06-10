// ════════════════════════════════════════════════════════════════════════════
// PopoverFloat — popover ancré à un bouton, rendu via portal sur document.body
// ════════════════════════════════════════════════════════════════════════════
//
// Pattern réutilisable pour les popovers placés à l'intérieur d'un parent
// `overflow-x-auto` (typique : table desktop des livrables). Sans portal,
// l'overflow d'un axe force l'autre axe à `auto` côté CSS spec → le popover
// se fait clipper en bas.
//
// Implémentation calquée sur `LoueurPillsEditor` (matériel) :
//   - rendu via `createPortal` sur `document.body`
//   - position calculée à partir du `getBoundingClientRect()` de l'ancre
//   - listener scroll/resize → recalc OU close si l'ancre sort du viewport
//   - listener mousedown → ferme si clic en dehors (et ailleurs que sur l'ancre)
//
// Props :
//   - anchorRef     : React ref vers le bouton ancre (obligatoire)
//   - open          : booléen (parent contrôle)
//   - onClose       : () => void — appelé en clic-outside / scroll out
//   - align         : 'left' | 'right' (par rapport au bord de l'ancre)
//   - placement     : 'bottom' | 'top' (défaut 'bottom') — sens d'ouverture
//   - offsetY       : px entre l'ancre et le popover (défaut 4)
//   - autoFlip      : si true (défaut), flip de bottom→top quand pas assez
//                     de place en dessous (mesure après render). Passer
//                     false pour figer le placement demandé.
//   - children      : contenu du popover
//
// Attention : ne stylise PAS l'enveloppe (pas de fond / border / shadow ici).
// Le contenu fourni se charge de son propre look. Cela évite les conflits de
// border-radius quand on imbrique des MenuRow avec leur propre hover.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function PopoverFloat({
  anchorRef,
  open,
  onClose,
  align = 'left',
  placement = 'bottom',
  offsetY = 4,
  autoFlip = true,
  children,
}) {
  const popRef = useRef(null)
  const [pos, setPos] = useState(null)

  // Recalc à l'ouverture + au resize / scroll.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return undefined
    }
    function recalc() {
      const el = anchorRef?.current
      if (!el) return
      const r = el.getBoundingClientRect()
      // Si l'ancre est totalement hors viewport (vertical), on ferme.
      if (r.bottom < 0 || r.top > window.innerHeight) {
        onClose?.()
        return
      }
      // Auto-flip : si le placement demandé est 'bottom' mais qu'il n'y a
      // pas assez de place en dessous (ou plus en haut), on flip vers 'top'
      // (et inversement). On utilise la hauteur réelle du popover si elle
      // a déjà été mesurée, sinon une estimation conservatrice (240px).
      const popH = popRef.current?.offsetHeight || 240
      const margin = 8
      const spaceBelow = window.innerHeight - r.bottom - margin
      const spaceAbove = r.top - margin
      let chosen = placement
      if (autoFlip) {
        if (placement === 'bottom' && popH + offsetY > spaceBelow && spaceAbove > spaceBelow) {
          chosen = 'top'
        } else if (placement === 'top' && popH + offsetY > spaceAbove && spaceBelow > spaceAbove) {
          chosen = 'bottom'
        }
      }
      // Position verticale selon placement choisi :
      //   - 'bottom' : popover sous l'ancre (top = ancre.bottom + offset)
      //   - 'top'    : popover au-dessus (bottom = viewport.h - ancre.top + offset)
      // Pour 'top' on utilise `bottom:` au lieu de `top:` pour que le popover
      // s'étende vers le haut depuis sa base.
      const next = {}
      if (chosen === 'top') {
        next.bottom = Math.max(margin, window.innerHeight - r.top + offsetY)
      } else {
        next.top = r.bottom + offsetY
      }
      if (align === 'right') {
        next.right = Math.max(margin, window.innerWidth - r.right)
      } else {
        next.left = Math.max(margin, r.left)
      }
      setPos(next)
    }
    recalc()
    // Second recalc dès que le popover est monté pour utiliser sa vraie
    // hauteur (le premier passage utilise l'estimation 240px).
    const raf = window.requestAnimationFrame(recalc)
    window.addEventListener('scroll', recalc, true)
    window.addEventListener('resize', recalc)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('scroll', recalc, true)
      window.removeEventListener('resize', recalc)
    }
  }, [open, anchorRef, align, placement, offsetY, onClose, autoFlip])

  // Click outside (ne ferme PAS si clic sur l'ancre — c'est elle qui toggle).
  useEffect(() => {
    if (!open) return undefined
    function onDoc(e) {
      const inPop = popRef.current && popRef.current.contains(e.target)
      const inAnchor = anchorRef?.current && anchorRef.current.contains(e.target)
      if (!inPop && !inAnchor) onClose?.()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onClose, anchorRef])

  if (!open || !pos) return null

  return createPortal(
    <div
      ref={popRef}
      style={{
        position: 'fixed',
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
        right: pos.right,
        zIndex: 9999,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
