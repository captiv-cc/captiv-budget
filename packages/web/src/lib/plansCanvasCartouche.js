// ════════════════════════════════════════════════════════════════════════════
// plansCanvasCartouche — config du cartouche PDF d'un plan (axe #9)
// ════════════════════════════════════════════════════════════════════════════
//
// Le cartouche (bande basse du PDF) est configuré par plan dans
// plans_canvas.cartouche (jsonb) :
//   { projet, ref, client, lieu, dateEvenement, contact, mention,
//     format ('a3'|'a4'), personnes: [{role, nom}],
//     logos: [{kind: 'storage'|'url', ref}] }  (max 3)
// Les logos uploadés vont dans le bucket plans
// (<project_id>/cartouche/<canvas_id>/…) ; le logo de l'organisation (URL
// publique) sert de logo 1 par défaut. Jamais de base64 dans le jsonb.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import { listMaps } from './lieux'
import { extractPeriodes, formatPeriodeFr, hasAnyRange } from './projectPeriodes'

const BUCKET = 'plans'

export const CARTOUCHE_ROLES = [
  'Directeur technique',
  'Réalisateur',
  '1er assistant réalisateur',
  'Production',
  'Chargé de production',
  'Régie générale',
  'Chef opérateur',
  'Ingénieur vision',
]

export const MAX_LOGOS = 3

export function emptyCartouche() {
  return {
    projet: '',
    ref: '',
    client: '',
    lieu: '',
    dateEvenement: '',
    contact: '',
    mention: '',
    format: 'a3',
    personnes: [],
    logos: [],
  }
}

/**
 * Valeurs par défaut tirées du projet (titre, ref, client, période de
 * tournage, lieu = première carte du module Lieu). Best-effort : chaque champ
 * absent reste ''.
 */
export async function fetchCartoucheDefaults(projectId) {
  const defaults = { projet: '', ref: '', client: '', lieu: '', dateEvenement: '' }
  try {
    const { data: project } = await supabase
      .from('projects')
      .select('title, ref_projet, metadata, clients(raison_sociale, nom_commercial)')
      .eq('id', projectId)
      .maybeSingle()
    if (project) {
      defaults.projet = project.title || ''
      defaults.ref = project.ref_projet || ''
      defaults.client =
        project.clients?.raison_sociale || project.clients?.nom_commercial || ''
      const tournage = extractPeriodes(project.metadata)?.tournage
      if (tournage && hasAnyRange(tournage)) {
        defaults.dateEvenement = formatPeriodeFr(tournage)
      }
    }
  } catch {
    /* best effort */
  }
  try {
    const maps = await listMaps(projectId)
    const active = (maps || []).find((m) => !m.is_archived)
    if (active?.name) defaults.lieu = active.name
  } catch {
    /* best effort */
  }
  return defaults
}

/** Upload d'un logo PNG/JPEG → chemin storage (bucket plans). */
export async function uploadCartoucheLogo({ projectId, canvasId, file }) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const path = `${projectId}/cartouche/${canvasId}/logo-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'image/png',
    upsert: false,
  })
  if (error) throw error
  return path
}

/**
 * Résout un logo ({kind, ref}) en dataURL — pour l'aperçu de la modale ET
 * l'embarquement dans le PDF (jspdf veut des dataURLs).
 */
export async function logoToDataUrl(logo) {
  if (!logo?.ref) return null
  let blob
  if (logo.kind === 'storage') {
    const { data, error } = await supabase.storage.from(BUCKET).download(logo.ref)
    if (error) throw error
    blob = data
  } else {
    const res = await fetch(logo.ref)
    if (!res.ok) throw new Error(`logo HTTP ${res.status}`)
    blob = await res.blob()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** Résout tous les logos d'un cartouche en dataURLs (null si échec, filtrés). */
export async function resolveCartoucheLogos(cartouche) {
  const logos = (cartouche?.logos || []).slice(0, MAX_LOGOS)
  const urls = await Promise.all(
    logos.map((l) => logoToDataUrl(l).catch(() => null)),
  )
  return urls.filter(Boolean)
}
