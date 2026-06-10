// ════════════════════════════════════════════════════════════════════════════
// IconButton — bouton carré avec icône (header, top bar, etc.)
// ════════════════════════════════════════════════════════════════════════════

import { Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { colors, radius } from '../../theme'

export default function IconButton({ icon, size = 34, iconSize = 17, color, onPress, style, ...rest }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, opacity: pressed ? 0.6 : 1 },
        style,
      ]}
      hitSlop={8}
      {...rest}
    >
      <Ionicons name={icon} size={iconSize} color={color ?? colors.text} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.glass.high,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderRadius: radius.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
