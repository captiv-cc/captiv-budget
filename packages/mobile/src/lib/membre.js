// ════════════════════════════════════════════════════════════════════════════
// membre — résolution user (auth) → projet_membres
// ════════════════════════════════════════════════════════════════════════════
//
// Il n'existe pas de lien direct profiles → projet_membres. La chaîne est :
//   profiles.id (auth.uid)  ←  contacts.user_id  →  contacts.id
//      →  projet_membres.contact_id  →  projet_membres.id
//
// Ces helpers font le pont, utilisés par les hooks Planning / Créneau.
//
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

/**
 * Mon projet_membres.id pour un projet donné (ou null).
 */
export async function fetchMonMembreId(userId, projetId) {
  if (!userId || !projetId) return null
  const { data, error } = await supabase
    .from('projet_membres')
    .select('id, contacts!inner(user_id)')
    .eq('project_id', projetId)
    .eq('contacts.user_id', userId)
    .is('parent_membre_id', null)
  if (error) throw error // réseau/RLS → laisse le hook garder son cache
  return data?.[0]?.id ?? null
}

/**
 * Tous mes projet_membres (tous projets) : [{ membre_id, project_id }].
 */
export async function fetchMesMembres(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('projet_membres')
    .select('id, project_id, contacts!inner(user_id)')
    .eq('contacts.user_id', userId)
    .is('parent_membre_id', null)
  if (error) throw error // réseau/RLS → laisse le hook garder son cache
  return (data ?? []).map((m) => ({ membre_id: m.id, project_id: m.project_id }))
}
