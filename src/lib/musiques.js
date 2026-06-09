// ════════════════════════════════════════════════════════════════════════════
// musiques.js — Helpers module Musiques (propositions + notes + tags)
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.6
//
// Couvre les 3 tables BDD du module Musiques :
//   - projet_musique_propositions
//   - projet_musique_notes
//   - projet_musique_tags
//
// Logique d'agrégation des notes (moyenne ★) côté front en MVP1
// (computeAggregates). Si la charge le justifie, passer en vue SQL plus
// tard.
//
// Cycle de vie statut :
//   vrac → selectionne → valide_festival → en_nego → accorde
//                                                  ↘ refuse (n'importe où)
//
// API publique :
//   Reads :
//     - listPropositions(projectId, opts)
//     - getProposition(id)
//     - listAllNotes(projectId)
//     - listAllTags(projectId)
//     - listDistinctTags(projectId, query, limit)
//   Writes propositions :
//     - createProposition(projectId, fields)
//     - updateProposition(id, fields)
//     - deleteProposition(id)
//     - setStatut(id, statut)
//   Writes notes (l'utilisateur courant) :
//     - upsertMyNote(propositionId, note)
//     - removeMyNote(propositionId)
//   Writes tags :
//     - addTag(propositionId, tag)
//     - removeTag(tagId)
//   Realtime :
//     - subscribeToProject(projectId, callbacks)
//   Pure helpers :
//     - normalizeTag(tag)
//     - STATUTS, STATUT_LABELS
//     - computeAggregates(propositions, notes, tags)
//
//   MUS-6 Livrable links (N:M proposition ↔ livrable) :
//     - listLivrablesForProposition(propositionId)
//     - listMusiquesForLivrable(livrableId)
//     - listAllLinks(projectId)
//     - linkPropositionToLivrable(propId, livrableId, opts)
//     - updateLink(linkId, patch)
//     - removeLink(linkId)
//     - reorderLinks(livrableId, orderedLinkIds)
//     - subscribeLinks(projectId, onChange)
//     - STATUTS_LOCAL, STATUT_LOCAL_LABELS, STATUT_LOCAL_COLORS
//
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// ─── Cycle de vie ───────────────────────────────────────────────────────────

export const STATUTS = [
  'vrac',
  'selectionne',
  'valide_festival',
  'en_nego',
  'accorde',
  'refuse',
]

export const STATUT_LABELS = {
  vrac: 'Vrac',
  selectionne: 'Sélectionné',
  valide_festival: 'Validé festival',
  en_nego: 'En négo',
  accorde: 'Accordé',
  refuse: 'Refusé',
}

/**
 * Palette statuts pour les badges UI. Chaque statut a une couleur
 * distincte pour le scanning rapide. Format : { bg, fg } avec couleurs
 * pâles/transparentes pour le fond et plus saturées pour le texte.
 *
 * Workflow visuel :
 *   vrac          → gris (neutre, à trier)
 *   selectionne   → bleu (choisi par équipe créa)
 *   valide_festival → vert clair (validé côté festival)
 *   en_nego       → amber (en cours de négociation label)
 *   accorde       → vert foncé (accord final, autorisé)
 *   refuse        → rouge (refusé soit festival soit label)
 */
export const STATUT_COLORS = {
  vrac: {
    bg: 'rgba(148,163,184,0.18)',  // slate
    fg: 'var(--txt-2)',
  },
  selectionne: {
    bg: 'rgba(59,130,246,0.18)',   // blue
    fg: 'var(--blue, #3B82F6)',
  },
  valide_festival: {
    bg: 'rgba(94,234,212,0.18)',   // teal-300
    fg: '#0F766E',
  },
  en_nego: {
    bg: 'rgba(245,158,11,0.18)',   // amber
    fg: '#D97706',
  },
  accorde: {
    bg: 'rgba(34,197,94,0.2)',     // green saturé
    fg: '#16A34A',
  },
  refuse: {
    bg: 'rgba(239,68,68,0.18)',    // red
    fg: '#EF4444',
  },
}

// ─── Normalisation tag ─────────────────────────────────────────────────────

/**
 * Normalise un tag : trim + lowercase. Pas de retrait des accents
 * (l'utilisateur peut vouloir taper "fémelle" et le retrouver tel quel).
 * Limite : 40 chars (côté BDD CHECK).
 */
export function normalizeTag(tag) {
  if (typeof tag !== 'string') return ''
  return tag.trim().toLowerCase().slice(0, 40)
}

// ─── Lectures ──────────────────────────────────────────────────────────────

/**
 * Liste les propositions d'un projet avec jointure artiste.
 *
 * Les notes et tags ne sont PAS jointe ici (sépare les requêtes pour
 * permettre des subscriptions Realtime distinctes). Utiliser
 * listAllNotes + listAllTags en parallèle puis computeAggregates pour
 * tout assembler côté front.
 *
 * @param {string} projectId
 * @param {object} [opts]
 * @param {string} [opts.statut] Filtre statut
 * @param {string} [opts.search] LIKE sur titre + artiste_text
 * @param {string} [opts.sort='created_at_desc']
 *        'created_at_desc' | 'created_at_asc' | 'titre_asc'
 * @returns {Promise<Array>}
 */
export async function listPropositions(projectId, opts = {}) {
  let q = supabase
    .from('projet_musique_propositions')
    .select(`
      *,
      artiste:artiste_id (id, nom, jour, scene, headliner, spotify_artist_id),
      proposer:proposer_id (id, full_name, avatar_url, email)
    `)
    .eq('project_id', projectId)
  if (opts.statut) {
    q = q.eq('statut', opts.statut)
  }
  if (opts.search?.trim()) {
    // Cherche dans titre OU artiste_text (le nom de l'annuaire est joint
    // mais on ne peut pas filter dessus en or-clause Supabase simplement).
    const s = opts.search.trim()
    q = q.or(`titre.ilike.%${s}%,artiste_text.ilike.%${s}%`)
  }
  switch (opts.sort) {
    case 'created_at_asc':
      q = q.order('created_at', { ascending: true })
      break
    case 'titre_asc':
      q = q.order('titre', { ascending: true })
      break
    case 'created_at_desc':
    default:
      q = q.order('created_at', { ascending: false })
  }
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Récupère une seule proposition (avec artiste joint).
 */
export async function getProposition(id) {
  const { data, error } = await supabase
    .from('projet_musique_propositions')
    .select(`
      *,
      artiste:artiste_id (id, nom, jour, scene, headliner, spotify_artist_id),
      proposer:proposer_id (id, full_name, avatar_url, email)
    `)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

/**
 * Liste toutes les notes du projet (jointure pour scope projet).
 * Utilisée pour calculer les moyennes côté front et afficher "qui a noté
 * quoi" sur le hover.
 */
export async function listAllNotes(projectId) {
  // Subquery : notes des propositions du projet courant
  const { data, error } = await supabase
    .from('projet_musique_notes')
    .select(`
      proposition_id,
      user_id,
      note,
      proposition:proposition_id!inner (project_id)
    `)
    .eq('proposition.project_id', projectId)
  if (error) throw error
  return data || []
}

/**
 * Liste tous les tags du projet (jointure pour scope projet).
 * Utilisé pour le rendu dans la liste + l'autocomplete.
 */
export async function listAllTags(projectId) {
  const { data, error } = await supabase
    .from('projet_musique_tags')
    .select(`
      id,
      proposition_id,
      tag,
      user_id,
      proposition:proposition_id!inner (project_id)
    `)
    .eq('proposition.project_id', projectId)
  if (error) throw error
  return data || []
}

/**
 * Liste les tags distincts du projet (autocomplete picker).
 *
 * @param {string} projectId
 * @param {string} [query] Filtre LIKE
 * @param {number} [limit=10]
 * @returns {Promise<Array<string>>}
 */
export async function listDistinctTags(projectId, query = '', limit = 10) {
  let q = supabase
    .from('projet_musique_tags')
    .select(`
      tag,
      proposition:proposition_id!inner (project_id)
    `)
    .eq('proposition.project_id', projectId)
    .limit(200)  // assez pour dédup ensuite
  if (query?.trim()) {
    q = q.ilike('tag', `${normalizeTag(query)}%`)
  }
  const { data, error } = await q
  if (error) throw error
  // Dédup côté front et limit
  const seen = new Set()
  const out = []
  for (const row of data || []) {
    if (!seen.has(row.tag)) {
      seen.add(row.tag)
      out.push(row.tag)
      if (out.length >= limit) break
    }
  }
  return out.sort()
}

// ─── Écritures propositions ────────────────────────────────────────────────

/**
 * Crée une nouvelle proposition. Au moins un de artiste_id ou
 * artiste_text doit être fourni (CHECK constraint BDD).
 *
 * @param {string} projectId
 * @param {object} fields
 * @returns {Promise<object>}
 */
export async function createProposition(projectId, fields) {
  if (!fields?.titre?.trim()) {
    throw new Error('titre requis')
  }
  if (!fields.artiste_id && !fields.artiste_text?.trim()) {
    throw new Error('artiste_id ou artiste_text requis')
  }
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id || null
  const payload = {
    project_id: projectId,
    artiste_id: fields.artiste_id || null,
    artiste_text: fields.artiste_text || null,
    titre: fields.titre.trim(),
    spotify_id: fields.spotify_id || null,
    spotify_url: fields.spotify_url || null,
    preview_url: fields.preview_url || null,
    cover_url: fields.cover_url || null,
    duration_ms: fields.duration_ms || null,
    audio_features: fields.audio_features || null,
    lien_youtube: fields.lien_youtube || null,
    timecode_start_sec: fields.timecode_start_sec ?? null,
    timecode_end_sec: fields.timecode_end_sec ?? null,
    statut: fields.statut || 'vrac',
    proposer_id: userId,
    remarques: fields.remarques || null,
  }
  const { data, error } = await supabase
    .from('projet_musique_propositions')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Patch partiel d'une proposition existante.
 */
export async function updateProposition(id, fields) {
  const { data, error } = await supabase
    .from('projet_musique_propositions')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime une proposition (cascade les notes + tags).
 */
export async function deleteProposition(id) {
  const { error } = await supabase
    .from('projet_musique_propositions')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/**
 * Met à jour le sort_order custom (drag and drop) d'une proposition.
 * Pas de validation (peut être positif/négatif/fractionnaire).
 */
export async function updateSortOrder(id, sortOrder) {
  return updateProposition(id, { sort_order: sortOrder })
}

/**
 * Calcule un sort_order pour insérer entre deux rows existantes.
 *
 * Cas :
 *   - Si beforeOrder + afterOrder sont définis : moyenne
 *   - Si afterOrder seul (drag tout en haut) : afterOrder - 1
 *   - Si beforeOrder seul (drag tout en bas) : beforeOrder + 1
 *   - Si rien : 0
 *
 * @param {number|null} beforeOrder sort_order de la row juste avant
 * @param {number|null} afterOrder sort_order de la row juste après
 * @returns {number}
 */
export function calcSortOrderBetween(beforeOrder, afterOrder) {
  const b = typeof beforeOrder === 'number' && !Number.isNaN(beforeOrder) ? beforeOrder : null
  const a = typeof afterOrder === 'number' && !Number.isNaN(afterOrder) ? afterOrder : null
  if (b == null && a == null) return 0
  if (b == null) return a - 1
  if (a == null) return b + 1
  return (b + a) / 2
}

/**
 * Change le statut. Pas de validation transition (le front peut sauter
 * d'étape — utile pour le Kanban drag-drop).
 */
export async function setStatut(id, statut) {
  if (!STATUTS.includes(statut)) {
    throw new Error(`statut invalide : ${statut}`)
  }
  return updateProposition(id, { statut })
}

/**
 * Liste les notes d'une proposition avec détails voteurs (full_name,
 * email, avatar_url) pour afficher la liste "qui a noté quoi" dans le
 * détail drawer. Trié par created_at DESC (plus récent en haut).
 *
 * MUSIQUES MUS-4.2 — détail voteurs visible dans le drawer comme on
 * affiche les commentaires.
 *
 * @param {string} propositionId
 * @returns {Promise<Array<{ user_id, note, created_at, updated_at, voter }>>}
 */
export async function listNotesForProposition(propositionId) {
  const { data, error } = await supabase
    .from('projet_musique_notes')
    .select(`
      proposition_id,
      user_id,
      note,
      created_at,
      updated_at,
      voter:user_id (id, full_name, avatar_url, email)
    `)
    .eq('proposition_id', propositionId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── Écritures notes (utilisateur courant uniquement) ──────────────────────

/**
 * UPSERT la note de l'utilisateur courant sur une proposition.
 *
 * @param {string} propositionId
 * @param {number} note Entier 1-5
 */
export async function upsertMyNote(propositionId, note) {
  if (!Number.isInteger(note) || note < 1 || note > 5) {
    throw new Error('note doit être un entier 1-5')
  }
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id
  if (!userId) throw new Error('non authentifié')
  const { data, error } = await supabase
    .from('projet_musique_notes')
    .upsert(
      { proposition_id: propositionId, user_id: userId, note },
      { onConflict: 'proposition_id,user_id' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime ma note sur une proposition.
 */
export async function removeMyNote(propositionId) {
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id
  if (!userId) throw new Error('non authentifié')
  const { error } = await supabase
    .from('projet_musique_notes')
    .delete()
    .eq('proposition_id', propositionId)
    .eq('user_id', userId)
  if (error) throw error
}

// ─── Écritures tags ────────────────────────────────────────────────────────

/**
 * Ajoute un tag à une proposition. Échec silencieux si le tag existe
 * déjà (UNIQUE(proposition_id, tag) gère côté BDD).
 *
 * @returns {Promise<object|null>} Le row inséré ou null si déjà présent.
 */
export async function addTag(propositionId, tag) {
  const normalized = normalizeTag(tag)
  if (!normalized) throw new Error('tag vide')
  if (normalized.length > 40) throw new Error('tag trop long (max 40)')
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id || null
  const { data, error } = await supabase
    .from('projet_musique_tags')
    .insert({ proposition_id: propositionId, tag: normalized, user_id: userId })
    .select('*')
    .maybeSingle()
  if (error) {
    // Code 23505 = UNIQUE violation (tag déjà présent)
    if (error.code === '23505') return null
    throw error
  }
  return data
}

/**
 * Supprime un tag par son id. La policy RLS vérifie que c'est bien le
 * tag de l'utilisateur (ou qu'il est admin/charge_prod).
 */
export async function removeTag(tagId) {
  const { error } = await supabase
    .from('projet_musique_tags')
    .delete()
    .eq('id', tagId)
  if (error) throw error
}

// ─── Realtime subscriptions ────────────────────────────────────────────────

/**
 * S'abonne aux changements des 3 tables musique du projet.
 * Renvoie un objet avec une méthode .unsubscribe() pour le cleanup.
 *
 * @param {string} projectId
 * @param {object} callbacks
 * @param {(payload) => void} [callbacks.onPropositionChange]
 * @param {(payload) => void} [callbacks.onNoteChange]
 * @param {(payload) => void} [callbacks.onTagChange]
 * @returns {{ unsubscribe: () => void }}
 */
export function subscribeToProject(projectId, callbacks = {}) {
  const channel = supabase
    .channel(`musiques:${projectId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_musique_propositions',
        filter: `project_id=eq.${projectId}`,
      },
      (payload) => callbacks.onPropositionChange?.(payload),
    )
    // Pour notes et tags on ne peut pas filter sur project_id directement
    // (pas dans la table). Le client va recevoir toutes les notifs des 3
    // tables, et c'est lui qui filtrera via la jointure côté state local.
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_musique_notes',
      },
      (payload) => callbacks.onNoteChange?.(payload),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_musique_tags',
      },
      (payload) => callbacks.onTagChange?.(payload),
    )
    .subscribe()
  return {
    unsubscribe: () => {
      supabase.removeChannel(channel)
    },
  }
}

// ─── Commentaires ──────────────────────────────────────────────────────────

/**
 * Liste tous les commentaires d'un projet (jointure pour scope).
 * Utilisé par la vue liste pour afficher le compteur 💬 sur chaque row.
 */
export async function listAllComments(projectId) {
  const { data, error } = await supabase
    .from('projet_musique_comments')
    .select(`
      id, proposition_id, user_id, created_at,
      proposition:proposition_id!inner (project_id)
    `)
    .eq('proposition.project_id', projectId)
  if (error) throw error
  return data || []
}

/**
 * Liste les commentaires d'une proposition triés du plus ancien au plus
 * récent (ordre de lecture naturel d'un fil de discussion).
 */
export async function listComments(propositionId) {
  const { data, error } = await supabase
    .from('projet_musique_comments')
    .select(`
      id, proposition_id, user_id, body, created_at, updated_at,
      author:user_id (id, full_name, avatar_url, email)
    `)
    .eq('proposition_id', propositionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Ajoute un commentaire signé du user courant.
 */
export async function addComment(propositionId, body) {
  const trimmed = (body || '').trim()
  if (!trimmed) throw new Error('Commentaire vide')
  if (trimmed.length > 2000) throw new Error('Max 2000 caractères')
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id
  if (!userId) throw new Error('non authentifié')
  const { data, error } = await supabase
    .from('projet_musique_comments')
    .insert({ proposition_id: propositionId, user_id: userId, body: trimmed })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour le body d'un commentaire (auteur uniquement, RLS protège).
 */
export async function updateComment(commentId, body) {
  const trimmed = (body || '').trim()
  if (!trimmed) throw new Error('Commentaire vide')
  if (trimmed.length > 2000) throw new Error('Max 2000 caractères')
  const { data, error } = await supabase
    .from('projet_musique_comments')
    .update({ body: trimmed })
    .eq('id', commentId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime un commentaire (auteur ou admin via RLS).
 */
export async function removeComment(commentId) {
  const { error } = await supabase
    .from('projet_musique_comments')
    .delete()
    .eq('id', commentId)
  if (error) throw error
}

/**
 * Subscribe aux changements de comments pour une proposition.
 * Renvoie { unsubscribe() }.
 */
export function subscribeComments(propositionId, onChange) {
  const channel = supabase
    .channel(`musique_comments:${propositionId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_musique_comments',
        filter: `proposition_id=eq.${propositionId}`,
      },
      (payload) => onChange?.(payload),
    )
    .subscribe()
  return {
    unsubscribe: () => supabase.removeChannel(channel),
  }
}

// ─── Détection de doublons à l'ajout ───────────────────────────────────────

/**
 * Cherche une proposition similaire dans le projet (matching flou sur
 * artiste + titre normalisés).
 *
 * Algorithme :
 *   1. Charge toutes les propositions du projet
 *   2. Normalise titre et artiste (NFD + lowercase + sans ponctuation)
 *   3. Match exact sur le couple (artiste_norm, titre_norm) →
 *      considéré comme doublon certain
 *   4. Match approximatif (titre identique mais artiste différent ou
 *      vice-versa) → renvoyé en "possibles" pour info
 *
 * Renvoie { exact: [...], similar: [...] }
 */
export async function findSimilarProposition(projectId, artisteName, titre) {
  const aNorm = normalizeForMatch(artisteName || '')
  const tNorm = normalizeForMatch(titre || '')
  if (!aNorm && !tNorm) return { exact: [], similar: [] }
  const { data, error } = await supabase
    .from('projet_musique_propositions')
    .select(`
      id, titre, artiste_text, artiste_id, statut, proposer_id, created_at,
      artiste:artiste_id (id, nom)
    `)
    .eq('project_id', projectId)
  if (error) throw error
  const exact = []
  const similar = []
  for (const p of data || []) {
    const pArtist = normalizeForMatch(p.artiste?.nom || p.artiste_text || '')
    const pTitre = normalizeForMatch(p.titre || '')
    if (pArtist === aNorm && pTitre === tNorm) {
      exact.push(p)
    } else if (pTitre === tNorm || (pArtist === aNorm && tNorm)) {
      similar.push(p)
    }
  }
  return { exact, similar }
}

function normalizeForMatch(s) {
  if (typeof s !== 'string') return ''
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

// ─── Helpers d'agrégation (purs, testables) ────────────────────────────────

/**
 * Calcule les agrégats par proposition à partir des listes brutes.
 *
 * Renvoie une Map<propositionId, { noteAvg, noteCount, myNote, tags }>.
 *
 * @param {Array} notes Tous les rows de projet_musique_notes du projet
 * @param {Array} tags Tous les rows de projet_musique_tags du projet
 * @param {string|null} currentUserId ID du user courant pour identifier sa note
 * @returns {Map<string, { noteAvg: number|null, noteCount: number, myNote: number|null, tags: Array<{id, tag, user_id}> }>}
 */
export function computeAggregates(notes, tags, currentUserId, comments = []) {
  const out = new Map()
  function ensure(key) {
    if (!out.has(key)) {
      out.set(key, {
        noteAvg: null,
        noteCount: 0,
        _sum: 0,
        myNote: null,
        tags: [],
        commentCount: 0,
      })
    }
    return out.get(key)
  }
  // Notes
  for (const n of notes || []) {
    const agg = ensure(n.proposition_id)
    agg._sum += n.note
    agg.noteCount += 1
    if (currentUserId && n.user_id === currentUserId) {
      agg.myNote = n.note
    }
  }
  // Moyennes
  for (const agg of out.values()) {
    if (agg.noteCount > 0) {
      agg.noteAvg = Math.round((agg._sum / agg.noteCount) * 10) / 10
    }
    delete agg._sum
  }
  // Tags
  for (const t of tags || []) {
    ensure(t.proposition_id).tags.push({
      id: t.id,
      tag: t.tag,
      user_id: t.user_id,
    })
  }
  // Comments count (juste le nombre, pas le détail)
  for (const c of comments || []) {
    ensure(c.proposition_id).commentCount += 1
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════
// MUS-6.2 — Helpers livrable_link (N:M proposition ↔ livrable)
// ═══════════════════════════════════════════════════════════════════════════

// Cycle de vie statut LOCAL par couple track+livrable (MUS-6.8 — refonte
// en 3 stades internes). La validation client + droits/labels vivront à
// part dans l'onglet "Autorisations" futur (pas de migration BDD ici).
//
//   proposition : track candidate pour ce livrable (par défaut au link)
//   choix       : shortlist — on l'a retenue comme candidate sérieuse
//   valide      : tranchée — c'est celle qui sera utilisée dans le livrable
export const STATUTS_LOCAL = ['proposition', 'choix', 'valide']
export const STATUT_LOCAL_LABELS = {
  proposition: 'Proposition',
  choix: 'Choix',
  valide: 'Validé',
}
// Palette : progression visuelle neutre → bleu (engagement) → vert (final).
// Cohérente avec le funnel à l'œil. Permet le scanning rapide dans les
// vues setlist / livrable.
export const STATUT_LOCAL_COLORS = {
  proposition: { bg: 'rgba(148,163,184,0.18)', fg: 'var(--txt-2)' },
  choix: { bg: 'rgba(59,130,246,0.18)', fg: 'var(--blue, #3B82F6)' },
  valide: { bg: 'rgba(34,197,94,0.2)', fg: '#16A34A' },
}

/**
 * Liste les livrables où une proposition est utilisée.
 * Pour la section "Utilisée dans" du drawer proposition.
 *
 * @param {string} propositionId
 * @returns {Promise<Array<{ id, livrable_id, ordre, remarque, statut_local,
 *   created_at, livrable: { id, numero, nom, statut, block: { nom, couleur } } }>>}
 */
export async function listLivrablesForProposition(propositionId) {
  const { data, error } = await supabase
    .from('projet_musique_livrable_link')
    .select(`
      id,
      livrable_id,
      proposition_id,
      ordre,
      remarque,
      statut_local,
      created_at,
      updated_at,
      livrable:livrable_id (
        id,
        numero,
        nom,
        statut,
        format,
        block:block_id (id, nom, couleur, prefixe)
      )
    `)
    .eq('proposition_id', propositionId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Liste les musiques attachées à un livrable (setlist).
 * Pour l'onglet Musiques du drawer livrable.
 *
 * Trie par ordre ASC NULLS LAST puis created_at ASC.
 *
 * @param {string} livrableId
 * @returns {Promise<Array<{ id, proposition_id, ordre, remarque, statut_local,
 *   proposition: <full proposition row> }>>}
 */
export async function listMusiquesForLivrable(livrableId) {
  const { data, error } = await supabase
    .from('projet_musique_livrable_link')
    .select(`
      id,
      proposition_id,
      livrable_id,
      ordre,
      remarque,
      statut_local,
      created_at,
      updated_at,
      proposition:proposition_id (
        id,
        titre,
        artiste_text,
        statut,
        cover_url,
        preview_url,
        lien_youtube,
        spotify_url,
        spotify_id,
        duration_ms,
        audio_features,
        explicit,
        artiste:artiste_id (id, nom, jour, scene, headliner),
        proposer:proposer_id (id, full_name, avatar_url, email)
      )
    `)
    .eq('livrable_id', livrableId)
    .order('ordre', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Liste TOUS les liens d'un projet (pour calcul des "déjà piockées"
 * dans la liste vrac + couverture par livrable dans le dashboard).
 *
 * Renvoie une liste plate avec proposition_id + livrable_id + statut_local.
 *
 * @param {string} projectId
 * @returns {Promise<Array<{ id, proposition_id, livrable_id, statut_local }>>}
 */
export async function listAllLinks(projectId) {
  // On filtre via la jointure livrable.project_id (les RLS le valident
  // déjà côté serveur, on ajoute le filtre côté requête pour scoper la
  // pagination).
  const { data, error } = await supabase
    .from('projet_musique_livrable_link')
    .select(`
      id,
      proposition_id,
      livrable_id,
      statut_local,
      livrable:livrable_id!inner (id, project_id, numero, nom)
    `)
    .eq('livrable.project_id', projectId)
  if (error) throw error
  return data || []
}

/**
 * Crée un lien proposition ↔ livrable.
 *
 * Si le lien existe déjà (UNIQUE constraint), on le récupère et on
 * patche les champs fournis (idempotent : ré-ajouter une track au même
 * livrable ne casse pas, ça update ordre/remarque/statut).
 *
 * @param {string} propositionId
 * @param {string} livrableId
 * @param {object} [opts]
 * @param {number} [opts.ordre]    Fractional ordering. Si omis, append
 *                                 (MAX(ordre) + 1000 dans le livrable).
 * @param {string} [opts.remarque]
 * @param {string} [opts.statut_local]  Défaut 'propose'.
 * @returns {Promise<object>} Le lien (créé ou patché).
 */
export async function linkPropositionToLivrable(
  propositionId,
  livrableId,
  opts = {},
) {
  const userResult = await supabase.auth.getUser()
  const userId = userResult.data?.user?.id || null

  // Tente d'abord l'INSERT. Si conflit (UNIQUE), on tombe sur l'update.
  // On gère ça en 2 étapes pour pouvoir lire l'existant et update les
  // champs fournis.
  const existing = await supabase
    .from('projet_musique_livrable_link')
    .select('*')
    .eq('proposition_id', propositionId)
    .eq('livrable_id', livrableId)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) {
    // Update seulement les champs fournis (skip ordre si non fourni pour
    // ne pas casser un drag manuel précédent).
    const patch = {}
    if (opts.ordre !== undefined) patch.ordre = opts.ordre
    if (opts.remarque !== undefined) patch.remarque = opts.remarque
    if (opts.statut_local !== undefined) patch.statut_local = opts.statut_local
    if (Object.keys(patch).length === 0) return existing.data
    const { data, error } = await supabase
      .from('projet_musique_livrable_link')
      .update(patch)
      .eq('id', existing.data.id)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  // Pas d'existant → INSERT. Calcule ordre si pas fourni (append en fin
  // de setlist du livrable).
  let ordre = opts.ordre
  if (ordre === undefined) {
    const { data: maxRow } = await supabase
      .from('projet_musique_livrable_link')
      .select('ordre')
      .eq('livrable_id', livrableId)
      .order('ordre', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    ordre = (maxRow?.ordre ?? 0) + 1000
  }

  const { data, error } = await supabase
    .from('projet_musique_livrable_link')
    .insert({
      proposition_id: propositionId,
      livrable_id: livrableId,
      ordre,
      remarque: opts.remarque || null,
      statut_local: opts.statut_local || 'proposition',
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Met à jour un lien (ordre, remarque, statut_local).
 *
 * @param {string} linkId
 * @param {object} patch  { ordre?, remarque?, statut_local? }
 */
export async function updateLink(linkId, patch) {
  const clean = {}
  if (patch.ordre !== undefined) clean.ordre = patch.ordre
  if (patch.remarque !== undefined) clean.remarque = patch.remarque
  if (patch.statut_local !== undefined) clean.statut_local = patch.statut_local
  if (Object.keys(clean).length === 0) return null
  const { data, error } = await supabase
    .from('projet_musique_livrable_link')
    .update(clean)
    .eq('id', linkId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime un lien (= retire la track du livrable, sans toucher à la
 * proposition globale).
 */
export async function removeLink(linkId) {
  const { error } = await supabase
    .from('projet_musique_livrable_link')
    .delete()
    .eq('id', linkId)
  if (error) throw error
}

/**
 * Réordonne les liens d'un livrable. Reçoit une liste d'IDs dans le
 * nouvel ordre et écrit ordre = (index + 1) × 1000 pour chacun (pas de
 * fractional, renumération complète — robuste contre les NULL et les
 * conflits de drag concurrents, pattern aligné MUS-3.5).
 *
 * @param {string} livrableId
 * @param {Array<string>} orderedLinkIds  IDs dans l'ordre cible
 */
export async function reorderLinks(livrableId, orderedLinkIds) {
  const updates = orderedLinkIds.map((id, idx) =>
    supabase
      .from('projet_musique_livrable_link')
      .update({ ordre: (idx + 1) * 1000 })
      .eq('id', id)
      .eq('livrable_id', livrableId), // garde-fou multi-projet
  )
  const results = await Promise.allSettled(updates)
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length > 0) {
    throw new Error(
      `${failed.length}/${orderedLinkIds.length} updates échoués`,
    )
  }
}

/**
 * S'abonne aux changements de la table link pour un projet (filtrage
 * côté client via la jointure livrable.project_id côté payload).
 *
 * @param {string} projectId  (informational — utilisé pour le channel name)
 * @param {(payload) => void} onChange
 * @returns {{ unsubscribe: () => void }}
 */
export function subscribeLinks(projectId, onChange) {
  const channel = supabase
    .channel(`musique_links:${projectId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_musique_livrable_link',
      },
      (payload) => onChange?.(payload),
    )
    .subscribe()
  return {
    unsubscribe: () => supabase.removeChannel(channel),
  }
}
