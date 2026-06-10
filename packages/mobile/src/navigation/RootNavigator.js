// ════════════════════════════════════════════════════════════════════════════
// RootNavigator — switch entre AuthStack et MainTabs selon session
// ════════════════════════════════════════════════════════════════════════════

import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { NavigationContainer, DarkTheme } from '@react-navigation/native'

import { useAuth } from '../lib/AuthContext'
import { colors } from '../theme'

import AuthStack from './AuthStack'
import MainTabs from './MainTabs'

const NavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.glass.border,
    primary: colors.brand.blue,
  },
}

export default function RootNavigator() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.brand.blue} />
      </View>
    )
  }

  return (
    <NavigationContainer theme={NavTheme}>
      {session ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
})
