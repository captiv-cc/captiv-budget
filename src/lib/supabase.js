import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '⚠️  Variables Supabase manquantes — copiez .env.example en .env et remplissez les valeurs.',
  )
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '')
