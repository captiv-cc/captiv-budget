// ════════════════════════════════════════════════════════════════════════════
// Button — bouton primaire / secondaire / ghost / success / danger
// ════════════════════════════════════════════════════════════════════════════
//
// Variants :
//   - primary  : fond blanc plein, texte noir (style web Captiv)
//   - secondary: fond glass, texte clair
//   - ghost    : transparent, juste texte
//   - success  : vert plein (style "Marquer fait")
//   - danger   : rouge transparent
//
// ════════════════════════════════════════════════════════════════════════════

import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native'

import { colors, radius, fontSize, fontWeight, spacing } from '../../theme'

const VARIANTS = {
  primary: {
    bg: '#fff',
    bgPressed: '#E5E5E5',
    color: '#000',
    border: 'transparent',
  },
  secondary: {
    bg: colors.glass.high,
    bgPressed: colors.glass.raised,
    color: colors.white,
    border: colors.glass.border,
  },
  ghost: {
    bg: 'transparent',
    bgPressed: colors.glass.subtle,
    color: colors.text,
    border: 'transparent',
  },
  success: {
    bg: colors.status.success,
    bgPressed: '#0EA571',
    color: '#fff',
    border: colors.status.successLight,
  },
  danger: {
    bg: colors.status.dangerBg,
    bgPressed: 'rgba(239,68,68,0.25)',
    color: colors.status.dangerLight,
    border: colors.status.dangerBorder,
  },
}

const SIZES = {
  sm: { paddingV: 8, paddingH: 14, fontSize: fontSize.small },
  md: { paddingV: 12, paddingH: 16, fontSize: fontSize.bodyLarge },
  lg: { paddingV: 14, paddingH: 18, fontSize: fontSize.subtitle },
}

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  onPress,
  disabled,
  loading,
  leftIcon,
  rightIcon,
  style,
  textStyle,
  ...rest
}) {
  const v = VARIANTS[variant] ?? VARIANTS.primary
  const s = SIZES[size] ?? SIZES.md

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      android_ripple={{ color: 'rgba(255,255,255,0.1)' }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: disabled ? `${v.bg}55` : pressed ? v.bgPressed : v.bg,
          borderColor: v.border,
          paddingVertical: s.paddingV,
          paddingHorizontal: s.paddingH,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.color} />
      ) : (
        <>
          {leftIcon}
          <Text
            style={[
              styles.text,
              { color: v.color, fontSize: s.fontSize },
              textStyle,
            ]}
            numberOfLines={1}
          >
            {children}
          </Text>
          {rightIcon}
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 0.5,
  },
  text: {
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
  },
})
