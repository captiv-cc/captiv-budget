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

import { useState, useMemo, useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native'
import { useRoute } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { SegmentedControl, Avatar } from '../components/atoms'
import { ScreenHeader, PressableScale } from '../components/shared'
import MesCreneauxView from '../components/planning/MesCreneauxView'
import TimelineView from '../components/planning/TimelineView'
import CreneauDetailSheet from './CreneauDetailSheet'
import { colors, fontWeight, spacing, radius } from '../theme'
import { aujourdhuiJour, formatJourPill } from '../lib/dateMin'
import { useProjet } from '../lib/ProjetContext'
import { useProjetDeroules } from '../hooks/useProjetDeroules'
import { useMesCreneauxJour } from '../hooks/useMesCreneauxJour'
import { useDerouleJour } from '../hooks/useDerouleJour'
import { usePlanningRealtime } from '../hooks/usePlanningRealtime'
import { useProfile } from '../hooks/useProfile'

export default function PlanningScreen() {
  const insets = useSafeAreaInsets()
  const route = useRoute()
  const { profile } = useProfile()
  const { projet } = useProjet()
  const [view, setView] = useState('mine') // 'mine' | 'timeline'
  const [selectedJour, setSelectedJour] = useState(null)
  const [selectedCreneau, setSelectedCreneau] = useState(null)

  // Deep-link push : ouvre le créneau ciblé (param posé par openCreneauFromPush)
  useEffect(() => {
    const id = route.params?.openCreneauId
    if (id) setSelectedCreneau({ id })
  }, [route.params?.openCreneauId, route.params?.ts])
  const { deroules, refetch: refetchDeroules } = useProjetDeroules(projet?.id)

  // Jours réels du projet (date_jour) ; pill active = jour choisi, sinon
  // aujourd'hui s'il fait partie du projet, sinon le 1er jour.
  const jours = useMemo(() => deroules.map((d) => d.date_jour), [deroules])
  const jourActif =
    selectedJour && jours.includes(selectedJour)
      ? selectedJour
      : jours.includes(aujourdhuiJour())
        ? aujourdhuiJour()
        : jours[0] ?? null

  const {
    creneaux: mesCreneaux,
    loading: loadingCreneaux,
    refetch: refetchMine,
  } = useMesCreneauxJour({ projetId: projet?.id, jour: jourActif })

  // Timeline : toutes les lanes + créneaux du jour
  const {
    lanes,
    creneaux: tousCreneaux,
    loading: loadingDeroule,
    refetch: refetchDeroule,
  } = useDerouleJour({ projetId: projet?.id, jour: jourActif })

  // Live : un changement déroulé (décalage, statut, réassignation, ajout de
  // jour) refetch tout
  const refetchAll = () => {
    refetchMine()
    refetchDeroule()
    refetchDeroules()
  }
  usePlanningRealtime(projet?.id, refetchAll)

  // Ids ordonnés pour la nav prec/suiv dans le drawer
  const siblingIds = useMemo(() => {
    const list = view === 'mine'
      ? mesCreneaux
      : [...tousCreneaux].sort((a, b) => (a.heure_debut_min ?? 0) - (b.heure_debut_min ?? 0))
    return list.map((c) => c.id)
  }, [view, mesCreneaux, tousCreneaux])

  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = async () => {
    setRefreshing(true)
    await Promise.all([refetchMine(), refetchDeroule(), refetchDeroules()])
    setRefreshing(false)
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <ScreenHeader
        title={view === 'mine' ? 'Mes créneaux' : 'Déroulé'}
        subtitle={`${projet?.title ?? 'Pas de projet en cours'}${jourActif ? ` · ${formatJourPill(jourActif)}` : ''}`}
        leftMode="menu"
        right={<Avatar nom={profile?.displayName ?? '?'} id={profile?.id} size={32} />}
      />

      {/* Day pills (scroll horizontal si beaucoup de jours) */}
      <View style={styles.dayPillsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={styles.dayPillsContent}
        >
          {jours.map((j) => (
            <PressableScale
              key={j}
              haptic="selection"
              onPress={() => setSelectedJour(j)}
              style={[styles.dayPill, jourActif === j && styles.dayPillActive]}
            >
              <Text style={[styles.dayPillText, jourActif === j && styles.dayPillTextActive]}>
                {formatJourPill(j)}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>
        {view === 'timeline' && (
          <View style={styles.lanesIndicator}>
            <Ionicons name="swap-horizontal-outline" size={11} color={colors.textMuted} />
            <Text style={styles.lanesIndicatorText}>{lanes.length} lanes</Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {view === 'mine' ? (
          <MesCreneauxView
            creneaux={mesCreneaux}
            onPressItem={setSelectedCreneau}
            refreshing={refreshing}
            onRefresh={onRefresh}
            loading={loadingCreneaux}
            jour={jourActif}
          />
        ) : (
          <TimelineView
            lanes={lanes}
            creneaux={tousCreneaux}
            jour={jourActif}
            onPressCreneau={setSelectedCreneau}
            refreshing={refreshing}
            onRefresh={onRefresh}
            loading={loadingDeroule}
          />
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
        onChanged={refetchAll}
        siblingIds={siblingIds}
        onNavigate={(id) => setSelectedCreneau({ id })}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  dayPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.md,
  },
  dayPillsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.lg,
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
