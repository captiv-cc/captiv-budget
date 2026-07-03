// ════════════════════════════════════════════════════════════════════════════
// LivrablesScreen — livrables par bloc (refonte UI 2026)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useRef } from 'react'
import { View, Text, Animated, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { IconButton } from '../components/atoms'
import { ScreenHeader, Card, Badge, PressableScale } from '../components/shared'
import { useHeaderLeftMode } from '../hooks/useHeaderLeftMode'
import { STATUT_LIVRABLE, STATUT_LIVRABLE_LABEL, formatDateCourte } from '@captiv/shared'
import { colors, spacing, radius, type } from '../theme'
import { useAuth } from '../lib/AuthContext'
import { aujourdhuiJour } from '../lib/dateMin'
import { useProjet } from '../lib/ProjetContext'
import { useLivrablesProjet } from '../hooks/useLivrablesProjet'
import { useListEntrance } from '../hooks/useListEntrance'
import { RowSkeletonList } from '../components/Skeleton'

const FILTRES = [
  { value: 'tous', label: 'Tous' },
  { value: 'mine', label: 'Mes livrables' },
  { value: 'retard', label: 'En retard' },
]

const STATUT_VARIANT = {
  [STATUT_LIVRABLE.VALIDE]: 'success',
  [STATUT_LIVRABLE.CAPTE]: 'success',
  [STATUT_LIVRABLE.EN_MONTAGE]: 'accent',
  [STATUT_LIVRABLE.EN_RETOUCHE]: 'warning',
  [STATUT_LIVRABLE.A_CAPTER]: 'info',
  [STATUT_LIVRABLE.A_DEMARRER]: 'neutral',
}

export default function LivrablesScreen() {
  const leftMode = useHeaderLeftMode()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [filtre, setFiltre] = useState('tous')
  const { projet } = useProjet()
  const { blocs, livrables, loading, refetch } = useLivrablesProjet(projet?.id)

  const filteredParBloc = useMemo(() => {
    const today = aujourdhuiJour()
    const match = (l) => {
      if (filtre === 'mine') return l.assignee_profile_id === user?.id
      if (filtre === 'retard') return l.livraison && String(l.livraison) < today && l.statut !== STATUT_LIVRABLE.VALIDE
      return true
    }
    const map = {}
    for (const l of livrables ?? []) {
      if (!match(l)) continue
      ;(map[l.bloc_id] ??= []).push(l)
    }
    return map
  }, [livrables, filtre, user?.id])

  const totalAffiches = Object.values(filteredParBloc).reduce((n, arr) => n + arr.length, 0)
  let runningIndex = 0

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <ScreenHeader title="Livrables" leftMode={leftMode} right={<IconButton icon="filter-outline" iconSize={14} />} />

      {/* Projet courant */}
      <View style={styles.topPad}>
        <Card variant="glass" padding="md">
          <Text style={styles.projetLabel}>Projet en cours</Text>
          <Text style={styles.projetName}>{projet?.title ?? 'Pas de projet'}</Text>
        </Card>
      </View>

      {/* Filtres */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.filtres}>
        {FILTRES.map((f) => {
          const active = f.value === filtre
          return (
            <PressableScale
              key={f.value}
              haptic="selection"
              onPress={() => setFiltre(f.value)}
              style={[styles.filtreChip, active && styles.filtreChipActive]}
            >
              <Text style={[styles.filtreText, active && styles.filtreTextActive]}>{f.label}</Text>
            </PressableScale>
          )
        })}
      </ScrollView>

      {loading && (!livrables || livrables.length === 0) ? (
        <View style={{ paddingTop: 6 }}>
          <RowSkeletonList count={7} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.textMuted} />}
        >
          {totalAffiches === 0 ? (
            <Text style={styles.empty}>
              {filtre === 'mine'
                ? 'Aucun livrable qui t’est assigné.'
                : filtre === 'retard'
                  ? 'Aucun livrable en retard 🎉'
                  : 'Aucun livrable sur ce projet.'}
            </Text>
          ) : (
            blocs.map((bloc) => {
              const items = filteredParBloc[bloc.id] ?? []
              if (items.length === 0) return null
              return (
                <View key={bloc.id} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={[styles.sectionDot, { backgroundColor: bloc.couleur }]} />
                    <Text style={styles.sectionLabel}>{bloc.label}</Text>
                    <Text style={styles.sectionCount}>{items.length}</Text>
                  </View>
                  <View style={styles.sectionList}>
                    {items.map((l) => (
                      <LivrableRow key={l.id} livrable={l} accent={bloc.couleur} index={runningIndex++} />
                    ))}
                  </View>
                </View>
              )
            })
          )}
        </ScrollView>
      )}
    </View>
  )
}

function LivrableRow({ livrable, accent, index }) {
  const entrance = useListEntrance(index)
  const tone = STATUT_VARIANT[livrable.statut] ?? 'neutral'
  const livraisonStr = livrable.livraison ? formatDateCourte(livrable.livraison).slice(0, 5) : null

  return (
    <Animated.View style={entrance}>
      <Card variant="flat" padding="sm" accent={accent} style={styles.row}>
        <Text style={styles.rowNum}>{livrable.numero}</Text>
        <View style={styles.rowContent}>
          <Text style={styles.rowTitre} numberOfLines={1}>{livrable.nom}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {[livrable.format, livrable.duree, livraisonStr].filter(Boolean).join('  ·  ')}
          </Text>
        </View>
        <Badge tone={tone}>{STATUT_LIVRABLE_LABEL[livrable.statut]}</Badge>
      </Card>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topPad: { paddingHorizontal: spacing.lg, paddingBottom: spacing.base },
  projetLabel: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  projetName: { ...type.bodyStrong, color: '#fff', marginTop: 2 },
  filtres: { paddingHorizontal: spacing.lg, paddingBottom: spacing.base, gap: spacing.sm },
  filtreChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
  },
  filtreChipActive: { backgroundColor: '#fff', borderColor: '#fff' },
  filtreText: { ...type.caption, color: colors.textSecondary, fontWeight: '600' },
  filtreTextActive: { color: '#000', fontWeight: '700' },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: 2, gap: spacing.xl },
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: 60 },
  section: { gap: spacing.base },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 2 },
  sectionDot: { width: 9, height: 9, borderRadius: 4.5 },
  sectionLabel: { ...type.overline, color: '#fff', textTransform: 'uppercase' },
  sectionCount: { ...type.caption, color: colors.textMuted },
  sectionList: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowNum: { width: 22, ...type.caption, color: colors.textMuted, fontWeight: '700' },
  rowContent: { flex: 1, gap: 2 },
  rowTitre: { ...type.subhead, color: '#fff', fontWeight: '600' },
  rowMeta: { ...type.caption, color: colors.textMuted },
})
