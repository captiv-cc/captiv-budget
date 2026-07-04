// ════════════════════════════════════════════════════════════════════════════
// plansCanvas — couche données des plans techniques ÉDITABLES (tldraw + Yjs)
// ════════════════════════════════════════════════════════════════════════════
//
// Distinct de lib/plans.js (bibliothèque de FICHIERS importés, qui servent de
// fonds via plans_canvas.fond_id). Cf. docs/CHANTIER_PLANS.md.
//
// Persistance du document : ydoc_state = Y.encodeStateAsUpdate(doc) en base64.
// L'autosave du PlanEditor écrase ydoc_state ; les snapshots figés iront dans
// plans_canvas_versions (Phase 2).
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

const CANVAS_FIELDS = `
  id, project_id, titre, description, category_id, fond_id,
  echelle_ratio, version_current, statut, snapshot_svg,
  created_at, created_by, updated_at, updated_by
`

/** Liste les plans éditables d'un projet (sans ydoc_state : payload léger). */
export async function listCanvases(projectId, { includeArchived = false } = {}) {
  let query = supabase
    .from('plans_canvas')
    .select(CANVAS_FIELDS)
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
  if (!includeArchived) query = query.neq('statut', 'archive')
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

/** Charge un plan complet (avec ydoc_state) pour l'éditeur. */
export async function getCanvas(canvasId) {
  const { data, error } = await supabase
    .from('plans_canvas')
    .select('*')
    .eq('id', canvasId)
    .single()
  if (error) throw error
  return data
}

export async function createCanvas({ projectId, titre, categoryId = null, fondId = null, userId = null }) {
  const { data, error } = await supabase
    .from('plans_canvas')
    .insert({
      project_id: projectId,
      titre: titre?.trim() || 'Plan sans titre',
      category_id: categoryId,
      fond_id: fondId,
      created_by: userId,
      updated_by: userId,
    })
    .select(CANVAS_FIELDS)
    .single()
  if (error) throw error
  return data
}

export async function updateCanvas(canvasId, fields = {}) {
  const { data, error } = await supabase
    .from('plans_canvas')
    .update(fields)
    .eq('id', canvasId)
    .select(CANVAS_FIELDS)
    .single()
  if (error) throw error
  return data
}

/** Autosave de l'état Yjs (base64). userId pour tracer updated_by. */
export async function saveCanvasState(canvasId, ydocStateB64, { userId = null } = {}) {
  const { error } = await supabase
    .from('plans_canvas')
    .update({ ydoc_state: ydocStateB64, updated_by: userId })
    .eq('id', canvasId)
  if (error) throw error
}

export async function archiveCanvas(canvasId) {
  return updateCanvas(canvasId, { statut: 'archive' })
}

export async function restoreCanvas(canvasId) {
  return updateCanvas(canvasId, { statut: 'brouillon' })
}

export async function deleteCanvas(canvasId) {
  const { error } = await supabase.from('plans_canvas').delete().eq('id', canvasId)
  if (error) throw error
}
