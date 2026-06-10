// ════════════════════════════════════════════════════════════════════════════
// @captiv/shared — point d'entrée principal
// ════════════════════════════════════════════════════════════════════════════
//
// Code partagé entre @captiv/web (Vite/React) et @captiv/mobile (Expo/RN).
//
// Règles d'or :
// - JavaScript ESM uniquement (compatible web + mobile)
// - Aucune dépendance browser-only (pas de window, document, localStorage direct…)
// - Aucune dépendance React Native (pas de import 'react-native')
// - Si un helper a besoin d'un environnement spécifique → expose un paramètre
//   (factory pattern) pour que chaque côté injecte sa stratégie.
//
// ════════════════════════════════════════════════════════════════════════════

// Supabase factory
export { createSupabaseClient } from './supabase.js'

// Constantes domaine
export * from './constants/statuts.js'
export * from './constants/rappels.js'

// Helpers purs
export * from './lib/dateFormat.js'
export * from './lib/format.js'

// Design tokens (utiles côté mobile principalement, mais le web pourrait s'en servir)
export * as tokens from './theme/tokens.js'
