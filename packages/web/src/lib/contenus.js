// ════════════════════════════════════════════════════════════════════════════
// contenus.js — suivi de validation des photos / vidéos (CONTENUS V1)
// ════════════════════════════════════════════════════════════════════════════
//
// Un contenu = un média soumis à l'équipe presse : type, sujet (artiste de
// l'annuaire OU libellé libre), scène, date, photographe, lien drive.
//
// Statuts : en_attente → valide | a_revoir | refuse. Chaque changement est
// journalisé dans les events (kind 'statut'), les messages libres en
// 'comment' — même fil côté desk et côté portail public.
//
// Personne n'a de compte sur le portail : chaque écriture porte le prénom
// saisi (updated_by_name / author_name). C'est ce qui remplace les rôles.
//
// Voir supabase/migrations/20260821a_contenus.sql.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

export const CONTENU_TYPES = ['photo', 'video']

export const CONTENU_TYPE_LABELS = {
  photo: 'Photo',
  video: 'Vidéo',
}

export const CONTENU_STATUTS = ['en_attente', 'valide', 'a_revoir', 'refuse']

export const CONTENU_STATUT_LABELS = {
  en_attente: 'En attente',
  valide: 'Validé',
  a_revoir: 'À revoir',
  refuse: 'Refusé',
}

export const CONTENU_STATUT_COLORS = {
  en_attente: '#9ca3af',
  valide: '#22c55e',
  a_revoir: '#f59e0b',
  refuse: '#ef4444',
}

// Colonnes éditables — sert de whitelist commune au desk et au portail.
export const CONTENU_EDITABLE_FIELDS = [
  'type',
  'artiste_id',
  'artiste_text',
  'scene',
  'date_contenu',
  'photographe',
  'drive_url',
  'suivi_par',
  'statut',
]

const SELECT_COLS = `
  id, project_id, type, artiste_id, artiste_text, scene, date_contenu,
  photographe, drive_url, suivi_par, statut, decide_at,
  created_at, updated_at, created_by_name, updated_by_name,
  artiste:artiste_id (id, nom, jour)
`

/** Sujet affiché : le libellé libre prime sur l'annuaire (cf. musiques). */
export function contenuSujet(c) {
  return (c?.artiste_text || '').trim() || c?.artiste?.nom || 'Sans titre'
}

/** Contenus vivants du projet, du plus récent au plus ancien. */
export async function listContenus(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_contenus')
    .select(SELECT_COLS)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('date_contenu', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** Fil d'événements du projet (commentaires + journal des statuts). */
export async function listContenuEvents(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_contenu_events')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createContenu({ projectId, authorName = null, ...fields }) {
  const payload = { project_id: projectId, created_by_name: authorName }
  for (const k of CONTENU_EDITABLE_FIELDS) {
    if (fields[k] !== undefined) payload[k] = fields[k]
  }
  const { data, error } = await supabase
    .from('projet_contenus')
    .insert(payload)
    .select(SELECT_COLS)
    .single()
  if (error) throw error
  return data
}

/**
 * Patch d'un contenu. Un changement de statut est journalisé dans le fil
 * (best-effort : l'échec du journal ne doit pas annuler la modification).
 */
export async function updateContenu(id, patch, { authorName = null, previousStatut = null } = {}) {
  const clean = {}
  for (const k of CONTENU_EDITABLE_FIELDS) {
    if (patch[k] !== undefined) clean[k] = patch[k]
  }
  if (Object.keys(clean).length === 0) return null
  clean.updated_by_name = authorName

  const { data, error } = await supabase
    .from('projet_contenus')
    .update(clean)
    .eq('id', id)
    .select(SELECT_COLS)
    .single()
  if (error) throw error

  if (clean.statut && previousStatut && clean.statut !== previousStatut) {
    try {
      await addContenuEvent({
        projectId: data.project_id,
        contenuId: id,
        kind: 'statut',
        body: clean.statut,
        authorName,
      })
    } catch (e) {
      console.warn('[contenus] journal statut', e)
    }
  }
  return data
}

/** Suppression douce : récupérable côté desk. */
export async function deleteContenu(id) {
  const { error } = await supabase
    .from('projet_contenus')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function addContenuEvent({ projectId, contenuId, kind = 'comment', body, authorName = null }) {
  const text = (body || '').trim()
  if (!text) return null
  const { data, error } = await supabase
    .from('projet_contenu_events')
    .insert({
      project_id: projectId,
      contenu_id: contenuId,
      kind,
      body: text,
      author_name: authorName,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

// ─── Suggestions de saisie ──────────────────────────────────────────────────

/**
 * Valeurs déjà employées dans le projet pour un champ libre (photographe,
 * scène). Sert de datalist : pas de table de configuration à administrer,
 * et les filtres restent fiables parce qu'on retape rarement un nom déjà
 * proposé. `extra` permet d'injecter des valeurs d'ailleurs (les scènes du
 * déroulé, par exemple).
 */
export function suggestValues(contenus, field, extra = []) {
  const set = new Set()
  for (const c of contenus || []) {
    const v = (c?.[field] || '').trim()
    if (v) set.add(v)
  }
  for (const v of extra) {
    const clean = (v || '').trim()
    if (clean) set.add(clean)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
}
