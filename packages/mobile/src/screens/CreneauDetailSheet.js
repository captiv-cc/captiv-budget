// ════════════════════════════════════════════════════════════════════════════
// CreneauDetailSheet — bottom sheet détail créneau
// ════════════════════════════════════════════════════════════════════════════
//
// Maquette : sheet 80% qui s'ouvre par dessus le planning.
// Contenu :
// - Badges : CAPTATION + HEADLINER + PLANIFIÉ + bouton X
// - Titre + plage horaire + durée
// - Bloc warning orange ("Dans 1h47 — pense à charger les batteries")
// - Carte Lieu + bouton "Y aller"
// - Section ÉQUIPE (avec MOI en premier)
// - Section BRIEF (texte multi-ligne)
// - Bouton "Marquer fait" vert + chevron dropdown statuts
//
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { BottomSheet, Avatar, Button, IconButton } from '../components/atoms'
import {
  formatPlageHoraire,
  formatDuree,
  formatCountdown,
  STATUT_CRENEAU,
  STATUT_CRENEAU_LABEL,
  STATUT_CRENEAU_COLOR,
  TYPE_CRENEAU_LABEL,
  TYPE_CRENEAU_COLOR,
} from '@captiv/shared'
import { fixtureUser } from '../fixtures'
import { colors, fontSize, fontWeight, spacing, radius } from '../theme'

export default function CreneauDetailSheet({ visible, creneau, onClose }) {
  const [statut, setStatut] = useState(creneau?.statut ?? STATUT_CRENEAU.PLANIFIE)
  const [showStatutDropdown, setShowStatutDropdown] = useState(false)

  if (!creneau) {
    return <BottomSheet visible={false} onClose={onClose} />
  }

  const typeColor = TYPE_CRENEAU_COLOR[creneau.type] ?? colors.brand.blue
  const typeLabel = TYPE_CRENEAU_LABEL[creneau.type] ?? ''
  const statutColor = STATUT_CRENEAU_COLOR[statut] ?? colors.textMuted
  const statutLabel = STATUT_CRENEAU_LABEL[statut] ?? ''

  const countdown = formatCountdown(creneau.start)
  const showWarning = creneau.warnings?.length > 0 || (countdown && countdown !== 'Maintenant')

  const callTeam = async (member) => {
    if (member.phone) {
      Linking.openURL(`tel:${member.phone}`).catch(() => {})
    }
  }

  const handleMarquerFait = () => {
    setStatut(STATUT_CRENEAU.FAIT)
    // TODO: persist via API (Supabase update creneau.statut)
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} heightPercent={82}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
        {/* Badges row */}
        <View style={styles.badgesRow}>
          <View style={[styles.typeBadge, { borderColor: `${typeColor}55` }]}>
            <Ionicons name="videocam-outline" size={12} color={typeColor} />
            <Text style={[styles.typeBadgeText, { color: typeColor }]}>
              {typeLabel.toUpperCase()}
            </Text>
          </View>
          {creneau.headliner && (
            <View style={styles.headBadge}>
              <Ionicons name="star" size={10} color="#FCA5A5" />
              <Text style={styles.headBadgeText}>HEADLINER</Text>
            </View>
          )}
          <View style={[styles.statutBadge, { borderColor: `${statutColor}55` }]}>
            <Ionicons name="flag-outline" size={11} color={statutColor} />
            <Text style={[styles.statutBadgeText, { color: statutColor }]}>
              {statutLabel.toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" onPress={onClose} size={28} iconSize={16} />
        </View>

        {/* Titre + heures */}
        <Text style={styles.titre}>{creneau.titre}</Text>
        <View style={styles.horaireRow}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.horaire}>{formatPlageHoraire(creneau.start, creneau.end)}</Text>
          <Text style={styles.horaireDuree}>· {formatDuree(creneau.duree_min)}</Text>
        </View>

        {/* Countdown / warning */}
        {showWarning && (
          <View style={styles.warningCard}>
            <Ionicons name="notifications-outline" size={18} color="#FBBF24" />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningTitle}>{countdown}</Text>
              {creneau.warnings?.[0] && (
                <Text style={styles.warningSub}>{creneau.warnings[0]}</Text>
              )}
            </View>
          </View>
        )}

        {/* Lieu */}
        {creneau.lieu && (
          <View style={styles.lieuCard}>
            <View style={styles.lieuIcon}>
              <Ionicons name="location-outline" size={16} color={colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.lieuTitre}>{creneau.lieu}</Text>
              {creneau.lieu_distance_m != null && (
                <Text style={styles.lieuSub}>{creneau.lieu_distance_m}m · Friche Belle de Mai</Text>
              )}
            </View>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Ionicons name="navigate-outline" size={14} color={colors.text} />}
              style={styles.yallerBtn}
            >
              Y aller
            </Button>
          </View>
        )}

        {/* Équipe */}
        {creneau.equipe?.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.sectionTitle}>ÉQUIPE ({creneau.equipe.length})</Text>
            </View>
            {creneau.equipe.map((m) => {
              const isMe = m.user_id === fixtureUser.id
              return (
                <View key={m.user_id} style={styles.memberRow}>
                  <Avatar
                    nom={isMe ? fixtureUser.nom : m.user_id.replace('user_', '')}
                    id={m.user_id}
                    size={28}
                  />
                  <Text style={styles.memberName}>
                    {isMe ? fixtureUser.nom : m.user_id.replace('user_', '')}
                  </Text>
                  {isMe && (
                    <View style={styles.moiTag}>
                      <Text style={styles.moiTagText}>MOI</Text>
                    </View>
                  )}
                  <Text style={styles.memberRole}>{m.role}</Text>
                  {!isMe && (
                    <Pressable onPress={() => callTeam(m)} hitSlop={8}>
                      <Ionicons name="call-outline" size={16} color={colors.brand.blueLight} />
                    </Pressable>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {/* Brief */}
        {creneau.brief && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="document-text-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.sectionTitle}>BRIEF</Text>
            </View>
            <View style={styles.briefCard}>
              <Text style={styles.briefText}>{creneau.brief}</Text>
            </View>
          </View>
        )}

        {/* Sources */}
        {creneau.sources?.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="link-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.sectionTitle}>SOURCES</Text>
            </View>
            <View style={{ gap: spacing.sm }}>
              {creneau.sources.map((s, i) => (
                <Pressable
                  key={i}
                  onPress={() => Linking.openURL(s.url).catch(() => {})}
                  style={styles.sourceRow}
                >
                  <Ionicons name="open-outline" size={14} color={colors.brand.blueLight} />
                  <Text style={styles.sourceLabel}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Action bar : Marquer fait + dropdown */}
      <View style={styles.actionBar}>
        <View style={{ flex: 1 }}>
          <Button
            variant={statut === STATUT_CRENEAU.FAIT ? 'secondary' : 'success'}
            onPress={handleMarquerFait}
            leftIcon={
              <Ionicons
                name={statut === STATUT_CRENEAU.FAIT ? 'checkmark-circle' : 'checkmark-outline'}
                size={18}
                color="#fff"
              />
            }
          >
            {statut === STATUT_CRENEAU.FAIT ? 'Fait ✓' : 'Marquer fait'}
          </Button>
        </View>
        <Pressable
          onPress={() => setShowStatutDropdown((v) => !v)}
          style={styles.chevronBtn}
          hitSlop={8}
        >
          <Ionicons
            name={showStatutDropdown ? 'chevron-down' : 'chevron-up'}
            size={18}
            color={colors.text}
          />
        </Pressable>

        {/* Dropdown statuts */}
        {showStatutDropdown && (
          <View style={styles.dropdown}>
            {Object.values(STATUT_CRENEAU).map((s) => {
              const isActive = s === statut
              const color = STATUT_CRENEAU_COLOR[s]
              return (
                <Pressable
                  key={s}
                  onPress={() => {
                    setStatut(s)
                    setShowStatutDropdown(false)
                  }}
                  style={[styles.dropdownItem, isActive && styles.dropdownItemActive]}
                >
                  <Ionicons name="flag-outline" size={14} color={color} />
                  <Text style={[styles.dropdownText, { color: isActive ? color : colors.text }]}>
                    {STATUT_CRENEAU_LABEL[s]}
                  </Text>
                  {isActive && <Ionicons name="checkmark" size={14} color={color} />}
                </Pressable>
              )
            })}
          </View>
        )}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  headBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(244,114,182,0.15)',
    borderColor: 'rgba(244,114,182,0.35)',
    borderWidth: 0.5,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  headBadgeText: {
    fontSize: 9,
    color: '#FCA5A5',
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  statutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  statutBadgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  titre: {
    fontSize: 28,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.6,
    marginTop: spacing.lg,
  },
  horaireRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  horaire: {
    fontSize: 14,
    color: '#fff',
    fontWeight: fontWeight.medium,
  },
  horaireDuree: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderColor: 'rgba(245,158,11,0.35)',
    borderWidth: 0.5,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  warningTitle: {
    fontSize: 14,
    color: '#FBBF24',
    fontWeight: fontWeight.bold,
  },
  warningSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  lieuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  lieuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.glass.high,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lieuTitre: {
    fontSize: 14,
    color: '#fff',
    fontWeight: fontWeight.semibold,
  },
  lieuSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  yallerBtn: {
    backgroundColor: colors.brand.blue,
    borderColor: colors.brand.blueLight,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  section: {
    marginTop: spacing.xxl,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  memberName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: fontWeight.semibold,
  },
  moiTag: {
    backgroundColor: 'rgba(59,130,246,0.18)',
    borderColor: 'rgba(96,165,250,0.3)',
    borderWidth: 0.5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  moiTagText: {
    fontSize: 9,
    color: '#93C5FD',
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  memberRole: {
    marginLeft: 'auto',
    fontSize: 12,
    color: colors.textSecondary,
  },
  briefCard: {
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  briefText: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  sourceLabel: {
    fontSize: 13,
    color: colors.brand.blueLight,
  },
  actionBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chevronBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.glass.high,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdown: {
    position: 'absolute',
    bottom: 60,
    right: 0,
    width: 180,
    backgroundColor: 'rgba(20,20,22,0.95)',
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 4,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 10,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  dropdownText: {
    fontSize: 13,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
})
