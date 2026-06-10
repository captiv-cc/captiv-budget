// ════════════════════════════════════════════════════════════════════════════
// Design tokens — palette, espacements, typo, radius, ombres
// ════════════════════════════════════════════════════════════════════════════
//
// Source unique pour le langage visuel mobile (et potentiellement web v2).
// Aligné sur les maquettes validées (Liquid Glass dark) :
// - Background noir profond #0A0A0B
// - Surfaces glass rgba(255,255,255,0.04-0.08) + backdrop-filter
// - Accent bleu #3B82F6, violet #8B5CF6
// - Statuts : vert #10B981, orange #F59E0B, rouge #EF4444, violet #A855F7
//
// ════════════════════════════════════════════════════════════════════════════

export const colors = {
  // ─── Bases ──────────────────────────────────────────────────────────────
  black: '#000000',
  bg: '#0A0A0B',
  bgElevated: '#141416',
  bgRaised: '#1A1A1D',

  white: '#FFFFFF',
  text: '#E5E5E7',
  textSecondary: '#A1A1AA',
  textMuted: '#71717A',
  textDim: '#52525B',

  // ─── Glass surfaces (semi-transparent, à composer avec backdrop-filter) ─
  glass: {
    subtle: 'rgba(255,255,255,0.025)',
    base: 'rgba(255,255,255,0.04)',
    raised: 'rgba(255,255,255,0.06)',
    high: 'rgba(255,255,255,0.08)',
    overlay: 'rgba(20,20,22,0.6)', // tab bar / nav bars
    dialog: 'rgba(20,20,22,0.85)', // bottom sheet
    border: 'rgba(255,255,255,0.08)',
    borderSubtle: 'rgba(255,255,255,0.06)',
    borderHigh: 'rgba(255,255,255,0.12)',
    insetHighlight: 'rgba(255,255,255,0.06)',
    insetHighlightStrong: 'rgba(255,255,255,0.2)',
  },

  // ─── Brand / accent ─────────────────────────────────────────────────────
  brand: {
    blue: '#3B82F6',
    blueLight: '#60A5FA',
    blueBg: 'rgba(59,130,246,0.12)',
    blueBorder: 'rgba(96,165,250,0.3)',
    violet: '#8B5CF6',
    violetLight: '#A78BFA',
  },

  // ─── Statuts ────────────────────────────────────────────────────────────
  status: {
    success: '#10B981',
    successLight: '#34D399',
    successBg: 'rgba(16,185,129,0.15)',
    successBorder: 'rgba(167,243,208,0.3)',

    warning: '#F59E0B',
    warningLight: '#FBBF24',
    warningBg: 'rgba(245,158,11,0.15)',
    warningBorder: 'rgba(253,224,71,0.3)',

    danger: '#EF4444',
    dangerLight: '#F87171',
    dangerBg: 'rgba(239,68,68,0.15)',
    dangerBorder: 'rgba(252,165,165,0.3)',

    info: '#3B82F6',
    infoLight: '#60A5FA',
    infoBg: 'rgba(59,130,246,0.15)',
    infoBorder: 'rgba(147,197,253,0.3)',

    accent: '#A855F7',
    accentLight: '#C4B5FD',
    accentBg: 'rgba(168,85,247,0.15)',
    accentBorder: 'rgba(196,181,253,0.3)',
  },

  // ─── Catégorie livrable (sections page Suivi) ───────────────────────────
  blocs: {
    recap: '#10B981', // vert
    snack: '#3B82F6', // bleu
    capsule: '#A855F7', // violet
    aftermovie: '#EC4899', // rose
    teaser: '#F59E0B', // orange
  },
}

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 6,
  base: 8,
  md: 11,
  lg: 14,
  xl: 18,
  xxl: 22,
  xxxl: 28,
  huge: 36,
}

export const radius = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 9,
  base: 11,
  lg: 14,
  xl: 18,
  xxl: 22,
  pill: 9999,
  // Bottom sheet (top corners seulement)
  sheet: 18,
  // Iphone screen radius approx (purement visuel, dev only)
  phone: 44,
}

export const fontSize = {
  micro: 8,
  tiny: 9,
  caption: 10,
  small: 11,
  body: 12,
  bodyLarge: 13,
  subtitle: 14,
  title: 16,
  heading: 20,
  display: 24,
  large: 28,
}

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  black: '800',
}

export const letterSpacing = {
  tighter: -0.5,
  tight: -0.3,
  normal: 0,
  wide: 0.3,
  wider: 0.5,
  widest: 0.6,
}

export const shadows = {
  glass: {
    // Light inset highlight + soft shadow bas
    light: 'inset 0 1px 0 rgba(255,255,255,0.06)',
    medium: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px rgba(0,0,0,0.4)',
    strong: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 12px 32px rgba(0,0,0,0.5)',
  },
  drop: {
    sm: '0 2px 8px rgba(0,0,0,0.2)',
    md: '0 4px 16px rgba(0,0,0,0.3)',
    lg: '0 8px 24px rgba(0,0,0,0.4)',
    xl: '0 12px 32px rgba(0,0,0,0.5)',
    sheet: '0 -10px 40px rgba(0,0,0,0.5)',
  },
  glow: {
    blue: '0 4px 16px rgba(59,130,246,0.35)',
    success: '0 4px 16px rgba(16,185,129,0.35)',
    danger: '0 4px 16px rgba(239,68,68,0.35)',
  },
}

/**
 * Blur intensities pour expo-blur (BlurView intensity prop)
 * iOS supporte 0-100, default 50
 */
export const blur = {
  subtle: 20,
  base: 40,
  strong: 60,
  intense: 80,
}

/**
 * Z-index hierarchy
 */
export const zIndex = {
  base: 0,
  raised: 1,
  sticky: 10,
  drawer: 20,
  modal: 30,
  toast: 40,
  tooltip: 50,
  floating: 60,
}
