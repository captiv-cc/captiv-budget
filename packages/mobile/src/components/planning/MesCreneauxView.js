// ════════════════════════════════════════════════════════════════════════════
// MesCreneauxView — agenda perso du cadreur (rail + spotlight maintenant/prochain)
// ════════════════════════════════════════════════════════════════════════════
//
// - Fil vertical (rail + points) = la journée du cadreur
// - Spotlight du créneau EN COURS ou PROCHAIN avec compte à rebours vivant
// - Trous de libre affichés entre créneaux
// - Barre de progression "x/y faits"
//
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'
import { ScrollView, View, Text, Animated, StyleSheet, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { formatHeure, formatCountdown, TYPE_CRENEAU_LABEL } from '@captiv/shared'
import { colors, fontWeight, radius, spacing, type, elevation } from '../../theme'
import { effectiveCouleurCreneau } from '../../lib/derouleColors'
import { creneauVisual } from '../../lib/creneauVisual'
import { aujourdhuiJour } from '../../lib/dateMin'
import { CreneauSkeletonList } from '../Skeleton'
import { Badge, PressableScale } from '../shared'
import { useNow } from '../../lib/useNow'
import { useListEntrance } from '../../hooks/useListEntrance'

function labelType(t) {
  if (!t) return ''
  return TYPE_CRENEAU_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1)
}

function tint(hex, alpha) {
  const h = (hex ?? '').replace('#', '')
  if (h.length < 6) return `rgba(255,255,255,${alpha})`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function fmtDuree(min) {
  if (min >= 60) {
    const h = Math.floor(min / 60)
    const m = min % 60
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
  }
  return `${min}min`
}

export default function MesCreneauxView({ creneaux, onPressItem, refreshing, onRefresh, loading, jour }) {
  const now = useNow(30000)
  const isToday = jour === aujourdhuiJour()

  const { sorted, items, activeId, faits } = useMemo(() => {
    const arr = [...(creneaux ?? [])]
      .filter((c) => c.start)
      .sort((a, b) => new Date(a.start) - new Date(b.start))

    const stateOf = (c) => {
      const s = new Date(c.start).getTime()
      const e = c.end ? new Date(c.end).getTime() : s
      if (e <= now) return 'past'
      if (s <= now && now < e) return 'current'
      return 'upcoming'
    }

    // Créneau "actif" mis en avant : en cours sinon le prochain (aujourd'hui only)
    let active = null
    if (isToday) {
      active = arr.find((c) => stateOf(c) === 'current') ?? arr.find((c) => stateOf(c) === 'upcoming')
    }

    // Construit la liste rail (créneaux + trous de libre)
    const list = []
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i]
      list.push({ kind: 'creneau', c, state: stateOf(c) })
      const next = arr[i + 1]
      if (next && c.end) {
        const gap = Math.round((new Date(next.start) - new Date(c.end)) / 60000)
        if (gap >= 20) list.push({ kind: 'gap', minutes: gap })
      }
    }

    const done = arr.filter((c) => c.statut === 'fait').length
    return { sorted: arr, items: list, activeId: active?.id ?? null, faits: done }
  }, [creneaux, now, isToday])

  if (loading && sorted.length === 0) {
    return <CreneauSkeletonList />
  }

  const total = sorted.length
  const progress = total ? faits / total : 0

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} /> : undefined}
    >
      {total === 0 ? (
        <Text style={styles.empty}>Aucun créneau ce jour. Profite ✨</Text>
      ) : (
        <>
          {/* Résumé / progression */}
          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              {faits}/{total} fait{faits > 1 ? 's' : ''}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
          </View>

          {items.map((it, i) =>
            it.kind === 'gap' ? (
              <View key={`gap-${i}`} style={styles.gapRow}>
                <View style={styles.rail}>
                  <View style={styles.railLineDashed} />
                </View>
                <Text style={styles.gapText}>{fmtDuree(it.minutes)} libre</Text>
              </View>
            ) : (
              <AgendaRow
                key={it.c.id}
                creneau={it.c}
                state={it.state}
                active={it.c.id === activeId}
                index={i}
                now={now}
                isFirst={i === 0}
                isLast={i === items.length - 1}
                onPress={() => onPressItem?.(it.c)}
              />
            ),
          )}
        </>
      )}
    </ScrollView>
  )
}

function AgendaRow({ creneau, state, active, index, now, isFirst, isLast, onPress }) {
  const entrance = useListEntrance(index)
  const color = effectiveCouleurCreneau(creneau)
  const vis = creneauVisual({ statut: creneau.statut, end: creneau.end })
  const dimmed = state === 'past' || vis.done || vis.cancelled
  const typeLabel = labelType(creneau.type)

  // Compte à rebours du créneau actif
  let countdown = null
  if (active) {
    if (state === 'current') countdown = 'EN COURS'
    else {
      const c = formatCountdown(creneau.start) // recalculé chaque tick via `now`
      countdown = c && c !== 'Maintenant' ? c.toUpperCase() : 'BIENTÔT'
    }
  }

  return (
    <Animated.View style={[styles.row, entrance]}>
      {/* Rail */}
      <View style={styles.rail}>
        {!isFirst && <View style={[styles.railLine, styles.railLineTop]} />}
        {!isLast && <View style={[styles.railLine, styles.railLineBottom]} />}
        <View
          style={[
            styles.dot,
            { borderColor: color },
            (state === 'past' || vis.done) && styles.dotPast,
            (active || state === 'current') && { backgroundColor: color },
          ]}
        />
      </View>

      {/* Carte */}
      <PressableScale
        haptic="light"
        onPress={onPress}
        style={[
          styles.card,
          {
            borderLeftColor: color,
            backgroundColor: dimmed ? colors.glass.subtle : tint(color, active ? 0.18 : 0.08),
            borderColor: active ? tint(color, 0.5) : dimmed ? colors.glass.borderSubtle : tint(color, 0.22),
            opacity: vis.opacity,
          },
          active && { ...elevation.md, shadowColor: color, borderWidth: 1 },
        ]}
      >
        <View style={styles.cardHead}>
          <Text style={[styles.type, { color }]}>{typeLabel.toUpperCase()}</Text>
          {!!countdown && (
            <View style={[styles.countdown, { backgroundColor: tint(color, 0.25) }]}>
              {state === 'current' && <View style={[styles.pulse, { backgroundColor: color }]} />}
              <Text style={[styles.countdownText, { color }]}>{countdown}</Text>
            </View>
          )}
          {vis.done && <Ionicons name="checkmark-circle" size={15} color={colors.status.successLight} />}
          {vis.cancelled && <Badge tone="danger">Annulé</Badge>}
        </View>

        <Text style={[styles.titre, active && styles.titreActive, vis.cancelled && styles.titreCancelled]} numberOfLines={1}>
          {creneau.titre}
        </Text>

        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={13} color={colors.textMuted} />
          <Text style={styles.meta}>
            {formatHeure(creneau.start)} → {formatHeure(creneau.end)}
          </Text>
          {!!creneau.lieu && (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Ionicons name="location-outline" size={13} color={colors.textMuted} />
              <Text style={styles.meta} numberOfLines={1}>{creneau.lieu}</Text>
            </>
          )}
        </View>
      </PressableScale>
    </Animated.View>
  )
}

const RAIL_W = 30

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.base, paddingBottom: 110 },
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: 60 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: RAIL_W,
    marginBottom: spacing.md,
  },
  summaryText: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.glass.base, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: colors.status.successLight },
  row: { flexDirection: 'row' },
  rail: { width: RAIL_W, alignItems: 'center' },
  railLine: { position: 'absolute', width: 1.5, backgroundColor: colors.glass.borderHigh, left: RAIL_W / 2 - 0.75 },
  railLineTop: { top: 0, height: 22 },
  railLineBottom: { top: 22, bottom: -spacing.md, height: undefined },
  railLineDashed: { position: 'absolute', width: 1.5, top: 0, bottom: 0, left: RAIL_W / 2 - 0.75, backgroundColor: colors.glass.border, opacity: 0.5 },
  dot: {
    position: 'absolute',
    top: 16,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    backgroundColor: colors.bg,
  },
  dotPast: { borderColor: colors.textDim, backgroundColor: colors.bg },
  gapRow: { flexDirection: 'row', alignItems: 'center', height: 30 },
  gapText: { ...type.caption, color: colors.textDim, paddingLeft: spacing.sm },
  card: {
    flex: 1,
    marginBottom: spacing.md,
    borderWidth: 0.5,
    borderLeftWidth: 3,
    borderRadius: radius.lg,
    borderTopColor: colors.glass.insetHighlight,
    padding: spacing.lg,
    gap: 5,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  type: { fontSize: 9, fontWeight: fontWeight.bold, letterSpacing: 0.4 },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm },
  countdownText: { fontSize: 9, fontWeight: fontWeight.bold, letterSpacing: 0.4 },
  pulse: { width: 5, height: 5, borderRadius: 3 },
  titre: { ...type.body, color: '#fff', fontWeight: '600' },
  titreActive: { ...type.title2, color: '#fff' },
  titreCancelled: { textDecorationLine: 'line-through', color: colors.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  meta: { ...type.caption, color: colors.textSecondary, flexShrink: 1 },
  metaDot: { color: colors.textDim, marginHorizontal: 2 },
})
