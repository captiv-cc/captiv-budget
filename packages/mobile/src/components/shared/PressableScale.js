// ════════════════════════════════════════════════════════════════════════════
// PressableScale — Pressable avec feedback scale + opacity + haptique
// ════════════════════════════════════════════════════════════════════════════
//
// Socle d'interaction de l'app. Animated RN natif (pas Reanimated).
// haptic : 'light' | 'medium' | 'selection' | 'success' | 'error' | false
//
// ════════════════════════════════════════════════════════════════════════════

import { useRef } from 'react'
import { Animated, Pressable } from 'react-native'
import * as Haptics from 'expo-haptics'

import { press } from '../../theme'

const HAPTICS = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  selection: () => Haptics.selectionAsync(),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
}

function fireHaptic(name) {
  const fn = HAPTICS[name]
  if (!fn) return
  try {
    const p = fn()
    if (p && p.catch) p.catch(() => {})
  } catch {
    // no-op
  }
}

export default function PressableScale({
  onPress,
  haptic = 'light',
  scaleTo = press.scale,
  disabled = false,
  hitSlop,
  style,
  children,
  ...rest
}) {
  const v = useRef(new Animated.Value(0)).current

  const animate = (to) =>
    Animated.timing(v, { toValue: to, duration: press.duration, useNativeDriver: true }).start()

  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] })
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [1, press.opacity] })

  return (
    <Pressable
      onPressIn={() => {
        if (disabled) return
        animate(1)
        if (haptic) fireHaptic(haptic)
      }}
      onPressOut={() => animate(0)}
      onPress={disabled ? undefined : onPress}
      hitSlop={hitSlop}
      {...rest}
    >
      <Animated.View style={[{ transform: [{ scale }], opacity }, style]}>
        {children}
      </Animated.View>
    </Pressable>
  )
}
