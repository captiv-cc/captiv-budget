// ════════════════════════════════════════════════════════════════════════════
// InfosProjetScreen — fiche du projet courant (consultation)
// ════════════════════════════════════════════════════════════════════════════

import { useRef } from 'react'
import { View, Text, Image, Animated, StyleSheet, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'

import { ScreenHeader, Section, Badge, PressableScale } from '../components/shared'
import { RowSkeletonList } from '../components/Skeleton'
import { colors, spacing, radius, type, gradients } from '../theme'
import { useProjet } from '../lib/ProjetContext'
import { useProjetInfos } from '../hooks/useProjetInfos'

const STATUT_PROJET = {
  prospect: { tone: 'warning', label: 'Prospect' },
  en_cours: { tone: 'info', label: 'En cours' },
  termine: { tone: 'success', label: 'Terminé' },
  annule: { tone: 'neutral', label: 'Annulé' },
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
function fmtDate(d) {
  if (!d) return null
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  if (!y) return null
  return `${day} ${MOIS[m - 1]} ${y}`
}
function fmtRange(a, b) {
  const da = fmtDate(a)
  const db = fmtDate(b)
  if (da && db) return da === db ? da : `${da} → ${db}`
  return da || db || '—'
}

export default function InfosProjetScreen() {
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current
  const { projet } = useProjet()
  const { infos, loading } = useProjetInfos(projet?.id)

  const p = infos ?? projet
  const heroH = insets.top + 190
  const statut = STATUT_PROJET[p?.status] ?? null

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        {/* Hero cover */}
        <View style={[styles.hero, { height: heroH, paddingTop: insets.top + 44 }]}>
          {p?.cover_url ? (
            <Image source={{ uri: p.cover_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <LinearGradient colors={gradients.hero} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient colors={['transparent', 'rgba(10,10,11,0.55)', '#0A0A0B']} style={StyleSheet.absoluteFill} />

          <View style={styles.heroContent}>
            <View style={styles.heroBadges}>
              {!!statut && <Badge tone={statut.tone} variant="soft" size="md">{statut.label}</Badge>}
              {!!p?.ref_projet && <Text style={styles.ref}>{p.ref_projet}</Text>}
            </View>
            <Text style={styles.title} numberOfLines={2}>{p?.title ?? 'Projet'}</Text>
            {!!(infos?.realisateur || infos?.agence) && (
              <Text style={styles.subline} numberOfLines={1}>
                {[infos?.realisateur, infos?.agence].filter(Boolean).join('  ·  ')}
              </Text>
            )}
            {infos?.types_projet?.length > 0 && (
              <View style={styles.typesRow}>
                {infos.types_projet.map((t) => (
                  <View key={t} style={styles.typePill}><Text style={styles.typePillText}>{t}</Text></View>
                ))}
              </View>
            )}
          </View>
        </View>

        <View style={styles.body}>
          {loading && !infos ? (
            <RowSkeletonList count={5} />
          ) : (
            <>
              <Section label="Détails" grouped>
                <InfoRow icon="calendar-outline" label="Dates" value={fmtRange(p?.date_debut, p?.date_fin)} />
                {!!p?.lieu_text && (
                  <InfoRow
                    icon="location-outline"
                    label="Lieu"
                    value={p.lieu_text}
                    onPress={() => Linking.openURL(`http://maps.apple.com/?q=${encodeURIComponent(p.lieu_text)}`).catch(() => {})}
                  />
                )}
                {!!infos?.client?.nom && <InfoRow icon="business-outline" label="Client" value={infos.client.nom} />}
                {!!infos?.production && <InfoRow icon="film-outline" label="Production" value={infos.production} />}
              </Section>

              {!!infos?.description && (
                <Section label="Description">
                  <Text style={styles.textBlock}>{infos.description}</Text>
                </Section>
              )}

              {!!infos?.note_prod && (
                <Section label="Note de prod">
                  <Text style={styles.textBlock}>{infos.note_prod}</Text>
                </Section>
              )}

              {!!infos?.drive_url && (
                <Section label="Liens" grouped>
                  <InfoRow
                    icon="folder-open-outline"
                    label="Drive du projet"
                    value="Ouvrir"
                    valueColor={colors.brand.blueLight}
                    onPress={() => Linking.openURL(infos.drive_url).catch(() => {})}
                  />
                </Section>
              )}
            </>
          )}
        </View>
      </Animated.ScrollView>

      <ScreenHeader title="Infos projet" subtitle={p?.title} leftMode="menu" scrollY={scrollY} overlay />
    </View>
  )
}

function InfoRow({ icon, label, value, valueColor = '#fff', onPress }) {
  const content = (
    <View style={styles.row}>
      <Ionicons name={icon} size={17} color={colors.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]} numberOfLines={2}>{value}</Text>
      {onPress && <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />}
    </View>
  )
  return onPress ? (
    <PressableScale haptic="selection" onPress={onPress}>{content}</PressableScale>
  ) : (
    content
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hero: { justifyContent: 'flex-end' },
  heroContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  heroBadges: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ref: { ...type.caption, color: colors.textSecondary, fontWeight: '700', letterSpacing: 0.5 },
  title: { ...type.largeTitle, color: '#fff' },
  subline: { ...type.subhead, color: colors.textSecondary },
  typesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  typePill: {
    backgroundColor: colors.brand.blueBg,
    borderColor: colors.brand.blueBorder,
    borderWidth: 0.5,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  typePillText: { ...type.caption, color: colors.brand.blueLight, fontWeight: '600' },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowLabel: { ...type.subhead, color: colors.textSecondary },
  rowValue: { ...type.subhead, color: '#fff', fontWeight: '600', flex: 1, textAlign: 'right' },
  textBlock: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
})
