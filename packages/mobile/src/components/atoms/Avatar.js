// ════════════════════════════════════════════════════════════════════════════
// Avatar — pastille initiales (gradient bleu/violet par défaut)
// ════════════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native'

import { colors, fontWeight } from '../../theme'
import { initiales, couleurAvatar } from '@captiv/shared'

export default function Avatar({ nom, id, size = 32, color, style, textStyle }) {
  const init = initiales(nom)
  const bg = color ?? couleurAvatar(id ?? nom)

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          { fontSize: size * 0.4, color: '#fff' },
          textStyle,
        ]}
      >
        {init}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  text: {
    fontWeight: fontWeight.bold,
    letterSpacing: -0.2,
  },
})
