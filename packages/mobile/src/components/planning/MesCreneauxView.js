// ════════════════════════════════════════════════════════════════════════════
// MesCreneauxView — liste verticale des créneaux du jour pour CE cadreur
// ════════════════════════════════════════════════════════════════════════════
//
// Maquette : carte par créneau, border-left colorée par type, heure début +
// heure fin empilées à gauche, type/titre/lieu à droite.
//
// ════════════════════════════════════════════════════════════════════════════

import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { formatHeure, TYPE_CRENEAU_LABEL, TYPE_CRENEAU_COLOR } from '@captiv/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme'

export default function MesCreneauxView({ creneaux, onPressItem }) {
  return (
    <FlatList
      data={creneaux}
      keyExtractor={(it) => it.id}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      renderItem={({ item }) => <CreneauRow creneau={item} onPress={() => onPressItem?.(item)} />}
      ListEmptyComponent={
        <Text style={styles.empty}>Aucun créneau aujourd'hui. Profite ✨</Text>
      }
    />
  )
}

function CreneauRow({ creneau, onPress }) {
  const color = TYPE_CRENEAU_COLOR[creneau.type] ?? colors.textMuted
  const typeLabel = TYPE_CRENEAU_LABEL[creneau.type] ?? ''

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderLeftColor: color, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.heureCol}>
        <Text style={styles.heureStart} numberOfLines={1}>{formatHeure(creneau.start)}</Text>
        <Text style={styles.heureEnd} numberOfLines={1}>{formatHeure(creneau.end)}</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.titreRow}>
          <Text style={[styles.type, { color }]}>
            {typeLabel.toUpperCase()}
          </Text>
          {creneau.headliner && (
            <View style={styles.headlinerChip}>
              <Ionicons name="star" size={9} color="#FCA5A5" />
              <Text style={styles.headlinerText}>HEAD</Text>
            </View>
          )}
        </View>
        <Text style={styles.titre} numberOfLines={1}>
          {creneau.titre}
        </Text>
        {creneau.lieu && (
          <View style={styles.lieuRow}>
            <Ionicons name="location-outline" size={12} color={colors.textMuted} />
            <Text style={styles.lieu}>{creneau.lieu}</Text>
          </View>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 100, // espace pour le segmented control floating + tab bar
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 60,
    fontSize: fontSize.body,
  },
  card: {
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderLeftWidth: 3,
    borderRadius: radius.lg,
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.lg,
    alignItems: 'flex-start',
  },
  heureCol: {
    width: 60,
  },
  heureStart: {
    fontSize: 20,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.4,
    lineHeight: 22,
  },
  heureEnd: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  titreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  type: {
    fontSize: fontSize.tiny,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  headlinerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(244,114,182,0.15)',
    borderColor: 'rgba(244,114,182,0.35)',
    borderWidth: 0.5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  headlinerText: {
    fontSize: 8,
    color: '#F472B6',
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  titre: {
    fontSize: fontSize.subtitle,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
  },
  lieuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  lieu: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
})
