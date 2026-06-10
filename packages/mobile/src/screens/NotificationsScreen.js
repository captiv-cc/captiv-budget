// ════════════════════════════════════════════════════════════════════════════
// NotificationsScreen — centre de notifications push (Aujourd'hui / Hier)
// ════════════════════════════════════════════════════════════════════════════
//
// Maquette : header simple, lignes notifications avec icône colorée selon
// type, point coloré à gauche si non lue, section Aujourd'hui / Hier.
//
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { IconButton, Avatar } from '../components/atoms'
import { formatRelatif, estAujourdhui, estHier } from '@captiv/shared'
import { colors, fontSize, fontWeight, spacing, radius } from '../theme'
import { useNotifications } from '../hooks/useNotifications'

const TYPE_META = {
  creneau_assigne: {
    icon: 'calendar',
    color: '#60A5FA',
    bg: 'rgba(59,130,246,0.12)',
  },
  creneau_modifie: {
    icon: 'create',
    color: '#FBBF24',
    bg: 'rgba(245,158,11,0.12)',
  },
  creneau_annule: {
    icon: 'close',
    color: '#F87171',
    bg: 'rgba(239,68,68,0.12)',
  },
  livrable_valide: {
    icon: 'checkmark',
    color: '#34D399',
    bg: 'rgba(16,185,129,0.12)',
  },
  mention: {
    icon: null, // avatar à la place
    color: '#A855F7',
    bg: 'rgba(168,85,247,0.12)',
  },
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets()
  const { notifications: notifs, unreadCount: nbNonLues, markAllRead } = useNotifications()

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



  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <IconButton icon="menu-outline" />
        <Text style={styles.title}>Notifications</Text>
        <Pressable onPress={markAllRead} hitSlop={8}>
          <Text style={styles.tousLu}>Tout lu</Text>
        </Pressable>
      </View>
      <Text style={styles.subTitle}>
        {nbNonLues} non lue{nbNonLues > 1 ? 's' : ''} · {notifs.length} cette semaine
      </Text>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        showsVerticalScrollIndicator={false}
      >
        {aujourdhui.length > 0 && (
          <Section label="Aujourd'hui">
            {aujourdhui.map((n) => (
              <NotifRow key={n.id} notif={n} />
            ))}
          </Section>
        )}
        {hier.length > 0 && (
          <Section label="Hier">
            {hier.map((n) => (
              <NotifRow key={n.id} notif={n} />
            ))}
          </Section>
        )}
        {plusVieux.length > 0 && (
          <Section label="Plus ancien">
            {plusVieux.map((n) => (
              <NotifRow key={n.id} notif={n} />
            ))}
          </Section>
        )}
      </ScrollView>
    </View>
  )
}

function Section({ label, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
      <View style={{ gap: 6 }}>{children}</View>
    </View>
  )
}

function NotifRow({ notif }) {
  const meta = TYPE_META[notif.type] ?? TYPE_META.creneau_assigne
  const isUnread = !notif.lu

  return (
    <Pressable
      style={[
        styles.notifRow,
        isUnread ? styles.notifRowUnread : styles.notifRowRead,
      ]}
    >
      {isUnread && <View style={[styles.unreadDot, { backgroundColor: meta.color }]} />}
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: meta.bg, marginLeft: isUnread ? 5 : 0 },
        ]}
      >
        {notif.type === 'mention' ? (
          <Avatar nom="Julie Marchand" id="user_julie" size={24} />
        ) : (
          <Ionicons name={meta.icon} size={14} color={meta.color} />
        )}
      </View>
      <View style={styles.notifContent}>
        <Text style={styles.notifTitre} numberOfLines={1}>
          {notif.titre}
        </Text>
        <Text style={styles.notifCorps} numberOfLines={2}>
          {notif.corps}
        </Text>
        <Text style={styles.notifTime}>{formatRelatif(notif.created_at)}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 4,
  },
  title: {
    fontSize: 16,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.3,
  },
  tousLu: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  subTitle: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  scroll: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 14,
    marginTop: 4,
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 9,
    color: colors.textDim,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 6,
  },
  notifRow: {
    flexDirection: 'row',
    gap: 9,
    padding: 11,
    borderRadius: radius.base,
    borderWidth: 0.5,
    alignItems: 'flex-start',
  },
  notifRowUnread: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: colors.glass.border,
  },
  notifRowRead: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.04)',
    opacity: 0.65,
  },
  unreadDot: {
    position: 'absolute',
    top: 14,
    left: 5,
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifContent: {
    flex: 1,
    minWidth: 0,
  },
  notifTitre: {
    fontSize: 12,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },
  notifCorps: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 13,
  },
  notifTime: {
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 4,
  },
})
