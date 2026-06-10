// ════════════════════════════════════════════════════════════════════════════
// createSupabaseClient — factory client Supabase agnostique web/mobile
// ════════════════════════════════════════════════════════════════════════════
//
// Le client Supabase a besoin d'un mécanisme de persistence de la session
// (auth token). Sur le web c'est localStorage par défaut. Sur mobile on veut
// expo-secure-store (Keychain iOS / EncryptedSharedPreferences Android).
//
// Cette factory expose un paramètre `storage` pour que chaque package injecte
// sa propre stratégie. Si rien n'est fourni → default Supabase (localStorage).
//
// Usage côté @captiv/web :
//   import { createSupabaseClient } from '@captiv/shared/supabase'
//   export const supabase = createSupabaseClient({
//     url: import.meta.env.VITE_SUPABASE_URL,
//     anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
//   })
//
// Usage côté @captiv/mobile :
//   import { createSupabaseClient } from '@captiv/shared/supabase'
//   import * as SecureStore from 'expo-secure-store'
//   export const supabase = createSupabaseClient({
//     url: process.env.EXPO_PUBLIC_SUPABASE_URL,
//     anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
//     storage: {
//       getItem: SecureStore.getItemAsync,
//       setItem: SecureStore.setItemAsync,
//       removeItem: SecureStore.deleteItemAsync,
//     },
//   })
//
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

/**
 * Crée un client Supabase configuré pour web ou mobile.
 *
 * @param {Object} opts
 * @param {string} opts.url - URL Supabase (https://xxx.supabase.co)
 * @param {string} opts.anonKey - Anon key publique
 * @param {Object} [opts.storage] - Custom storage adapter (SecureStore côté mobile)
 * @param {boolean} [opts.detectSessionInUrl] - true pour le web (OAuth redirect), false pour mobile
 * @param {boolean} [opts.persistSession] - défaut true
 * @param {boolean} [opts.autoRefreshToken] - défaut true
 * @returns Supabase client
 */
export function createSupabaseClient({
  url,
  anonKey,
  storage,
  detectSessionInUrl = true,
  persistSession = true,
  autoRefreshToken = true,
} = {}) {
  if (!url || !anonKey) {
    throw new Error(
      '[@captiv/shared] createSupabaseClient: url et anonKey sont requis. ' +
        'Vérifie tes variables d\'environnement (VITE_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL).',
    )
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession,
      autoRefreshToken,
      detectSessionInUrl,
      ...(storage ? { storage } : {}),
    },
  })
}
