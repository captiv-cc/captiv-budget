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
    blueBgSubtle: 'rgba(59,130,246,0.06)',
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

// ════════════════════════════════════════════════════════════════════════════
// Échelle typo sémantique (avec lineHeight) — refonte UI 2026
// ════════════════════════════════════════════════════════════════════════════
// À préférer aux fontSize bruts : donne du rythme (line-heights) et une
// hiérarchie cohérente. À étaler via {...type.body}.
export const type = {
  largeTitle: { fontSize: 28, lineHeight: 34, letterSpacing: -0.5, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 27, letterSpacing: -0.4, fontWeight: '700' },
  title2: { fontSize: 19, lineHeight: 24, letterSpacing: -0.3, fontWeight: '700' },
  headerTitle: { fontSize: 17, lineHeight: 22, letterSpacing: -0.3, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 20, letterSpacing: -0.2, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 20, letterSpacing: -0.2, fontWeight: '600' },
  subhead: { fontSize: 13, lineHeight: 18, letterSpacing: -0.1, fontWeight: '400' },
  footnote: { fontSize: 12, lineHeight: 16, letterSpacing: 0, fontWeight: '400' },
  caption: { fontSize: 11, lineHeight: 14, letterSpacing: 0, fontWeight: '500' },
  overline: { fontSize: 10, lineHeight: 13, letterSpacing: 0.6, fontWeight: '700' },
}

// ════════════════════════════════════════════════════════════════════════════
// Teintes de statut unifiées (fini les rgba en dur dans les écrans)
// ════════════════════════════════════════════════════════════════════════════
export const statusTint = {
  success: { fg: colors.status.successLight, bg: colors.status.successBg, border: colors.status.successBorder, solid: colors.status.success },
  warning: { fg: colors.status.warningLight, bg: colors.status.warningBg, border: colors.status.warningBorder, solid: colors.status.warning },
  danger: { fg: colors.status.dangerLight, bg: colors.status.dangerBg, border: colors.status.dangerBorder, solid: colors.status.danger },
  info: { fg: colors.status.infoLight, bg: colors.status.infoBg, border: colors.status.infoBorder, solid: colors.status.info },
  accent: { fg: colors.status.accentLight, bg: colors.status.accentBg, border: colors.status.accentBorder, solid: colors.status.accent },
  neutral: { fg: colors.textMuted, bg: colors.glass.base, border: colors.glass.borderSubtle, solid: colors.textSecondary },
}

// ════════════════════════════════════════════════════════════════════════════
// Ombres RN natives (shadowColor/Offset/Opacity/Radius + elevation Android)
// Les `shadows` ci-dessus (strings CSS) restent pour le web.
// ⚠️ Une View ombrée ne doit PAS avoir overflow:'hidden' ni fond transparent.
// ════════════════════════════════════════════════════════════════════════════
export const elevation = {
  none: {},
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 6 },
  lg: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.45, shadowRadius: 28, elevation: 12 },
  header: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
}

// Feedback de press unique (PressableScale)
export const press = {
  scale: 0.97,
  opacity: 0.85,
  duration: 90,
}

// Dégradés (expo-linear-gradient) — mode "bold"
export const gradients = {
  hero: ['rgba(59,130,246,0.22)', 'rgba(59,130,246,0.04)', 'transparent'],
  violet: ['rgba(139,92,246,0.20)', 'transparent'],
  success: ['rgba(16,185,129,0.18)', 'transparent'],
  dark: ['rgba(20,20,22,0)', 'rgba(10,10,11,0.6)'],
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
