// ════════════════════════════════════════════════════════════════════════════
// Input — champ texte styled (label + icône + secure + show password)
// ════════════════════════════════════════════════════════════════════════════

import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'

import { colors, radius, fontSize, fontWeight, spacing } from '../../theme'

export default function Input({
  label,
  rightLabel,
  value,
  onChangeText,
  placeholder,
  icon, // 'mail-outline', 'lock-closed-outline', etc.
  secureTextEntry,
  autoCapitalize = 'none',
  autoComplete,
  keyboardType,
  returnKeyType,
  onSubmitEditing,
  editable = true,
  style,
}) {
  const [secureVisible, setSecureVisible] = useState(!secureTextEntry)

  return (
    <View style={[styles.wrapper, style]}>
      {label && (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {rightLabel && <Text style={styles.rightLabel}>{rightLabel}</Text>}
        </View>
      )}
      <View style={styles.inputWrapper}>
        {icon && (
          <Ionicons name={icon} size={15} color={colors.textDim} style={styles.iconLeft} />
        )}
        <TextInput
          style={[
            styles.input,
            secureTextEntry && !secureVisible && { letterSpacing: 3 },
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secureTextEntry && !secureVisible}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          keyboardType={keyboardType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          editable={editable}
        />
        {secureTextEntry && (
          <Pressable
            onPress={() => setSecureVisible((v) => !v)}
            hitSlop={8}
            style={styles.iconRight}
          >
            <Ionicons
              name={secureVisible ? 'eye-off-outline' : 'eye-outline'}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  rightLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderRadius: radius.base,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    gap: spacing.base,
  },
  iconLeft: {},
  iconRight: { paddingLeft: spacing.sm },
  input: {
    flex: 1,
    color: colors.white,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.medium,
    paddingVertical: 0, // sans ça RN met du padding intrinsèque
  },
})
