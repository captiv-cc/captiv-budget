// ════════════════════════════════════════════════════════════════════════════
// lib/lieu.js — données carte (Lieu) côté mobile + résolution "Y aller"
// ════════════════════════════════════════════════════════════════════════════
//
// Charge la carte d'un projet : overlay (plan calé + URL signée), POIs, et les
// lanes (pour résoudre un créneau → son lieu). Lecture seule.
//
// Résolution "Y aller" d'un créneau (ordre de priorité) :
//   1. creneau.lieu_id            → POI explicite (le plus précis)
//   2. POI.creneau_id == creneau  → lien posé côté carte sur ce créneau
//   3. POI.lane_id (par LIBELLÉ)  → scène/lieu, transversal multi-jours
//   4. lieu_text == label POI     → correspondance par nom
//   5. POI.deroule_id == jour     → point générique du jour (si unique)
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import { loadCache, saveCache } from './cache'

const BUCKET = 'plans'

/* ─── Chargement ────────────────────────────────────────────────────────── */

export async function fetchLieuData(projetId) {
  if (!projetId) return null
  const cacheKey = `lieu:${projetId}`

  try {
    // 1. Carte principale
    const { data: maps } = await supabase
      .from('projet_lieu_maps')
      .select('id, name, base_layer, center_lng, center_lat, zoom, default_opacity')
      .eq('project_id', projetId)
      .eq('is_archived', false)
      .order('sort_order', { ascending: true })
      .limit(1)
    const map = maps?.[0] || null
    if (!map) {
      const empty = { map: null, overlay: null, pois: [], lanes: [] }
      saveCache(cacheKey, empty)
      return empty
    }

    // 2. Overlay actif (plan calé)
    const { data: overlays } = await supabase
      .from('projet_lieu_overlays')
      .select('id, plan_id, corners, opacity, is_active')
      .eq('map_id', map.id)
      .eq('is_active', true)
      .order('z', { ascending: true })
    let overlay = null
    const ov = overlays?.[0]
    if (ov?.plan_id) {
      const { data: plan } = await supabase
        .from('plans')
        .select('id, name, storage_path, file_type')
        .eq('id', ov.plan_id)
        .maybeSingle()
      if (plan?.storage_path) {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(plan.storage_path, 3600)
        overlay = {
          corners: ov.corners,
          opacity: ov.opacity ?? map.default_opacity ?? 0.7,
          url: signed?.signedUrl || null,
          fileType: plan.file_type,
          planName: plan.name,
        }
      }
    }

    // 3. POIs
    const { data: pois } = await supabase
      .from('projet_lieu_pois')
      .select('id, kind, label, color, icon, geom, notes, deroule_id, lane_id, creneau_id')
      .eq('project_id', projetId)
      .eq('is_archived', false)
      .order('sort_order', { ascending: true })

    // 4. Lanes du projet (pour résolution par libellé)
    const { data: deroules } = await supabase
      .from('projet_deroules')
      .select('id')
      .eq('project_id', projetId)
    const derouleIds = (deroules ?? []).map((d) => d.id)
    let lanes = []
    if (derouleIds.length) {
      const { data: ls } = await supabase
        .from('projet_deroule_lanes')
        .select('id, libelle, type, sort_order')
        .in('deroule_id', derouleIds)
      lanes = ls ?? []
    }

    const payload = { map, overlay, pois: pois ?? [], lanes }
    saveCache(cacheKey, payload)
    return payload
  } catch (err) {
    console.warn('[lib/lieu] fetchLieuData', err.message)
    const cached = await loadCache(cacheKey)
    if (cached) return cached
    throw err
  }
}

/* ─── Résolution "Y aller" ──────────────────────────────────────────────── */

function norm(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function resolveCreneauLieu(creneau, { pois = [], lanes = [] } = {}) {
  if (!creneau) return null
  const laneById = new Map(lanes.map((l) => [l.id, l]))

  // 1. lieu_id explicite
  if (creneau.lieu_id) {
    const p = pois.find((x) => x.id === creneau.lieu_id)
    if (p) return p
  }
  // 2. POI lié à ce créneau
  const byCreneau = pois.find((x) => x.creneau_id === creneau.id)
  if (byCreneau) return byCreneau
  // 3. POI lié à la lane (résolu par libellé, transversal)
  const laneLib = creneau.lane_id ? norm(laneById.get(creneau.lane_id)?.libelle) : null
  if (laneLib) {
    const byLane = pois.find((x) => x.lane_id && norm(laneById.get(x.lane_id)?.libelle) === laneLib)
    if (byLane) return byLane
  }
  // 4. Correspondance par nom (lieu_text ↔ label POI)
  const lt = norm(creneau.lieu || creneau.lieu_text)
  if (lt) {
    const byName = pois.find((x) => norm(x.label) === lt)
    if (byName) return byName
  }
  // 5. Point générique du jour (si un seul)
  if (creneau.deroule_id) {
    const dayPois = pois.filter((x) => x.deroule_id === creneau.deroule_id && !x.creneau_id && !x.lane_id)
    if (dayPois.length === 1) return dayPois[0]
  }
  return null
}

/* ─── Géométrie ─────────────────────────────────────────────────────────── */

/** Centre {lng,lat} d'un POI (point / centroïde zone / milieu ligne). */
export function poiCenter(poi) {
  const g = poi?.geom
  if (!g?.type) return null
  if (g.type === 'Point') {
    return { lng: g.coordinates[0], lat: g.coordinates[1] }
  }
  if (g.type === 'LineString') {
    const cs = g.coordinates
    const mid = cs[Math.floor(cs.length / 2)] || cs[0]
    return { lng: mid[0], lat: mid[1] }
  }
  if (g.type === 'Polygon') {
    const ring = g.coordinates[0] || []
    const pts = ring.slice(0, -1) // retire le point de fermeture
    if (!pts.length) return null
    const sx = pts.reduce((s, p) => s + p[0], 0) / pts.length
    const sy = pts.reduce((s, p) => s + p[1], 0) / pts.length
    return { lng: sx, lat: sy }
  }
  return null
}
