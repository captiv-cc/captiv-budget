// ════════════════════════════════════════════════════════════════════════════
// BottomSheet — feuille modale qui remonte du bas
// ════════════════════════════════════════════════════════════════════════════
//
// Implémentation simple sans @gorhom/bottom-sheet (évite une dep supplémentaire
// pour V1). Hauteur fixe via props (80% par défaut). Backdrop tappable pour
// fermer. Handle bar en haut. Swipe-to-dismiss via PanResponder.
//
// Pour V2, migrer vers @gorhom/bottom-sheet qui supporte snap points multiples
// et physique plus naturelle.
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  Animated,
  Dimensions,
  PanResponder,
  Platform,
} from 'react-native'
import { BlurView } from 'expo-blur'

import { colors, radius, spacing } from '../../theme'

const { height: SCREEN_HEIGHT } = Dimensions.get('window')

export default function BottomSheet({
  visible,
  onClose,
  heightPercent = 80,
  children,
  blurBackdrop = true,
  closeOnBackdrop = true,
}) {
  const sheetHeight = (SCREEN_HEIGHT * heightPercent) / 100
  const translateY = useRef(new Animated.Value(sheetHeight)).current
  const backdropOpacity = useRef(new Animated.Value(0)).current

  // Open / close animations
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: sheetHeight,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [visible, sheetHeight, translateY, backdropOpacity])

  // Pan responder pour swipe-to-dismiss depuis le handle
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, gesture) => Math.abs(gesture.dy) > 10,
      onPanResponderMove: (_e, gesture) => {
        if (gesture.dy > 0) {
          translateY.setValue(gesture.dy)
          const progress = Math.max(0, 1 - gesture.dy / sheetHeight)
          backdropOpacity.setValue(progress)
        }
      },
      onPanResponderRelease: (_e, gesture) => {
        if (gesture.dy > 80 || gesture.vy > 0.8) {
          // Close
          Animated.parallel([
            Animated.timing(translateY, {
              toValue: sheetHeight,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(backdropOpacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start(() => onClose?.())
        } else {
          // Snap back
          Animated.parallel([
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
            Animated.timing(backdropOpacity, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start()
        }
      },
    }),
  ).current

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={StyleSheet.absoluteFill}>
        {/* Backdrop */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { opacity: backdropOpacity, backgroundColor: 'rgba(0,0,0,0.5)' },
          ]}
        >
          {closeOnBackdrop && (
            <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
          )}
        </Animated.View>

        {/* Sheet */}
        <Animated.View
          style={[
            styles.sheet,
            { height: sheetHeight, transform: [{ translateY }] },
          ]}
        >
          {Platform.OS === 'ios' && blurBackdrop && (
            <BlurView
              intensity={60}
              tint="dark"
              style={[StyleSheet.absoluteFill, { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet }]}
            />
          )}
          <View style={styles.sheetSurface} />

          {/* Handle bar (zone tactile pour drag) */}
          <View {...panResponder.panHandlers} style={styles.handleZone}>
            <View style={styles.handle} />
          </View>

          {/* Contenu */}
          <View style={styles.content}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
  },
  sheetSurface: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Platform.OS === 'ios' ? colors.glass.dialog : '#141416',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    borderBottomWidth: 0,
  },
  handleZone: {
    paddingTop: 8,
    paddingBottom: 14,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.glass.insetHighlightStrong,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: 22,
  },
})
