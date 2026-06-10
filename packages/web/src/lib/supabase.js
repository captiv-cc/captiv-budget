// ════════════════════════════════════════════════════════════════════════════
// supabase.js (web) — client Supabase pour @captiv/web
// ════════════════════════════════════════════════════════════════════════════
//
// Utilise la factory @captiv/shared/supabase pour bénéficier d'un comportement
// cohérent avec l'app mobile (@captiv/mobile). Côté web, on n'injecte pas de
// storage custom : Supabase utilise localStorage par défaut.
//
// Variables d'environnement attendues (cf. .env.example) :
//   - VITE_SUPABASE_URL
//   - VITE_SUPABASE_ANON_KEY
//
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseClient } from '@captiv/shared/supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '⚠️  Variables Supabase manquantes — copiez .env.example en .env et remplissez les valeurs.',
  )
}

export const supabase = createSupabaseClient({
  url: supabaseUrl || 'https://placeholder.supabase.co',
  anonKey: supabaseKey || 'placeholder',
})
