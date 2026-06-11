// ════════════════════════════════════════════════════════════════════════════
// transform.js — transformations géométriques des coins d'un overlay
// ════════════════════════════════════════════════════════════════════════════
//
// On travaille en coordonnées Mercator normalisées (MercatorCoordinate) :
// projection conforme → rotation/échelle se comportent correctement
// localement (vs lng/lat qui n'est pas isotrope). On convertit corners
// lng/lat → XY mercator, on applique la transfo planaire, on reconvertit.
//
// Conventions corners : array de 4 {lng,lat} ordre TL, TR, BR, BL.
// ════════════════════════════════════════════════════════════════════════════

import maplibregl from 'maplibre-gl'

const { MercatorCoordinate } = maplibregl

export function lngLatToXY(ll) {
  const m = MercatorCoordinate.fromLngLat([ll.lng, ll.lat])
  return { x: m.x, y: m.y }
}

export function xyToLngLat({ x, y }) {
  const ll = new MercatorCoordinate(x, y, 0).toLngLat()
  return { lng: ll.lng, lat: ll.lat }
}

export function cornersToXY(corners) {
  return corners.map(lngLatToXY)
}

export function xyToCorners(xy) {
  return xy.map(xyToLngLat)
}

export function centroidXY(xy) {
  const n = xy.length || 1
  return {
    x: xy.reduce((s, p) => s + p.x, 0) / n,
    y: xy.reduce((s, p) => s + p.y, 0) / n,
  }
}

export function distXY(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/* ─── Transfos haut-niveau (sur corners lng/lat) ──────────────────────────── */

/** Translate les 4 coins d'un delta mercator (dx,dy). */
export function translateXY(xy, dx, dy) {
  return xy.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

/** Échelle uniforme autour du centre. */
export function scaleCorners(corners, factor) {
  const xy = cornersToXY(corners)
  const c = centroidXY(xy)
  const out = xy.map((p) => ({
    x: c.x + (p.x - c.x) * factor,
    y: c.y + (p.y - c.y) * factor,
  }))
  return xyToCorners(out)
}

/** Rotation autour du centre, en degrés (sens horaire écran). */
export function rotateCorners(corners, deltaDeg) {
  const xy = cornersToXY(corners)
  const c = centroidXY(xy)
  const t = (deltaDeg * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const out = xy.map((p) => {
    const dx = p.x - c.x
    const dy = p.y - c.y
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
  })
  return xyToCorners(out)
}

/* ─── Init : rectangle aligné nord, ratio respecté ────────────────────────── */

/**
 * Construit 4 coins (TL,TR,BR,BL) d'un rectangle centré sur `center`,
 * de largeur `widthM` mètres et ratio `aspect` (= largeur/hauteur de l'image).
 */
export function cornersForAspect(center, aspect = 1.4, widthM = 500) {
  const heightM = widthM / (aspect || 1)
  const dLat = heightM / 2 / 111320
  const dLng = widthM / 2 / (111320 * Math.cos((center.lat * Math.PI) / 180))
  return [
    { lng: center.lng - dLng, lat: center.lat + dLat }, // TL
    { lng: center.lng + dLng, lat: center.lat + dLat }, // TR
    { lng: center.lng + dLng, lat: center.lat - dLat }, // BR
    { lng: center.lng - dLng, lat: center.lat - dLat }, // BL
  ]
}

/* ─── Poignée de rotation ─────────────────────────────────────────────────── */

/**
 * Position de la poignée de rotation : au-delà du milieu du bord haut,
 * dans la direction centre→milieu-haut. Retourne {lng,lat}.
 */
export function rotateHandlePoint(corners, extend = 0.35) {
  const xy = cornersToXY(corners)
  const c = centroidXY(xy)
  const topMid = { x: (xy[0].x + xy[1].x) / 2, y: (xy[0].y + xy[1].y) / 2 }
  const vx = topMid.x - c.x
  const vy = topMid.y - c.y
  return xyToLngLat({ x: topMid.x + vx * extend, y: topMid.y + vy * extend })
}

/** Angle (radians) du vecteur centre→point en XY mercator. */
export function angleFromCenter(corners, pointLngLat) {
  const c = centroidXY(cornersToXY(corners))
  const p = lngLatToXY(pointLngLat)
  return Math.atan2(p.y - c.y, p.x - c.x)
}
