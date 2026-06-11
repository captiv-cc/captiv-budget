// ════════════════════════════════════════════════════════════════════════════
// Card — surface unifiée (remplace les cartes/ligne aux styles divergents)
// ════════════════════════════════════════════════════════════════════════════
//
// variant : 'flat' (glass.subtle, rows) | 'glass' (glass.base + inset) |
//           'elevated' (glass.raised + ombre + inset)
// padding : 'sm' | 'md' (défaut) | 'lg' | 'none'
// accent  : couleur d'une barre gauche (optionnel)
// onPress : si fourni → wrappe en PressableScale
//
// ⚠️ 'elevated' ne met PAS overflow:'hidden' (l'ombre serait clippée iOS).
// ════════════════════════════════════════════════════════════════════════════

import { View, StyleSheet } from 'react-native'

import { colors, spacing, radius, elevation } from '../../theme'
import PressableScale from './PressableScale'

const PADDINGS = { none: 0, sm: spacing.md, md: spacing.lg, lg: spacing.xl }

export default function Card({
  variant = 'glass',
  padding = 'md',
  accent,
  onPress,
  haptic = 'light',
  style,
  children,
  ...rest
}) {
  const base = [
    styles.base,
    variant === 'flat' && styles.flat,
    variant === 'glass' && styles.glass,
    variant === 'elevated' && styles.elevated,
    { padding: PADDINGS[padding] ?? spacing.lg },
    accent && { borderLeftWidth: 3, borderLeftColor: accent },
    style,
  ]

  if (onPress) {
    return (
      <PressableScale onPress={onPress} haptic={haptic} style={base} {...rest}>
        {children}
      </PressableScale>
    )
  }
  return (
    <View style={base} {...rest}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: 0.5,
  },
  flat: {
    backgroundColor: colors.glass.subtle,
    borderColor: colors.glass.borderSubtle,
  },
  glass: {
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderTopColor: colors.glass.insetHighlight,
  },
  elevated: {
    backgroundColor: colors.glass.raised,
    borderColor: colors.glass.borderHigh,
    borderTopColor: colors.glass.insetHighlightStrong,
    ...elevation.sm,
  },
})
