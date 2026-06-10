// ════════════════════════════════════════════════════════════════════════════
// ProfilScreen — avatar + stats + settings + déconnexion
// ════════════════════════════════════════════════════════════════════════════
//
// Maquette : header simple, avatar central + nom + badge "Cadreur", 3 stats
// (Créneaux / Livrables / Captés), sections Notifications + Compte + Aide,
// avec picker rappels créneaux (bottom sheet) à 15 min par défaut.
//
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { Avatar, BottomSheet, Button, IconButton, Toggle } from '../components/atoms'
import { useAuth } from '../lib/AuthContext'
import {
  DELAI_RAPPEL_MINUTES,
  DELAI_RAPPEL_LABEL,
  DELAI_RAPPEL_DEFAUT,
} from '@captiv/shared'
import { colors, fontSize, fontWeight, spacing, radius } from '../theme'
import { fixtureUser } from '../fixtures'
import { useUserSettings } from '../hooks/useUserSettings'

export default function ProfilScreen() {
  const insets = useSafeAreaInsets()
  const { signOut } = useAuth()
  const { settings, update } = useUserSettings()
  const pushOn = settings.push_enabled
  const setPushOn = (val) => update({ push_enabled: val })
  const rappelMin = settings.rappel_delai_min ?? DELAI_RAPPEL_DEFAUT
  const setRappelMin = (val) => update({ rappel_delai_min: val })
  const [pickerOpen, setPickerOpen] = useState(false)

  const handleSignOut = () => {
    Alert.alert('Déconnexion', 'Veux-tu vraiment te déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se déconnecter',
        style: 'destructive',
        onPress: () => signOut().catch(() => {}),
      },
    ])
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <IconButton icon="menu-outline" />
        <Text style={styles.title}>Profil</Text>
        <IconButton icon="pencil" iconSize={13} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + identité */}
        <View style={styles.identite}>
          <Avatar nom={fixtureUser.nom} id={fixtureUser.id} size={64} />
          <Text style={styles.nom}>{fixtureUser.nom}</Text>
          <View style={styles.roleBadge}>
            <Ionicons name="videocam-outline" size={10} color={colors.textSecondary} />
            <Text style={styles.roleText}>{fixtureUser.role.toUpperCase()}</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard valeur="12" label="Créneaux" />
          <StatCard valeur="5" label="Livrables" />
          <StatCard valeur="9h" label="Capté" valeurColor={colors.status.successLight} />
        </View>

        {/* Section Notifications */}
        <Section title="Notifications">
          <RowItem
            icon="notifications-outline"
            label="Push notifications"
            right={<Toggle value={pushOn} onChange={setPushOn} />}
          />
          <RowItem
            icon="calendar-outline"
            label="Rappels créneaux"
            rightLabel={DELAI_RAPPEL_LABEL[rappelMin] ?? `${rappelMin} min avant`}
            chevron
            onPress={() => setPickerOpen(true)}
            highlight
          />
        </Section>

        {/* Section Compte */}
        <Section title="Compte">
          <RowItem icon="mail-outline" label={fixtureUser.email} />
          <RowItem icon="lock-closed-outline" label="Changer mot de passe" chevron />
        </Section>

        {/* Section Aide & Logout */}
        <Section>
          <RowItem icon="megaphone-outline" iconColor="#FBBF24" label="Signaler un bug / une idée" chevron />
          <RowItem
            icon="log-out-outline"
            iconColor="#F87171"
            label="Se déconnecter"
            labelColor="#F87171"
            onPress={handleSignOut}
          />
        </Section>

        <Text style={styles.versionFooter}>DESK Cadreur · v1.0.0 · build 23</Text>
      </ScrollView>

      {/* Bottom sheet picker rappels */}
      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        heightPercent={62}
      >
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Rappel avant un créneau</Text>
          <Text style={styles.pickerSub}>Recevez une notif push avant chaque créneau</Text>
        </View>
        <View style={styles.pickerList}>
          {DELAI_RAPPEL_MINUTES.map((m, i) => {
            const isActive = m === rappelMin
            const isFirst = i === 0
            const isLast = i === DELAI_RAPPEL_MINUTES.length - 1
            return (
              <Pressable
                key={m}
                onPress={() => setRappelMin(m)}
                style={[
                  styles.pickerRow,
                  isActive && styles.pickerRowActive,
                  isFirst && { borderTopLeftRadius: radius.base, borderTopRightRadius: radius.base },
                  isLast && { borderBottomLeftRadius: radius.base, borderBottomRightRadius: radius.base },
                ]}
              >
                <Text style={[styles.pickerRowLabel, isActive && styles.pickerRowLabelActive]}>
                  {DELAI_RAPPEL_LABEL[m]}
                  {m === DELAI_RAPPEL_DEFAUT && (
                    <Text style={styles.pickerDefault}>  Par défaut</Text>
                  )}
                </Text>
                <View style={[styles.radio, isActive && styles.radioActive]}>
                  {isActive && <Ionicons name="checkmark" size={11} color="#fff" />}
                </View>
              </Pressable>
            )
          })}
        </View>
        <Button variant="primary" size="md" onPress={() => setPickerOpen(false)}>
          Confirmer
        </Button>
      </BottomSheet>
    </View>
  )
}

// ─── Sub components ────────────────────────────────────────────────────────
function StatCard({ valeur, label, valeurColor = '#fff' }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValeur, { color: valeurColor }]}>{valeur}</Text>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
    </View>
  )
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      {title && <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>}
      <View style={styles.sectionBlock}>{children}</View>
    </View>
  )
}

function RowItem({
  icon,
  iconColor = colors.textSecondary,
  label,
  labelColor = '#fff',
  right,
  rightLabel,
  chevron,
  highlight,
  onPress,
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.rowItem, highlight && styles.rowItemHighlight]}
    >
      <Ionicons name={icon} size={13} color={iconColor} />
      <Text style={[styles.rowItemLabel, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
      {right ?? (
        <>
          {rightLabel && <Text style={styles.rowItemRight}>{rightLabel}</Text>}
          {chevron && <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />}
        </>
      )}
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
    paddingBottom: 4,
  },
  title: {
    fontSize: 16,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.3,
  },
  scroll: { flex: 1 },
  identite: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 10,
  },
  nom: {
    fontSize: 18,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 2,
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: 5,
  },
  roleText: {
    fontSize: 9,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.4,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 11,
    gap: 5,
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  statValeur: {
    fontSize: 18,
    fontWeight: fontWeight.bold,
  },
  statLabel: {
    fontSize: 8,
    color: colors.textSecondary,
    letterSpacing: 0.4,
    marginTop: 1,
  },
  section: {
    paddingHorizontal: 11,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 8,
    color: colors.textMuted,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
    paddingHorizontal: 11,
    paddingBottom: 4,
  },
  sectionBlock: {
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 11,
    paddingVertical: 11,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  rowItemHighlight: {
    backgroundColor: 'rgba(59,130,246,0.06)',
  },
  rowItemLabel: {
    flex: 1,
    fontSize: 11,
  },
  rowItemRight: {
    fontSize: 10,
    color: colors.brand.blueLight,
    marginRight: 3,
    fontWeight: fontWeight.medium,
  },
  versionFooter: {
    textAlign: 'center',
    fontSize: 8,
    color: colors.textDim,
    paddingVertical: 12,
  },
  // Picker
  pickerHeader: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 14,
  },
  pickerTitle: {
    fontSize: 14,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
  },
  pickerSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  pickerList: {
    gap: 0,
    marginBottom: spacing.lg,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.glass.subtle,
    borderColor: colors.glass.borderSubtle,
    borderWidth: 0.5,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginTop: -0.5, // overlap borders
  },
  pickerRowActive: {
    backgroundColor: 'rgba(59,130,246,0.1)',
    borderColor: 'rgba(96,165,250,0.4)',
  },
  pickerRowLabel: {
    fontSize: 13,
    color: '#fff',
  },
  pickerRowLabelActive: {
    fontWeight: fontWeight.semibold,
  },
  pickerDefault: {
    fontSize: 10,
    color: colors.brand.blueLight,
    fontWeight: fontWeight.medium,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: colors.brand.blueLight,
    backgroundColor: colors.brand.blue,
  },
})
