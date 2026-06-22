// ════════════════════════════════════════════════════════════════════════════
// useDevisHistory — journal d'audit d'un devis (R4)
// ════════════════════════════════════════════════════════════════════════════
//
// Charge les dernières entrées de devis_audit (alimentées par le trigger
// SQL, cf. supabase/devis_audit.sql) et s'abonne en Realtime aux nouveaux
// events (INSERT) pour que le panneau Historique se mette à jour en direct
// quand quelqu'un (soi ou un autre éditeur) modifie le devis.
//
// `enabled` permet de ne charger qu'à l'ouverture du panneau (lazy).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const PAGE = 100

export function useDevisHistory({ devisId, enabled }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!devisId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('devis_audit')
      .select('*')
      .eq('devis_id', devisId)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (error) console.error('[useDevisHistory] load', error)
    setEntries(data || [])
    setLoading(false)
  }, [devisId])

  useEffect(() => {
    if (!enabled || !devisId) return
    load()
  }, [enabled, devisId, load])

  // Realtime : nouvelles entrées (INSERT only — un audit est immuable).
  useEffect(() => {
    if (!enabled || !devisId) return undefined
    const channel = supabase
      .channel(`devis-audit:${devisId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'devis_audit', filter: `devis_id=eq.${devisId}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          setEntries((prev) => (prev.some((e) => e.id === row.id) ? prev : [row, ...prev]))
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [enabled, devisId])

  return { entries, loading, reload: load }
}
