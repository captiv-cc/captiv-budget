// ════════════════════════════════════════════════════════════════════════════
// ProfilScreen — hero gradient + stats animées + réglages (refonte UI 2026)
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { View, Text, Animated, Pressable, StyleSheet, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'

import { Avatar, BottomSheet, Button, IconButton, Toggle } from '../components/atoms'
import { ScreenHeader, Section, Card, Badge, PressableScale, HEADER_BASE_HEIGHT } from '../components/shared'
import { useHeaderLeftMode } from '../hooks/useHeaderLeftMode'
import { useAuth } from '../lib/AuthContext'
import {
  DELAI_RAPPEL_MINUTES,
  DELAI_RAPPEL_LABEL,
  DELAI_RAPPEL_DEFAUT,
} from '@captiv/shared'
import { colors, spacing, radius, type, statusTint, gradients } from '../theme'
import { useUserSettings } from '../hooks/useUserSettings'
import { useProfile } from '../hooks/useProfile'
import { sendTestPush } from '../lib/push'

export default function ProfilScreen() {
  const leftMode = useHeaderLeftMode()
  const insets = useSafeAreaInsets()
  const { signOut, user } = useAuth()
  const { profile } = useProfile()
  const { settings, update } = useUserSettings()
  const [testing, setTesting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const scrollY = useRef(new Animated.Value(0)).current
  const heroIn = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(heroIn, { toValue: 1, duration: 420, useNativeDriver: true }).start()
  }, [heroIn])

  const pushOn = settings.push_enabled
  const setPushOn = (val) => update({ push_enabled: val })
  const rappelMin = settings.rappel_delai_min ?? DELAI_RAPPEL_DEFAUT
  const setRappelMin = (val) => update({ rappel_delai_min: val })

  const handleTestPush = async () => {
    if (testing) return
    setTesting(true)
    try {
      const res = await sendTestPush(user?.id)
      Alert.alert(
        'Notification envoyée',
        res?.sent > 0
          ? 'Tu devrais la recevoir dans quelques secondes.'
          : "Aucun appareil enregistré. Vérifie que tu as autorisé les notifications (et que tu es sur un vrai téléphone).",
      )
    } catch (e) {
      Alert.alert('Échec', e?.message ?? "Impossible d'envoyer la notification test.")
    } finally {
      setTesting(false)
    }
  }

  const handleSignOut = () => {
    Alert.alert('Déconnexion', 'Veux-tu vraiment te déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => signOut().catch(() => {}) },
    ])
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Dégradé hero plein-largeur */}
      <LinearGradient colors={gradients.hero} style={styles.heroGradient} pointerEvents="none" />

      <Animated.ScrollView
        contentContainerStyle={{ paddingTop: insets.top + HEADER_BASE_HEIGHT, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        {/* Identité */}
        <Animated.View
          style={[
            styles.identite,
            { opacity: heroIn, transform: [{ translateY: heroIn.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
          ]}
        >
          <Avatar nom={profile?.displayName ?? '?'} id={profile?.id} size={84} />
          <Text style={styles.nom}>{profile?.displayName ?? 'Mon profil'}</Text>
          <Badge tone="info" variant="soft" size="md" icon="videocam">
            {profile?.role ?? 'cadreur'}
          </Badge>
        </Animated.View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard value={12} label="Créneaux" />
          <StatCard value={5} label="Livrables" />
          <StatCard value={9} suffix="h" label="Capté" color={statusTint.success.fg} />
        </View>

        {/* Réglages */}
        <View style={styles.body}>
          <Section label="Notifications" grouped>
            <Row icon="notifications-outline" label="Push notifications" right={<Toggle value={pushOn} onChange={setPushOn} />} />
            <Row
              icon="calendar-outline"
              label="Rappels créneaux"
              rightLabel={DELAI_RAPPEL_LABEL[rappelMin] ?? `${rappelMin} min avant`}
              chevron
              highlight
              onPress={() => setPickerOpen(true)}
            />
            <Row
              icon="paper-plane-outline"
              label={testing ? 'Envoi…' : 'Envoyer une notification test'}
              onPress={handleTestPush}
            />
          </Section>

          <Section label="Compte" grouped>
            <Row icon="mail-outline" label={profile?.email ?? user?.email ?? '—'} />
            <Row icon="lock-closed-outline" label="Changer mot de passe" chevron />
          </Section>

          <Section grouped>
            <Row icon="megaphone-outline" iconColor={statusTint.warning.fg} label="Signaler un bug / une idée" chevron />
            <Row icon="log-out-outline" iconColor={statusTint.danger.fg} labelColor={statusTint.danger.fg} label="Se déconnecter" onPress={handleSignOut} />
          </Section>

          <Text style={styles.versionFooter}>DESK Cadreur · v1.0.0 · build 23</Text>
        </View>
      </Animated.ScrollView>

      {/* Header overlay (blur au scroll) */}
      <ScreenHeader
        title="Profil"
        leftMode={leftMode}
        right={<IconButton icon="pencil" iconSize={13} />}
        scrollY={scrollY}
        overlay
      />

      {/* Picker rappels */}
      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} heightPercent={62}>
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Rappel avant un créneau</Text>
          <Text style={styles.pickerSub}>Reçois une notif push avant chaque créneau</Text>
        </View>
        <View style={styles.pickerList}>
          {DELAI_RAPPEL_MINUTES.map((m) => {
            const isActive = m === rappelMin
            return (
              <PressableScale
                key={m}
                haptic="selection"
                onPress={() => setRappelMin(m)}
                style={[styles.pickerRow, isActive && styles.pickerRowActive]}
              >
                <Text style={[styles.pickerRowLabel, isActive && { fontWeight: '600' }]}>
                  {DELAI_RAPPEL_LABEL[m]}
                </Text>
                {m === DELAI_RAPPEL_DEFAUT && <Badge tone="info">Défaut</Badge>}
                <View style={{ flex: 1 }} />
                <View style={[styles.radio, isActive && styles.radioActive]}>
                  {isActive && <Ionicons name="checkmark" size={11} color="#fff" />}
                </View>
              </PressableScale>
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

// ─── Sub-components ─────────────────────────────────────────────────────────
function StatCard({ value, suffix = '', label, color = '#fff' }) {
  const [display, setDisplay] = useState(0)
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const id = v.addListener(({ value: x }) => setDisplay(Math.round(x)))
    Animated.timing(v, { toValue: value, duration: 800, useNativeDriver: false }).start()
    return () => v.removeListener(id)
  }, [value, v])
  return (
    <Card variant="elevated" padding="sm" style={styles.statCard}>
      <Text style={[styles.statValeur, { color }]}>
        {display}
        {suffix}
      </Text>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
    </Card>
  )
}

function Row({ icon, iconColor = colors.textSecondary, label, labelColor = '#fff', right, rightLabel, chevron, highlight, onPress }) {
  const content = (
    <View style={[styles.row, highlight && styles.rowHighlight]}>
      <Ionicons name={icon} size={17} color={iconColor} />
      <Text style={[styles.rowLabel, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
      {right ?? (
        <>
          {rightLabel && <Text style={styles.rowRight}>{rightLabel}</Text>}
          {chevron && <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />}
        </>
      )}
    </View>
  )
  if (onPress) {
    return (
      <PressableScale haptic="selection" onPress={onPress}>
        {content}
      </PressableScale>
    )
  }
  return content
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  heroGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 320,
  },
  identite: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  nom: {
    ...type.title,
    color: '#fff',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.base,
    marginBottom: spacing.lg,
  },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  statValeur: { ...type.title, fontWeight: '700' },
  statLabel: {
    ...type.overline,
    color: colors.textSecondary,
    marginTop: 2,
  },
  body: { paddingHorizontal: spacing.lg, gap: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowHighlight: { backgroundColor: colors.brand.blueBgSubtle },
  rowLabel: { flex: 1, ...type.subhead, fontWeight: '500' },
  rowRight: { ...type.footnote, color: colors.brand.blueLight, fontWeight: '600' },
  versionFooter: {
    textAlign: 'center',
    ...type.caption,
    color: colors.textDim,
    paddingVertical: spacing.md,
  },
  // Picker
  pickerHeader: { alignItems: 'center', paddingTop: 4, paddingBottom: spacing.lg },
  pickerTitle: { ...type.bodyStrong, color: '#fff' },
  pickerSub: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  pickerList: { gap: spacing.sm, marginBottom: spacing.lg },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.glass.subtle,
    borderColor: colors.glass.borderSubtle,
    borderWidth: 0.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pickerRowActive: {
    backgroundColor: colors.brand.blueBg,
    borderColor: colors.brand.blueBorder,
  },
  pickerRowLabel: { ...type.subhead, color: '#fff' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.brand.blueLight, backgroundColor: colors.brand.blue },
})
