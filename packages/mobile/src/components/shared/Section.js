// ════════════════════════════════════════════════════════════════════════════
// Section — bloc de section unifié (label overline + contenu)
// ════════════════════════════════════════════════════════════════════════════
//
// grouped : true → enveloppe les enfants dans un bloc glass avec séparateurs
//           fins entre chaque enfant (style "réglages iOS").
//
// ════════════════════════════════════════════════════════════════════════════

import { Children } from 'react'
import { View, Text, StyleSheet } from 'react-native'

import { colors, spacing, radius, type } from '../../theme'

export default function Section({ label, grouped = false, gap = spacing.sm, style, children }) {
  const items = Children.toArray(children).filter(Boolean)

  return (
    <View style={[styles.section, style]}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      {grouped ? (
        <View style={styles.group}>
          {items.map((child, i) => (
            <View key={i}>
              {i > 0 && <View style={styles.divider} />}
              {child}
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap }}>{children}</View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  label: {
    ...type.overline,
    color: colors.textMuted,
    textTransform: 'uppercase',
    paddingHorizontal: 2,
  },
  group: {
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderTopColor: colors.glass.insetHighlight,
    borderWidth: 0.5,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glass.borderSubtle,
    marginLeft: spacing.lg,
  },
})
