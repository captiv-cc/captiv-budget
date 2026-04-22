// ════════════════════════════════════════════════════════════════════════════
// matosCheckAuthed.js — Helpers pour le mode chantier authentifié (MAT-14)
// ════════════════════════════════════════════════════════════════════════════
//
// Pendant les essais, un membre interne CAPTIV peut aussi ouvrir la checklist
// terrain *sans* passer par un token jetable. On utilise son identité Supabase
// (auth.uid() + profiles.full_name) pour tracer les actions et peupler la
// présence temps-réel.
//
// Architecture :
//   - Route `/projets/:id/materiel/check/:versionId?` (authenticated)
//   - Chaque action passe par une RPC SECURITY DEFINER gated par
//     `can_read_outil('materiel')` / `can_edit_outil('materiel')`
//   - Les RPC lisent `auth.uid()` → `profiles.full_name` pour l'attribution
//     (pas besoin de passer explicitement un userName côté client).
//
// Miroir strict de matosCheckToken.js pour l'UI (shape identique des retours
// RPC), mais indexé par `versionId` au lieu de `token`, et jamais de
// localStorage (l'identité est portée par la session Supabase).
//
// Voir supabase/migrations/20260422_mat14_authed_check_session.sql.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// ═══ RPC authed : chargement du bundle session ══════════════════════════════

/**
 * Charge le bundle complet d'une version pour l'utilisateur authentifié.
 * Gate serveur : `can_read_outil(project_id, 'materiel')`. Si l'utilisateur
 * n'a pas le droit, la RPC lève une exception (mapped ici en `error`).
 *
 * Shape retournée : STRICTEMENT identique à `fetchCheckSession(token)` dans
 * matosCheckToken.js — c'est le même builder `_check_fetch_bundle(version_id)`
 * côté SQL. Ne pas re-casser : le hook useCheckAuthedSession lit les mêmes
 * clés en snake_case (item_loueurs, pre_check_by_name, etc.).
 */
export async function fetchCheckSessionAuthed(versionId) {
  if (!versionId) throw new Error('fetchCheckSessionAuthed : versionId requis')
  const { data, error } = await supabase.rpc('check_session_fetch_authed', {
    p_version_id: versionId,
  })
  if (error) throw error
  if (!data) throw new Error('Version introuvable ou accès refusé')
  return data
}

// ═══ RPC authed : actions ═══════════════════════════════════════════════════

/**
 * Toggle le pre_check d'un item. Côté serveur, `auth.uid()` est utilisé pour
 * `pre_check_by` et `profiles.full_name` pour `pre_check_by_name` — pas besoin
 * de passer userName ici.
 *
 * Retour identique à `toggleCheck` côté token : `{ item_id, pre_check_at,
 * pre_check_by, pre_check_by_name, … }`.
 */
export async function toggleCheckAuthed({ itemId }) {
  if (!itemId) throw new Error('toggleCheckAuthed : itemId requis')
  const { data, error } = await supabase.rpc('check_action_toggle_authed', {
    p_item_id: itemId,
  })
  if (error) throw error
  return data
}

/**
 * Ajoute un additif à un bloc en mode authenticated. L'identité est dérivée de
 * `auth.uid()` serveur-side — on ne passe jamais de userName ici.
 */
export async function addCheckItemAuthed({ blockId, designation, quantite = 1 }) {
  if (!blockId) throw new Error('addCheckItemAuthed : blockId requis')
  if (!designation?.trim()) throw new Error('addCheckItemAuthed : désignation requise')
  const { data, error } = await supabase.rpc('check_action_add_item_authed', {
    p_block_id: blockId,
    p_designation: designation.trim(),
    p_quantite: quantite,
  })
  if (error) throw error
  return data
}

/**
 * Ajoute un commentaire sur un item. `author_id` = auth.uid(), `author_name`
 * = profiles.full_name. Retour identique au chemin token.
 */
export async function addCheckCommentAuthed({ itemId, body }) {
  if (!itemId) throw new Error('addCheckCommentAuthed : itemId requis')
  if (!body?.trim()) throw new Error('addCheckCommentAuthed : corps du message requis')
  const { data, error } = await supabase.rpc('check_action_add_comment_authed', {
    p_item_id: itemId,
    p_body: body.trim(),
  })
  if (error) throw error
  return data
}

/** Change le flag de statut d'un item (ok | attention | probleme | null). */
export async function setCheckFlagAuthed({ itemId, flag }) {
  if (!itemId) throw new Error('setCheckFlagAuthed : itemId requis')
  const validFlags = [null, 'ok', 'attention', 'probleme']
  if (!validFlags.includes(flag)) {
    throw new Error(`setCheckFlagAuthed : flag invalide (${flag})`)
  }
  const { data, error } = await supabase.rpc('check_action_set_flag_authed', {
    p_item_id: itemId,
    p_flag: flag,
  })
  if (error) throw error
  return data
}

/**
 * Marque un item comme "retiré du tournage" (soft, toggle). `removed_by_name`
 * provient de profiles.full_name côté serveur (pas de paramètre userName).
 */
export async function setItemRemovedAuthed({ itemId, removed, reason = null }) {
  if (!itemId) throw new Error('setItemRemovedAuthed : itemId requis')
  if (typeof removed !== 'boolean') {
    throw new Error('setItemRemovedAuthed : removed doit être un boolean')
  }
  const { data, error } = await supabase.rpc('check_action_set_removed_authed', {
    p_item_id: itemId,
    p_removed: removed,
    p_reason: (reason || '').trim() || null,
  })
  if (error) throw error
  return data
}

/**
 * Supprime définitivement un additif (hard DELETE). Réservé aux items
 * `added_during_check=true` — la RPC lève sinon.
 */
export async function deleteCheckAdditifAuthed({ itemId }) {
  if (!itemId) throw new Error('deleteCheckAdditifAuthed : itemId requis')
  const { data, error } = await supabase.rpc('check_action_delete_additif_authed', {
    p_item_id: itemId,
  })
  if (error) throw error
  return data
}

// ═══ RPC authed : clôture essais ════════════════════════════════════════════

/**
 * Clôture les essais en mode authenticated (sans token). `closed_by` =
 * auth.uid(), `closed_by_name` = profiles.full_name côté serveur.
 *
 * Shape payload aligné sur `check_action_close_essais` (chemin token) :
 *   { version_id, closed_at, closed_by_name, bilan_archive_path, attachment_id }
 *
 * @param {object} opts
 * @param {string} opts.versionId
 * @param {string} opts.archivePath     — path Storage ZIP (upload préalable)
 * @param {string} opts.archiveFilename — nom lisible du ZIP
 * @param {number} opts.archiveSize     — taille en octets
 * @param {string} [opts.archiveMime]   — defaults to 'application/zip'
 */
export async function closeCheckEssaisAuthed({
  versionId,
  archivePath,
  archiveFilename,
  archiveSize,
  archiveMime = 'application/zip',
}) {
  if (!versionId) throw new Error('closeCheckEssaisAuthed : versionId requis')
  if (!archivePath) throw new Error('closeCheckEssaisAuthed : archivePath requis')
  const { data, error } = await supabase.rpc('check_action_close_essais_authed', {
    p_version_id: versionId,
    p_archive_path: archivePath,
    p_archive_filename: archiveFilename || 'bilan.zip',
    p_archive_size_bytes: archiveSize || 0,
    p_archive_mime: archiveMime,
  })
  if (error) throw error
  return data
}
