// ════════════════════════════════════════════════════════════════════════════
// NotificationsScreen — centre de notifications (refonte UI 2026)
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useRef } from 'react'
import { View, Text, Animated, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { Avatar } from '../components/atoms'
import { ScreenHeader, Section, Card, PressableScale, HEADER_BASE_HEIGHT } from '../components/shared'
import { formatRelatif, estAujourdhui, estHier } from '@captiv/shared'
import { colors, spacing, radius, type, statusTint } from '../theme'
import { useNotifications } from '../hooks/useNotifications'
import { useListEntrance } from '../hooks/useListEntrance'
import { creneauIdFromNotif, openCreneauFromPush } from '../navigation/navigationRef'

const TYPE_META = {
  creneau_assigne: { icon: 'calendar', tone: 'info' },
  creneau_modifie: { icon: 'create', tone: 'warning' },
  creneau_annule: { icon: 'close', tone: 'danger' },
  livrable_valide: { icon: 'checkmark', tone: 'success' },
  mention: { icon: null, tone: 'accent' },
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current
  const { notifications: notifs, unreadCount: nbNonLues, markAllRead, markRead, deleteNotif } = useNotifications()

  const handlePress = (n) => {
    if (!n.lu) markRead(n.id)
    const creneauId = creneauIdFromNotif({ creneau_id: n.data?.creneau_id, deep_link: n.deep_link })
    if (creneauId) openCreneauFromPush(creneauId)
  }

  const { aujourdhui, hier, plusVieux } = useMemo(() => {
    const today = []
    const yesterday = []
    const older = []
    for (const n of notifs) {
      if (estAujourdhui(n.created_at)) today.push(n)
      else if (estHier(n.created_at)) yesterday.push(n)
      else older.push(n)
    }
    return { aujourdhui: today, hier: yesterday, plusVieux: older }
  }, [notifs])

  const groups = [
    ['Aujourd’hui', aujourdhui],
    ['Hier', hier],
    ['Plus ancien', plusVieux],
  ].filter(([, arr]) => arr.length > 0)

  let runningIndex = 0

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Animated.ScrollView
        contentContainerStyle={{ paddingTop: insets.top + HEADER_BASE_HEIGHT, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        <Text style={styles.subTitle}>
          {nbNonLues} non lue{nbNonLues > 1 ? 's' : ''} · {notifs.length} cette semaine
        </Text>

        {groups.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={26} color={colors.textMuted} />
            <Text style={styles.emptyText}>Aucune notification</Text>
          </View>
        ) : (
          <View style={styles.body}>
            {groups.map(([label, arr]) => (
              <Section key={label} label={label}>
                {arr.map((n) => (
                  <NotifRow
                    key={n.id}
                    notif={n}
                    index={runningIndex++}
                    onPress={() => handlePress(n)}
                    onDelete={() => deleteNotif(n.id)}
                  />
                ))}
              </Section>
            ))}
          </View>
        )}
      </Animated.ScrollView>

      <ScreenHeader
        title="Notifications"
        leftMode="menu"
        right={
          <PressableScale haptic="selection" onPress={markAllRead} hitSlop={8}>
            <Text style={styles.tousLu}>Tout lu</Text>
          </PressableScale>
        }
        scrollY={scrollY}
        overlay
      />
    </View>
  )
}

function NotifRow({ notif, index, onPress, onDelete }) {
  const entrance = useListEntrance(index)
  const meta = TYPE_META[notif.type] ?? TYPE_META.creneau_assigne
  const tint = statusTint[meta.tone]
  const isUnread = !notif.lu
  const hasCreneau = !!(notif.data?.creneau_id || notif.deep_link)

  return (
    <Animated.View style={entrance}>
      <PressableScale
        haptic="selection"
        onPress={onPress}
        style={[styles.row, { backgroundColor: isUnread ? colors.glass.base : 'transparent', borderColor: isUnread ? colors.glass.border : colors.glass.borderSubtle }, !isUnread && { opacity: 0.7 }]}
      >
        {isUnread && <View style={[styles.unreadDot, { backgroundColor: tint.fg }]} />}
        <View style={[styles.iconWrap, { backgroundColor: tint.bg, marginLeft: isUnread ? 6 : 0 }]}>
          {notif.type === 'mention' ? (
            <Avatar nom={notif.data?.from_name ?? notif.titre} id={notif.id} size={26} />
          ) : (
            <Ionicons name={meta.icon} size={15} color={tint.fg} />
          )}
        </View>
        <View style={styles.content}>
          <Text style={styles.titre} numberOfLines={1}>{notif.titre}</Text>
          {!!notif.corps && <Text style={styles.corps} numberOfLines={2}>{notif.corps}</Text>}
          <Text style={styles.time}>
            {formatRelatif(notif.created_at)}
            {hasCreneau ? '  ·  Voir le créneau ›' : ''}
          </Text>
        </View>
        <Pressable onPress={onDelete} hitSlop={10} style={styles.deleteBtn}>
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      </PressableScale>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  subTitle: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
  body: { paddingHorizontal: spacing.lg, gap: spacing.xl },
  empty: { alignItems: 'center', gap: spacing.base, marginTop: 80 },
  emptyText: { ...type.subhead, color: colors.textMuted },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderTopColor: colors.glass.insetHighlight,
    alignItems: 'flex-start',
  },
  unreadDot: { position: 'absolute', top: spacing.lg, left: 6, width: 6, height: 6, borderRadius: 3 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0, gap: 2 },
  titre: { ...type.subhead, color: '#fff', fontWeight: '600' },
  corps: { ...type.footnote, color: colors.textSecondary },
  time: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  deleteBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  tousLu: { ...type.caption, color: colors.brand.blueLight, fontWeight: '600' },
})
