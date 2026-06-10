// ════════════════════════════════════════════════════════════════════════════
// StatusPill — chip statut/badge (Validé, À démarrer, En cours, etc.)
// ════════════════════════════════════════════════════════════════════════════
//
// Variants :
//   - success | warning | danger | info | accent | neutral
//
// Auto-color via STATUT_LIVRABLE_COLOR / STATUT_CRENEAU_COLOR si tu passes
// `statut={'valide'}` ou `statut={'planifie'}` (cherche dans les maps shared).
//
// ════════════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native'

import { colors, radius, fontSize, fontWeight, letterSpacing, spacing } from '../../theme'

const VARIANT_STYLES = {
  success: { bg: colors.status.successBg, color: colors.status.successLight, border: colors.status.successBorder },
  warning: { bg: colors.status.warningBg, color: colors.status.warningLight, border: colors.status.warningBorder },
  danger: { bg: colors.status.dangerBg, color: colors.status.dangerLight, border: colors.status.dangerBorder },
  info: { bg: colors.status.infoBg, color: colors.status.infoLight, border: colors.status.infoBorder },
  accent: { bg: colors.status.accentBg, color: colors.status.accentLight, border: colors.status.accentBorder },
  neutral: {
    bg: colors.glass.base,
    color: colors.textMuted,
    border: colors.glass.borderSubtle,
  },
}

export default function StatusPill({ children, variant = 'neutral', uppercase = true, style, textStyle }) {
  const v = VARIANT_STYLES[variant] ?? VARIANT_STYLES.neutral

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: v.bg, borderColor: v.border },
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: v.color },
          uppercase && styles.textUpper,
          textStyle,
        ]}
      >
        {children}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.base,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 0.5,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.micro,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  textUpper: {
    textTransform: 'uppercase',
  },
})
