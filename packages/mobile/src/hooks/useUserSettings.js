// ════════════════════════════════════════════════════════════════════════════
// useUserSettings — lecture + écriture user_settings (Supabase)
// ════════════════════════════════════════════════════════════════════════════
//
// CRUD simple sur la table user_settings. Auto-create avec valeurs par défaut
// si la ligne n'existe pas encore.
//
// Utilisation :
//   const { settings, update, loading } = useUserSettings()
//   update({ rappel_delai_min: 30 })
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { DELAI_RAPPEL_DEFAUT } from '@captiv/shared'

const DEFAULT_SETTINGS = {
  push_enabled: true,
  rappel_delai_min: DELAI_RAPPEL_DEFAUT,
  language: 'fr',
  theme: 'auto',
}

export function useUserSettings() {
  const { user } = useAuth()
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)

  // Charger
  useEffect(() => {
    if (!user?.id) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (cancelled) return
      if (error) {
        // eslint-disable-next-line no-console
        console.warn('[useUserSettings] fetch error', error.message)
        setLoading(false)
        return
      }
      if (data) {
        setSettings({ ...DEFAULT_SETTINGS, ...data })
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  // Update (upsert avec onConflict user_id)
  const update = useCallback(
    async (patch) => {
      if (!user?.id) return
      const next = { ...settings, ...patch, user_id: user.id }
      setSettings(next) // optimistic
      const { error } = await supabase.from('user_settings').upsert(next, {
        onConflict: 'user_id',
      })
      if (error) {
        // eslint-disable-next-line no-console
        console.warn('[useUserSettings] update error', error.message)
        // TODO: rollback optimistic ?
      }
    },
    [user?.id, settings],
  )

  return { settings, update, loading }
}
