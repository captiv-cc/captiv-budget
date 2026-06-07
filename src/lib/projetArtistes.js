// ════════════════════════════════════════════════════════════════════════════
// projetArtistes.js — Helpers annuaire artistes du projet
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.6
//
// Annuaire unifié des artistes d'un projet festival, partagé entre les
// modules Déroulé et Musiques. Alimenté par 3 sources :
//   - 'affiche' : import IA d'une affiche festival (MUS-1.5)
//   - 'grille'  : import IA de la timetable festival (existant)
//   - 'manuel'  : saisie directe dans Déroulé ou Musiques
//
// Le matching de doublon repose sur `nom_normalise` (NFD + lowercase +
// retire ponctuation). Cohérence entre :
//   - La fonction normalizeNom() de ce fichier (utilisée à l'INSERT/UPDATE)
//   - L'algorithme de search côté picker (mêmes règles pour matcher)
//
// API publique :
//   - normalizeNom(nom)
//   - listArtistes(projectId, { search, limit })
//   - findByNomFlou(projectId, nom)
//   - upsertArtiste(projectId, payload)
//   - bulkUpsertFromAffiche(projectId, artistes[], opts)
//   - enrichWithSpotify(artisteId, spotifyData)
//   - deleteArtiste(artisteId)
//   - searchSuggestions(projectId, query, limit)
//
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// ─── 1. Normalisation du nom d'artiste ──────────────────────────────────────

/**
 * Normalise un nom d'artiste pour matching flou et déduplication.
 *
 * Règles :
 *   1. Trim + retire les espaces multiples
 *   2. NFD (décompose les diacritiques) + retire les diacritiques
 *   3. Lowercase
 *   4. Retire la ponctuation (garde lettres, chiffres, espace)
 *   5. Retire les "&" "et" "feat" "ft" "vs" qui parasitent le matching
 *      (optionnel — la version actuelle GARDE ces mots pour rester proche
 *      de l'intention de l'utilisateur)
 *
 * Exemples :
 *   "Charlotte de Witte"   → "charlotte de witte"
 *   "Bigflo & Oli"         → "bigflo & oli" (le & est retiré comme ponct)
 *   "MØDE"                 → "mode"
 *   "BU$HI"                → "bu hi"   ← le $ tombe
 *   "Tiesto - Hot In It"   → "tiesto hot in it"
 *
 * @param {string} nom
 * @returns {string}
 */
export function normalizeNom(nom) {
  if (typeof nom !== 'string') return ''
  return nom
    .normalize('NFD')                  // décompose accents
    .replace(/[̀-ͯ]/g, '')   // retire diacritiques
    .replace(/Ø/g, 'O')                // O barré → O (NFD ne le décompose pas)
    .replace(/ø/g, 'o')
    .replace(/[$£€]/g, '')             // signes monétaires
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')      // ne garde que alphanumérique + espaces
    .replace(/\s+/g, ' ')              // condense les espaces
    .trim()
}

// ─── 2. Lecture de l'annuaire ──────────────────────────────────────────────

/**
 * Liste tous les artistes de l'annuaire d'un projet.
 *
 * @param {string} projectId
 * @param {object} [opts]
 * @param {string} [opts.search] Filtre LIKE sur nom_normalise (typeahead)
 * @param {number} [opts.limit] Limite (par défaut 500, pas de pagination MVP1)
 * @returns {Promise<Array<object>>}
 */
export async function listArtistes(projectId, opts = {}) {
  const { search = null, limit = 500 } = opts
  let q = supabase
    .from('projet_artistes')
    .select('*')
    .eq('project_id', projectId)
    .order('headliner', { ascending: false })
    .order('nom', { ascending: true })
    .limit(limit)
  if (search && search.trim()) {
    const normalized = normalizeNom(search)
    if (normalized) {
      // ILIKE sur nom_normalise — Postgres traite ça avec l'index UNIQUE
      // composite (project_id, nom_normalise) pour les requêtes par préfixe.
      q = q.ilike('nom_normalise', `${normalized}%`)
    }
  }
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Recherche un artiste par matching flou exact sur nom_normalise.
 * Renvoie le row si trouvé, null sinon.
 *
 * @param {string} projectId
 * @param {string} nom
 * @returns {Promise<object|null>}
 */
export async function findByNomFlou(projectId, nom) {
  const normalized = normalizeNom(nom)
  if (!normalized) return null
  const { data, error } = await supabase
    .from('projet_artistes')
    .select('*')
    .eq('project_id', projectId)
    .eq('nom_normalise', normalized)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data || null
}

/**
 * Suggestions pour picker artiste (typeahead). Combine matching exact
 * et matching par préfixe, dédupliqué.
 *
 * @param {string} projectId
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {Promise<Array<object>>}
 */
export async function searchSuggestions(projectId, query, limit = 10) {
  const normalized = normalizeNom(query || '')
  if (!normalized) {
    // Pas de query → liste les headliners en premier
    return listArtistes(projectId, { limit })
  }
  const { data, error } = await supabase
    .from('projet_artistes')
    .select('*')
    .eq('project_id', projectId)
    .ilike('nom_normalise', `%${normalized}%`)
    .order('headliner', { ascending: false })
    .order('nom', { ascending: true })
    .limit(limit)
  if (error) throw error
  return data || []
}

// ─── 3. Écriture / upsert ──────────────────────────────────────────────────

/**
 * UPSERT un artiste dans l'annuaire. Si un artiste avec le même
 * nom_normalise existe déjà sur ce projet, on UPDATE les champs fournis
 * (sans effacer les champs absents du payload).
 *
 * Priorité d'enrichissement entre sources :
 *   manuel  : remplace toujours (saisie utilisateur explicite)
 *   grille  : remplace si row.source = 'affiche' (grille = plus précis)
 *   affiche : ne remplace pas si row.source = 'grille' ou 'manuel'
 *
 * @param {string} projectId
 * @param {object} payload
 * @param {string} payload.nom (obligatoire)
 * @param {string} [payload.jour]
 * @param {string} [payload.scene]
 * @param {boolean} [payload.headliner]
 * @param {string} payload.source (obligatoire, 'affiche'|'grille'|'manuel')
 * @param {string} [payload.spotify_artist_id]
 * @param {object} [payload.metadata]
 * @returns {Promise<object>} L'artiste créé/updated
 */
export async function upsertArtiste(projectId, payload) {
  if (!payload?.nom?.trim()) {
    throw new Error('nom requis')
  }
  if (!['affiche', 'grille', 'manuel'].includes(payload.source)) {
    throw new Error(`source invalide : ${payload.source}`)
  }
  const nom = payload.nom.trim()
  const nom_normalise = normalizeNom(nom)
  // Cherche un existant
  const existing = await findByNomFlou(projectId, nom)
  if (!existing) {
    // INSERT
    const { data, error } = await supabase
      .from('projet_artistes')
      .insert({
        project_id: projectId,
        nom,
        nom_normalise,
        jour: payload.jour || null,
        scene: payload.scene || null,
        headliner: Boolean(payload.headliner),
        source: payload.source,
        spotify_artist_id: payload.spotify_artist_id || null,
        metadata: payload.metadata || {},
      })
      .select('*')
      .single()
    if (error) throw error
    return data
  }
  // UPDATE avec priorité source
  const sourcePriority = { manuel: 3, grille: 2, affiche: 1 }
  const incomingPrio = sourcePriority[payload.source] || 0
  const existingPrio = sourcePriority[existing.source] || 0
  // Champs sensibles à la priorité : jour, scene, headliner
  // Champs toujours patchables : spotify_artist_id, metadata (enrichissement)
  const patch = {}
  if (incomingPrio >= existingPrio) {
    if (payload.jour !== undefined) patch.jour = payload.jour || null
    if (payload.scene !== undefined) patch.scene = payload.scene || null
    if (payload.headliner !== undefined) patch.headliner = Boolean(payload.headliner)
    // Le source peut monter en priorité mais pas descendre (un manuel
    // qui se fait réécrire par un affiche garde son tag manuel).
    if (incomingPrio > existingPrio) patch.source = payload.source
  }
  if (payload.spotify_artist_id !== undefined) {
    patch.spotify_artist_id = payload.spotify_artist_id || null
  }
  if (payload.metadata !== undefined) {
    patch.metadata = { ...existing.metadata, ...payload.metadata }
  }
  if (Object.keys(patch).length === 0) {
    // Rien à patcher → renvoie l'existant tel quel
    return existing
  }
  const { data, error } = await supabase
    .from('projet_artistes')
    .update(patch)
    .eq('id', existing.id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Bulk upsert pour l'import affiche IA. Itère sur la liste d'artistes
 * extraits et appelle upsertArtiste pour chacun avec source='affiche'.
 *
 * @param {string} projectId
 * @param {Array<{nom: string, jour?: string, scene?: string, headliner?: boolean}>} artistes
 * @param {object} [opts]
 * @param {string} [opts.source='affiche'] Permet de réutiliser pour 'grille'
 * @returns {Promise<{ created: number, updated: number, errors: Array }>}
 */
export async function bulkUpsertFromAffiche(projectId, artistes, opts = {}) {
  const source = opts.source || 'affiche'
  let created = 0
  let updated = 0
  const errors = []
  // Sequentiel : volume faible (50-100 artistes max), pas de bénéfice à
  // paralléliser, et on évite les races sur upsert flou.
  for (const a of artistes || []) {
    if (!a?.nom?.trim()) continue
    try {
      const existing = await findByNomFlou(projectId, a.nom)
      await upsertArtiste(projectId, { ...a, source })
      if (existing) updated += 1
      else created += 1
    } catch (e) {
      errors.push({ nom: a.nom, error: e.message || String(e) })
    }
  }
  return { created, updated, errors }
}

/**
 * Enrichit un artiste existant avec son ID Spotify (après lookup).
 * Patch direct sans logique de priorité (les IDs Spotify sont
 * universels, on ne risque pas d'overwrite à tort).
 */
export async function enrichWithSpotify(artisteId, { spotify_artist_id, metadata }) {
  const patch = {}
  if (spotify_artist_id !== undefined) patch.spotify_artist_id = spotify_artist_id
  if (metadata !== undefined) patch.metadata = metadata
  const { data, error } = await supabase
    .from('projet_artistes')
    .update(patch)
    .eq('id', artisteId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime un artiste de l'annuaire. La FK sur projet_deroule_creneaux et
 * projet_musique_propositions a ON DELETE SET NULL, donc les rows liées
 * restent (juste artiste_id devient null).
 */
export async function deleteArtiste(artisteId) {
  const { error } = await supabase
    .from('projet_artistes')
    .delete()
    .eq('id', artisteId)
  if (error) throw error
}
