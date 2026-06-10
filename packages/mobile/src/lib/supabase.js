// ════════════════════════════════════════════════════════════════════════════
// supabase.js (mobile) — client Supabase pour @captiv/mobile
// ════════════════════════════════════════════════════════════════════════════
//
// Utilise la factory @captiv/shared/supabase et injecte un storage adapter
// basé sur expo-secure-store (Keychain iOS / EncryptedSharedPreferences Android)
// pour persister la session de manière sécurisée.
//
// Pour les très gros tokens (>2KB sur iOS via Keychain) → fallback AsyncStorage.
// Supabase auth tokens font ~1.5KB donc on est ok avec SecureStore.
//
// ════════════════════════════════════════════════════════════════════════════

import * as SecureStore from 'expo-secure-store'
import { createSupabaseClient } from '@captiv/shared/supabase'

// Adapter SecureStore compatible avec l'API Storage de Supabase
const SecureStoreAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '⚠️  Variables Supabase manquantes — vérifie packages/mobile/.env (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY).',
  )
}

export const supabase = createSupabaseClient({
  url: supabaseUrl || 'https://placeholder.supabase.co',
  anonKey: supabaseAnonKey || 'placeholder',
  storage: SecureStoreAdapter,
  detectSessionInUrl: false, // false sur mobile (pas d'OAuth redirect via URL)
})
