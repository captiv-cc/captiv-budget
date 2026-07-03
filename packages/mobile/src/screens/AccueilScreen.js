// ════════════════════════════════════════════════════════════════════════════
// AccueilScreen — foyer du mode CLASSIQUE (gestion)
// ════════════════════════════════════════════════════════════════════════════
//
// Hub du desk en poche : projet courant (changer via burger), accès à tous les
// outils du projet, bascule vers le mode tournage. Les outils "onglets" du
// mode classique (Devis, Planning) naviguent en tab ; les autres sont des
// pages poussées du MainStack (dont LivrablesPage / CartePage enregistrées
// pour le mode classique).
// ════════════════════════════════════════════════════════════════════════════

import { useRef, useState } from 'react'
import { View, Text, Animated, ScrollView, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'

import {
  ScreenHeader,
  Section,
  Card,
  Badge,
  PressableScale,
  HEADER_BASE_HEIGHT,
} from '../components/shared'
import { BottomSheet } from '../components/atoms'
import { useProjet } from '../lib/ProjetContext'
import { useProfile } from '../hooks/useProfile'
import { colors, spacing, radius, fontWeight, gradients } from '../theme'

const OUTILS_COMMERCIAL = [
  { label: 'Devis', icon: 'document-text-outline', tab: 'Devis' },
]

const OUTILS_PRODUCTION = [
  { label: 'Planning', icon: 'calendar-outline', tab: 'Planning' },
  { label: 'Livrables', icon: 'checkbox-outline', tab: 'Livrables' },
  { label: 'Équipe & contacts', icon: 'people-outline', screen: 'Equipe' },
  { label: 'Matériel', icon: 'cube-outline', screen: 'Materiel' },
  { label: 'Logistique & VHR', icon: 'bed-outline', screen: 'Logistique' },
  { label: 'Plan / Carte', icon: 'map-outline', screen: 'CartePage' },
  { label: 'Infos projet', icon: 'information-circle-outline', screen: 'InfosProjet' },
]

export default function AccueilScreen() {
  const insets = useSafeAreaInsets()
  const nav = useNavigation()
  const { projet, projets, setProjetId } = useProjet()
  const { profile } = useProfile()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const scrollY = useRef(new Animated.Value(0)).current

  const prenom = profile?.prenom || profile?.displayName?.split(' ')[0] || ''

  const go = (item) => {
    if (item.tab) {
      nav.navigate(item.tab)
    } else {
      // Pages du MainStack : naviguer depuis le parent (le tab navigator ne
      // les connaît pas).
      const parent = nav.getParent()
      ;(parent ?? nav).navigate(item.screen)
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient colors={gradients.hero} style={styles.heroGradient} pointerEvents="none" />

      <Animated.ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + HEADER_BASE_HEIGHT,
          paddingBottom: insets.bottom + 100,
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        {/* Salutation */}
        <View style={styles.hello}>
          <Text style={styles.helloText}>
            {prenom ? `Bonjour, ${prenom} 👋` : 'Bonjour 👋'}
          </Text>
        </View>

        <View style={styles.body}>
          {/* Projet courant : tap = changer de projet */}
          <Section label="Projet courant">
            <Card variant="glass" onPress={() => setSwitcherOpen(true)}>
              <View style={styles.projetRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projetTitle} numberOfLines={1}>
                    {projet?.title ?? 'Aucun projet'}
                  </Text>
                  {!!projet?.lieu_text && (
                    <Text style={styles.projetSub} numberOfLines={1}>
                      {projet.lieu_text}
                    </Text>
                  )}
                </View>
                {!!projet?.status && (
                  <Badge tone="info" variant="soft" size="sm">
                    {projet.status}
                  </Badge>
                )}
                <View style={styles.changerTag}>
                  <Text style={styles.changerText}>Changer</Text>
                  <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
                </View>
              </View>
            </Card>
          </Section>

          {/* Outils */}
          <Section label="Commercial" grouped>
            {OUTILS_COMMERCIAL.map((o) => (
              <ToolRow key={o.label} item={o} onPress={() => go(o)} />
            ))}
          </Section>

          <Section label="Production" grouped>
            {OUTILS_PRODUCTION.map((o) => (
              <ToolRow key={o.label} item={o} onPress={() => go(o)} />
            ))}
          </Section>

        </View>
      </Animated.ScrollView>

      <ScreenHeader title="Accueil" leftMode="menu" scrollY={scrollY} overlay />

      {/* ── Sélecteur de projet ─────────────────────────────────────────────── */}
      <BottomSheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} heightPercent={62}>
        <Text style={styles.switcherTitle}>Changer de projet</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          {projets.map((p) => {
            const active = p.id === projet?.id
            return (
              <PressableScale
                key={p.id}
                haptic="selection"
                onPress={() => {
                  setProjetId(p.id)
                  setSwitcherOpen(false)
                }}
              >
                <View style={[styles.switcherRow, active && styles.switcherRowActive]}>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={active ? colors.brand.blueLight : colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.projetTitle} numberOfLines={1}>
                      {p.title}
                    </Text>
                    {!!p.lieu_text && (
                      <Text style={styles.projetSub} numberOfLines={1}>
                        {p.lieu_text}
                      </Text>
                    )}
                  </View>
                  {!!p.status && (
                    <Badge tone="neutral" variant="soft" size="sm">
                      {p.status}
                    </Badge>
                  )}
                </View>
              </PressableScale>
            )
          })}
          {projets.length === 0 && <Text style={styles.projetSub}>Aucun projet.</Text>}
        </ScrollView>
      </BottomSheet>
    </View>
  )
}

function ToolRow({ item, onPress }) {
  return (
    <PressableScale haptic="selection" onPress={onPress}>
      <View style={styles.row}>
        <Ionicons name={item.icon} size={17} color={colors.textSecondary} />
        <Text style={styles.rowLabel} numberOfLines={1}>
          {item.label}
        </Text>
        <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
      </View>
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  heroGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 260,
  },
  hello: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.md,
  },
  helloText: {
    fontSize: 26,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
  },
  body: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  projetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  projetTitle: {
    fontSize: 16,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  projetSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  changerTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  changerText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  switcherTitle: {
    fontSize: 20,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.4,
    marginBottom: spacing.md,
  },
  switcherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  switcherRowActive: {
    backgroundColor: colors.glass.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
})
