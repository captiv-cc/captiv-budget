// ════════════════════════════════════════════════════════════════════════════
// theme — wrapper RN du design system @captiv/shared
// ════════════════════════════════════════════════════════════════════════════
//
// Expose les tokens partagés + des helpers RN spécifiques (StyleSheet,
// glass styles, etc.).
//
// Note : la V1 mobile est dark-only (cohérent avec les maquettes Liquid Glass).
// Le toggle iOS light/dark est respecté pour le scheme (couleur status bar, etc.)
// mais les surfaces restent dark. V2 ajoutera un vrai light theme.
//
// ════════════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native'
import { tokens } from '@captiv/shared'

export const {
  colors,
  spacing,
  radius,
  fontSize,
  fontWeight,
  letterSpacing,
  blur,
  zIndex,
  type,
  statusTint,
  elevation,
  press,
  gradients,
} = tokens

/**
 * Police par défaut. Sur iOS on prend la SF native via fontFamily undefined
 * (system default) qui donne la SF Pro automatiquement.
 * Android : Roboto par défaut. Si besoin d'une typo custom, charger via expo-font.
 */
export const font = {
  family: Platform.select({
    ios: undefined, // SF Pro auto
    android: 'sans-serif',
    default: undefined,
  }),
  familyBold: Platform.select({
    ios: undefined,
    android: 'sans-serif-medium',
    default: undefined,
  }),
}

/**
 * Glass surface — utilisé partout pour les cards Liquid Glass.
 *
 * Style "base" : fond très subtil rgba(255,255,255,0.04) + border subtile.
 * Composer avec <BlurView intensity={20} /> en background absolu pour
 * obtenir l'effet Liquid Glass complet.
 */
export const glassStyles = {
  subtle: {
    backgroundColor: colors.glass.subtle,
    borderWidth: 0.5,
    borderColor: colors.glass.borderSubtle,
    borderRadius: radius.base,
  },
  base: {
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderRadius: radius.lg,
  },
  raised: {
    backgroundColor: colors.glass.raised,
    borderWidth: 0.5,
    borderColor: colors.glass.borderHigh,
    borderRadius: radius.lg,
  },
  high: {
    backgroundColor: colors.glass.high,
    borderWidth: 0.5,
    borderColor: colors.glass.borderHigh,
    borderRadius: radius.lg,
  },
}

/**
 * Surface glass "posée" : variant glass + ombre douce + inset highlight.
 * À utiliser pour les cards en relief (elevated). Ne PAS combiner avec
 * overflow:'hidden' (l'ombre serait clippée sur iOS).
 */
export function glassSurface(variant = 'base') {
  return {
    ...glassStyles[variant],
    ...elevation.sm,
    borderTopColor: colors.glass.insetHighlight,
  }
}

/**
 * Hauteur status bar approx (iOS notch) — utile pour offset top
 * Mieux : utiliser useSafeAreaInsets() dans les composants
 */
export const statusBarOffset = Platform.select({ ios: 44, android: 24, default: 0 })

/**
 * Hauteur tab bar approx — utile pour padding bottom dans les screens
 */
export const tabBarHeight = 56 + (Platform.OS === 'ios' ? 24 : 0)
