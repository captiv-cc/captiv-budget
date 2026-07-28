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
    .replace(/[$£€]/g, ' ')            // signes monétaires → espace
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
  // Champs sensibles à la priorité : jour, scene, headliner.
  // Règle (amendée 2026-07-28, bug Hugo) : la priorité protège les VALEURS
  // EXISTANTES, elle n'interdit pas de COMPLÉTER un champ vide. Cas réel :
  // import timetable d'abord (source 'grille', jour/scene null) puis
  // affiche (prio inférieure) qui connaît les jours → sans ça, le
  // ré-import disait « 88 mis à jour » sans rien écrire.
  const canOverwrite = incomingPrio >= existingPrio
  const patch = {}
  if (payload.jour !== undefined && payload.jour && (canOverwrite || !existing.jour)) {
    patch.jour = payload.jour
  } else if (payload.jour !== undefined && !payload.jour && canOverwrite) {
    patch.jour = null
  }
  if (payload.scene !== undefined && payload.scene && (canOverwrite || !existing.scene)) {
    patch.scene = payload.scene
  } else if (payload.scene !== undefined && !payload.scene && canOverwrite) {
    patch.scene = null
  }
  if (payload.headliner !== undefined) {
    if (canOverwrite) {
      patch.headliner = Boolean(payload.headliner)
    } else if (
      payload.headliner === true &&
      !existing.headliner &&
      existing.source !== 'manuel'
    ) {
      // Une source moins prioritaire peut PROMOUVOIR en headliner (info
      // typique de l'affiche), jamais rétrograder — et jamais contre une
      // décision manuelle.
      patch.headliner = true
    }
  }
  // Le source peut monter en priorité mais pas descendre (un manuel
  // qui se fait réécrire par un affiche garde son tag manuel).
  if (incomingPrio > existingPrio) patch.source = payload.source
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
 * Résout les artistes d'un import timetable (déroulé) vers l'annuaire partagé.
 * Pour chaque nom unique : upsert (source='grille' par défaut) — réutilise
 * l'artiste de l'affiche si le nom matche (fuzzy via nom_normalise), sinon le
 * crée. Renvoie une Map(nom_normalisé → artiste row) pour poser artiste_id sur
 * les créneaux. Le matching dédupliqué évite N upserts pour un même artiste.
 *
 * @param {string} projectId
 * @param {Array<{titre?: string, nom?: string}>} items shows extraits (titre = nom artiste)
 * @param {object} [opts]
 * @param {string} [opts.source='grille']
 * @returns {Promise<Map<string, object>>} clé = normalizeNom(nom)
 */
export async function resolveArtistesForImport(projectId, items, { source = 'grille' } = {}) {
  const map = new Map()
  if (!projectId) return map
  for (const it of items || []) {
    const nom = (it?.titre ?? it?.nom ?? '').trim()
    const key = normalizeNom(nom)
    if (!key || map.has(key)) continue
    try {
      const artiste = await upsertArtiste(projectId, { nom, source })
      map.set(key, artiste)
    } catch (e) {
      console.warn('[resolveArtistesForImport]', nom, e?.message || e)
    }
  }
  return map
}

/**
 * Récupère les créneaux du déroulé liés à un artiste (via créneau.artiste_id).
 * Sert à montrer, côté Musiques, où/quand l'artiste joue (scène + heure + jour).
 *
 * @param {string} artisteId
 * @returns {Promise<Array<{id, titre, date_jour, scene, heure_debut_min, heure_fin_min}>>}
 */
export async function fetchCreneauxByArtiste(artisteId) {
  if (!artisteId) return []
  const { data, error } = await supabase
    .from('projet_deroule_creneaux')
    .select(
      'id, titre, heure_debut_min, heure_fin_min, projet_deroules!inner(date_jour), lane:lane_id(libelle)',
    )
    .eq('artiste_id', artisteId)
  if (error) throw error
  return (data || [])
    .map((c) => ({
      id: c.id,
      titre: c.titre,
      date_jour: c.projet_deroules?.date_jour || null,
      scene: c.lane?.libelle || null,
      heure_debut_min: c.heure_debut_min,
      heure_fin_min: c.heure_fin_min,
    }))
    .sort(
      (a, b) =>
        (a.date_jour || '').localeCompare(b.date_jour || '') ||
        (a.heure_debut_min ?? 0) - (b.heure_debut_min ?? 0),
    )
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
/**
 * MUS-4.9 — Toggle/set le flag headliner d'un artiste existant.
 * Marque la source comme 'manuel' (priorité max) pour éviter qu'un
 * ré-import affiche écrase la décision de l'utilisateur.
 *
 * @param {string} artisteId
 * @param {boolean} headliner
 * @returns {Promise<object>}
 */
export async function setArtisteHeadliner(artisteId, headliner) {
  const { data, error } = await supabase
    .from('projet_artistes')
    .update({
      headliner: Boolean(headliner),
      source: 'manuel',
    })
    .eq('id', artisteId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function deleteArtiste(artisteId) {
  const { error } = await supabase
    .from('projet_artistes')
    .delete()
    .eq('id', artisteId)
  if (error) throw error
}

// ─── MUS-ANNUAIRE : édition / fusion / recoupement ─────────────────────────
//
// Vue « Annuaire » (demande Hugo 2026-07-28) : reprendre la main sur les
// artistes après un import IA raté — renommer, corriger jour/scène,
// supprimer, fusionner les doublons. Toute édition passe la source en
// 'manuel' (priorité max) pour qu'un ré-import IA n'écrase pas la correction.

/**
 * Met à jour un artiste (nom / jour / scene / headliner). Un rename
 * recalcule nom_normalise ; si un AUTRE artiste du projet porte déjà ce
 * nom normalisé, on lève une erreur avec `code: 'DUPLICATE_NOM'` et
 * `conflictArtiste` — l'UI propose alors la fusion à la place.
 *
 * @param {string} artisteId
 * @param {object} patch { nom?, jour?, scene?, headliner? }
 * @returns {Promise<object>}
 */
export async function updateArtiste(artisteId, patch = {}) {
  const { data: existing, error: fetchErr } = await supabase
    .from('projet_artistes')
    .select('*')
    .eq('id', artisteId)
    .single()
  if (fetchErr) throw fetchErr

  const update = { source: 'manuel' }
  if (patch.nom !== undefined) {
    const nom = String(patch.nom || '').trim()
    if (!nom) throw new Error('Le nom ne peut pas être vide')
    const nom_normalise = normalizeNom(nom)
    if (nom_normalise !== existing.nom_normalise) {
      const { data: conflict } = await supabase
        .from('projet_artistes')
        .select('*')
        .eq('project_id', existing.project_id)
        .eq('nom_normalise', nom_normalise)
        .neq('id', artisteId)
        .limit(1)
        .maybeSingle()
      if (conflict) {
        const err = new Error(
          `« ${conflict.nom} » existe déjà dans l'annuaire — fusionne les deux fiches plutôt que de renommer.`,
        )
        err.code = 'DUPLICATE_NOM'
        err.conflictArtiste = conflict
        throw err
      }
    }
    update.nom = nom
    update.nom_normalise = nom_normalise
  }
  if (patch.jour !== undefined) update.jour = patch.jour || null
  if (patch.scene !== undefined) update.scene = patch.scene || null
  if (patch.headliner !== undefined) update.headliner = Boolean(patch.headliner)

  const { data, error } = await supabase
    .from('projet_artistes')
    .update(update)
    .eq('id', artisteId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Fusionne deux fiches artiste : les propositions musiques et les créneaux
 * déroulé de `sourceId` sont rattachés à `targetId`, la cible récupère les
 * infos qui lui manquent (jour, scène, spotify, metadata ; headliner en OR),
 * puis la fiche source est supprimée. La cible passe en source 'manuel'.
 *
 * @param {string} sourceId  fiche absorbée (supprimée)
 * @param {string} targetId  fiche conservée
 * @returns {Promise<object>} la cible mise à jour
 */
export async function mergeArtistes(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) {
    throw new Error('Fusion invalide')
  }
  const { data: rows, error: fetchErr } = await supabase
    .from('projet_artistes')
    .select('*')
    .in('id', [sourceId, targetId])
  if (fetchErr) throw fetchErr
  const source = rows?.find((r) => r.id === sourceId)
  const target = rows?.find((r) => r.id === targetId)
  if (!source || !target) throw new Error('Artiste introuvable')
  if (source.project_id !== target.project_id) {
    throw new Error('Les deux artistes ne sont pas dans le même projet')
  }

  // 1. Repointer les références (propositions musiques + créneaux déroulé).
  const { error: propErr } = await supabase
    .from('projet_musique_propositions')
    .update({ artiste_id: targetId })
    .eq('artiste_id', sourceId)
  if (propErr) throw propErr
  const { error: crenErr } = await supabase
    .from('projet_deroule_creneaux')
    .update({ artiste_id: targetId })
    .eq('artiste_id', sourceId)
  if (crenErr) throw crenErr

  // 2. Compléter la cible avec ce que la source sait en plus.
  const patch = { source: 'manuel' }
  if (!target.jour && source.jour) patch.jour = source.jour
  if (!target.scene && source.scene) patch.scene = source.scene
  if (!target.spotify_artist_id && source.spotify_artist_id) {
    patch.spotify_artist_id = source.spotify_artist_id
  }
  if (source.headliner && !target.headliner) patch.headliner = true
  if (source.metadata && Object.keys(source.metadata).length) {
    patch.metadata = { ...source.metadata, ...target.metadata }
  }
  const { data: updated, error: updErr } = await supabase
    .from('projet_artistes')
    .update(patch)
    .eq('id', targetId)
    .select('*')
    .single()
  if (updErr) throw updErr

  // 3. Supprimer la source (les FKs pointent déjà sur la cible).
  const { error: delErr } = await supabase
    .from('projet_artistes')
    .delete()
    .eq('id', sourceId)
  if (delErr) throw delErr

  return updated
}

/**
 * Supprime plusieurs artistes d'un coup (nettoyage / reset d'un import).
 * FKs en SET NULL : créneaux et propositions gardent leur contenu.
 */
export async function deleteArtistes(artisteIds = []) {
  if (!artisteIds.length) return 0
  const { error } = await supabase
    .from('projet_artistes')
    .delete()
    .in('id', artisteIds)
  if (error) throw error
  return artisteIds.length
}

/**
 * Marque un artiste comme « pas un doublon » (metadata.dup_ok) : la
 * détection de doublons proches ignore toute paire qui le contient.
 * Persistant — le badge ne réapparaît pas au prochain chargement.
 */
export async function setArtisteDupOk(artisteId, ok = true) {
  const { data: existing, error: fetchErr } = await supabase
    .from('projet_artistes')
    .select('metadata')
    .eq('id', artisteId)
    .single()
  if (fetchErr) throw fetchErr
  const metadata = { ...(existing?.metadata || {}) }
  if (ok) metadata.dup_ok = true
  else delete metadata.dup_ok
  const { data, error } = await supabase
    .from('projet_artistes')
    .update({ metadata })
    .eq('id', artisteId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Valeurs structurées pour les champs jour / scène de l'annuaire (retour
 * Hugo : « ce sont censés être des paramètres définis », pas du texte
 * libre). Union de :
 *   - jours : dates des déroulés du projet (formatées « Jeudi 20 août »)
 *             + valeurs jour déjà portées par les artistes ;
 *   - scènes : lanes 'lieu' des déroulés + valeurs scene des artistes.
 */
export async function fetchJourSceneOptions(projectId) {
  const jours = []
  const scenes = []
  if (!projectId) return { jours, scenes }
  const [dRes, lRes, aRes] = await Promise.all([
    supabase
      .from('projet_deroules')
      .select('date_jour')
      .eq('project_id', projectId)
      .order('date_jour', { ascending: true }),
    supabase
      .from('projet_deroule_lanes')
      .select('libelle, type, projet_deroules!inner(project_id)')
      .eq('projet_deroules.project_id', projectId)
      .eq('type', 'lieu'),
    supabase
      .from('projet_artistes')
      .select('jour, scene')
      .eq('project_id', projectId),
  ])
  if (dRes.error) throw dRes.error
  if (lRes.error) throw lRes.error
  if (aRes.error) throw aRes.error

  const pushUnique = (arr, value) => {
    const v = String(value || '').trim()
    if (!v) return
    if (!arr.some((x) => x.toLowerCase() === v.toLowerCase())) arr.push(v)
  }
  for (const d of dRes.data || []) {
    if (!d.date_jour) continue
    const label = new Date(`${d.date_jour}T12:00:00`).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    pushUnique(jours, label.charAt(0).toUpperCase() + label.slice(1))
  }
  for (const a of aRes.data || []) pushUnique(jours, a.jour)
  for (const l of lRes.data || []) pushUnique(scenes, l.libelle)
  for (const a of aRes.data || []) pushUnique(scenes, a.scene)
  return { jours, scenes }
}

/**
 * Synchronise les fiches artistes depuis les créneaux du déroulé : remplit
 * jour / scene quand la fiche n'a PAS de valeur ET que les créneaux sont
 * univoques (exactement 1 jour / 1 scène distincts). N'écrase jamais une
 * valeur existante, ne touche pas au champ source.
 *
 * Pourquoi écrire en base plutôt qu'afficher un dérivé : tout le reste de
 * l'app (picker Programmation, groupements par jour) lit artiste.jour —
 * un dérivé d'affichage laissait ces artistes en « Sans jour ».
 * Appelée à l'ouverture de l'annuaire (canEdit) et après un import
 * timetable. Idempotente.
 *
 * @returns {Promise<number>} nombre de fiches complétées
 */
export async function syncArtistesFromCreneaux(projectId) {
  if (!projectId) return 0
  const [artistes, counts] = await Promise.all([
    listArtistes(projectId, { limit: 500 }),
    fetchArtisteCounts(projectId),
  ])
  let patched = 0
  for (const a of artistes) {
    const patch = {}
    const dJours = counts.jours.get(a.id) || []
    const dScenes = counts.scenes.get(a.id) || []
    if (!a.jour && dJours.length === 1) patch.jour = dJours[0]
    if (!a.scene && dScenes.length === 1) patch.scene = dScenes[0]
    if (!Object.keys(patch).length) continue
    const { error } = await supabase
      .from('projet_artistes')
      .update(patch)
      .eq('id', a.id)
    if (error) throw error
    patched += 1
  }
  return patched
}

/**
 * Recoupement affiche ↔ timetable : compte, par artiste du projet, les
 * créneaux déroulé liés et les propositions musiques rattachées — et
 * remonte les SCÈNES (lanes) et JOURS (date du déroulé) portés par ces
 * créneaux : c'est la vérité terrain de la timetable, affichée dans
 * l'annuaire quand la fiche artiste n'a pas de valeur propre.
 *
 * Renvoie { creneaux, propositions, scenes, jours } — Maps par artisteId
 * (scenes/jours : tableaux de libellés dédupliqués).
 */
export async function fetchArtisteCounts(projectId) {
  const creneaux = new Map()
  const propositions = new Map()
  const scenes = new Map()
  const jours = new Map()
  if (!projectId) return { creneaux, propositions, scenes, jours }
  const [cRes, pRes] = await Promise.all([
    supabase
      .from('projet_deroule_creneaux')
      .select('artiste_id, lane:lane_id(libelle, type), projet_deroules!inner(project_id, date_jour)')
      .eq('projet_deroules.project_id', projectId)
      .not('artiste_id', 'is', null),
    supabase
      .from('projet_musique_propositions')
      .select('artiste_id')
      .eq('project_id', projectId)
      .not('artiste_id', 'is', null),
  ])
  if (cRes.error) throw cRes.error
  if (pRes.error) throw pRes.error
  const pushUnique = (map, id, value) => {
    const v = String(value || '').trim()
    if (!v) return
    const arr = map.get(id) || []
    if (!arr.some((x) => x.toLowerCase() === v.toLowerCase())) {
      arr.push(v)
      map.set(id, arr)
    }
  }
  for (const row of cRes.data || []) {
    creneaux.set(row.artiste_id, (creneaux.get(row.artiste_id) || 0) + 1)
    if (row.lane?.type === 'lieu') pushUnique(scenes, row.artiste_id, row.lane.libelle)
    if (row.projet_deroules?.date_jour) {
      const label = new Date(`${row.projet_deroules.date_jour}T12:00:00`).toLocaleDateString(
        'fr-FR',
        { weekday: 'long', day: 'numeric', month: 'long' },
      )
      pushUnique(jours, row.artiste_id, label.charAt(0).toUpperCase() + label.slice(1))
    }
  }
  for (const row of pRes.data || []) {
    propositions.set(row.artiste_id, (propositions.get(row.artiste_id) || 0) + 1)
  }
  return { creneaux, propositions, scenes, jours }
}
