// ════════════════════════════════════════════════════════════════════════════
// EquipeScreen — équipe & contacts (refonte UI 2026)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef } from 'react'
import { View, Text, Animated, Pressable, StyleSheet, Linking, RefreshControl } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { Avatar } from '../components/atoms'
import { ScreenHeader, Section, Card, Badge, HEADER_BASE_HEIGHT } from '../components/shared'
import { useHeaderLeftMode } from '../hooks/useHeaderLeftMode'
import { RowSkeletonList } from '../components/Skeleton'
import { colors, spacing, type } from '../theme'
import { useProjet } from '../lib/ProjetContext'
import { useProjetEquipe } from '../hooks/useProjetEquipe'
import { useListEntrance } from '../hooks/useListEntrance'
import MembreDetailSheet from './MembreDetailSheet'

export default function EquipeScreen() {
  const leftMode = useHeaderLeftMode()
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current
  const { projet } = useProjet()
  const categoryOrder = projet?.metadata?.equipe?.category_order
  const { groupes, membres, loading, refetch } = useProjetEquipe(projet?.id, categoryOrder)
  const [selected, setSelected] = useState(null)

  let runningIndex = 0

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Animated.ScrollView
        contentContainerStyle={{ paddingTop: insets.top + HEADER_BASE_HEIGHT, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.xl }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.textMuted} progressViewOffset={insets.top + HEADER_BASE_HEIGHT} />}
      >
        {loading && membres.length === 0 ? (
          <RowSkeletonList count={8} />
        ) : membres.length === 0 ? (
          <Text style={styles.empty}>Aucun membre sur ce projet.</Text>
        ) : (
          groupes.map((g) => (
            <Section key={g.category} label={`${g.category} · ${g.items.length}`}>
              {g.items.map((m) => (
                <MembreRow key={m.id} membre={m} index={runningIndex++} onPress={() => setSelected(m)} />
              ))}
            </Section>
          ))
        )}
      </Animated.ScrollView>

      <ScreenHeader title="Équipe & contacts" subtitle={projet?.title} leftMode={leftMode} scrollY={scrollY} overlay />

      <MembreDetailSheet membre={selected} visible={!!selected} onClose={() => setSelected(null)} />
    </View>
  )
}

function MembreRow({ membre, index, onPress }) {
  const entrance = useListEntrance(index)
  const call = () => membre.phone && Linking.openURL(`tel:${membre.phone}`).catch(() => {})
  const mail = () => membre.email && Linking.openURL(`mailto:${membre.email}`).catch(() => {})

  return (
    <Animated.View style={entrance}>
      <Card variant="flat" padding="md" onPress={onPress} style={styles.row}>
        <Avatar nom={membre.nom} id={membre.id} size={40} />
        <View style={styles.rowContent}>
          <View style={styles.nameRow}>
            <Text style={styles.nom} numberOfLines={1}>{membre.nom}</Text>
            {membre.is_me && <Badge tone="info">MOI</Badge>}
          </View>
          <Text style={styles.poste} numberOfLines={1}>
            {membre.poste ?? '—'}{membre.secteur ? `  ·  ${membre.secteur}` : ''}
          </Text>
        </View>
        <View style={styles.actions}>
          {!!membre.phone && (
            <Pressable onPress={call} style={styles.actionBtn} hitSlop={6}>
              <Ionicons name="call" size={16} color={colors.brand.blueLight} />
            </Pressable>
          )}
          {!!membre.email && (
            <Pressable onPress={mail} style={styles.actionBtn} hitSlop={6}>
              <Ionicons name="mail" size={16} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </Card>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowContent: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nom: { ...type.subhead, color: '#fff', fontWeight: '600', flexShrink: 1 },
  poste: { ...type.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.glass.high,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
