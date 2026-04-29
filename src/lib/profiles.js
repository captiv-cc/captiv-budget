// ════════════════════════════════════════════════════════════════════════════
// profiles — helper minimal pour lister les profils d'une organisation
// ════════════════════════════════════════════════════════════════════════════
//
// Usage actuel : autocomplete monteur dans l'outil Livrables (LIV-15).
// Pourra servir à d'autres outils (assignations Étapes, mentions, etc.).
//
// La table `profiles` est gardée par RLS sur `org_id`, donc même si on ne
// passe pas explicitement l'org, l'utilisateur ne verra que les profils de
// son org. On reste néanmoins explicite côté requête (filtre `eq('org_id')`)
// pour pouvoir scope plus tard si on a un usage admin/cross-org.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

/**
 * Liste les profils membres d'une organisation.
 *
 * @param {Object} params
 * @param {string} params.orgId  - id de l'organisation (obligatoire)
 * @returns {Promise<Array<{ id, full_name, email, role, avatar_url }>>}
 */
export async function listOrgProfiles({ orgId }) {
  if (!orgId) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, avatar_url')
    .eq('org_id', orgId)
    .order('full_name', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Construit une `Map<id, profile>` indexée pour les lookups O(1).
 * @param {Array} profiles
 * @returns {Map<string, Object>}
 */
export function indexProfilesById(profiles = []) {
  const map = new Map()
  for (const p of profiles) {
    if (p?.id) map.set(p.id, p)
  }
  return map
}
