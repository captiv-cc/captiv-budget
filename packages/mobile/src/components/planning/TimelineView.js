// ════════════════════════════════════════════════════════════════════════════
// TimelineView — vue Timeline multi-lanes (MOI + scènes)
// ════════════════════════════════════════════════════════════════════════════
//
// Maquette : colonnes par lane (MOI, CHATEAU, VIRAGE, …), heures à gauche,
// blocs positionnés en absolute selon start/end. Ligne NOW rouge horizontale
// au time courant.
//
// V1 : layout simple via absolute positioning. V2 : drag-to-reorder.
//
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState, useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'

import { TYPE_CRENEAU_COLOR } from '@captiv/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme'

const PIXELS_PER_MINUTE = 2.5
const HEURE_DEBUT = 17 // affichage commence à 17h
const HEURE_FIN = 24 // jusqu'à minuit
const LANE_WIDTH = 100
const HOUR_COL_WIDTH = 36

export default function TimelineView({ lanes, creneaux }) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Préparation : group creneaux par lane_id
  const creneauxByLane = useMemo(() => {
    const map = {}
    for (const c of creneaux) {
      if (!map[c.lane_id]) map[c.lane_id] = []
      map[c.lane_id].push(c)
    }
    return map
  }, [creneaux])

  const totalMinutes = (HEURE_FIN - HEURE_DEBUT) * 60
  const totalHeight = totalMinutes * PIXELS_PER_MINUTE

  // Position NOW
  const nowMinutesFromStart = (now.getHours() - HEURE_DEBUT) * 60 + now.getMinutes()
  const showNow = nowMinutesFromStart >= 0 && nowMinutesFromStart <= totalMinutes
  const nowTop = showNow ? nowMinutesFromStart * PIXELS_PER_MINUTE : 0

  // Liste des heures à afficher
  const hours = []
  for (let h = HEURE_DEBUT; h <= HEURE_FIN; h++) {
    hours.push(h)
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.hScrollContent}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          <View style={[styles.gridWrap, { height: totalHeight }]}>
            {/* Heures à gauche */}
            <View style={styles.hourCol}>
              {hours.map((h) => (
                <Text
                  key={h}
                  style={[
                    styles.hourLabel,
                    { top: (h - HEURE_DEBUT) * 60 * PIXELS_PER_MINUTE - 6 },
                  ]}
                >
                  {h}h
                </Text>
              ))}
            </View>

            {/* Lignes horizontales heures */}
            {hours.map((h) => (
              <View
                key={`line-${h}`}
                style={[
                  styles.hourLine,
                  { top: (h - HEURE_DEBUT) * 60 * PIXELS_PER_MINUTE },
                ]}
              />
            ))}

            {/* Lanes en colonnes */}
            {lanes.map((lane, idx) => (
              <View
                key={lane.id}
                style={[
                  styles.lane,
                  {
                    left: HOUR_COL_WIDTH + idx * LANE_WIDTH,
                    width: LANE_WIDTH,
                  },
                ]}
              >
                {/* Header lane */}
                <View style={styles.laneHeader}>
                  <View
                    style={[
                      styles.laneDot,
                      { backgroundColor: lane.type === 'cadreur' ? colors.brand.blue : colors.textMuted },
                    ]}
                  />
                  <Text style={styles.laneLabel}>{lane.label}</Text>
                </View>

                {/* Créneaux dans cette lane */}
                {(creneauxByLane[lane.id] ?? []).map((c) => {
                  const start = new Date(c.start)
                  const end = new Date(c.end)
                  const startMin = (start.getHours() - HEURE_DEBUT) * 60 + start.getMinutes()
                  const durationMin = (end - start) / 60_000
                  const top = startMin * PIXELS_PER_MINUTE + 30 // offset header
                  const height = Math.max(durationMin * PIXELS_PER_MINUTE - 4, 20)
                  const color = TYPE_CRENEAU_COLOR[c.type_creneau] ?? colors.textMuted
                  return (
                    <View
                      key={c.id}
                      style={[
                        styles.bloc,
                        {
                          top,
                          height,
                          borderLeftColor: color,
                          backgroundColor: `${color}22`, // alpha ~13%
                        },
                      ]}
                    >
                      {c.sous_titre && (
                        <Text style={[styles.blocSousTitre, { color }]} numberOfLines={1}>
                          {c.sous_titre.toUpperCase()}
                        </Text>
                      )}
                      <Text style={styles.blocTitre} numberOfLines={2}>
                        {c.titre}
                      </Text>
                      {c.headliner && (
                        <View style={styles.blocHead}>
                          <Text style={styles.blocHeadText}>★ HEAD</Text>
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>
            ))}

            {/* Ligne NOW rouge */}
            {showNow && (
              <View style={[styles.nowLine, { top: nowTop + 30 }]}>
                <View style={styles.nowDot} />
                <View style={styles.nowBar} />
                <View style={styles.nowLabel}>
                  <Text style={styles.nowLabelText}>NOW</Text>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hScrollContent: {
    paddingRight: 14,
  },
  gridWrap: {
    position: 'relative',
    paddingTop: 30, // espace header lanes
  },
  hourCol: {
    position: 'absolute',
    left: 0,
    top: 30,
    width: HOUR_COL_WIDTH,
    bottom: 0,
  },
  hourLabel: {
    position: 'absolute',
    left: 8,
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: fontWeight.medium,
  },
  hourLine: {
    position: 'absolute',
    left: HOUR_COL_WIDTH,
    right: 0,
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  lane: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  laneHeader: {
    position: 'absolute',
    top: 0,
    left: 4,
    right: 4,
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  laneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  laneLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  bloc: {
    position: 'absolute',
    left: 4,
    right: 4,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  blocSousTitre: {
    fontSize: 8,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  blocTitre: {
    fontSize: 11,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },
  blocHead: {
    marginTop: 2,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(244,114,182,0.18)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  blocHeadText: {
    fontSize: 7,
    color: '#F472B6',
    fontWeight: fontWeight.bold,
  },
  nowLine: {
    position: 'absolute',
    left: HOUR_COL_WIDTH,
    right: 0,
    height: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginLeft: -4,
    shadowColor: '#EF4444',
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  nowBar: {
    flex: 1,
    height: 2,
    backgroundColor: '#EF4444',
  },
  nowLabel: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    marginLeft: 4,
  },
  nowLabelText: {
    fontSize: 8,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
})
