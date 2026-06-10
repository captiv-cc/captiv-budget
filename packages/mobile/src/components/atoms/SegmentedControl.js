// ════════════════════════════════════════════════════════════════════════════
// SegmentedControl — toggle segmenté à 2-N options (Mes créneaux/Timeline)
// ════════════════════════════════════════════════════════════════════════════
//
// Style Liquid Glass : track glass semi-transparent, option active = blanc.
//
// Usage :
//   <SegmentedControl
//     options={[
//       { value: 'mine', label: 'Mes créneaux', icon: 'list-outline' },
//       { value: 'timeline', label: 'Timeline', icon: 'grid-outline' },
//     ]}
//     value={view}
//     onChange={setView}
//   />
//
// ════════════════════════════════════════════════════════════════════════════

import { View, Pressable, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { colors, radius, spacing, fontSize, fontWeight } from '../../theme'

export default function SegmentedControl({ options, value, onChange, style }) {
  return (
    <View style={[styles.track, style]}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange?.(opt.value)}
            style={[styles.option, active && styles.optionActive]}
          >
            {opt.icon && (
              <Ionicons
                name={opt.icon}
                size={14}
                color={active ? '#000' : colors.textSecondary}
              />
            )}
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.glass.base,
    borderRadius: radius.base,
    padding: 3,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    gap: 2,
  },
  option: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  optionActive: {
    backgroundColor: '#fff',
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },
  labelActive: {
    color: '#000',
  },
})
