// ════════════════════════════════════════════════════════════════════════════
// PlanningScreen — vue Planning (Mes créneaux / Timeline)
// ════════════════════════════════════════════════════════════════════════════
//
// Maquette V4 :
// - Header allégé : burger gauche, contexte projet + jour au centre, avatar droite
// - Day pills (VEN/SAM/DIM)
// - Content : Mes créneaux (FlatList cards) OU Timeline (grid multi-lanes)
// - Floating Liquid Glass SegmentedControl en bas (au-dessus de la tab bar)
//
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { IconButton, SegmentedControl, Avatar } from '../components/atoms'
import MesCreneauxView from '../components/planning/MesCreneauxView'
import TimelineView from '../components/planning/TimelineView'
import CreneauDetailSheet from './CreneauDetailSheet'
import { colors, fontSize, fontWeight, spacing, radius } from '../theme'
import {
  fixtureCreneaux,
  fixtureLanes,
  fixtureCreneauxTimeline,
  fixtureProjet,
  fixtureUser,
} from '../fixtures'

const JOURS = ['VEN', 'SAM 14', 'DIM']

export default function PlanningScreen() {
  const insets = useSafeAreaInsets()
  const [view, setView] = useState('mine') // 'mine' | 'timeline'
  const [jour, setJour] = useState('SAM 14')
  const [selectedCreneau, setSelectedCreneau] = useState(null)

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="menu-outline" />
        <View style={styles.headerCenter}>
          <Text style={styles.context}>
            {fixtureProjet.nom} · SAM 14 JUIN
          </Text>
          <Text style={styles.title}>
            {view === 'mine' ? 'Mes créneaux' : 'Planning festival'}
          </Text>
        </View>
        <Avatar nom={fixtureUser.nom} id={fixtureUser.id} size={32} />
      </View>

      {/* Day pills */}
      <View style={styles.dayPills}>
        {JOURS.map((j) => (
          <Pressable
            key={j}
            onPress={() => setJour(j)}
            style={[styles.dayPill, jour === j && styles.dayPillActive]}
          >
            <Text style={[styles.dayPillText, jour === j && styles.dayPillTextActive]}>{j}</Text>
          </Pressable>
        ))}
        {view === 'timeline' && (
          <View style={styles.lanesIndicator}>
            <Ionicons name="swap-horizontal-outline" size={11} color={colors.textMuted} />
            <Text style={styles.lanesIndicatorText}>4 lanes</Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {view === 'mine' ? (
          <MesCreneauxView
            creneaux={fixtureCreneaux}
            onPressItem={setSelectedCreneau}
          />
        ) : (
          <TimelineView lanes={fixtureLanes} creneaux={fixtureCreneauxTimeline} />
        )}
      </View>

      {/* Floating segmented control (au-dessus de la tab bar) */}
      <View style={[styles.floatingSegmentWrap, { bottom: 8 }]}>
        {Platform.OS === 'ios' && (
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        )}
        <View style={StyleSheet.absoluteFill} pointerEvents="none" />
        <SegmentedControl
          options={[
            { value: 'mine', label: 'Mes créneaux', icon: 'list-outline' },
            { value: 'timeline', label: 'Timeline', icon: 'grid-outline' },
          ]}
          value={view}
          onChange={setView}
          style={styles.floatingSegment}
        />
      </View>

      {/* Detail sheet */}
      <CreneauDetailSheet
        visible={!!selectedCreneau}
        creneau={selectedCreneau}
        onClose={() => setSelectedCreneau(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.base,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  context: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 16,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
    marginTop: 1,
  },
  dayPills: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },
  dayPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.md,
    backgroundColor: colors.glass.subtle,
    borderWidth: 0.5,
    borderColor: colors.glass.borderSubtle,
  },
  dayPillActive: {
    backgroundColor: colors.brand.blue,
    borderColor: colors.brand.blueLight,
  },
  dayPillText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.4,
  },
  dayPillTextActive: {
    color: '#fff',
  },
  lanesIndicator: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  lanesIndicatorText: {
    fontSize: 10,
    color: colors.textMuted,
  },
  content: {
    flex: 1,
  },
  floatingSegmentWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    overflow: 'hidden',
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.glass.borderHigh,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 12,
  },
  floatingSegment: {
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
})
