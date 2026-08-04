// ════════════════════════════════════════════════════════════════════════════
// musiqueAutorisations.js — Suivi des autorisations musique (MUS-7 A1/A2)
// ════════════════════════════════════════════════════════════════════════════
//
// Une autorisation = 1 row par couple track × média (FK unique vers
// projet_musique_livrable_link). Créée à la volée au premier édit
// (ensureAutorisation) — les links sans row sont affichés « à lancer ».
//
// Statuts : a_lancer → envoyee (EN COURS) → accordee (OUI) | refusee (NON).
// envoyee_at / decidee_at posés automatiquement au changement de statut.
// Chaque changement de statut est journalisé dans les events (kind 'statut'),
// les messages libres dans kind 'comment' — même fil pour l'interne et le
// futur portail RP (A3).
//
// Voir supabase/migrations/20260804a_musique_autorisations.sql et
// docs/CHANTIER_MUS-7_AUTORISATIONS.md.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

export const AUTOR_STATUTS = ['a_lancer', 'envoyee', 'accordee', 'refusee']

export const AUTOR_STATUT_LABELS = {
  a_lancer: 'À lancer',
  envoyee: 'En cours',
  accordee: 'Autorisé',
  refusee: 'Refusé',
}

export const AUTOR_STATUT_COLORS = {
  a_lancer: '#9ca3af',
  envoyee: '#3b82f6',
  accordee: '#22c55e',
  refusee: '#ef4444',
}

/**
 * Liste les couples track × média candidats à l'autorisation : tous les
 * links du projet avec proposition (crédit artiste_text + jour annuaire),
 * livrable et autorisation embarquée (null si jamais lancée).
 */
export async function listAutorisationRows(projectId) {
  const { data, error } = await supabase
    .from('projet_musique_livrable_link')
    .select(`
      id,
      livrable_id,
      proposition_id,
      statut_local,
      livrable:livrable_id (id, nom, project_id),
      proposition:proposition_id (
        id, titre, artiste_text, preview_url, lien_youtube, spotify_id,
        duration_ms,
        artiste:artiste_id (id, nom, jour)
      ),
      autorisation:projet_musique_autorisations!link_id (
        id, statut, envoyee_at, decidee_at, duree_utilisation, contact_label,
        doc_signe, master_url, utilise, updated_at, updated_by_name
      )
    `)
  if (error) throw error
  // La jointure !link_id revient en array (relation 1-1 non déclarée côté
  // PostgREST) — aplatit en objet | null. Filtre projet via le livrable.
  return (data || [])
    .filter((l) => l.livrable?.project_id === projectId)
    .map((l) => ({
      ...l,
      autorisation: Array.isArray(l.autorisation)
        ? l.autorisation[0] || null
        : l.autorisation || null,
    }))
}

/**
 * Get-or-create la row d'autorisation d'un link. Idempotent (UNIQUE link_id
 * + upsert). Retourne la row.
 */
export async function ensureAutorisation({ projectId, linkId }) {
  if (!projectId || !linkId) throw new Error('ensureAutorisation : projectId + linkId requis')
  const { data, error } = await supabase
    .from('projet_musique_autorisations')
    .upsert(
      { project_id: projectId, link_id: linkId },
      { onConflict: 'link_id', ignoreDuplicates: false },
    )
    .select('*')
    .single()
  if (error) throw error
  return data
}

/**
 * Patch une autorisation. Gère les timestamps automatiques :
 *   - statut → 'envoyee'            : envoyee_at = now (si pas déjà posé)
 *   - statut → 'accordee'/'refusee' : decidee_at = now
 *   - statut → 'a_lancer'           : reset des deux
 * Journalise le changement de statut dans les events.
 *
 * @param {object} autor  Row actuelle (pour comparer le statut)
 * @param {object} patch  Champs à modifier
 * @param {object} [who]  { userId, userName } — auteur de la modif
 */
export async function updateAutorisation(autor, patch, who = {}) {
  const final = { ...patch, updated_at: new Date().toISOString() }
  if (who.userId !== undefined) final.updated_by = who.userId
  if (who.userName !== undefined) final.updated_by_name = who.userName

  if (patch.statut && patch.statut !== autor.statut) {
    if (patch.statut === 'envoyee' && !autor.envoyee_at) {
      final.envoyee_at = new Date().toISOString()
    }
    if (patch.statut === 'accordee' || patch.statut === 'refusee') {
      final.decidee_at = new Date().toISOString()
    }
    if (patch.statut === 'a_lancer') {
      final.envoyee_at = null
      final.decidee_at = null
    }
  }

  const { data, error } = await supabase
    .from('projet_musique_autorisations')
    .update(final)
    .eq('id', autor.id)
    .select('*')
    .single()
  if (error) throw error

  if (patch.statut && patch.statut !== autor.statut) {
    await addAutorisationEvent({
      projectId: autor.project_id,
      autorisationId: autor.id,
      kind: 'statut',
      body: patch.statut,
      authorId: who.userId || null,
      authorName: who.userName || null,
    }).catch((e) => console.warn('[musiqueAutorisations] event statut', e))
  }

  return data
}

/* ─── Events (commentaires + journal) ───────────────────────────────────── */

export async function listAutorisationEvents(autorisationId) {
  const { data, error } = await supabase
    .from('projet_musique_autorisation_events')
    .select('*, author:author_id (id, full_name, avatar_url)')
    .eq('autorisation_id', autorisationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/** Compte les commentaires (kind 'comment') par autorisation du projet. */
export async function countCommentsByAutorisation(projectId) {
  const { data, error } = await supabase
    .from('projet_musique_autorisation_events')
    .select('autorisation_id, kind')
    .eq('project_id', projectId)
    .eq('kind', 'comment')
  if (error) throw error
  const map = new Map()
  for (const e of data || []) {
    map.set(e.autorisation_id, (map.get(e.autorisation_id) || 0) + 1)
  }
  return map
}

export async function addAutorisationEvent({
  projectId,
  autorisationId,
  kind = 'comment',
  body,
  authorId = null,
  authorName = null,
}) {
  if (!body?.trim()) throw new Error('addAutorisationEvent : body requis')
  const { data, error } = await supabase
    .from('projet_musique_autorisation_events')
    .insert({
      project_id: projectId,
      autorisation_id: autorisationId,
      kind,
      body: body.trim(),
      author_id: authorId,
      author_name: authorName,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/* ─── Realtime ──────────────────────────────────────────────────────────── */

export function subscribeAutorisations(projectId, onChange) {
  const channel = supabase
    .channel(`musique-autor-${projectId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_musique_autorisations',
        filter: `project_id=eq.${projectId}`,
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projet_musique_autorisation_events',
        filter: `project_id=eq.${projectId}`,
      },
      onChange,
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}
