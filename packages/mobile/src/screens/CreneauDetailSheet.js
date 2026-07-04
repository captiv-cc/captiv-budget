// ════════════════════════════════════════════════════════════════════════════
// CreneauDetailSheet — bottom sheet détail créneau
// ════════════════════════════════════════════════════════════════════════════
//
// Maquette : sheet 80% qui s'ouvre par dessus le planning.
// Contenu :
// - Badges : CAPTATION + HEADLINER + PLANIFIÉ + bouton X
// - Titre + plage horaire + durée
// - Bloc warning orange ("Dans 1h47 — pense à charger les batteries")
// - Carte Lieu + bouton "Y aller"
// - Section ÉQUIPE (avec MOI en premier)
// - Section BRIEF (texte multi-ligne)
// - Bouton "Marquer fait" vert + chevron dropdown statuts
//
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Alert, Share } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import * as Notifications from 'expo-notifications'

import { BottomSheet, Avatar, Button, IconButton } from '../components/atoms'
import { PressableScale } from '../components/shared'
import {
  formatPlageHoraire,
  formatDuree,
  formatCountdown,
  STATUT_CRENEAU,
  STATUT_CRENEAU_LABEL,
  STATUT_CRENEAU_COLOR,
  TYPE_CRENEAU_LABEL,
} from '@captiv/shared'
import { colors, fontSize, fontWeight, spacing, radius, statusTint } from '../theme'
import { useCreneau } from '../hooks/useCreneau'
import { effectiveCouleurCreneau } from '../lib/derouleColors'
import { setCreneauStatut } from '../lib/creneauStatut'
import { stripHtml } from '../lib/creneauVisual'
import { useNow } from '../lib/useNow'
import { formatDateHeureLong } from '../lib/dateMin'
import { useProjet } from '../lib/ProjetContext'
import { fetchLieuData, resolveCreneauLieu, poiCenter } from '../lib/lieu'
import { navigationRef } from '../navigation/navigationRef'

export default function CreneauDetailSheet({ visible, creneau, onClose, onChanged, siblingIds = [], onNavigate }) {
  const [statut, setStatut] = useState(creneau?.statut ?? STATUT_CRENEAU.PLANIFIE)
  const [showStatutDropdown, setShowStatutDropdown] = useState(false)
  const [saving, setSaving] = useState(false)
  const now = useNow(60000) // horloge vivante (countdown) — hook avant tout early return
  const { projet } = useProjet()

  // Charge le détail complet (équipe via projet_membres) ; fallback sur le créneau allégé de la liste
  const { creneau: detail } = useCreneau(creneau?.id)

  // Resync le statut affiché quand on ouvre un autre créneau (le sheet reste
  // monté). Sur deep-link push on ne reçoit qu'un { id } → on prend le statut
  // du détail une fois chargé.
  useEffect(() => {
    setStatut(creneau?.statut ?? detail?.statut ?? STATUT_CRENEAU.PLANIFIE)
  }, [creneau?.id, creneau?.statut, detail?.statut])
  const equipe = detail?.equipe ?? creneau?.equipe ?? []

  if (!creneau) {
    return <BottomSheet visible={false} onClose={onClose} />
  }

  // Source d'affichage : détail complet si chargé, sinon le créneau passé
  // (la Timeline passe une ligne brute sans start/end ISO → detail comble).
  const c = detail ?? creneau

  const typeColor = effectiveCouleurCreneau(c)
  const typeLabel = TYPE_CRENEAU_LABEL[c.type] ?? (c.type ? c.type.charAt(0).toUpperCase() + c.type.slice(1) : '')
  const statutColor = STATUT_CRENEAU_COLOR[statut] ?? colors.textMuted
  const statutLabel = STATUT_CRENEAU_LABEL[statut] ?? ''

  // Countdown vivant : <2h → relatif ("Dans 1h47", tick chaque minute) ;
  // ≥2h → date absolue ("Début vendredi 12 juin 20h"). Rien si déjà passé.
  const startMs = c.start ? new Date(c.start).getTime() : null
  const minsUntil = startMs != null ? Math.round((startMs - now) / 60000) : null
  let countdownText = null
  if (minsUntil != null && minsUntil > 0) {
    countdownText = minsUntil >= 120 ? `Début ${formatDateHeureLong(c.start)}` : formatCountdown(c.start)
  }
  const alerteText = c.warnings?.[0] ?? null
  const showWarning = !!(countdownText || alerteText)
  const notesText = stripHtml(c.notes)

  const callTeam = async (member) => {
    if (member.phone) {
      Linking.openURL(`tel:${member.phone}`).catch(() => {})
    }
  }

  // Optimistic + persist + revert si la RLS bloque
  const applyStatut = async (next) => {
    if (saving || next === statut) return
    const prev = statut
    setStatut(next)
    setSaving(true)
    const res = await setCreneauStatut(c.id, next)
    setSaving(false)
    if (res.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      onChanged?.()
      return
    }
    setStatut(prev) // revert
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    if (res.blocked) {
      Alert.alert('Action non autorisée', "Tu n'as pas les droits pour changer le statut de ce créneau.")
    } else {
      Alert.alert('Erreur', res.error?.message ?? 'Impossible de mettre à jour le statut.')
    }
  }

  const handleMarquerFait = () => {
    applyStatut(statut === STATUT_CRENEAU.FAIT ? STATUT_CRENEAU.PLANIFIE : STATUT_CRENEAU.FAIT)
  }

  // Navigation entre créneaux frères (sans fermer le drawer)
  const navIdx = siblingIds.indexOf(creneau?.id)
  const prevId = navIdx > 0 ? siblingIds[navIdx - 1] : null
  const nextId = navIdx >= 0 && navIdx < siblingIds.length - 1 ? siblingIds[navIdx + 1] : null

  // Actions rapides
  const handleShare = () => {
    Share.share({ message: `${c.titre} · ${formatPlageHoraire(c.start, c.end)}${c.lieu ? ` · ${c.lieu}` : ''}` }).catch(() => {})
  }
  const handleYAller = async () => {
    // 1. Tente de résoudre le lieu précis sur la carte interactive.
    if (projet?.id) {
      try {
        const data = await fetchLieuData(projet.id)
        const poi = resolveCreneauLieu(
          { id: c.id, lieu_id: c.lieu_id, lane_id: c.lane_id, deroule_id: c.deroule_id, lieu: c.lieu },
          { pois: data?.pois, lanes: data?.lanes },
        )
        const ctr = poi ? poiCenter(poi) : null
        if (ctr && navigationRef.isReady()) {
          onClose?.()
          navigationRef.navigate('Tabs', {
            screen: 'Carte',
            params: {
              focusLng: ctr.lng,
              focusLat: ctr.lat,
              focusLabel: poi.label || c.titre,
              title: 'Y aller',
            },
          })
          return
        }
      } catch {
        /* fallback ci-dessous */
      }
    }
    // 2. Fallback : recherche texte dans Maps.
    if (c.lieu) Linking.openURL(`http://maps.apple.com/?q=${encodeURIComponent(c.lieu)}`).catch(() => {})
  }
  const handleRappel = async () => {
    if (!c.start) return
    const trigger = new Date(new Date(c.start).getTime() - 15 * 60000)
    if (trigger.getTime() <= Date.now()) {
      Alert.alert('Trop tard', 'Ce créneau commence dans moins de 15 min (ou est déjà passé).')
      return
    }
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Bientôt : ${c.titre}`,
          body: `Dans 15 min · ${formatPlageHoraire(c.start, c.end)}${c.lieu ? ` · ${c.lieu}` : ''}`,
          data: { creneau_id: c.id },
        },
        trigger: { type: 'date', date: trigger },
      })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      Alert.alert('Rappel programmé', 'Tu seras prévenu 15 min avant le créneau.')
    } catch {
      Alert.alert('Erreur', 'Impossible de programmer le rappel.')
    }
  }

  // Hauteur dynamique selon le contenu présent
  const sheetHeight = (() => {
    let h = 42
    if (showWarning) h += 9
    if (c.lieu) h += 9
    if (equipe.length) h += 8 + Math.min(equipe.length, 4) * 5
    if (c.brief) h += 12
    if (notesText) h += 13
    return Math.max(48, Math.min(90, h))
  })()

  return (
    <BottomSheet visible={visible} onClose={onClose} heightPercent={sheetHeight}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
        {/* Navigation entre créneaux */}
        {siblingIds.length > 1 && navIdx >= 0 && (
          <View style={styles.navRow}>
            <PressableScale
              haptic="selection"
              disabled={!prevId}
              onPress={() => prevId && onNavigate?.(prevId)}
              style={[styles.navBtn, !prevId && styles.navBtnDisabled]}
            >
              <Ionicons name="chevron-back" size={16} color={prevId ? '#fff' : colors.textDim} />
              <Text style={[styles.navBtnText, !prevId && { color: colors.textDim }]}>Préc.</Text>
            </PressableScale>
            <Text style={styles.navCount}>{navIdx + 1} / {siblingIds.length}</Text>
            <PressableScale
              haptic="selection"
              disabled={!nextId}
              onPress={() => nextId && onNavigate?.(nextId)}
              style={[styles.navBtn, !nextId && styles.navBtnDisabled]}
            >
              <Text style={[styles.navBtnText, !nextId && { color: colors.textDim }]}>Suiv.</Text>
              <Ionicons name="chevron-forward" size={16} color={nextId ? '#fff' : colors.textDim} />
            </PressableScale>
          </View>
        )}

        {/* Badges row */}
        <View style={styles.badgesRow}>
          <View style={[styles.typeBadge, { borderColor: `${typeColor}55` }]}>
            <Ionicons name="videocam-outline" size={12} color={typeColor} />
            <Text style={[styles.typeBadgeText, { color: typeColor }]}>
              {typeLabel.toUpperCase()}
            </Text>
          </View>
          {c.headliner && (
            <View style={styles.headBadge}>
              <Ionicons name="star" size={10} color="#FCA5A5" />
              <Text style={styles.headBadgeText}>HEADLINER</Text>
            </View>
          )}
          <View style={[styles.statutBadge, { borderColor: `${statutColor}55` }]}>
            <Ionicons name="flag-outline" size={11} color={statutColor} />
            <Text style={[styles.statutBadgeText, { color: statutColor }]}>
              {statutLabel.toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" onPress={onClose} size={28} iconSize={16} />
        </View>

        {/* Titre + heures */}
        <Text style={styles.titre}>{c.titre}</Text>
        <View style={styles.horaireRow}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.horaire}>{formatPlageHoraire(c.start, c.end)}</Text>
          <Text style={styles.horaireDuree}>· {formatDuree(c.duree_min)}</Text>
        </View>

        {/* Actions rapides */}
        <View style={styles.quickRow}>
          <QuickAction icon="alarm-outline" label="Rappel" onPress={handleRappel} />
          <QuickAction icon="share-outline" label="Partager" onPress={handleShare} />
        </View>

        {/* Countdown / point d'attention */}
        {showWarning && (
          <View style={styles.warningCard}>
            <Ionicons name="notifications-outline" size={18} color="#FBBF24" />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningTitle}>{countdownText ?? alerteText}</Text>
              {countdownText && alerteText && (
                <Text style={styles.warningSub}>{alerteText}</Text>
              )}
            </View>
          </View>
        )}

        {/* Lieu */}
        {(c.lieu || c.lieu_id) && (
          <View style={styles.lieuCard}>
            <View style={styles.lieuIcon}>
              <Ionicons name="location-outline" size={16} color={colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.lieuTitre}>{c.lieu || 'Lieu sur la carte'}</Text>
              {c.lieu_distance_m != null && (
                <Text style={styles.lieuSub}>{c.lieu_distance_m}m · Friche Belle de Mai</Text>
              )}
            </View>
            <Button
              variant="secondary"
              size="sm"
              onPress={handleYAller}
              leftIcon={<Ionicons name="navigate-outline" size={14} color={colors.text} />}
              style={styles.yallerBtn}
            >
              Y aller
            </Button>
          </View>
        )}

        {/* Équipe */}
        {equipe.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.sectionTitle}>ÉQUIPE ({equipe.length})</Text>
            </View>
            {equipe.map((m) => {
              const isMe = m.is_me
              const nom = m.nom ?? 'Inconnu'
              return (
                <View key={m.membre_id} style={styles.memberRow}>
                  <Avatar nom={nom} id={m.membre_id} size={28} />
                  <Text style={styles.memberName}>{nom}</Text>
                  {isMe && (
                    <View style={styles.moiTag}>
                      <Text style={styles.moiTagText}>MOI</Text>
                    </View>
                  )}
                  <Text style={styles.memberRole}>{m.role}</Text>
                  {!isMe && (
                    <Pressable onPress={() => callTeam(m)} hitSlop={8}>
                      <Ionicons name="call-outline" size={16} color={colors.brand.blueLight} />
                    </Pressable>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {/* Brief (description courte) */}
        {c.brief ? (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="document-text-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.sectionTitle}>BRIEF</Text>
            </View>
            <View style={styles.briefCard}>
              <Text style={styles.briefText}>{c.brief}</Text>
            </View>
          </View>
        ) : null}

        {/* Notes (brief riche du web) */}
        {notesText ? (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="reader-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.sectionTitle}>NOTES</Text>
            </View>
            <View style={styles.briefCard}>
              <Text style={styles.briefText}>{notesText}</Text>
            </View>
          </View>
        ) : null}

        {/* Sources */}
        {c.sources?.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="link-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.sectionTitle}>SOURCES</Text>
            </View>
            <View style={{ gap: spacing.sm }}>
              {c.sources.map((s, i) => (
                <Pressable
                  key={i}
                  onPress={() => Linking.openURL(s.url).catch(() => {})}
                  style={styles.sourceRow}
                >
                  <Ionicons name="open-outline" size={14} color={colors.brand.blueLight} />
                  <Text style={styles.sourceLabel}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Action bar : Marquer fait + dropdown */}
      <View style={styles.actionBar}>
        <View style={{ flex: 1 }}>
          <Button
            variant={statut === STATUT_CRENEAU.FAIT ? 'secondary' : 'success'}
            onPress={handleMarquerFait}
            leftIcon={
              <Ionicons
                name={statut === STATUT_CRENEAU.FAIT ? 'checkmark-circle' : 'checkmark-outline'}
                size={18}
                color="#fff"
              />
            }
          >
            {statut === STATUT_CRENEAU.FAIT ? 'Fait ✓' : 'Marquer fait'}
          </Button>
        </View>
        <Pressable
          onPress={() => setShowStatutDropdown((v) => !v)}
          style={styles.chevronBtn}
          hitSlop={8}
        >
          <Ionicons
            name={showStatutDropdown ? 'chevron-down' : 'chevron-up'}
            size={18}
            color={colors.text}
          />
        </Pressable>

        {/* Dropdown statuts */}
        {showStatutDropdown && (
          <View style={styles.dropdown}>
            {Object.values(STATUT_CRENEAU).map((s) => {
              const isActive = s === statut
              const color = STATUT_CRENEAU_COLOR[s]
              return (
                <Pressable
                  key={s}
                  onPress={() => {
                    setShowStatutDropdown(false)
                    applyStatut(s)
                  }}
                  style={[styles.dropdownItem, isActive && styles.dropdownItemActive]}
                >
                  <Ionicons name="flag-outline" size={14} color={color} />
                  <Text style={[styles.dropdownText, { color: isActive ? color : colors.text }]}>
                    {STATUT_CRENEAU_LABEL[s]}
                  </Text>
                  {isActive && <Ionicons name="checkmark" size={14} color={color} />}
                </Pressable>
              )
            })}
          </View>
        )}
      </View>
    </BottomSheet>
  )
}

function QuickAction({ icon, label, onPress, color = '#fff' }) {
  return (
    <PressableScale haptic="light" onPress={onPress} style={styles.quickBtn}>
      <Ionicons name={icon} size={17} color={color} />
      <Text style={[styles.quickLabel, { color }]}>{label}</Text>
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.glass.high,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
  },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { fontSize: 12, color: '#fff', fontWeight: fontWeight.semibold },
  navCount: { fontSize: 11, color: colors.textMuted, fontWeight: fontWeight.medium },
  quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  quickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.glass.high,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
  },
  quickLabel: { fontSize: 12, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  headBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(244,114,182,0.15)',
    borderColor: 'rgba(244,114,182,0.35)',
    borderWidth: 0.5,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  headBadgeText: {
    fontSize: 9,
    color: '#FCA5A5',
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  statutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  statutBadgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  titre: {
    fontSize: 28,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.6,
    marginTop: spacing.lg,
  },
  horaireRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  horaire: {
    fontSize: 14,
    color: '#fff',
    fontWeight: fontWeight.medium,
  },
  horaireDuree: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: statusTint.warning.bg,
    borderColor: statusTint.warning.border,
    borderWidth: 0.5,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  warningTitle: {
    fontSize: 14,
    color: '#FBBF24',
    fontWeight: fontWeight.bold,
  },
  warningSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  lieuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  lieuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.glass.high,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lieuTitre: {
    fontSize: 14,
    color: '#fff',
    fontWeight: fontWeight.semibold,
  },
  lieuSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  yallerBtn: {
    backgroundColor: colors.brand.blue,
    borderColor: colors.brand.blueLight,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  section: {
    marginTop: spacing.xxl,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  memberName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: fontWeight.semibold,
  },
  moiTag: {
    backgroundColor: statusTint.info.bg,
    borderColor: colors.brand.blueBorder,
    borderWidth: 0.5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  moiTagText: {
    fontSize: 9,
    color: '#93C5FD',
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  memberRole: {
    marginLeft: 'auto',
    fontSize: 12,
    color: colors.textSecondary,
  },
  briefCard: {
    backgroundColor: colors.glass.base,
    borderColor: colors.glass.border,
    borderWidth: 0.5,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  briefText: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  sourceLabel: {
    fontSize: 13,
    color: colors.brand.blueLight,
  },
  actionBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chevronBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.glass.high,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdown: {
    position: 'absolute',
    bottom: 60,
    right: 0,
    width: 180,
    backgroundColor: 'rgba(20,20,22,0.95)',
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 4,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 10,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  dropdownItemActive: {
    backgroundColor: colors.glass.base,
  },
  dropdownText: {
    fontSize: 13,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
})
