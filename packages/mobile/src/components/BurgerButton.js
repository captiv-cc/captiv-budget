// ════════════════════════════════════════════════════════════════════════════
// BurgerButton — bouton menu (burger) + bottom sheet "contexte projet"
// ════════════════════════════════════════════════════════════════════════════
//
// Ne duplique PAS la tab bar. Sert au contexte projet :
// - changer de projet (sélecteur)
// - [à venir] pages projet : Infos, Équipe, Plans, Logistique, Matériel
// - déconnexion
//
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation, useNavigationState } from '@react-navigation/native'

import { IconButton, BottomSheet } from './atoms'
import { useAuth } from '../lib/AuthContext'
import { useProjet } from '../lib/ProjetContext'
import { usePermissions } from '../hooks/usePermissions'
import { navigationRef } from '../navigation/navigationRef'
import { colors, fontWeight, spacing, radius } from '../theme'

// Pages projet poussées (MainStack). Pour les internes, la Carte n'est pas un
// onglet → elle apparaît ici en page.
const PAGES_EXTERNE = [
  { name: 'InfosProjet', icon: 'information-circle-outline', label: 'Infos projet' },
  { name: 'Equipe', icon: 'people-outline', label: 'Équipe & contacts' },
  { name: 'Logistique', icon: 'bed-outline', label: 'Logistique & VHR' },
  { name: 'Materiel', icon: 'cube-outline', label: 'Matériel' },
]
const PAGES_INTERNE = [
  ...PAGES_EXTERNE,
  { name: 'CartePage', icon: 'map-outline', label: 'Plan / Carte' },
]

// Écrans poussés (hors tab bar) où le burger propose « Aller à » pour revenir.
const PUSHED_SCREENS = [...PAGES_INTERNE.map((p) => p.name), 'Profil', 'DevisEditor']

// Sections de l'app (tab bar) — proposées dans le burger UNIQUEMENT depuis une
// page projet (où il n'y a pas de tab bar pour revenir). Dépend du rôle.
const SECTIONS_EXTERNE = [
  { name: 'Planning', icon: 'calendar-outline', label: 'Planning' },
  { name: 'Livrables', icon: 'checkbox-outline', label: 'Livrables' },
  { name: 'Notifications', icon: 'notifications-outline', label: 'Notifications' },
  { name: 'Carte', icon: 'map-outline', label: 'Plan' },
]
const SECTIONS_INTERNE = [
  { name: 'Accueil', icon: 'home-outline', label: 'Accueil' },
  { name: 'Planning', icon: 'calendar-outline', label: 'Planning' },
  { name: 'Livrables', icon: 'checkbox-outline', label: 'Livrables' },
  { name: 'Devis', icon: 'document-text-outline', label: 'Devis' },
  { name: 'Notifications', icon: 'notifications-outline', label: 'Notifications' },
]

export default function BurgerButton() {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const nav = useNavigation()
  const { signOut } = useAuth()
  const { projet, projets, setProjetId } = useProjet()
  const { isInternal } = usePermissions()
  const PAGES = isInternal ? PAGES_INTERNE : PAGES_EXTERNE
  const APP_SECTIONS = isInternal ? SECTIONS_INTERNE : SECTIONS_EXTERNE

  // Sommes-nous sur une page projet (vs un onglet) ? → propose le retour à l'app
  const currentRoute = useNavigationState((s) => s?.routes?.[s.index]?.name)
  const onProjectPage = PUSHED_SCREENS.includes(currentRoute)

  const close = () => {
    setOpen(false)
    setExpanded(false)
  }

  const choose = (id) => {
    setProjetId(id)
    close()
  }

  const goPage = (name) => {
    close()
    nav.navigate(name)
  }

  const goSection = (name) => {
    close()
    navigationRef.navigate('Tabs', { screen: name })
  }

  const logout = () => {
    close()
    Alert.alert('Déconnexion', 'Veux-tu vraiment te déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => signOut().catch(() => {}) },
    ])
  }

  return (
    <>
      <IconButton icon="menu-outline" onPress={() => setOpen(true)} />
      <BottomSheet visible={open} onClose={close} heightPercent={expanded ? 74 : onProjectPage ? 66 : 44}>
        <Text style={styles.title}>Projet</Text>

        {/* Projet courant (repliable) */}
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={({ pressed }) => [styles.currentRow, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="albums-outline" size={18} color={colors.brand.blueLight} />
          <View style={{ flex: 1 }}>
            <Text style={styles.projetTitle} numberOfLines={1}>{projet?.title ?? 'Aucun projet'}</Text>
            {!!projet?.lieu_text && (
              <Text style={styles.projetSub} numberOfLines={1}>{projet.lieu_text}</Text>
            )}
          </View>
          {projets.length > 1 && (
            <View style={styles.changerTag}>
              <Text style={styles.changerText}>Changer</Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textSecondary} />
            </View>
          )}
        </Pressable>

        {expanded && (
          <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
            {projets
              .filter((p) => p.id !== projet?.id)
              .map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => choose(p.id)}
                  style={({ pressed }) => [styles.projetRow, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="radio-button-off" size={18} color={colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.projetTitle} numberOfLines={1}>{p.title}</Text>
                    {!!p.lieu_text && (
                      <Text style={styles.projetSub} numberOfLines={1}>{p.lieu_text}</Text>
                    )}
                  </View>
                </Pressable>
              ))}
          </ScrollView>
        )}

        {onProjectPage && (
          <>
            <View style={styles.sep} />
            <Text style={styles.sectionLabel}>Aller à</Text>
            {APP_SECTIONS.map((s) => (
              <Pressable
                key={s.name}
                onPress={() => goSection(s.name)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.glass.base }]}
              >
                <Ionicons name={s.icon} size={20} color={colors.brand.blueLight} />
                <Text style={styles.rowLabel}>{s.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
              </Pressable>
            ))}
          </>
        )}

        <View style={styles.sep} />
        <Text style={styles.sectionLabel}>PAGES PROJET</Text>
        {PAGES.map((p) => (
          <Pressable
            key={p.name}
            onPress={() => goPage(p.name)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.glass.base }]}
          >
            <Ionicons name={p.icon} size={20} color={colors.text} />
            <Text style={styles.rowLabel}>{p.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </Pressable>
        ))}

        <View style={styles.sep} />
        <Pressable
          onPress={() => goPage('Profil')}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.glass.base }]}
        >
          <Ionicons name="person-circle-outline" size={20} color={colors.text} />
          <Text style={styles.rowLabel}>Mon profil</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
        </Pressable>

        <View style={styles.sep} />
        <Pressable
          onPress={logout}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.glass.base }]}
        >
          <Ionicons name="log-out-outline" size={20} color="#F87171" />
          <Text style={[styles.rowLabel, { color: '#F87171' }]}>Se déconnecter</Text>
        </Pressable>
      </BottomSheet>
    </>
  )
}

const styles = StyleSheet.create({
  title: {
    fontSize: 22,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.4,
    marginBottom: spacing.md,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 13,
    paddingVertical: spacing.lg,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
  },
  changerTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  changerText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  projetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  projetRowActive: {
    backgroundColor: colors.glass.base,
  },
  projetTitle: {
    fontSize: 15,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  projetSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  sep: {
    height: 0.5,
    backgroundColor: colors.glass.border,
    marginVertical: spacing.sm,
  },
  sectionLabel: {
    fontSize: 9,
    color: colors.textDim,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
    paddingHorizontal: spacing.md,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  rowLabel: {
    fontSize: 15,
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
})
