// ════════════════════════════════════════════════════════════════════════════
// App.js — racine de l'app DESK Cadreur
// ════════════════════════════════════════════════════════════════════════════
//
// Stack de providers (de l'extérieur vers l'intérieur) :
//   1. GestureHandlerRootView   → nécessaire pour react-native-gesture-handler
//   2. SafeAreaProvider          → fournit useSafeAreaInsets()
//   3. QueryClientProvider       → React Query
//   4. AuthProvider              → état session Supabase
//   5. RootNavigator             → switch AuthStack / MainTabs selon session
//
// ════════════════════════════════════════════════════════════════════════════

import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { StatusBar } from 'expo-status-bar'

import { AuthProvider } from './src/lib/AuthContext'
import { queryClient } from './src/lib/queryClient'
import RootNavigator from './src/navigation/RootNavigator'

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0A0A0B' }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
