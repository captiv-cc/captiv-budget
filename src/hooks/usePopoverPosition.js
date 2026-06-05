// ════════════════════════════════════════════════════════════════════════════
// usePopoverPosition — Calcule la position d'un popover anchored
// ════════════════════════════════════════════════════════════════════════════
//
// Reçoit le rect d'un élément (DOMRect) et la taille désirée du popover,
// retourne { top, left, side, arrowOffset } pour positionner le popover en
// flip auto (préfère côté droit du bloc, bascule à gauche/haut/bas si pas
// la place).
//
// Pattern utilisé :
//   const { anchorRect, popoverRef, position } = usePopoverPosition({
//     anchorRect: { top, left, right, bottom, width, height },
//     preferredSide: 'right',
//     gap: 12,
//   })
//
// Returns position : {
//   top: number (px depuis le top de la fenêtre, à utiliser en position fixed),
//   left: number,
//   side: 'right' | 'left' | 'top' | 'bottom',
//   arrowOffset: number (offset en px de la flèche le long du popover, sur
//                 l'axe qui pointe vers le bloc)
// }
//
// Note : on retourne aussi `ready` (boolean) pour que le composant puisse
// rendre le popover avec opacity:0 au 1er render (avant qu'on connaisse la
// taille via ref) et n'apparaitre qu'après mesure → pas de flash de position.
// ════════════════════════════════════════════════════════════════════════════

import { useLayoutEffect, useRef, useState } from 'react'

const DEFAULT_GAP = 12
const DEFAULT_VIEWPORT_PAD = 8 // marge minimale entre popover et bord d'écran
const MIN_ARROW_INSET = 16 // empêche la flèche de coller au bord du popover

/**
 * @param {object} opts
 * @param {DOMRect|null} opts.anchorRect — rect de l'élément cible
 * @param {string} [opts.preferredSide='right'] — 'right'|'left'|'top'|'bottom'
 * @param {number} [opts.gap=12] — distance entre bloc et popover
 * @returns {{ position: object, popoverRef: React.RefObject, ready: boolean }}
 */
export function usePopoverPosition({
  anchorRect,
  preferredSide = 'right',
  gap = DEFAULT_GAP,
}) {
  const popoverRef = useRef(null)
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    side: preferredSide,
    arrowOffset: 0,
  })
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    if (!anchorRect || !popoverRef.current) {
      setReady(false)
      return undefined
    }

    function recompute() {
      const el = popoverRef.current
      if (!el || !anchorRect) return
      const popSize = {
        width: el.offsetWidth,
        height: el.offsetHeight,
      }
      const vw = window.innerWidth
      const vh = window.innerHeight
      const pad = DEFAULT_VIEWPORT_PAD

      // Espace dispo de chaque côté du bloc
      const spaceRight = vw - anchorRect.right - gap
      const spaceLeft = anchorRect.left - gap
      const spaceTop = anchorRect.top - gap
      const spaceBottom = vh - anchorRect.bottom - gap

      // Choix du côté : préféré si assez de place, sinon flip vers le côté
      // qui a le plus d'espace.
      let side = preferredSide
      const needsHorizontal = side === 'left' || side === 'right'
      if (needsHorizontal) {
        if (side === 'right' && popSize.width > spaceRight && spaceLeft > spaceRight) {
          side = 'left'
        } else if (side === 'left' && popSize.width > spaceLeft && spaceRight > spaceLeft) {
          side = 'right'
        }
        // Si ni gauche ni droite n'ont assez de place, on essaie en bas/haut
        if (popSize.width > Math.max(spaceLeft, spaceRight)) {
          if (spaceBottom > popSize.height) side = 'bottom'
          else if (spaceTop > popSize.height) side = 'top'
        }
      } else {
        if (side === 'bottom' && popSize.height > spaceBottom && spaceTop > spaceBottom) {
          side = 'top'
        } else if (side === 'top' && popSize.height > spaceTop && spaceBottom > spaceTop) {
          side = 'bottom'
        }
      }

      // Calcul position selon le côté final.
      // Pour right/left : on aligne le top du popover sur le top du bloc
      // (plus naturel et stable quand le popover est plus grand que le bloc).
      // Pour top/bottom : on centre horizontalement sur le bloc.
      let top = 0
      let left = 0
      switch (side) {
        case 'right':
          left = anchorRect.right + gap
          top = anchorRect.top
          break
        case 'left':
          left = anchorRect.left - gap - popSize.width
          top = anchorRect.top
          break
        case 'bottom':
          left = anchorRect.left + anchorRect.width / 2 - popSize.width / 2
          top = anchorRect.bottom + gap
          break
        case 'top':
          left = anchorRect.left + anchorRect.width / 2 - popSize.width / 2
          top = anchorRect.top - gap - popSize.height
          break
        default:
          break
      }

      // Clamp aux bords (avec padding viewport)
      const maxLeft = vw - popSize.width - pad
      const maxTop = vh - popSize.height - pad
      const clampedLeft = Math.max(pad, Math.min(left, maxLeft))
      const clampedTop = Math.max(pad, Math.min(top, maxTop))

      // Position de la flèche : on cherche où la flèche doit pointer pour
      // viser le CENTRE du bloc, à partir du bord du popover.
      const isHorizontal = side === 'right' || side === 'left'
      const anchorCenter = isHorizontal
        ? anchorRect.top + anchorRect.height / 2
        : anchorRect.left + anchorRect.width / 2
      const popStart = isHorizontal ? clampedTop : clampedLeft
      const popSizeAlong = isHorizontal ? popSize.height : popSize.width
      const rawOffset = anchorCenter - popStart
      // Clamp pour que la flèche ne sorte pas du popover
      const arrowOffset = Math.max(
        MIN_ARROW_INSET,
        Math.min(popSizeAlong - MIN_ARROW_INSET, rawOffset),
      )

      setPosition({ top: clampedTop, left: clampedLeft, side, arrowOffset })
      setReady(true)
    }

    recompute()

    // Recompute si la fenêtre est redimensionnée ou si le popover change de
    // taille (ex : passage compact → étendu).
    const ro = new ResizeObserver(recompute)
    ro.observe(popoverRef.current)
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
    // anchorRect est un DOMRect (objet, peut changer de référence à chaque
    // open) → on dépend de ses valeurs primitives pour ne recompute que
    // quand le rect change vraiment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    anchorRect?.top,
    anchorRect?.left,
    anchorRect?.right,
    anchorRect?.bottom,
    anchorRect?.width,
    anchorRect?.height,
    preferredSide,
    gap,
  ])

  return { popoverRef, position, ready }
}
