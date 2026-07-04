// ════════════════════════════════════════════════════════════════════════════
// MembreDetailSheet — drawer détail d'un membre d'équipe
// ════════════════════════════════════════════════════════════════════════════
//
// Infos calquées sur la vue web share : poste, secteur, téléphone, email,
// présence (sessions colorées).
//
// ════════════════════════════════════════════════════════════════════════════

import { View, Text, ScrollView, StyleSheet, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { BottomSheet, Avatar } from '../components/atoms'
import { Badge, PressableScale } from '../components/shared'
import { colors, fontWeight, spacing, radius, type, statusTint } from '../theme'

const JOURS_1 = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return d && m ? `${d}/${m}` : ''
}

function fmtRange(start, end) {
  const a = fmtDate(start)
  const b = fmtDate(end)
  if (a && b) return a === b ? a : `${a} → ${b}`
  return a || b || ''
}

function hhmm(t) {
  return t ? String(t).slice(0, 5) : ''
}

function dayChip(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${JOURS_1[dt.getDay()]}${d}`
}

function tint(hex, alpha) {
  const h = (hex ?? '').replace('#', '')
  if (h.length < 6) return `rgba(59,130,246,${alpha})`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export default function MembreDetailSheet({ membre, visible, onClose }) {
  if (!membre) return <BottomSheet visible={false} onClose={onClose} />

  const call = () => membre.phone && Linking.openURL(`tel:${membre.phone}`).catch(() => {})
  const mail = () => membre.email && Linking.openURL(`mailto:${membre.email}`).catch(() => {})

  // Hauteur adaptée au contenu (sessions)
  const nbSessions = membre.sessions?.length ?? 0
  const sheetHeight = Math.max(40, Math.min(82, 38 + (nbSessions ? 6 + Math.min(nbSessions, 4) * 10 : 0)))

  return (
    <BottomSheet visible={visible} onClose={onClose} heightPercent={sheetHeight}>
      <View style={styles.head}>
        <Avatar nom={membre.nom} id={membre.id} size={52} />
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.nom} numberOfLines={1}>{membre.nom}</Text>
            {membre.is_me && <Badge tone="info" variant="solid">MOI</Badge>}
          </View>
          {!!membre.poste && <Text style={styles.poste}>{membre.poste}</Text>}
          <View style={styles.metaRow}>
            <Badge tone="neutral">{membre.category}</Badge>
            {!!membre.secteur && (
              <View style={styles.secteur}>
                <Ionicons name="location-outline" size={11} color={colors.textMuted} />
                <Text style={styles.secteurText}>{membre.secteur}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Contact */}
      <View style={styles.contactRow}>
        <PressableScale
          haptic="light"
          onPress={call}
          disabled={!membre.phone}
          style={[styles.contactBtn, !membre.phone && styles.contactBtnDisabled]}
        >
          <Ionicons name="call" size={16} color={membre.phone ? '#fff' : colors.textDim} />
          <Text style={[styles.contactLabel, !membre.phone && { color: colors.textDim }]}>
            {membre.phone ?? 'Pas de numéro'}
          </Text>
        </PressableScale>
        <PressableScale
          haptic="light"
          onPress={mail}
          disabled={!membre.email}
          style={[styles.contactBtn, !membre.email && styles.contactBtnDisabled]}
        >
          <Ionicons name="mail" size={16} color={membre.email ? '#fff' : colors.textDim} />
          <Text style={[styles.contactLabel, !membre.email && { color: colors.textDim }]} numberOfLines={1}>
            {membre.email ?? 'Pas d’email'}
          </Text>
        </PressableScale>
      </View>

      {/* Présence / sessions */}
      {membre.sessions?.length > 0 && (
        <ScrollView style={styles.section} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>PRÉSENCE</Text>
          <View style={{ gap: 8 }}>
            {membre.sessions.map((s, i) => {
              const color = s.couleur ? `#${s.couleur.replace('#', '')}` : colors.brand.blue
              return (
                <View key={i} style={styles.sessionCard}>
                  <View style={styles.sessionHead}>
                    <View style={[styles.dot, { backgroundColor: color }]} />
                    <View style={{ flex: 1 }}>
                      {!!s.label && <Text style={styles.sessionLabel}>{s.label}</Text>}
                      {!!s.lieu && <Text style={styles.sessionLieu}>{s.lieu}</Text>}
                    </View>
                    <Text style={styles.sessionDates}>{fmtRange(s.arrival, s.departure)}</Text>
                  </View>

                  {s.days?.length > 0 && (
                    <View style={styles.chipsRow}>
                      {s.days.map((d) => (
                        <View
                          key={d}
                          style={[styles.chip, { backgroundColor: tint(color, 0.18), borderColor: tint(color, 0.4) }]}
                        >
                          <Text style={[styles.chipText, { color }]}>{dayChip(d)}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {(s.arrivalDate || s.arrival_time || s.departureDate || s.departure_time) && (
                    <View style={styles.travelRow}>
                      {(s.arrivalDate || s.arrival_time) && (
                        <View style={styles.travelItem}>
                          <Ionicons name="airplane" size={11} color={statusTint.success.fg} style={{ transform: [{ rotate: '45deg' }] }} />
                          <Text style={styles.travel}>
                            Arrivée {fmtDate(s.arrivalDate ?? s.arrival)}{s.arrival_time ? ` · ${hhmm(s.arrival_time)}` : ''}
                          </Text>
                        </View>
                      )}
                      {(s.departureDate || s.departure_time) && (
                        <View style={styles.travelItem}>
                          <Ionicons name="airplane" size={11} color={statusTint.warning.fg} style={{ transform: [{ rotate: '135deg' }] }} />
                          <Text style={styles.travel}>
                            Départ {fmtDate(s.departureDate ?? s.departure)}{s.departure_time ? ` · ${hhmm(s.departure_time)}` : ''}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        </ScrollView>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nom: { ...type.title, fontSize: 19, color: '#fff', flexShrink: 1 },
  poste: { ...type.subhead, color: colors.textSecondary, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  secteur: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  secteurText: { ...type.caption, color: colors.textMuted },
  contactRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.glass.high,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  contactBtnDisabled: { opacity: 0.5 },
  contactLabel: { ...type.subhead, color: '#fff', fontWeight: fontWeight.medium, flexShrink: 1 },
  section: { marginTop: spacing.xxl, maxHeight: 320 },
  sectionLabel: { ...type.overline, color: colors.textSecondary, marginBottom: spacing.md },
  sessionCard: {
    backgroundColor: colors.glass.subtle,
    borderWidth: 0.5,
    borderColor: colors.glass.borderSubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sessionLabel: { ...type.subhead, color: '#fff', fontWeight: fontWeight.semibold },
  sessionLieu: { ...type.caption, color: colors.textMuted, marginTop: 1 },
  sessionDates: { ...type.footnote, color: colors.textSecondary, fontWeight: fontWeight.medium },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 0.5,
  },
  chipText: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.2 },
  travelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: 2 },
  travelItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  travel: { ...type.caption, color: colors.textSecondary, fontWeight: fontWeight.medium },
})
