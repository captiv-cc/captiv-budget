// ════════════════════════════════════════════════════════════════════════════
// LivrablesScreen — liste des livrables (style page suivi captiv)
// ════════════════════════════════════════════════════════════════════════════
//
// Maquette : header avec contexte projet, filtres chips (Tous / Mes / En
// retard), sections par bloc (RECAP, SNACK CONTENT, CAPSULES) avec pastille
// colorée, chaque ligne livrable compacte (n° + nom + format/durée/livraison
// + chip statut).
//
// ════════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { IconButton, StatusPill } from '../components/atoms'
import {
  STATUT_LIVRABLE,
  STATUT_LIVRABLE_LABEL,
  formatDateCourte,
} from '@captiv/shared'
import { colors, fontSize, fontWeight, spacing, radius } from '../theme'
import { fixtureLivrables, fixtureBlocs, fixtureProjet } from '../fixtures'

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
  const insets = useSafeAreaInsets()
  const [filtre, setFiltre] = useState('tous')

  const livrablesParBloc = useMemo(() => {
    const map = {}
    for (const l of fixtureLivrables) {
      if (!map[l.bloc_id]) map[l.bloc_id] = []
      map[l.bloc_id].push(l)
    }
    return map
  }, [])

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="menu-outline" />
        <Text style={styles.title}>Livrables</Text>
        <IconButton icon="filter-outline" iconSize={14} />
      </View>

      {/* Projet chip */}
      <View style={styles.projetChipWrap}>
        <View style={styles.projetChip}>
          <View>
            <Text style={styles.projetChipLabel}>Projet en cours</Text>
            <Text style={styles.projetChipName}>{fixtureProjet.nom}</Text>
          </View>
          <View style={styles.projetChipPill}>
            <Text style={styles.projetChipPillText}>
              J{fixtureProjet.jour_actuel}/{fixtureProjet.jours_total} · VEN
            </Text>
          </View>
        </View>
      </View>

      {/* Filtres */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtres}
      >
        {FILTRES.map((f) => {
          const isActive = f.value === filtre
          return (
            <Pressable
              key={f.value}
              onPress={() => setFiltre(f.value)}
              style={[styles.filtreChip, isActive && styles.filtreChipActive]}
            >
              <Text style={[styles.filtreText, isActive && styles.filtreTextActive]}>
                {f.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {/* Liste sections */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {fixtureBlocs.map((bloc) => {
          const items = livrablesParBloc[bloc.id] ?? []
          if (items.length === 0) return null
          return (
            <View key={bloc.id} style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionDot, { backgroundColor: bloc.couleur }]} />
                <Text style={styles.sectionLabel}>{bloc.label}</Text>
                <Text style={styles.sectionCount}>· {items.length}</Text>
              </View>
              <View style={styles.sectionList}>
                {items.map((l) => (
                  <LivrableRow key={l.id} livrable={l} />
                ))}
              </View>
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

function LivrableRow({ livrable }) {
  const variant = STATUT_VARIANT[livrable.statut] ?? 'neutral'
  const livraisonStr = livrable.livraison
    ? formatDateCourte(livrable.livraison).slice(0, 5) // "12/06"
    : null

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={styles.rowNum}>{livrable.numero}</Text>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitre} numberOfLines={1}>
          {livrable.nom}
        </Text>
        <Text style={styles.rowMeta}>
          {livrable.format} · {livrable.duree}
          {livraisonStr ? ` · ${livraisonStr}` : ''}
        </Text>
      </View>
      <StatusPill variant={variant}>{STATUT_LIVRABLE_LABEL[livrable.statut]}</StatusPill>
    </Pressable>
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
  title: {
    fontSize: 16,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.3,
  },
  projetChipWrap: {
    paddingHorizontal: 14,
    paddingBottom: spacing.base,
  },
  projetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.glass.subtle,
    borderColor: colors.glass.borderSubtle,
    borderWidth: 0.5,
    borderRadius: radius.base,
    padding: spacing.md,
  },
  projetChipLabel: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  projetChipName: {
    fontSize: 13,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    marginTop: 1,
  },
  projetChipPill: {
    backgroundColor: 'rgba(16,185,129,0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  projetChipPillText: {
    fontSize: 8,
    color: '#34D399',
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  filtres: {
    paddingHorizontal: 14,
    paddingBottom: spacing.base,
    gap: 4,
  },
  filtreChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    marginRight: 4,
  },
  filtreChipActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  filtreText: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  filtreTextActive: {
    color: '#000',
    fontWeight: fontWeight.bold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 2,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  sectionDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  sectionLabel: {
    fontSize: 10,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  sectionCount: {
    fontSize: 9,
    color: colors.textMuted,
  },
  sectionList: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glass.subtle,
    borderColor: colors.glass.borderSubtle,
    borderWidth: 0.5,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 11,
    gap: spacing.md,
  },
  rowNum: {
    width: 18,
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
  },
  rowContent: {
    flex: 1,
  },
  rowTitre: {
    fontSize: 11,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    lineHeight: 14,
  },
  rowMeta: {
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 1,
  },
})
