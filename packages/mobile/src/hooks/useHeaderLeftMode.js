// ════════════════════════════════════════════════════════════════════════════
// useHeaderLeftMode — burger sur les onglets, flèche retour sur les pages
// ════════════════════════════════════════════════════════════════════════════
//
// Certains écrans vivent dans les deux mondes (Livrables/Carte : onglet pour
// les externes, page poussée pour les internes). Le header doit proposer un
// vrai RETOUR quand l'écran est poussé — c'était le point « navigation floue »
// du premier test : toutes les pages affichaient le burger, sans retour.

import { useRoute } from '@react-navigation/native'

// Noms de routes de la tab bar (les deux jeux confondus)
const TAB_ROUTES = new Set([
  'Accueil',
  'Planning',
  'Livrables',
  'Devis',
  'Notifications',
  'Carte',
])

export function useHeaderLeftMode() {
  const route = useRoute()
  return TAB_ROUTES.has(route.name) ? 'menu' : 'back'
}
