// ════════════════════════════════════════════════════════════════════════════
// MainTabs — bottom tab bar Liquid Glass
// ════════════════════════════════════════════════════════════════════════════

import { View, Text, Pressable, StyleSheet, Platform } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import PlanningScreen from '../screens/PlanningScreen'
import LivrablesScreen from '../screens/LivrablesScreen'
import NotificationsScreen from '../screens/NotificationsScreen'
import CarteScreen from '../screens/CarteScreen'
import AccueilScreen from '../screens/AccueilScreen'
import DevisListScreen from '../screens/DevisListScreen'
import { colors, fontSize, fontWeight } from '../theme'
import { useNotifications } from '../hooks/useNotifications'
import { usePermissions } from '../hooks/usePermissions'

const Tab = createBottomTabNavigator()

// Onglets selon le RÔLE (un seul jeu par utilisateur, pas de switch) :
//   externes (cadreurs/prestataires) → app terrain historique
//   internes (admin/charge_prod/coordinateur) → app complète avec Accueil + Devis
const TABS_EXTERNE = [
  { name: 'Planning', label: 'Planning', icon: 'calendar-outline', iconActive: 'calendar' },
  { name: 'Livrables', label: 'Livrables', icon: 'checkbox-outline', iconActive: 'checkbox' },
  { name: 'Notifications', label: 'Notifs', icon: 'notifications-outline', iconActive: 'notifications' },
  { name: 'Carte', label: 'Plan', icon: 'map-outline', iconActive: 'map' },
]

const TABS_INTERNE = [
  { name: 'Accueil', label: 'Accueil', icon: 'home-outline', iconActive: 'home' },
  { name: 'Planning', label: 'Planning', icon: 'calendar-outline', iconActive: 'calendar' },
  { name: 'Livrables', label: 'Livrables', icon: 'checkbox-outline', iconActive: 'checkbox' },
  { name: 'Devis', label: 'Devis', icon: 'document-text-outline', iconActive: 'document-text' },
  { name: 'Notifications', label: 'Notifs', icon: 'notifications-outline', iconActive: 'notifications' },
]

function GlassTabBar({ state, descriptors, navigation, tabs }) {
  const insets = useSafeAreaInsets()
  const pb = Math.max(insets.bottom, 12)
  const { unreadCount } = useNotifications()

  return (
    <View style={[styles.tabBarWrap, { paddingBottom: pb }]}>
      {Platform.OS === 'ios' && (
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      )}
      <View style={[StyleSheet.absoluteFill, styles.tabBarSurface]} />
      <View style={styles.tabBarRow}>
        {state.routes.map((route, index) => {
          const focused = state.index === index
          const meta = tabs.find((t) => t.name === route.name) ?? tabs[0]
          const badge = route.name === 'Notifications' ? unreadCount : 0
          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            })
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name)
            }
          }

          return (
            <Pressable key={route.key} onPress={onPress} style={styles.tab} hitSlop={8}>
              <View style={styles.tabIconWrap}>
                <Ionicons
                  name={focused ? meta.iconActive : meta.icon}
                  size={22}
                  color={focused ? colors.brand.blueLight : colors.textMuted}
                />
                {badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[
                  styles.tabLabel,
                  { color: focused ? colors.brand.blueLight : colors.textMuted, fontWeight: focused ? fontWeight.semibold : fontWeight.regular },
                ]}
              >
                {meta.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export default function MainTabs() {
  const { isInternal } = usePermissions()
  const tabs = isInternal ? TABS_INTERNE : TABS_EXTERNE

  return (
    <Tab.Navigator
      key={isInternal ? 'interne' : 'externe'} // routes différentes selon le rôle
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <GlassTabBar {...props} tabs={tabs} />}
    >
      {isInternal ? (
        <>
          <Tab.Screen name="Accueil" component={AccueilScreen} />
          <Tab.Screen name="Planning" component={PlanningScreen} />
          <Tab.Screen name="Livrables" component={LivrablesScreen} />
          <Tab.Screen name="Devis" component={DevisListScreen} />
          <Tab.Screen name="Notifications" component={NotificationsScreen} />
        </>
      ) : (
        <>
          <Tab.Screen name="Planning" component={PlanningScreen} />
          <Tab.Screen name="Livrables" component={LivrablesScreen} />
          <Tab.Screen name="Notifications" component={NotificationsScreen} />
          <Tab.Screen name="Carte" component={CarteScreen} />
        </>
      )}
    </Tab.Navigator>
  )
}

const styles = StyleSheet.create({
  tabBarWrap: {
    paddingTop: 6,
    paddingHorizontal: 8,
    overflow: 'hidden',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  tabBarSurface: {
    backgroundColor: 'rgba(10,10,11,0.85)',
  },
  tabBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  tabIconWrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: '#EF4444',
    borderRadius: 7,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: fontWeight.bold,
  },
  tabLabel: {
    fontSize: fontSize.caption,
    letterSpacing: -0.1,
  },
})
