// ════════════════════════════════════════════════════════════════════════════
// CarteScreen — carte interactive du site (WebView MapLibre, lecture seule)
// ════════════════════════════════════════════════════════════════════════════
//
// Onglet "Plan". Affiche le plan calé + POIs sur satellite. Ouvrable aussi
// depuis un créneau via "Y aller" (route.params.focus*).
// Contrôles : opacité/toggle plan (in-WebView), Recentrer (natif), carte
// d'info au tap d'un repère (natif) avec Itinéraire.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ActivityIndicator, Pressable, StyleSheet, Linking, Platform } from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { ScreenHeader, HEADER_BASE_HEIGHT } from '../components/shared'
import { colors, spacing, radius, type } from '../theme'
import { useProjet } from '../lib/ProjetContext'
import { fetchLieuData } from '../lib/lieu'
import { buildMapHtml } from '../lib/lieuHtml'

function openMaps(lat, lng, label) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  const q = encodeURIComponent(label || 'Destination')
  const url = Platform.select({
    ios: `http://maps.apple.com/?daddr=${lat},${lng}&q=${q}`,
    android: `geo:${lat},${lng}?q=${lat},${lng}(${q})`,
    default: `https://maps.google.com/?q=${lat},${lng}`,
  })
  Linking.openURL(url).catch(() => {})
}

export default function CarteScreen({ route }) {
  const insets = useSafeAreaInsets()
  const { projet } = useProjet()
  const webRef = useRef(null)

  const focusLng = route?.params?.focusLng ?? null
  const focusLat = route?.params?.focusLat ?? null
  const focusLabel = route?.params?.focusLabel ?? null
  const headerTitle = route?.params?.title ?? 'Carte du site'

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedPoi, setSelectedPoi] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchLieuData(projet?.id)
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [projet?.id])

  // Reset la carte d'info quand on change de focus (nouveau "Y aller").
  useEffect(() => { setSelectedPoi(null) }, [focusLng, focusLat])

  const html = useMemo(() => {
    if (!data?.map) return null
    const focus = Number.isFinite(focusLng) && Number.isFinite(focusLat)
      ? { lng: focusLng, lat: focusLat, label: focusLabel }
      : null
    const center = focus
      ? { lng: focus.lng, lat: focus.lat }
      : (data.map.center_lng != null
          ? { lng: data.map.center_lng, lat: data.map.center_lat }
          : { lng: 2.35, lat: 48.85 })
    return buildMapHtml({ center, zoom: data.map.zoom ?? 15, overlay: data.overlay, pois: data.pois, focus })
  }, [data, focusLng, focusLat, focusLabel])

  const onMessage = (e) => {
    try {
      const m = JSON.parse(e.nativeEvent.data)
      if (m.type === 'poi_tap') {
        setSelectedPoi({ label: m.label, notes: m.notes, lat: m.lat, lng: m.lng })
      }
    } catch { /* noop */ }
  }

  const recenter = () => {
    webRef.current?.injectJavaScript('window.__recenter && window.__recenter(); true;')
  }

  const topPad = insets.top + HEADER_BASE_HEIGHT
  const hasFocus = Number.isFinite(focusLat) && Number.isFinite(focusLng)

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={{ flex: 1, paddingTop: topPad }}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.textMuted} /></View>
        ) : !html ? (
          <View style={styles.center}>
            <Ionicons name="map-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Aucune carte pour ce projet</Text>
            <Text style={styles.emptySub}>La production n’a pas encore calé de plan sur la carte.</Text>
          </View>
        ) : (
          <>
            <WebView
              ref={webRef}
              originWhitelist={['*']}
              source={{ html }}
              style={styles.web}
              javaScriptEnabled
              domStorageEnabled
              allowFileAccess
              onMessage={onMessage}
              startInLoadingState
              renderLoading={() => (
                <View style={[styles.center, StyleSheet.absoluteFill]}><ActivityIndicator color={colors.textMuted} /></View>
              )}
              setSupportMultipleWindows={false}
            />

            {/* Recentrer (haut-droit, sous le zoom) */}
            <Pressable
              onPress={recenter}
              style={({ pressed }) => [styles.recenterBtn, { top: topPad + 132 }, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name={hasFocus ? 'navigate-circle-outline' : 'scan-outline'} size={22} color="#fff" />
            </Pressable>

            {/* Itinéraire focus (si "Y aller" et pas de carte ouverte) */}
            {hasFocus && !selectedPoi && (
              <Pressable
                onPress={() => openMaps(focusLat, focusLng, focusLabel)}
                style={({ pressed }) => [styles.itinBtn, { bottom: 16 }, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="navigate" size={16} color="#fff" />
                <Text style={styles.itinText}>Itinéraire</Text>
              </Pressable>
            )}

            {/* Carte d'info au tap d'un repère */}
            {selectedPoi && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{selectedPoi.label || 'Repère'}</Text>
                  <Pressable onPress={() => setSelectedPoi(null)} hitSlop={10}>
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
                {!!selectedPoi.notes && (
                  <Text style={styles.cardNotes} numberOfLines={3}>{selectedPoi.notes}</Text>
                )}
                <Pressable
                  onPress={() => openMaps(selectedPoi.lat, selectedPoi.lng, selectedPoi.label)}
                  style={({ pressed }) => [styles.cardItin, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="navigate" size={16} color="#fff" />
                  <Text style={styles.itinText}>Itinéraire</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </View>

      <ScreenHeader title={headerTitle} subtitle={projet?.title} leftMode="menu" overlay />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  web: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { ...type.subhead, color: colors.text, fontWeight: '700', marginTop: spacing.sm },
  emptySub: { ...type.footnote, color: colors.textMuted, textAlign: 'center' },
  recenterBtn: {
    position: 'absolute', right: 12, width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(18,20,26,0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  itinBtn: {
    position: 'absolute', right: 16, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: radius.pill,
    backgroundColor: colors.brand.blue,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  itinText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  card: {
    position: 'absolute', left: 12, right: 12, bottom: 12,
    backgroundColor: 'rgba(20,22,28,0.96)', borderRadius: radius.lg,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', padding: spacing.md, gap: spacing.sm,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...type.subhead, color: '#fff', fontWeight: '700', flex: 1 },
  cardNotes: { ...type.footnote, color: colors.textSecondary },
  cardItin: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.brand.blue,
  },
})
