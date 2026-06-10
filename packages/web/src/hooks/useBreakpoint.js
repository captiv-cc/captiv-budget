/**
 * useBreakpoint — Hook SSR-safe qui suit le breakpoint courant.
 *
 * Seuils alignés sur Tailwind 3 défaut :
 *   - mobile   : < 640px       (pas de préfixe Tailwind)
 *   - tablet   : 640px..1023px (sm: / md:)
 *   - desktop  : >= 1024px     (lg: et +)
 *
 * Cette convention s'aligne avec le chantier responsive Planning (2026-04) :
 * on distingue 3 paliers pour chaque vue du pilier Planning.
 *
 * Usage :
 *   const bp = useBreakpoint()
 *   // bp.isMobile, bp.isTablet, bp.isDesktop → booléens mutuellement exclusifs
 *   // bp.is ∈ 'mobile' | 'tablet' | 'desktop'
 *   // bp.atLeastTablet / bp.atLeastDesktop → booléens "cascading"
 *
 * Implémentation : window.matchMedia + listener change. Aucun poll / pas de
 * resize event. Les changements (portrait → paysage, redim. devtools) sont
 * propagés.
 */
import { useEffect, useState } from 'react'

// Seuils (doivent coller à tailwind.config.js — Tailwind default)
export const BREAKPOINT_TABLET_MIN = 640 // >= sm
export const BREAKPOINT_DESKTOP_MIN = 1024 // >= lg

function resolve(width) {
  if (width < BREAKPOINT_TABLET_MIN) return 'mobile'
  if (width < BREAKPOINT_DESKTOP_MIN) return 'tablet'
  return 'desktop'
}

function getInitial() {
  // SSR / Node : on retourne 'desktop' pour ne pas flash un layout mobile côté
  // server-render. En pratique Captiv est SPA Vite, donc window existe
  // quasiment tout le temps après le premier render React.
  if (typeof window === 'undefined') return 'desktop'
  return resolve(window.innerWidth)
}

/**
 * @returns {{
 *   is: 'mobile' | 'tablet' | 'desktop',
 *   isMobile: boolean,
 *   isTablet: boolean,
 *   isDesktop: boolean,
 *   atLeastTablet: boolean,
 *   atLeastDesktop: boolean
 * }}
 */
export function useBreakpoint() {
  const [bp, setBp] = useState(getInitial)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined

    const mqTablet = window.matchMedia(`(min-width: ${BREAKPOINT_TABLET_MIN}px)`)
    const mqDesktop = window.matchMedia(`(min-width: ${BREAKPOINT_DESKTOP_MIN}px)`)

    function update() {
      if (mqDesktop.matches) setBp('desktop')
      else if (mqTablet.matches) setBp('tablet')
      else setBp('mobile')
    }

    update()
    // addEventListener('change') est le moderne ; addListener reste fallback
    // pour de très vieux navigateurs (Safari < 14, on ne s'embête pas).
    mqTablet.addEventListener('change', update)
    mqDesktop.addEventListener('change', update)
    return () => {
      mqTablet.removeEventListener('change', update)
      mqDesktop.removeEventListener('change', update)
    }
  }, [])

  return {
    is: bp,
    isMobile: bp === 'mobile',
    isTablet: bp === 'tablet',
    isDesktop: bp === 'desktop',
    atLeastTablet: bp === 'tablet' || bp === 'desktop',
    atLeastDesktop: bp === 'desktop',
  }
}

export default useBreakpoint
