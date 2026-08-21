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
  'espace',
  'date_contenu',
  'photographe',
  'drive_url',
  'suivi_par',
  'statut',
]

const SELECT_COLS = `
  id, project_id, type, artiste_id, artiste_text, espace, date_contenu,
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

// ─── Listes de référence (espaces, photographes, suivi) ────────────────────
//
// Trois listes par projet, alimentées à la volée : saisir une valeur inédite
// dans un champ l'ajoute à la liste, elle est proposée ensuite. Le festival
// gère donc ses espaces et ses photographes sans rien administrer.

export const REF_KINDS = ['espace', 'photographe', 'suivi']

export const REF_LABELS = {
  espace: 'Espace',
  photographe: 'Photographe',
  suivi: 'Suivi par',
}

export async function listContenuRefs(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_contenu_refs')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('valeur', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Ajoute une valeur si elle n'existe pas déjà (comparaison insensible à la
 * casse, comme l'index unique). Renvoie la row existante le cas échéant.
 */
export async function createContenuRef({ projectId, kind, valeur, existing = [] }) {
  const clean = (valeur || '').trim()
  if (!clean) return null
  const already = existing.find(
    (r) => r.kind === kind && r.valeur.toLowerCase() === clean.toLowerCase(),
  )
  if (already) return already
  const { data, error } = await supabase
    .from('projet_contenu_refs')
    .insert({ project_id: projectId, kind, valeur: clean })
    .select('*')
    .single()
  if (error) {
    // Course entre deux saisies simultanées : l'index a tranché, on n'a
    // rien à signaler à l'utilisateur.
    if (error.code === '23505') return null
    throw error
  }
  return data
}

export async function deleteContenuRef(id) {
  const { error } = await supabase.from('projet_contenu_refs').delete().eq('id', id)
  if (error) throw error
}

/** Valeurs d'une liste, prêtes pour un menu déroulant. */
export function refValues(refs, kind) {
  return (refs || [])
    .filter((r) => r.kind === kind)
    .map((r) => r.valeur)
}

// ─── Annuaire artistes ─────────────────────────────────────────────────────

/**
 * Artistes déjà déclarés sur le projet (annuaire partagé avec le déroulé et
 * les musiques). Sert d'auto-complétion au champ sujet : sans ça, « Macklemore »
 * retapé à la main casse le regroupement par artiste.
 */
export async function listProjetArtistes(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_artistes')
    .select('id, nom')
    .eq('project_id', projectId)
    .order('nom', { ascending: true })
  if (error) return []
  return data || []
}

/**
 * Traduit une saisie de sujet en patch : un nom reconnu dans l'annuaire est
 * LIÉ (artiste_id), tout le reste devient un libellé libre. On ne crée jamais
 * d'artiste depuis ce module — l'annuaire appartient au déroulé.
 */
export function resolveSujet(valeur, artistes = []) {
  const clean = (valeur || '').trim()
  if (!clean) return { artiste_id: null, artiste_text: null }
  const found = (artistes || []).find(
    (a) => (a.nom || '').toLowerCase() === clean.toLowerCase(),
  )
  return found
    ? { artiste_id: found.id, artiste_text: null }
    : { artiste_id: null, artiste_text: clean }
}

// ─── Jours du projet ────────────────────────────────────────────────────────

/**
 * Étiquette un jour du projet : « Jour 2 · vendredi 21 août ». Les contenus
 * se repèrent au jour de festival bien plus qu'à la date calendaire.
 */
export function formatJourLabel(iso, index) {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00`)
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return `Jour ${index + 1} · ${jour}`
}

/**
 * Jours du projet, dérivés des journées de déroulé déjà créées (source la
 * plus fiable : ce sont les jours réellement travaillés). Vide si le projet
 * n'a pas de déroulé — l'UI retombe alors sur une date libre.
 */
export async function listProjetJours(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_deroules')
    .select('date_jour')
    .eq('project_id', projectId)
    .order('date_jour', { ascending: true })
  if (error) return []
  const seen = new Set()
  const out = []
  for (const row of data || []) {
    if (!row.date_jour || seen.has(row.date_jour)) continue
    seen.add(row.date_jour)
    out.push({ date: row.date_jour, label: formatJourLabel(row.date_jour, out.length) })
  }
  return out
}

// ─── Identité du lecteur (lien photographes) ────────────────────────────────
//
// Le lien de suivi est le même pour tous les photographes : sans savoir qui
// lit, chacun doit chercher ses contenus au milieu de ceux des autres. On
// mémorise donc son nom PAR PROJET (localStorage), comme l'identité des
// pages logistique et déroulé. La valeur 'ALL' signifie « j'ai répondu, je
// veux voir tout » : sans elle, on reposerait la question à chaque visite.

const MOI_PREFIX = 'contenus.moi.'
export const VOIR_TOUT = 'ALL'

export function readContenuIdentity(projectId) {
  if (!projectId || typeof localStorage === 'undefined') return null
  return localStorage.getItem(MOI_PREFIX + projectId) || null
}

export function writeContenuIdentity(projectId, valeur) {
  if (!projectId || typeof localStorage === 'undefined') return
  if (valeur) localStorage.setItem(MOI_PREFIX + projectId, valeur)
  else localStorage.removeItem(MOI_PREFIX + projectId)
}
