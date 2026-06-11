// ════════════════════════════════════════════════════════════════════════════
// creneauStatut — persistance du statut d'un créneau
// ════════════════════════════════════════════════════════════════════════════
//
// UPDATE direct (utilisateur authentifié). La RLS exige can_edit_outil(
// project_id, 'deroule') : admin / charge_prod / coordinateur OK, prestataire
// seulement avec la permission. Si la RLS refuse, l'UPDATE touche 0 ligne
// SANS erreur → on le détecte via .select() pour pouvoir revert côté UI.
//
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

export const STATUTS_CRENEAU = ['planifie', 'en_cours', 'fait', 'annule']

/**
 * Met à jour le statut d'un créneau.
 * @returns { ok: boolean, blocked: boolean, error?: Error }
 *   blocked = true si l'UPDATE a été refusé par la RLS (0 ligne, pas d'erreur).
 */
export async function setCreneauStatut(creneauId, statut) {
  if (!creneauId || !STATUTS_CRENEAU.includes(statut)) {
    return { ok: false, blocked: false, error: new Error('statut invalide') }
  }
  const { data, error } = await supabase
    .from('projet_deroule_creneaux')
    .update({ statut })
    .eq('id', creneauId)
    .select('id')

  if (error) return { ok: false, blocked: false, error }
  if (!data || data.length === 0) return { ok: false, blocked: true }
  return { ok: true, blocked: false }
}
