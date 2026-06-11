// ════════════════════════════════════════════════════════════════════════════
// MainStack — stack racine (tabs + pages projet poussées depuis le burger)
// ════════════════════════════════════════════════════════════════════════════

import { createNativeStackNavigator } from '@react-navigation/native-stack'

import MainTabs from './MainTabs'
import EquipeScreen from '../screens/EquipeScreen'
import InfosProjetScreen from '../screens/InfosProjetScreen'
import LogistiqueScreen from '../screens/LogistiqueScreen'
import MaterielScreen from '../screens/MaterielScreen'
import ProfilScreen from '../screens/ProfilScreen'

const Stack = createNativeStackNavigator()

export default function MainStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 280,
        gestureEnabled: true,
        contentStyle: { backgroundColor: '#0A0A0B' },
      }}
    >
      <Stack.Screen name="Tabs" component={MainTabs} options={{ animation: 'fade' }} />
      <Stack.Screen name="Equipe" component={EquipeScreen} />
      <Stack.Screen name="InfosProjet" component={InfosProjetScreen} />
      <Stack.Screen name="Logistique" component={LogistiqueScreen} />
      <Stack.Screen name="Materiel" component={MaterielScreen} />
      <Stack.Screen name="Profil" component={ProfilScreen} />
    </Stack.Navigator>
  )
}
