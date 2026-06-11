// ════════════════════════════════════════════════════════════════════════════
// Badge — pastille de statut/label unifiée (remplace les 8 variantes éparses)
// ════════════════════════════════════════════════════════════════════════════
//
// tone    : clé de statusTint (success|warning|danger|info|accent|neutral)
//           OU un objet { fg, bg, border } custom.
// variant : 'soft' (défaut) | 'solid' | 'dot'
// size    : 'sm' (défaut) | 'md'
//
// ════════════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { colors, statusTint, radius, fontWeight } from '../../theme'

function resolveTone(tone) {
  if (tone && typeof tone === 'object') return tone
  return statusTint[tone] ?? statusTint.neutral
}

export default function Badge({ tone = 'neutral', variant = 'soft', icon, size = 'sm', children, style }) {
  const t = resolveTone(tone)
  const isMd = size === 'md'
  const solid = variant === 'solid'
  const dot = variant === 'dot'

  const bg = solid ? t.solid : t.bg
  const fg = solid ? '#fff' : t.fg
  const borderColor = solid ? 'transparent' : t.border

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: bg, borderColor },
        isMd && styles.md,
        style,
      ]}
    >
      {dot && <View style={[styles.dot, { backgroundColor: t.solid }]} />}
      {icon && <Ionicons name={icon} size={isMd ? 12 : 10} color={fg} />}
      <Text style={[styles.text, isMd && styles.textMd, { color: fg }]}>{children}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 0.5,
  },
  md: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.md,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  textMd: { fontSize: 10 },
})
