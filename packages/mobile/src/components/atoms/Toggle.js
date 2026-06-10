// ════════════════════════════════════════════════════════════════════════════
// Toggle — switch on/off (style iOS)
// ════════════════════════════════════════════════════════════════════════════

import { Pressable, View, StyleSheet } from 'react-native'
import { useEffect, useRef } from 'react'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated'

import { colors } from '../../theme'

const TRACK_WIDTH = 34
const TRACK_HEIGHT = 20
const KNOB_SIZE = 16

export default function Toggle({ value, onChange, color = colors.status.success }) {
  const offset = useSharedValue(value ? TRACK_WIDTH - KNOB_SIZE - 2 : 2)

  useEffect(() => {
    offset.value = withTiming(value ? TRACK_WIDTH - KNOB_SIZE - 2 : 2, { duration: 180 })
  }, [value, offset])

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }))

  return (
    <Pressable
      onPress={() => onChange?.(!value)}
      style={[
        styles.track,
        {
          backgroundColor: value ? color : 'rgba(255,255,255,0.15)',
          borderColor: value ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)',
        },
      ]}
    >
      <Animated.View style={[styles.knob, knobStyle]} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 0.5,
    justifyContent: 'center',
  },
  knob: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 2,
  },
})
