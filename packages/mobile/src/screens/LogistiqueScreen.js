// ════════════════════════════════════════════════════════════════════════════
// LogistiqueScreen — Logistique & VHR du projet (lecture seule pour l'instant)
// ════════════════════════════════════════════════════════════════════════════
//
// - Général : visible par tous
// - Mes infos : les infos VHR du membre courant
// - Toute l'équipe : visible seulement par les internes (admin/charge_prod/coord)
//
// ════════════════════════════════════════════════════════════════════════════

import { useRef } from 'react'
import { View, Text, Animated, StyleSheet, RefreshControl, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import * as WebBrowser from 'expo-web-browser'
import { Ionicons } from '@expo/vector-icons'

import { ScreenHeader, Section, Card, PressableScale, HEADER_BASE_HEIGHT } from '../components/shared'
import { RowSkeletonList } from '../components/Skeleton'
import { colors, spacing, radius, type } from '../theme'
import { supabase } from '../lib/supabase'
import { useProjet } from '../lib/ProjetContext'
import { useProjetLogistique } from '../hooks/useProjetLogistique'
import { usePermissions } from '../hooks/usePermissions'

const BUCKET = 'projet-logistique-v0-docs'

async function openDoc(path) {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) throw error
    // Preview in-app (Safari View Controller) avec bouton Partager/Télécharger
    await WebBrowser.openBrowserAsync(data.signedUrl, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      controlsColor: '#3B82F6',
      dismissButtonStyle: 'close',
    })
  } catch {
    Alert.alert('Document indisponible', "Impossible d'ouvrir ce document.")
  }
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} Mo`
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`
}

function docIcon(name = '', mime = '') {
  const n = name.toLowerCase()
  if (mime?.startsWith('image/') || /\.(png|jpe?g|heic|webp)$/.test(n)) return 'image-outline'
  if (/\.pdf$/.test(n) || mime === 'application/pdf') return 'document-text-outline'
  return 'document-outline'
}

const VHR = [
  { key: 'transport', icon: 'train-outline', label: 'Transport', color: '#60A5FA' },
  { key: 'hebergement', icon: 'bed-outline', label: 'Hébergement', color: '#A78BFA' },
  { key: 'repas', icon: 'restaurant-outline', label: 'Repas', color: '#FBBF24' },
]

// Resserre les blancs du texte libre saisi côté web
function cleanText(t) {
  return String(t ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function LogistiqueScreen() {
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current
  const { projet } = useProjet()
  const { canViewAll, canEdit } = usePermissions()
  const { general, generalDocs, myEntry, otherEntries, entries, loading, refetch } = useProjetLogistique(projet?.id)

  const editable = canEdit('logistique_v0')

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
        {/* Indicateur lecture seule */}
        {!editable && (
          <View style={styles.viewOnly}>
            <Ionicons name="eye-outline" size={13} color={colors.textMuted} />
            <Text style={styles.viewOnlyText}>Lecture seule</Text>
          </View>
        )}

        {loading && entries.length === 0 && !general ? (
          <RowSkeletonList count={5} />
        ) : (
          <>
            {/* Général */}
            {(!!general || generalDocs.length > 0) && (
              <Section label="Général">
                {!!general && <Text style={styles.textBlock}>{cleanText(general)}</Text>}
                <DocList docs={generalDocs} />
              </Section>
            )}

            {/* Mes infos */}
            <Section label="Mes infos VHR">
              {myEntry ? (
                <EntryBlocks entry={myEntry} />
              ) : (
                <Text style={styles.muted}>Aucune info logistique te concernant pour l’instant.</Text>
              )}
            </Section>

            {/* Toute l'équipe (internes uniquement) */}
            {canViewAll && otherEntries.length > 0 && (
              <Section label={`Toute l’équipe · ${otherEntries.length}`}>
                {otherEntries.map((e) => (
                  <Card key={e.id} variant="flat" padding="md" style={{ gap: spacing.md }}>
                    <View style={styles.entryHead}>
                      <Text style={styles.entryName} numberOfLines={1}>{e.nom}</Text>
                      {!!e.poste && <Text style={styles.entryPoste} numberOfLines={1}>{e.poste}</Text>}
                    </View>
                    <EntryBlocks entry={e} compact />
                  </Card>
                ))}
              </Section>
            )}

            {!general && !myEntry && !(canViewAll && otherEntries.length) && (
              <Text style={styles.muted}>Aucune information logistique sur ce projet.</Text>
            )}
          </>
        )}
      </Animated.ScrollView>

      <ScreenHeader
        title="Logistique & VHR"
        subtitle={projet?.title}
        leftMode="menu"
        scrollY={scrollY}
        overlay
      />
    </View>
  )
}

function EntryBlocks({ entry, compact }) {
  const present = VHR.filter((v) => entry[v.key] || entry.docs?.[v.key]?.length)
  if (present.length === 0) {
    return <Text style={styles.muted}>—</Text>
  }
  return (
    <View style={{ gap: compact ? spacing.sm : spacing.md }}>
      {present.map((v) => (
        <View key={v.key} style={styles.vhrRow}>
          <View style={[styles.vhrIcon, { backgroundColor: `${v.color}22` }]}>
            <Ionicons name={v.icon} size={15} color={v.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.vhrLabel}>{v.label}</Text>
            {!!entry[v.key] && <Text style={styles.vhrText}>{cleanText(entry[v.key])}</Text>}
            <DocList docs={entry.docs?.[v.key]} />
          </View>
        </View>
      ))}
    </View>
  )
}

function DocList({ docs }) {
  if (!docs?.length) return null
  return (
    <View style={styles.docList}>
      {docs.map((d, i) => (
        <PressableScale key={i} haptic="light" onPress={() => openDoc(d.path)} style={styles.docChip}>
          <Ionicons name={docIcon(d.name, d.mime)} size={15} color={colors.brand.blueLight} />
          <Text style={styles.docName} numberOfLines={1}>{d.name}</Text>
          {!!d.size && <Text style={styles.docSize}>{fmtSize(d.size)}</Text>}
          <Ionicons name="open-outline" size={14} color={colors.textMuted} />
        </PressableScale>
      ))}
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
  textBlock: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  muted: { ...type.subhead, color: colors.textMuted, paddingVertical: spacing.sm },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entryName: { ...type.subhead, color: '#fff', fontWeight: '700', flexShrink: 1 },
  entryPoste: { ...type.caption, color: colors.textMuted },
  vhrRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  vhrIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  vhrLabel: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  vhrText: { ...type.subhead, color: '#fff', marginTop: 1 },
  docList: { gap: spacing.xs, marginTop: spacing.sm },
  docChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: colors.brand.blueBg,
    borderWidth: 0.5,
    borderColor: colors.brand.blueBorder,
  },
  docName: { ...type.caption, color: '#fff', fontWeight: '600', flex: 1 },
  docSize: { ...type.caption, color: colors.textMuted },
})
