import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { colors, fontSize, fontWeight, spacing, radius } from '../../theme'

export default function TimelineView({ lanes, creneaux }) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="grid-outline" size={28} color={colors.brand.blueLight} />
        </View>
        <Text style={styles.title}>Vue Timeline</Text>
        <Text style={styles.subtitle}>
          Vue multi-scènes + multi-cadreurs, comme sur l'app web
        </Text>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Lanes prévues</Text>
          <Text style={styles.rowValue}>
            {lanes?.length ? `${lanes.length} (MOI + scènes)` : '—'}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Créneaux à afficher</Text>
          <Text style={styles.rowValue}>{creneaux?.length ?? 0}</Text>
        </View>

        <View style={styles.badge}>
          <Ionicons name="construct-outline" size={11} color="#FBBF24" />
          <Text style={styles.badgeText}>Bientôt en V1.1</Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingBottom: 120,
  },
  card: {
    width: '100%',
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(96,165,250,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.heading,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  rowLabel: {
    fontSize: fontSize.small,
    color: colors.textMuted,
  },
  rowValue: {
    fontSize: fontSize.small,
    color: '#fff',
    fontWeight: fontWeight.semibold,
  },
  badge: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderColor: 'rgba(251,191,36,0.35)',
    borderWidth: 0.5,
    borderRadius: 5,
  },
  badgeText: {
    fontSize: 9,
    color: '#FBBF24',
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
})
