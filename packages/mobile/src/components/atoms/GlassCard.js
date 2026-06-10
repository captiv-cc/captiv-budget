// ════════════════════════════════════════════════════════════════════════════
// GlassCard — surface Liquid Glass de base
// ════════════════════════════════════════════════════════════════════════════
//
// Utilise expo-blur pour le vrai effet Liquid Glass iOS.
// Sur Android, expo-blur tombe sur un fond semi-opaque (Material You-ish).
//
// Variants :
//   - subtle  : fond très discret, pour les rows
//   - base    : carte standard
//   - raised  : pour les éléments mis en avant (chip actif, statut accentué)
//   - high    : pour les modales / sheets
//
// ════════════════════════════════════════════════════════════════════════════

import { View, StyleSheet, Platform } from 'react-native'
import { BlurView } from 'expo-blur'

import { colors, radius, glassStyles, blur } from '../../theme'

export default function GlassCard({
  variant = 'base',
  blurIntensity,
  blurTint = 'dark',
  style,
  children,
  ...rest
}) {
  const surfaceStyle = glassStyles[variant] ?? glassStyles.base
  const intensity = blurIntensity ?? (variant === 'high' ? blur.strong : blur.subtle)

  // Sur iOS on a un vrai blur natif. Sur Android le blur est plus coûteux
  // et moins joli — on garde un fond semi-opaque sans BlurView.
  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.wrapper, { borderRadius: surfaceStyle.borderRadius }, style]} {...rest}>
        <BlurView
          intensity={intensity}
          tint={blurTint}
          style={[StyleSheet.absoluteFill, { borderRadius: surfaceStyle.borderRadius }]}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: surfaceStyle.backgroundColor,
              borderRadius: surfaceStyle.borderRadius,
              borderWidth: surfaceStyle.borderWidth,
              borderColor: surfaceStyle.borderColor,
            },
          ]}
          pointerEvents="none"
        />
        <View style={styles.content}>{children}</View>
      </View>
    )
  }

  // Android fallback : juste un fond semi-opaque sur bg sombre
  return (
    <View
      style={[
        styles.wrapper,
        surfaceStyle,
        { backgroundColor: 'rgba(20,20,22,0.85)' },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
  },
  content: {
    position: 'relative',
    zIndex: 1,
  },
})
