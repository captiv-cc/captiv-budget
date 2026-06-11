/**
 * lieux.js — Couche d'accès données pour la Carte interactive (LIEU V1).
 *
 * Sous-onglet "Carte" de l'outil Plans : géoréférencement d'un plan technique
 * (raster de la table `plans`) sur une carte réelle + POIs/zones liés au
 * déroulé.
 *
 * Tables :
 *   - projet_lieu_maps     : 1+ carte par projet (centre/zoom/fond/opacité).
 *   - projet_lieu_overlays : un plan raster calé (4 coins lng/lat).
 *   - projet_lieu_pois     : point / zone / ligne (GeoJSON) + liens déroulé.
 *
 * RLS : réutilise l'outil 'plans' — can_read_outil / can_edit_outil('plans').
 * Pas de RPC en V1 (CRUD direct via supabase client).
 *
 * Note : pour l'image du plan à caler, on réutilise getSignedUrl() de lib/plans
 * (bucket privé `plans`, URL signée ~10 min).
 */

import { supabase } from './supabase'

/* ─── Maps ──────────────────────────────────────────────────────────────── */

const MAP_COLS =
  'id, project_id, name, base_layer, center_lng, center_lat, zoom, default_opacity, sort_order, is_archived, created_at, updated_at'

export async function listMaps(projectId) {
  if (!projectId) throw new Error('listMaps : projectId requis')
  const { data, error } = await supabase
    .from('projet_lieu_maps')
    .select(MAP_COLS)
    .eq('project_id', projectId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Récupère la carte principale du projet, ou la crée si aucune n'existe.
 * En V1 on travaille avec une seule carte par projet.
 */
export async function getOrCreateMap(projectId) {
  if (!projectId) throw new Error('getOrCreateMap : projectId requis')
  const existing = await listMaps(projectId)
  if (existing.length > 0) return existing[0]

  const { data, error } = await supabase
    .from('projet_lieu_maps')
    .insert([{ project_id: projectId, name: 'Carte du site' }])
    .select(MAP_COLS)
    .single()
  if (error) throw error
  return data
}

export async function updateMap(mapId, fields = {}) {
  if (!mapId) throw new Error('updateMap : mapId requis')
  const patch = {}
  if (fields.name !== undefined) patch.name = fields.name?.trim() || 'Carte du site'
  if (fields.base_layer !== undefined) patch.base_layer = fields.base_layer
  if (fields.center_lng !== undefined) patch.center_lng = fields.center_lng
  if (fields.center_lat !== undefined) patch.center_lat = fields.center_lat
  if (fields.zoom !== undefined) patch.zoom = fields.zoom
  if (fields.default_opacity !== undefined) patch.default_opacity = fields.default_opacity
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('projet_lieu_maps')
    .update(patch)
    .eq('id', mapId)
    .select(MAP_COLS)
    .single()
  if (error) throw error
  return data
}

/* ─── Overlays (plan raster géoréférencé) ───────────────────────────────── */

const OVERLAY_COLS =
  'id, map_id, project_id, plan_id, corners, rotation_deg, opacity, z, is_active, created_at, updated_at'

export async function listOverlays(mapId) {
  if (!mapId) throw new Error('listOverlays : mapId requis')
  const { data, error } = await supabase
    .from('projet_lieu_overlays')
    .select(OVERLAY_COLS)
    .eq('map_id', mapId)
    .order('z', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Crée un overlay (plan calé). corners = [{lng,lat}×4] ordre TL,TR,BR,BL.
 */
export async function createOverlay({
  mapId,
  projectId,
  planId = null,
  corners,
  rotationDeg = 0,
  opacity = 0.7,
  z = 0,
}) {
  if (!mapId || !projectId) throw new Error('createOverlay : mapId + projectId requis')
  if (!Array.isArray(corners) || corners.length !== 4) {
    throw new Error('createOverlay : corners doit être un array de 4 {lng,lat}')
  }
  const { data, error } = await supabase
    .from('projet_lieu_overlays')
    .insert([
      {
        map_id: mapId,
        project_id: projectId,
        plan_id: planId,
        corners,
        rotation_deg: rotationDeg,
        opacity,
        z,
      },
    ])
    .select(OVERLAY_COLS)
    .single()
  if (error) throw error
  return data
}

export async function updateOverlay(overlayId, fields = {}) {
  if (!overlayId) throw new Error('updateOverlay : overlayId requis')
  const patch = {}
  if (fields.corners !== undefined) {
    if (!Array.isArray(fields.corners) || fields.corners.length !== 4) {
      throw new Error('updateOverlay : corners doit être un array de 4 {lng,lat}')
    }
    patch.corners = fields.corners
  }
  if (fields.rotation_deg !== undefined) patch.rotation_deg = fields.rotation_deg
  if (fields.opacity !== undefined) patch.opacity = fields.opacity
  if (fields.z !== undefined) patch.z = fields.z
  if (fields.is_active !== undefined) patch.is_active = Boolean(fields.is_active)
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('projet_lieu_overlays')
    .update(patch)
    .eq('id', overlayId)
    .select(OVERLAY_COLS)
    .single()
  if (error) throw error
  return data
}

export async function deleteOverlay(overlayId) {
  if (!overlayId) throw new Error('deleteOverlay : overlayId requis')
  const { error } = await supabase
    .from('projet_lieu_overlays')
    .delete()
    .eq('id', overlayId)
  if (error) throw error
}

/* ─── POIs (points / zones / lignes) ────────────────────────────────────── */

const POI_COLS =
  'id, map_id, project_id, kind, label, color, icon, geom, notes, deroule_id, lane_id, creneau_id, sort_order, is_archived, created_at, updated_at'

export async function listPois(mapId, { includeArchived = false } = {}) {
  if (!mapId) throw new Error('listPois : mapId requis')
  let q = supabase
    .from('projet_lieu_pois')
    .select(POI_COLS)
    .eq('map_id', mapId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (!includeArchived) q = q.eq('is_archived', false)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Liste les POIs d'un projet (tous maps confondus) — pour le sélecteur "Lieu"
 * de l'éditeur de créneau du déroulé. projet_lieu_pois porte project_id.
 */
export async function listPoisByProject(projectId, { includeArchived = false } = {}) {
  if (!projectId) return []
  let q = supabase
    .from('projet_lieu_pois')
    .select(POI_COLS)
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (!includeArchived) q = q.eq('is_archived', false)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createPoi({
  mapId,
  projectId,
  kind = 'point',
  label = '',
  color = '#4d9fff',
  icon = null,
  geom,
  notes = null,
  derouleId = null,
  laneId = null,
  creneauId = null,
}) {
  if (!mapId || !projectId) throw new Error('createPoi : mapId + projectId requis')
  if (!geom || !geom.type) throw new Error('createPoi : geom GeoJSON requis')
  const { data, error } = await supabase
    .from('projet_lieu_pois')
    .insert([
      {
        map_id: mapId,
        project_id: projectId,
        kind,
        label,
        color,
        icon,
        geom,
        notes,
        deroule_id: derouleId,
        lane_id: laneId,
        creneau_id: creneauId,
      },
    ])
    .select(POI_COLS)
    .single()
  if (error) throw error
  return data
}

export async function updatePoi(poiId, fields = {}) {
  if (!poiId) throw new Error('updatePoi : poiId requis')
  const patch = {}
  if (fields.label !== undefined) patch.label = fields.label ?? ''
  if (fields.color !== undefined) patch.color = fields.color
  if (fields.icon !== undefined) patch.icon = fields.icon || null
  if (fields.geom !== undefined) patch.geom = fields.geom
  if (fields.notes !== undefined) patch.notes = fields.notes?.trim() || null
  if (fields.kind !== undefined) patch.kind = fields.kind
  if (fields.deroule_id !== undefined) patch.deroule_id = fields.deroule_id || null
  if (fields.lane_id !== undefined) patch.lane_id = fields.lane_id || null
  if (fields.creneau_id !== undefined) patch.creneau_id = fields.creneau_id || null
  if (fields.sort_order !== undefined) patch.sort_order = fields.sort_order
  if (fields.is_archived !== undefined) patch.is_archived = Boolean(fields.is_archived)
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await supabase
    .from('projet_lieu_pois')
    .update(patch)
    .eq('id', poiId)
    .select(POI_COLS)
    .single()
  if (error) throw error
  return data
}

export async function deletePoi(poiId) {
  if (!poiId) throw new Error('deletePoi : poiId requis')
  const { error } = await supabase.from('projet_lieu_pois').delete().eq('id', poiId)
  if (error) throw error
}

/* ─── Helpers géo ───────────────────────────────────────────────────────── */

/**
 * À partir d'un centre {lng,lat} et de dimensions approx (mètres), retourne
 * 4 coins (TL,TR,BR,BL) pour initialiser un overlay non encore calé.
 * Conversion mètres→degrés simple (suffisant pour un draft à ajuster ensuite).
 */
export function defaultCornersAround(center, widthM = 400, heightM = 300) {
  const { lng, lat } = center
  const dLat = heightM / 2 / 111320
  const dLng = widthM / 2 / (111320 * Math.cos((lat * Math.PI) / 180))
  return [
    { lng: lng - dLng, lat: lat + dLat }, // TL
    { lng: lng + dLng, lat: lat + dLat }, // TR
    { lng: lng + dLng, lat: lat - dLat }, // BR
    { lng: lng - dLng, lat: lat - dLat }, // BL
  ]
}

/** corners [{lng,lat}] → [[lng,lat]] pour une image source MapLibre. */
export function cornersToCoordinates(corners) {
  return (corners || []).map((c) => [c.lng, c.lat])
}

/** [[lng,lat]] (image source) → [{lng,lat}]. */
export function coordinatesToCorners(coords) {
  return (coords || []).map(([lng, lat]) => ({ lng, lat }))
}
