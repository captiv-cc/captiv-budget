// ════════════════════════════════════════════════════════════════════════════
// TimelineView — agenda journalier multi-lanes (style Google Calendar)
// ════════════════════════════════════════════════════════════════════════════
//
// - Axe horaire fixe à gauche (gutter)
// - Header de lanes figé en haut, synchronisé au scroll horizontal du corps
// - Colonnes = lanes (MOI en 1er, puis lieux/scènes, puis autres cadreurs)
// - Blocs créneaux positionnés en absolu selon heure_debut/fin (minutes)
// - Créneaux multi_lane → bandeau pleine largeur
// - Ligne "NOW" si on regarde aujourd'hui
//
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useRef, useEffect } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { colors, fontWeight, radius } from '../../theme'
import { aujourdhuiJour, combineDateAndMinutes } from '../../lib/dateMin'
import { effectiveCouleurCreneau } from '../../lib/derouleColors'
import { creneauVisual } from '../../lib/creneauVisual'
import { Skeleton } from '../Skeleton'

const HOUR_HEIGHT = 58
const PX_PER_MIN = HOUR_HEIGHT / 60
const GUTTER = 44
const LANE_WIDTH = 134
const HEADER_HEIGHT = 38

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(113,113,122,${alpha})`
  let h = hex.startsWith('#') ? hex.slice(1) : hex
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return `rgba(113,113,122,${alpha})`
  return `rgba(${r},${g},${b},${alpha})`
}

function fmtHour(min) {
  const h = Math.floor(min / 60) % 24
  return `${h}h`
}

// Répartit les créneaux d'une lane en sous-colonnes pour gérer les
// chevauchements (côte à côte, par cluster d'events qui se chevauchent).
// Renvoie [{ c, sub, subCount }].
function layoutLane(creneaux) {
  const sorted = [...creneaux].sort(
    (a, b) =>
      (a.heure_debut_min ?? 0) - (b.heure_debut_min ?? 0) ||
      (a.heure_fin_min ?? 0) - (b.heure_fin_min ?? 0),
  )
  const out = []
  let cluster = []
  let clusterEnd = -Infinity

  const flush = () => {
    if (!cluster.length) return
    const colEnd = [] // fin de la dernière event par sous-colonne
    for (const c of cluster) {
      const s = c.heure_debut_min
      const e = endMin(c)
      let col = colEnd.findIndex((end) => end <= s)
      if (col === -1) {
        col = colEnd.length
        colEnd.push(e)
      } else {
        colEnd[col] = e
      }
      c.__sub = col
    }
    const count = colEnd.length
    for (const c of cluster) out.push({ c, sub: c.__sub, subCount: count })
    cluster = []
    clusterEnd = -Infinity
  }

  for (const c of sorted) {
    if (c.heure_debut_min == null) continue
    const s = c.heure_debut_min
    const e = endMin(c)
    if (cluster.length && s >= clusterEnd) flush()
    cluster.push(c)
    clusterEnd = Math.max(clusterEnd, e)
  }
  flush()
  return out
}

// Fin du créneau en minutes, en gérant le débordement minuit (fin < début).
function endMin(c) {
  const s = c.heure_debut_min
  let e = c.heure_fin_min ?? s + 30
  if (e < s) e += 1440
  return e
}

function laneIcon(lane) {
  if (lane.isMine) return 'ellipse'
  if (lane.type === 'lieu') return 'location'
  if (lane.type === 'global') return 'albums-outline'
  if (lane.type === 'equipe') return 'people'
  return 'videocam'
}

export default function TimelineView({ lanes, creneaux, jour, onPressCreneau, refreshing, onRefresh, loading }) {
  const headerScrollRef = useRef(null)
  const vScrollRef = useRef(null)
  const scrolledJour = useRef(null)

  const { axisStart, axisEnd, hours } = useMemo(() => {
    const valid = (creneaux ?? []).filter((c) => c.heure_debut_min != null)
    if (valid.length === 0) return { axisStart: 600, axisEnd: 1440, hours: [] }
    let min = Math.min(...valid.map((c) => c.heure_debut_min))
    let max = Math.max(...valid.map((c) => endMin(c)))
    min = Math.floor(min / 60) * 60
    max = Math.ceil(max / 60) * 60
    const hrs = []
    for (let m = min; m <= max; m += 60) hrs.push(m)
    return { axisStart: min, axisEnd: max, hours: hrs }
  }, [creneaux])

  const totalHeight = (axisEnd - axisStart) * PX_PER_MIN
  const bodyWidth = Math.max(lanes.length * LANE_WIDTH, 1)

  // Créneaux par lane (mono-lane) + bandeaux (multi_lane / lane absente)
  const { byLane, bands } = useMemo(() => {
    const laneIds = new Set(lanes.map((l) => l.id))
    const map = {}
    const bandsArr = []
    for (const c of creneaux ?? []) {
      if (c.heure_debut_min == null) continue
      if (c.multi_lane || !laneIds.has(c.lane_id)) {
        bandsArr.push(c)
      } else {
        ;(map[c.lane_id] ??= []).push(c)
      }
    }
    return { byLane: map, bands: bandsArr }
  }, [creneaux, lanes])

  const nowMin = useMemo(() => {
    if (jour !== aujourdhuiJour()) return null
    const d = new Date()
    const m = d.getHours() * 60 + d.getMinutes()
    if (m < axisStart || m > axisEnd) return null
    return m
  }, [jour, axisStart, axisEnd])

  // Auto-scroll (une fois par jour) vers maintenant, sinon le 1er créneau.
  useEffect(() => {
    if (!hours.length || scrolledJour.current === jour) return
    scrolledJour.current = jour
    let targetMin = nowMin
    if (targetMin == null) {
      const starts = (creneaux ?? []).filter((c) => c.heure_debut_min != null).map((c) => c.heure_debut_min)
      targetMin = starts.length ? Math.min(...starts) : axisStart
    }
    const y = Math.max((targetMin - axisStart) * PX_PER_MIN - 60, 0)
    const id = setTimeout(() => vScrollRef.current?.scrollTo({ y, animated: false }), 250)
    return () => clearTimeout(id)
  }, [jour, hours.length, nowMin, axisStart, creneaux])

  if (!lanes.length) {
    if (loading) {
      return (
        <View style={styles.skeletonWrap}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} style={{ height: 56, borderRadius: 10 }} />
          ))}
        </View>
      )
    }
    return (
      <View style={styles.empty}>
        <Ionicons name="grid-outline" size={26} color={colors.textMuted} />
        <Text style={styles.emptyText}>Aucun créneau ce jour.</Text>
      </View>
    )
  }

  const topOf = (min) => (min - axisStart) * PX_PER_MIN
  const heightOf = (c) => {
    const dur = endMin(c) - c.heure_debut_min
    return Math.max(dur * PX_PER_MIN - 2, 22)
  }

  return (
    <View style={styles.container}>
      {/* Header lanes (figé) */}
      <View style={styles.headerRow}>
        <View style={{ width: GUTTER }} />
        <ScrollView
          ref={headerScrollRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          <View style={{ flexDirection: 'row', width: bodyWidth }}>
            {lanes.map((l) => (
              <View key={l.id} style={[styles.laneHead, { width: LANE_WIDTH }]}>
                <View style={styles.laneHeadInner}>
                  <Ionicons
                    name={laneIcon(l)}
                    size={10}
                    color={l.isMine ? colors.brand.blueLight : l.color}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.laneHeadText, l.isMine && { color: colors.brand.blueLight }]}
                  >
                    {l.isMine ? 'MOI' : l.libelle}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Corps scrollable vertical */}
      <ScrollView
        ref={vScrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 110 }}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />
          ) : undefined
        }
      >
        <View style={{ flexDirection: 'row', height: totalHeight }}>
          {/* Gutter heures */}
          <View style={{ width: GUTTER }}>
            {hours.map((m) => (
              <Text key={m} style={[styles.hourLabel, { top: topOf(m) - 6 }]}>
                {fmtHour(m)}
              </Text>
            ))}
          </View>

          {/* Corps lanes (scroll horizontal, sync header) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            style={{ flex: 1 }}
            onScroll={(e) => {
              headerScrollRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false })
            }}
          >
            <View style={{ width: bodyWidth, height: totalHeight }}>
              {/* Lignes horaires */}
              {hours.map((m) => (
                <View key={m} style={[styles.hourLine, { top: topOf(m) }]} />
              ))}

              {/* Colonnes lanes + leurs créneaux */}
              {lanes.map((l, i) => (
                <View
                  key={l.id}
                  style={[styles.laneCol, { left: i * LANE_WIDTH, width: LANE_WIDTH }]}
                >
                  {layoutLane(byLane[l.id] ?? []).map(({ c, sub, subCount }) => {
                    const col = effectiveCouleurCreneau(c)
                    const vis = creneauVisual({
                      statut: c.statut,
                      end: combineDateAndMinutes(jour, c.heure_fin_min),
                    })
                    const dim = vis.done || vis.cancelled || vis.past
                    const isNow = nowMin != null && c.heure_debut_min <= nowMin && nowMin < endMin(c)
                    const slotW = (LANE_WIDTH - 4) / subCount
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => onPressCreneau?.(c)}
                        style={[
                          styles.block,
                          {
                            top: topOf(c.heure_debut_min),
                            height: heightOf(c),
                            left: 2 + sub * slotW,
                            width: slotW - 2,
                            backgroundColor: hexToRgba(col, dim ? 0.07 : isNow ? 0.24 : 0.16),
                            borderColor: hexToRgba(col, dim ? 0.25 : 0.5),
                            borderLeftColor: col,
                            opacity: vis.opacity,
                          },
                          (vis.enCours || isNow) && { borderWidth: 1.5, borderColor: col },
                          isNow && { shadowColor: col, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
                        ]}
                      >
                        <View style={styles.blockTitleRow}>
                          {vis.done && (
                            <Ionicons name="checkmark-circle" size={11} color="#34D399" />
                          )}
                          <Text
                            numberOfLines={2}
                            style={[styles.blockTitle, vis.cancelled && styles.blockTitleCancelled]}
                          >
                            {c.titre}
                          </Text>
                        </View>
                        {heightOf(c) > 34 && (
                          <Text style={styles.blockTime}>{fmtHour(c.heure_debut_min)}</Text>
                        )}
                      </Pressable>
                    )
                  })}
                </View>
              ))}

              {/* Bandeaux multi_lane (pleine largeur) */}
              {bands.map((c) => {
                const col = effectiveCouleurCreneau(c)
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => onPressCreneau?.(c)}
                    style={[
                      styles.band,
                      {
                        top: topOf(c.heure_debut_min),
                        height: heightOf(c),
                        width: bodyWidth - 8,
                        backgroundColor: hexToRgba(col, 0.1),
                        borderColor: hexToRgba(col, 0.4),
                      },
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.bandText, { color: col }]}>
                      {c.titre}
                    </Text>
                  </Pressable>
                )
              })}

              {/* Ligne NOW */}
              {nowMin != null && (
                <View style={[styles.nowLine, { top: topOf(nowMin) }]} pointerEvents="none">
                  <View style={styles.nowDot} />
                  <View style={styles.nowLabel}>
                    <Text style={styles.nowLabelText}>
                      {Math.floor(nowMin / 60) % 24}:{String(nowMin % 60).padStart(2, '0')}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 120,
  },
  emptyText: { color: colors.textMuted, fontSize: 13 },
  skeletonWrap: { flex: 1, paddingHorizontal: 14, paddingTop: 12, gap: 10 },
  headerRow: {
    flexDirection: 'row',
    height: HEADER_HEIGHT,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.glass.border,
  },
  laneHead: {
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  laneHeadInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  laneHeadText: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  hourLabel: {
    position: 'absolute',
    right: 6,
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: fontWeight.medium,
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glass.borderSubtle,
  },
  laneCol: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(255,255,255,0.05)',
  },
  block: {
    position: 'absolute',
    borderWidth: 0.5,
    borderLeftWidth: 2.5,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  blockTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 3,
  },
  blockTitle: {
    flex: 1,
    fontSize: 10,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    lineHeight: 12,
  },
  blockTitleCancelled: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  blockTime: {
    fontSize: 8,
    color: colors.textSecondary,
    marginTop: 1,
  },
  band: {
    position: 'absolute',
    left: 4,
    borderWidth: 0.5,
    borderStyle: 'dashed',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  bandText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: '#EF4444',
  },
  nowDot: {
    position: 'absolute',
    left: -3,
    top: -3,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  nowLabel: {
    position: 'absolute',
    left: 4,
    top: -8,
    backgroundColor: '#EF4444',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  nowLabelText: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.2 },
})
