// ════════════════════════════════════════════════════════════════════════════
// Skeleton — placeholder animé (pulse) pendant les chargements
// ════════════════════════════════════════════════════════════════════════════
//
// Animated RN natif (pas Reanimated — cohérent avec le choix projet SDK 54).
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { colors, radius, spacing } from '../theme'

export function Skeleton({ style }) {
  const op = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [op])

  return <Animated.View style={[styles.base, { opacity: op }, style]} />
}

/** Liste de cartes créneau en chargement. */
export function CreneauSkeletonList({ count = 4 }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.card}>
          <Skeleton style={{ width: 52, height: 22, borderRadius: 6 }} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton style={{ width: '40%', height: 10 }} />
            <Skeleton style={{ width: '75%', height: 14 }} />
          </View>
        </View>
      ))}
    </View>
  )
}

/** Lignes livrables en chargement. */
export function RowSkeletonList({ count = 6 }) {
  return (
    <View style={{ gap: 6, paddingHorizontal: 14 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} style={{ height: 44, borderRadius: radius.md }} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.glass.base,
    borderRadius: radius.md,
  },
  list: {
    paddingHorizontal: 14,
    paddingTop: 6,
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.glass.subtle,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 0.5,
    borderColor: colors.glass.borderSubtle,
  },
})
