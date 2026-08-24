// ════════════════════════════════════════════════════════════════════════════
// musiqueBerceaux — maquettes de bande son
// ════════════════════════════════════════════════════════════════════════════
//
// Un berceau est une suite ordonnée de blocs, chacun pointant vers une
// proposition avec ses points de coupe. Une seule piste : les morceaux
// s'enchaînent bout à bout, c'est ce qu'est un berceau d'aftermovie.
//
// Un bloc peut porter sur un fichier déposé (coupe libre dans le morceau
// entier) ou, à défaut, sur l'extrait 30 s — utile pour tester un
// enchaînement avant d'avoir les fichiers.
//
// Voir supabase/migrations/20260824b_musique_berceaux.sql.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// Durée retenue pour un extrait quand on n'a pas mesuré le fichier.
export const PREVIEW_DUREE_MS = 30000

/* ─── Helpers purs ──────────────────────────────────────────────────────── */

/** Source réellement jouable d'un bloc : le fichier déposé, sinon l'extrait. */
export function blocSource(proposition) {
  if (proposition?.audio_path) return 'fichier'
  if (proposition?.preview_url) return 'extrait'
  return 'aucune'
}

/**
 * Durée exploitable d'une proposition : la mesure du fichier déposé, sinon
 * la durée de l'extrait. `duration_ms` (Spotify) n'est PAS utilisable comme
 * borne de coupe tant qu'on n'a pas le fichier — on ne peut pas jouer
 * au-delà des 30 secondes de l'extrait.
 */
export function dureeExploitableMs(proposition) {
  if (proposition?.audio_path) {
    return proposition.audio_duree_ms || proposition.duration_ms || 0
  }
  if (proposition?.preview_url) return PREVIEW_DUREE_MS
  return 0
}

export function blocDureeMs(bloc) {
  return Math.max(0, (bloc?.out_ms || 0) - (bloc?.in_ms || 0))
}

/**
 * Place les blocs sur la timeline, bout à bout. Renvoie chaque bloc avec sa
 * position de début et de fin, pour l'affichage comme pour la feuille de
 * montage.
 */
export function timelinePositions(blocs = []) {
  let curseur = 0
  return [...blocs]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((bloc) => {
      const duree = blocDureeMs(bloc)
      const item = { bloc, start_ms: curseur, end_ms: curseur + duree, duree_ms: duree }
      curseur += duree
      return item
    })
}

export function timelineDureeMs(blocs = []) {
  return blocs.reduce((total, b) => total + blocDureeMs(b), 0)
}

/**
 * Écart à la durée visée. `null` si aucune cible : l'interface n'affiche
 * alors rien plutôt qu'un zéro trompeur.
 */
export function ecartCibleMs(blocs, cibleMs) {
  if (!cibleMs) return null
  return timelineDureeMs(blocs) - cibleMs
}

/** Contraint une coupe aux bornes du morceau, et garde un bloc non vide. */
export function clampCoupe({ in_ms, out_ms }, dureeMaxMs) {
  const max = Math.max(1000, dureeMaxMs || 0)
  const debut = Math.min(Math.max(0, Math.round(in_ms || 0)), max - 500)
  const fin = Math.min(Math.max(debut + 500, Math.round(out_ms || 0)), max)
  return { in_ms: debut, out_ms: fin }
}

/* ─── Lecture ───────────────────────────────────────────────────────────── */

export async function listBerceaux(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_musique_berceaux')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function listBlocs(berceauId) {
  if (!berceauId) return []
  const { data, error } = await supabase
    .from('projet_musique_berceau_blocs')
    .select('*')
    .eq('berceau_id', berceauId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

/* ─── Écriture ──────────────────────────────────────────────────────────── */

export async function createBerceau({ projectId, nom, livrableId = null, dureeCibleMs = null, userId = null }) {
  const { data, error } = await supabase
    .from('projet_musique_berceaux')
    .insert({
      project_id: projectId,
      nom: (nom || '').trim() || 'Nouveau berceau',
      livrable_id: livrableId,
      duree_cible_ms: dureeCibleMs,
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateBerceau(id, patch) {
  const clean = {}
  for (const k of ['nom', 'livrable_id', 'duree_cible_ms', 'notes']) {
    if (patch[k] !== undefined) clean[k] = patch[k]
  }
  if (Object.keys(clean).length === 0) return null
  const { data, error } = await supabase
    .from('projet_musique_berceaux')
    .update(clean)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function deleteBerceau(id) {
  const { error } = await supabase.from('projet_musique_berceaux').delete().eq('id', id)
  if (error) throw error
}

/**
 * Ajoute un morceau en fin de berceau. La coupe par défaut prend le morceau
 * entier (ou l'extrait) : on affine ensuite, plutôt que d'imposer un
 * découpage arbitraire.
 */
export async function addBloc({ projectId, berceauId, proposition, sortOrder }) {
  const duree = dureeExploitableMs(proposition)
  if (!duree) throw new Error('Ce morceau n’a ni fichier déposé ni extrait — rien à jouer.')
  const { data, error } = await supabase
    .from('projet_musique_berceau_blocs')
    .insert({
      project_id: projectId,
      berceau_id: berceauId,
      proposition_id: proposition.id,
      sort_order: sortOrder,
      in_ms: 0,
      out_ms: duree,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateBloc(id, patch) {
  const clean = {}
  for (const k of ['sort_order', 'in_ms', 'out_ms', 'fade_in_ms', 'fade_out_ms', 'gain', 'note']) {
    if (patch[k] !== undefined) clean[k] = patch[k]
  }
  if (Object.keys(clean).length === 0) return null
  const { data, error } = await supabase
    .from('projet_musique_berceau_blocs')
    .update(clean)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function deleteBloc(id) {
  const { error } = await supabase.from('projet_musique_berceau_blocs').delete().eq('id', id)
  if (error) throw error
}

/**
 * Duplique un berceau avec ses blocs. Le geste central de cet outil :
 * « et si on commençait par Moby ? » — on essaie sans perdre la version
 * qui marchait.
 */
export async function duplicateBerceau({ berceau, blocs, userId = null }) {
  const copie = await createBerceau({
    projectId: berceau.project_id,
    nom: `${berceau.nom} (copie)`,
    livrableId: berceau.livrable_id,
    dureeCibleMs: berceau.duree_cible_ms,
    userId,
  })
  if (blocs.length > 0) {
    const { error } = await supabase.from('projet_musique_berceau_blocs').insert(
      blocs.map((b, i) => ({
        project_id: berceau.project_id,
        berceau_id: copie.id,
        proposition_id: b.proposition_id,
        sort_order: i,
        in_ms: b.in_ms,
        out_ms: b.out_ms,
        fade_in_ms: b.fade_in_ms,
        fade_out_ms: b.fade_out_ms,
        gain: b.gain,
        note: b.note,
      })),
    )
    if (error) throw error
  }
  return copie
}

/** Réécrit l'ordre après un glisser-déposer. */
export async function reorderBlocs(blocsOrdonnes) {
  const updates = blocsOrdonnes.map((b, i) =>
    supabase.from('projet_musique_berceau_blocs').update({ sort_order: i }).eq('id', b.id),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed) throw failed.error
}
