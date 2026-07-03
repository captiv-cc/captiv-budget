// ════════════════════════════════════════════════════════════════════════════
// MaterielScreen — matériel du projet (version active, lecture seule)
// ════════════════════════════════════════════════════════════════════════════

import { useRef } from 'react'
import { View, Text, Animated, StyleSheet, RefreshControl } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { ScreenHeader, Section, Badge, HEADER_BASE_HEIGHT } from '../components/shared'
import { useHeaderLeftMode } from '../hooks/useHeaderLeftMode'
import { RowSkeletonList } from '../components/Skeleton'
import { colors, spacing, radius, type } from '../theme'
import { useProjet } from '../lib/ProjetContext'
import { useProjetMateriel } from '../hooks/useProjetMateriel'
import { usePermissions } from '../hooks/usePermissions'

const FLAG = {
  attention: { tone: 'warning', label: 'À vérifier' },
  probleme: { tone: 'danger', label: 'Problème' },
}

export default function MaterielScreen() {
  const leftMode = useHeaderLeftMode()
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current
  const { projet } = useProjet()
  const { canEdit } = usePermissions()
  const { version, blocks, loading, refetch } = useProjetMateriel(projet?.id)

  const editable = canEdit('materiel')
  const totalItems = blocks.reduce((n, b) => n + b.items.length, 0)
  const subtitle = version ? `${projet?.title ?? ''} · V${version.numero}` : projet?.title

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
        {!editable && (
          <View style={styles.viewOnly}>
            <Ionicons name="eye-outline" size={13} color={colors.textMuted} />
            <Text style={styles.viewOnlyText}>Lecture seule{version ? ` · V${version.numero}${version.is_active ? ' active' : ''}` : ''}</Text>
          </View>
        )}

        {loading && blocks.length === 0 ? (
          <RowSkeletonList count={7} />
        ) : !version ? (
          <Text style={styles.empty}>Aucune version de matériel sur ce projet.</Text>
        ) : totalItems === 0 ? (
          <Text style={styles.empty}>La liste matériel est vide.</Text>
        ) : (
          blocks.map((b) => (
            b.items.length > 0 && (
              <View key={b.id} style={styles.block}>
                <View style={styles.blockHeader}>
                  <View style={[styles.blockDot, { backgroundColor: b.couleur ?? colors.textMuted }]} />
                  <Text style={styles.blockTitre}>{b.titre}</Text>
                  <Text style={styles.blockCount}>{b.items.length}</Text>
                </View>
                <Section grouped>
                  {b.items.map((it) => (
                    <ItemRow key={it.id} item={it} />
                  ))}
                </Section>
              </View>
            )
          ))
        )}
      </Animated.ScrollView>

      <ScreenHeader title="Matériel" subtitle={subtitle} leftMode={leftMode} scrollY={scrollY} overlay />
    </View>
  )
}

function ItemRow({ item }) {
  const flag = FLAG[item.flag]
  return (
    <View style={styles.itemRow}>
      <Text style={styles.qty}>{item.quantite}×</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {!!item.label && <Text style={styles.itemLabel}>{item.label}</Text>}
        <Text style={styles.itemName} numberOfLines={2}>{item.designation}</Text>
        {!!item.remarques && <Text style={styles.itemRem} numberOfLines={1}>{item.remarques}</Text>}
        {item.loueurs.length > 0 && (
          <View style={styles.loueursRow}>
            {item.loueurs.map((l, i) => (
              <View key={i} style={[styles.loueurChip, l.couleur && { borderColor: `${l.couleur}66`, backgroundColor: `${l.couleur}22` }]}>
                <Text style={[styles.loueurText, l.couleur && { color: l.couleur }]} numberOfLines={1}>
                  {l.nom}{l.ref ? ` · ${l.ref}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {flag && <Badge tone={flag.tone}>{flag.label}</Badge>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  viewOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
  },
  viewOnlyText: { ...type.caption, color: colors.textMuted, fontWeight: '600' },
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: 60 },
  block: { gap: spacing.base },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 2 },
  blockDot: { width: 9, height: 9, borderRadius: 4.5 },
  blockTitre: { ...type.overline, color: '#fff', textTransform: 'uppercase' },
  blockCount: { ...type.caption, color: colors.textMuted },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md },
  qty: { ...type.subhead, color: colors.brand.blueLight, fontWeight: '700', minWidth: 26 },
  itemLabel: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  itemName: { ...type.subhead, color: '#fff', fontWeight: '600' },
  itemRem: { ...type.caption, color: colors.textMuted },
  loueursRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  loueurChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
  },
  loueurText: { ...type.caption, color: colors.textSecondary, fontWeight: '600' },
})
