// ════════════════════════════════════════════════════════════════════════════
// useListEntrance — entrée animée (fade + slide) d'un item de liste
// ════════════════════════════════════════════════════════════════════════════
//
// Retourne un style Animated { opacity, transform } à étaler sur un
// <Animated.View>. Stagger par index, plafonné pour les longues listes.
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'
import { Animated } from 'react-native'

export function useListEntrance(index = 0) {
  const v = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 260,
      delay: Math.min(index * 28, 180),
      useNativeDriver: true,
    }).start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  }
}
