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
import CarteScreen from '../screens/CarteScreen'
import DevisEditorScreen from '../screens/DevisEditorScreen'

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
      {/* Pour les internes, la Carte n'est pas un onglet → page poussée.
          DevisEditor = éditeur natif d'une version de devis. */}
      <Stack.Screen name="CartePage" component={CarteScreen} />
      <Stack.Screen name="DevisEditor" component={DevisEditorScreen} />
    </Stack.Navigator>
  )
}
