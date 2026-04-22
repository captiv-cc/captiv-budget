// ════════════════════════════════════════════════════════════════════════════
// matosCheckToken.js — Helpers pour l'accès anonyme "checklist terrain" (MAT-10)
// ════════════════════════════════════════════════════════════════════════════
//
// Pendant les essais matériel, on partage une URL tokenisée `/check/:token`
// à toute l'équipe (cadreurs, DIT, loueur invité…) pour cocher chaque item
// en direct, sans que chacun ait à créer un compte CAPTIV.
//
// Architecture :
//   - Les tokens vivent dans `matos_check_tokens` (un token = un lien de
//     partage pour une version donnée). Les membres de l'org les créent,
//     listent, révoquent via RLS normale (can_read_outil / can_edit_outil).
//
//   - Côté anon, toutes les opérations passent par des fonctions RPC
//     SECURITY DEFINER qui valident le token puis opèrent avec les droits
//     du rôle qui a créé la fonction (donc bypass RLS pour le scope du
//     token uniquement). L'utilisateur anon ne se connecte jamais à
//     `matos_items` en direct ; il appelle `check_session_fetch(token)`,
//     `check_action_toggle(token, item_id, name)`, etc.
//
// Voir supabase/migrations/20260421_mat10_checklist_terrain.sql.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// 24 bytes → 32 chars en base64url. Aligné avec icalTokens.js.
const TOKEN_BYTES = 24

// ═══ Génération token ════════════════════════════════════════════════════════

/**
 * Génère un nouveau secret token (~32 chars base64url) via WebCrypto.
 * Le token est généré côté client — le serveur ne voit que le résultat final.
 */
export function generateCheckToken() {
  const cryptoObj = globalThis.crypto
  if (!cryptoObj?.getRandomValues) {
    throw new Error('WebCrypto indisponible : impossible de générer un token de checklist')
  }
  const bytes = new Uint8Array(TOKEN_BYTES)
  cryptoObj.getRandomValues(bytes)
  return base64urlEncode(bytes)
}

function base64urlEncode(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ═══ URL publique ════════════════════════════════════════════════════════════

/**
 * Construit l'URL complète de la route `/check/:token`, à partager par SMS,
 * WhatsApp, email, etc. Basée sur `window.location.origin` pour rester cohérent
 * entre dev/prod sans config supplémentaire.
 */
export function buildCheckUrl(token) {
  if (typeof window === 'undefined' || !token) return ''
  return `${window.location.origin}/check/${encodeURIComponent(token)}`
}

// ═══ CRUD matos_check_tokens (côté authenticated) ═══════════════════════════
//
// Ces fonctions sont appelées depuis l'UI autorisée (onglet Matériel > Gestion
// des tokens terrain). Elles passent par la table directement → RLS standard.

/**
 * Liste les tokens d'une version. `includeRevoked=true` par défaut pour
 * permettre l'audit dans l'UI de gestion ; passer `false` pour ne voir que
 * les liens actifs.
 */
export async function listCheckTokens({ versionId, includeRevoked = true } = {}) {
  if (!versionId) throw new Error('listCheckTokens : versionId requis')
  let query = supabase
    .from('matos_check_tokens')
    .select('id, token, version_id, label, created_by, created_at, revoked_at, expires_at, last_accessed_at')
    .eq('version_id', versionId)
    .order('created_at', { ascending: false })
  if (!includeRevoked) {
    query = query.is('revoked_at', null)
  }
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Crée un nouveau token pour une version. Le secret est généré localement
 * (crypto) ; on l'insère avec un label libre ("Équipe caméra", "Loueur Lux"…)
 * et une date d'expiration optionnelle.
 */
export async function createCheckToken({ versionId, label = null, expiresAt = null }) {
  if (!versionId) throw new Error('createCheckToken : versionId requis')

  const token = generateCheckToken()
  const payload = {
    token,
    version_id: versionId,
    label: label?.trim() || null,
    expires_at: expiresAt || null,
  }

  const { data, error } = await supabase
    .from('matos_check_tokens')
    .insert([payload])
    .select('id, token, version_id, label, created_by, created_at, revoked_at, expires_at, last_accessed_at')
    .single()
  if (error) throw error
  return data
}

/**
 * Révoque un token (soft : `revoked_at = now()`, la ligne reste pour l'audit).
 * Idempotent : réappeler ne re-touche pas la date si déjà révoqué.
 */
export async function revokeCheckToken(tokenId) {
  const { error } = await supabase.rpc('revoke_matos_check_token', { p_token_id: tokenId })
  if (error) throw error
}

/** Restaure un token révoqué (efface `revoked_at`). */
export async function restoreCheckToken(tokenId) {
  const { error } = await supabase
    .from('matos_check_tokens')
    .update({ revoked_at: null })
    .eq('id', tokenId)
  if (error) throw error
}

/** Rename un token (édition du label). */
export async function renameCheckToken(tokenId, newLabel) {
  const { error } = await supabase
    .from('matos_check_tokens')
    .update({ label: (newLabel || '').trim() || null })
    .eq('id', tokenId)
  if (error) throw error
}

// ═══ RPC anon : consommation du token ═══════════════════════════════════════
//
// Appelées depuis la route publique `/check/:token` (utilisateur anon ou
// authentifié, peu importe — le token fait foi). Toutes passent par des
// fonctions SECURITY DEFINER qui valident le token + maj last_accessed_at.

/**
 * Charge le bundle complet pour un token : version + projet + blocs + items +
 * loueurs + pivots + commentaires + pièces jointes. Retourne l'objet JSONB
 * renvoyé par la RPC `check_session_fetch`.
 *
 * Shape retournée — toutes les clés sont en snake_case, strictement alignées
 * avec la RPC `check_session_fetch` (cf. migration MAT-10J / MAT-10N). Ne PAS
 * camelCaser côté client : le hook useCheckTokenSession lit directement ces
 * clés. Un ancien bug (itemLoueurs vs item_loueurs) faisait disparaître les
 * pastilles loueur — respecter le shape serveur évite de recasser ça.
 *
 *   {
 *     version:      { id, project_id, numero, label, notes, is_active },
 *     project:      { id, title, ref_projet },
 *     blocks:       [ { id, titre, couleur, affichage, sort_order } ],
 *     items:        [ { id, block_id, materiel_bdd_id, label, designation,
 *                       quantite, remarques, flag, pre_check_at, pre_check_by,
 *                       pre_check_by_name, added_during_check, added_by,
 *                       added_by_name, added_at, removed_at, removed_by_name,
 *                       removed_reason, sort_order } ],
 *     loueurs:      [ { id, nom, couleur } ],
 *     item_loueurs: [ { id, item_id, loueur_id, numero_reference, sort_order } ],
 *     comments:     [ { id, item_id, body, author_id, author_name, created_at } ],
 *     attachments:  [ { id, version_id, title, filename, storage_path,
 *                       size_bytes, mime_type, uploaded_by_name, created_at } ],
 *   }
 *
 * Lève une erreur si le token est inconnu, révoqué ou expiré.
 */
export async function fetchCheckSession(token) {
  if (!token) throw new Error('fetchCheckSession : token requis')
  const { data, error } = await supabase.rpc('check_session_fetch', { p_token: token })
  if (error) throw error
  if (!data) throw new Error('Token invalide ou révoqué')
  return data
}

/**
 * Toggle le pre_check sur un item. Si le user n'était pas coché → on le
 * coche avec son nom ; sinon on décoche. Le nom est obligatoire pour tracer
 * qui a fait quoi (sert aussi pour l'UI "coché par Camille").
 */
export async function toggleCheck({ token, itemId, userName }) {
  if (!token || !itemId) throw new Error('toggleCheck : token + itemId requis')
  if (!userName?.trim()) throw new Error('toggleCheck : userName requis')
  const { data, error } = await supabase.rpc('check_action_toggle', {
    p_token: token,
    p_item_id: itemId,
    p_user_name: userName.trim(),
  })
  if (error) throw error
  return data // ligne matos_items mise à jour
}

/**
 * Ajoute un "additif" (item ajouté pendant les essais) à un bloc. Les items
 * ajoutés sont taggués `added_during_check=true` et apparaissent séparément
 * dans l'UI, avec leur auteur ("Ajouté par Camille à 14h23").
 *
 * MAT-19 : `loueurId` optionnel. Si fourni, la RPC insère aussi la ligne pivot
 * `matos_item_loueurs` dans la même transaction, pour que l'additif apparaisse
 * directement dans le récap du bon loueur (sinon il tombe dans "Non assigné").
 *
 * Retour : `{ id: uuid, item_loueur_id: uuid|null, loueur_id: uuid|null }`
 */
export async function addCheckItem({
  token,
  blockId,
  designation,
  quantite = 1,
  userName,
  loueurId = null,
}) {
  if (!token || !blockId) throw new Error('addCheckItem : token + blockId requis')
  if (!designation?.trim()) throw new Error('addCheckItem : désignation requise')
  if (!userName?.trim()) throw new Error('addCheckItem : userName requis')
  const { data, error } = await supabase.rpc('check_action_add_item', {
    p_token: token,
    p_block_id: blockId,
    p_designation: designation.trim(),
    p_quantite: quantite,
    p_user_name: userName.trim(),
    p_loueur_id: loueurId || null,
  })
  if (error) throw error
  return data // { id, item_loueur_id, loueur_id }
}

/**
 * Ajoute un commentaire sur un item (thread append-only). Les commentaires
 * sont affichés dans l'ordre chronologique sous l'item, avec l'auteur.
 */
export async function addCheckComment({ token, itemId, body, userName }) {
  if (!token || !itemId) throw new Error('addCheckComment : token + itemId requis')
  if (!body?.trim()) throw new Error('addCheckComment : corps du message requis')
  if (!userName?.trim()) throw new Error('addCheckComment : userName requis')
  const { data, error } = await supabase.rpc('check_action_add_comment', {
    p_token: token,
    p_item_id: itemId,
    p_body: body.trim(),
    p_user_name: userName.trim(),
  })
  if (error) throw error
  return data // ligne matos_item_comments créée
}

/**
 * Change le flag de statut d'un item (ok | attention | probleme | null).
 * `flag=null` réinitialise (retour à l'état neutre).
 */
export async function setCheckFlag({ token, itemId, flag }) {
  if (!token || !itemId) throw new Error('setCheckFlag : token + itemId requis')
  const validFlags = [null, 'ok', 'attention', 'probleme']
  if (!validFlags.includes(flag)) {
    throw new Error(`setCheckFlag : flag invalide (${flag})`)
  }
  const { data, error } = await supabase.rpc('check_action_set_flag', {
    p_token: token,
    p_item_id: itemId,
    p_flag: flag,
  })
  if (error) throw error
  return data // ligne matos_items mise à jour
}

/**
 * Marque un item comme "retiré du tournage" (soft, toggle). Si `removed=true`,
 * l'item reste en base mais est exclu du rendu loueur (MAT-13) et affiché
 * barré dans la checklist. Si `removed=false`, on réactive l'item.
 *
 * Le `reason` est facultatif (ex. "cam remplacée par PLV80", "défaut optique").
 * Le `userName` est obligatoire car c'est lui qui signe le retrait dans le bilan.
 *
 * RPC : check_action_set_removed(token, item_id, removed, reason, user_name)
 * Retour : { item_id, removed_at, removed_by_name, removed_reason }
 */
export async function setItemRemoved({ token, itemId, removed, reason = null, userName }) {
  if (!token || !itemId) throw new Error('setItemRemoved : token + itemId requis')
  if (typeof removed !== 'boolean') {
    throw new Error('setItemRemoved : removed doit être un boolean')
  }
  if (removed && !userName?.trim()) {
    throw new Error('setItemRemoved : userName requis pour retirer un item')
  }
  const { data, error } = await supabase.rpc('check_action_set_removed', {
    p_token: token,
    p_item_id: itemId,
    p_removed: removed,
    p_reason: (reason || '').trim() || null,
    p_user_name: (userName || '').trim() || null,
  })
  if (error) throw error
  return data
}

/**
 * Supprime définitivement un additif (hard DELETE). Réservé aux items
 * `added_during_check=true` ; la RPC lève une exception sinon. Pour les
 * items de la liste d'origine, utiliser `setItemRemoved({ removed: true })`.
 *
 * Utilité : corriger une erreur de saisie pendant les essais (on a ajouté
 * "Bras magqiue" à la place de "Bras magique"). Le soft-remove laisserait
 * la ligne fautive dans le bilan.
 *
 * RPC : check_action_delete_additif(token, item_id)
 * Retour : { item_id, deleted: true }
 */
export async function deleteCheckAdditif({ token, itemId }) {
  if (!token || !itemId) throw new Error('deleteCheckAdditif : token + itemId requis')
  const { data, error } = await supabase.rpc('check_action_delete_additif', {
    p_token: token,
    p_item_id: itemId,
  })
  if (error) throw error
  return data
}

// ═══ Nom utilisateur anon (localStorage) ═════════════════════════════════════
//
// L'utilisateur anon tape son prénom à la première ouverture du lien ; on le
// stocke en localStorage pour ne pas le redemander à chaque tap. La clé est
// scopée par token pour permettre à plusieurs personnes de partager un même
// appareil sans écraser leur identité (cas rare mais possible : tablette
// prêtée sur le plateau).

const USER_NAME_PREFIX = 'matos.check.username:'

/**
 * Lit le nom enregistré pour un token donné, ou null si jamais défini.
 * Retourne null côté SSR (pas de window).
 */
export function getCheckUserName(token) {
  if (typeof window === 'undefined' || !token) return null
  try {
    return window.localStorage.getItem(USER_NAME_PREFIX + token) || null
  } catch {
    return null
  }
}

/**
 * Enregistre le nom pour un token. Passer `null` ou une chaîne vide pour
 * effacer (on passe par removeItem plutôt que stocker "").
 */
export function setCheckUserName(token, userName) {
  if (typeof window === 'undefined' || !token) return
  try {
    const trimmed = (userName || '').trim()
    if (trimmed) {
      window.localStorage.setItem(USER_NAME_PREFIX + token, trimmed)
    } else {
      window.localStorage.removeItem(USER_NAME_PREFIX + token)
    }
  } catch {
    // ignore
  }
}
