// ════════════════════════════════════════════════════════════════════════════
// devisHistorySeen — suivi "vu / non-vu" de l'historique devis, côté serveur
// ════════════════════════════════════════════════════════════════════════════
//
// Source de vérité : table devis_audit_seen (cf. supabase/devis_audit_seen.sql),
// une ligne par (user, devis) avec last_seen_at. Synchronisé entre appareils.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// Nb d'entrées d'audit faites par D'AUTRES depuis la dernière consultation.
export async function fetchUnseenCount(devisId, userId) {
  if (!devisId || !userId) return 0
  const { data: seen } = await supabase
    .from('devis_audit_seen')
    .select('last_seen_at')
    .eq('devis_id', devisId)
    .eq('user_id', userId)
    .maybeSingle()
  const lastSeen = seen?.last_seen_at || '1970-01-01T00:00:00Z'
  const { count, error } = await supabase
    .from('devis_audit')
    .select('id', { count: 'exact', head: true })
    .eq('devis_id', devisId)
    .neq('actor_id', userId)
    .gt('created_at', lastSeen)
  if (error) return 0
  return count || 0
}

// Marque l'historique comme lu maintenant (upsert sur la PK composite).
export async function markHistorySeen(devisId, userId) {
  if (!devisId || !userId) return
  await supabase
    .from('devis_audit_seen')
    .upsert(
      { user_id: userId, devis_id: devisId, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,devis_id' },
    )
}
