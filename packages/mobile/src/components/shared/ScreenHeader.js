// ════════════════════════════════════════════════════════════════════════════
// ScreenHeader — header unifié (titre + sous-titre + actions), blur au scroll
// ════════════════════════════════════════════════════════════════════════════
//
// Props :
// - title, subtitle
// - leftMode : 'menu' (burger) | 'back' | 'none'
// - onLeftPress (back) — défaut nav.goBack
// - right : node (Avatar, IconButton…)
// - align : 'center' (défaut) | 'left'
// - scrollY : Animated.Value → fait apparaître un fond blur + ombre au scroll
// - overlay : true → header flottant en absolu (contenu scrolle dessous)
//
// HEADER_BASE_HEIGHT : hauteur hors safe-area (pour paddingTop du contenu en overlay).
// ════════════════════════════════════════════════════════════════════════════

import { Platform, View, Text, Animated, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { useNavigation } from '@react-navigation/native'

import { IconButton } from '../atoms'
import BurgerButton from '../BurgerButton'
import { colors, spacing, type, blur, elevation } from '../../theme'

export const HEADER_BASE_HEIGHT = 52

export default function ScreenHeader({
  title,
  subtitle,
  leftMode = 'menu',
  onLeftPress,
  right,
  align = 'center',
  scrollY,
  overlay = false,
}) {
  const insets = useSafeAreaInsets()
  const nav = useNavigation()

  const bgOpacity = scrollY
    ? scrollY.interpolate({ inputRange: [0, 40], outputRange: [0, 1], extrapolate: 'clamp' })
    : null

  const left =
    leftMode === 'back' ? (
      <IconButton icon="chevron-back" onPress={onLeftPress ?? (() => nav.goBack())} />
    ) : leftMode === 'menu' ? (
      <BurgerButton />
    ) : (
      <View style={styles.slot} />
    )

  return (
    <View
      style={[
        overlay ? styles.overlay : null,
        { paddingTop: insets.top + spacing.sm },
      ]}
    >
      {/* Fond blur + ombre qui apparaît au scroll */}
      {scrollY && (
        <Animated.View style={[StyleSheet.absoluteFill, styles.bgWrap, { opacity: bgOpacity }]}>
          {Platform.OS === 'ios' && <BlurView intensity={blur.base} tint="dark" style={StyleSheet.absoluteFill} />}
          <View style={[StyleSheet.absoluteFill, styles.bgSurface]} />
          <View style={styles.bgBorder} />
        </Animated.View>
      )}

      <View style={styles.row}>
        <View style={styles.slot}>{left}</View>
        <View style={[styles.center, align === 'left' && styles.centerLeft]}>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
          {!!title && (
            <Text style={[styles.title, align === 'left' && { textAlign: 'left' }]} numberOfLines={1}>
              {title}
            </Text>
          )}
        </View>
        <View style={[styles.slot, styles.slotRight]}>{right}</View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  bgWrap: { overflow: 'hidden' },
  bgSurface: { backgroundColor: colors.glass.overlay },
  bgBorder: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glass.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.base,
    minHeight: 44,
  },
  slot: { width: 40, justifyContent: 'center' },
  slotRight: { alignItems: 'flex-end' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerLeft: { alignItems: 'flex-start', paddingHorizontal: spacing.sm },
  subtitle: {
    ...type.caption,
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },
  title: {
    ...type.headerTitle,
    color: '#fff',
  },
})
