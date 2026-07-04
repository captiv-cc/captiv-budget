// ════════════════════════════════════════════════════════════════════════════
// DevisListScreen — onglet Devis du mode CLASSIQUE
// ════════════════════════════════════════════════════════════════════════════
//
// Lots + versions du projet courant : statut, totaux figés à l'envoi,
// tracking client (« Vu N fois » / « Jamais ouvert »), partage du lien
// public, ouverture de l'éditeur natif (DevisEditorScreen).
// La création de lots/versions reste au desk pour cette v1.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, Animated, RefreshControl, Share, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'

import { ScreenHeader, Section, Badge, PressableScale, HEADER_BASE_HEIGHT } from '../components/shared'
import { useProjet } from '../lib/ProjetContext'
import { supabase } from '../lib/supabase'
import { fmtEur } from '@captiv/shared/lib/cotisations'
import { colors, spacing, fontWeight } from '../theme'

const PUBLIC_BASE = 'https://desk.captiv.cc' // domaine du desk (liens client)

const STATUS_META = {
  brouillon: { label: 'Brouillon', tone: 'neutral' },
  envoye: { label: 'Envoyé', tone: 'info' },
  accepte: { label: 'Accepté', tone: 'success' },
  refuse: { label: 'Refusé', tone: 'danger' },
}

export function useDevisLots(projetId) {
  const [lots, setLots] = useState([])
  const [devisByLot, setDevisByLot] = useState({})
  const [viewsByDevis, setViewsByDevis] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!projetId) return
    setLoading(true)
    try {
      const [{ data: lotsData }, { data: devisData }] = await Promise.all([
        supabase
          .from('devis_lots')
          .select('*')
          .eq('project_id', projetId)
          .order('sort_order', { ascending: true }),
        supabase.from('devis').select('*').eq('project_id', projetId),
      ])
      const byLot = {}
      for (const d of devisData || []) {
        const key = d.lot_id || '_sans_lot'
        if (!byLot[key]) byLot[key] = []
        byLot[key].push(d)
      }
      for (const key of Object.keys(byLot)) {
        byLot[key].sort((a, b) => (b.version_number || 0) - (a.version_number || 0))
      }
      setLots((lotsData || []).filter((l) => !l.archived))
      setDevisByLot(byLot)

      // Tracking : vues du lien client par devis envoyé/accepté
      const sentIds = (devisData || [])
        .filter((d) => d.sent_at || ['envoye', 'accepte'].includes(d.status))
        .map((d) => d.id)
      if (sentIds.length) {
        const { data: events } = await supabase
          .from('devis_public_events')
          .select('devis_id, created_at')
          .in('devis_id', sentIds)
          .eq('type', 'view')
        const map = {}
        for (const e of events || []) {
          map[e.devis_id] = (map[e.devis_id] || 0) + 1
        }
        setViewsByDevis(map)
      } else {
        setViewsByDevis({})
      }
    } catch (err) {
      console.warn('[useDevisLots]', err)
    } finally {
      setLoading(false)
    }
  }, [projetId])

  useEffect(() => {
    load()
  }, [load])

  return { lots, devisByLot, viewsByDevis, loading, reload: load }
}

export default function DevisListScreen() {
  const insets = useSafeAreaInsets()
  const nav = useNavigation()
  const { projet } = useProjet()
  const { lots, devisByLot, viewsByDevis, loading, reload } = useDevisLots(projet?.id)
  const scrollY = useRef(new Animated.Value(0)).current

  const openEditor = (dv) => {
    ;(nav.getParent() ?? nav).navigate('DevisEditor', { devisId: dv.id })
  }

  const shareLink = (dv) => {
    if (!dv.public_token) return
    Share.share({ message: `${PUBLIC_BASE}/devis/public/${dv.public_token}` }).catch(() => {})
  }

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : null

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
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
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.textMuted} />
        }
      >
        <View style={styles.body}>
          {!loading && lots.length === 0 && !devisByLot._sans_lot && (
            <Text style={styles.empty}>
              Aucun devis sur ce projet. Créez les lots et versions depuis le desk.
            </Text>
          )}

          {lots.map((lot) => {
            const versions = devisByLot[lot.id] || []
            return (
              <Section key={lot.id} label={lot.title || 'Lot'} grouped>
                {versions.length === 0 ? (
                  <Text style={styles.emptyLot}>Aucune version.</Text>
                ) : (
                  versions.map((dv) => {
                    const st = STATUS_META[dv.status] || STATUS_META.brouillon
                    const views = viewsByDevis[dv.id]
                    const isSent = dv.status === 'envoye' || dv.status === 'accepte'
                    return (
                      <PressableScale key={dv.id} haptic="selection" onPress={() => openEditor(dv)}>
                        <View style={styles.row}>
                          <View style={styles.versionBadge}>
                            <Text style={styles.versionText}>V{dv.version_number}</Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.title} numberOfLines={1}>
                              {dv.title || `Devis V${dv.version_number}`}
                            </Text>
                            <Text style={styles.sub} numberOfLines={1}>
                              {dv.sent_at ? `Envoyé le ${fmtDate(dv.sent_at)}` : `Créé le ${fmtDate(dv.created_at)}`}
                              {isSent &&
                                (views
                                  ? ` · Vu ${views} fois`
                                  : ' · Jamais ouvert')}
                            </Text>
                          </View>
                          <View style={styles.right}>
                            {dv.sent_total_ht != null && (
                              <Text style={styles.total}>{fmtEur(dv.sent_total_ht)}</Text>
                            )}
                            <Badge tone={st.tone} variant="soft" size="sm">
                              {st.label}
                            </Badge>
                          </View>
                          {isSent && dv.public_token && (
                            <PressableScale haptic="light" onPress={() => shareLink(dv)}>
                              <View style={styles.shareBtn}>
                                <Ionicons
                                  name="share-outline"
                                  size={16}
                                  color={colors.textSecondary}
                                />
                              </View>
                            </PressableScale>
                          )}
                        </View>
                      </PressableScale>
                    )
                  })
                )}
              </Section>
            )
          })}

          {/* Devis hérités sans lot (data legacy) */}
          {devisByLot._sans_lot?.length > 0 && (
            <Section label="Sans lot" grouped>
              {devisByLot._sans_lot.map((dv) => (
                <PressableScale key={dv.id} haptic="selection" onPress={() => openEditor(dv)}>
                  <View style={styles.row}>
                    <View style={styles.versionBadge}>
                      <Text style={styles.versionText}>V{dv.version_number}</Text>
                    </View>
                    <Text style={styles.title} numberOfLines={1}>
                      {dv.title || `Devis V${dv.version_number}`}
                    </Text>
                  </View>
                </PressableScale>
              ))}
            </Section>
          )}
        </View>
      </Animated.ScrollView>

      <ScreenHeader
        title="Devis"
        subtitle={projet?.title}
        leftMode="menu"
        scrollY={scrollY}
        overlay
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    gap: spacing.lg,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  emptyLot: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  versionBadge: {
    backgroundColor: colors.brand.blueBg,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  versionText: {
    color: colors.brand.blueLight,
    fontSize: 11,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  title: {
    fontSize: 14,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  sub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    gap: 3,
  },
  total: {
    fontSize: 13,
    color: colors.text,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  shareBtn: {
    padding: 6,
  },
})
