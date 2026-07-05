// ════════════════════════════════════════════════════════════════════════════
// railMath — échantillonnage d'un rail (polyligne ou spline Catmull-Rom)
// ════════════════════════════════════════════════════════════════════════════
//
// Utilisé par RailCamShapeUtil (cable-cam / travelling) : le rail est défini
// par des points ; la caméra se positionne à t ∈ [0,1] le long du chemin.
// La spline (Catmull-Rom → béziers cubiques) permet les courbes de
// travelling ; la géométrie/hit-testing utilise le chemin échantillonné.
// ════════════════════════════════════════════════════════════════════════════

const SAMPLES_PER_SEG = 14

/** Catmull-Rom (centripète simplifiée) → points échantillonnés. */
function sampleSpline(points) {
  if (points.length < 3) return points.slice()
  const pts = []
  const P = [points[0], ...points, points[points.length - 1]]
  for (let i = 0; i < P.length - 3; i += 1) {
    const [p0, p1, p2, p3] = [P[i], P[i + 1], P[i + 2], P[i + 3]]
    for (let j = 0; j < SAMPLES_PER_SEG; j += 1) {
      const t = j / SAMPLES_PER_SEG
      const t2 = t * t
      const t3 = t2 * t
      pts.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  pts.push({ ...points[points.length - 1] })
  return pts
}

/** Chemin échantillonné du rail (droit ou courbe). */
export function sampleRail(points, spline) {
  if (!points || points.length < 2) return points || []
  return spline && points.length >= 3 ? sampleSpline(points) : points.slice()
}

/** Longueurs cumulées d'un chemin échantillonné. */
function cumulative(pts) {
  const acc = [0]
  for (let i = 1; i < pts.length; i += 1) {
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  return acc
}

/** Point (+ angle tangent) à t ∈ [0,1] le long du chemin. */
export function pointAtT(pts, t) {
  if (!pts.length) return { x: 0, y: 0, angle: 0 }
  if (pts.length === 1) return { ...pts[0], angle: 0 }
  const acc = cumulative(pts)
  const total = acc[acc.length - 1] || 1
  const target = Math.max(0, Math.min(1, t)) * total
  let i = 1
  while (i < acc.length - 1 && acc[i] < target) i += 1
  const segLen = acc[i] - acc[i - 1] || 1
  const f = (target - acc[i - 1]) / segLen
  const a = pts[i - 1]
  const b = pts[i]
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

/** t du point du chemin le plus proche de p (projection par segments). */
export function nearestT(pts, p) {
  if (pts.length < 2) return 0
  const acc = cumulative(pts)
  const total = acc[acc.length - 1] || 1
  let best = { d: Infinity, t: 0 }
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy || 1
    const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    const qx = a.x + dx * f
    const qy = a.y + dy * f
    const d = Math.hypot(p.x - qx, p.y - qy)
    if (d < best.d) {
      best = { d, t: (acc[i - 1] + Math.sqrt(len2) * f) / total }
    }
  }
  return best.t
}

/** Path SVG du rail (droit : lignes ; courbe : chemin échantillonné). */
export function railSvgPath(pts) {
  if (!pts.length) return ''
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
}

/** Intersection des segments p1-p3 et p2-p4 (spider cam) ; fallback centroïde. */
export function diagonalsIntersection(p1, p2, p3, p4) {
  const d1x = p3.x - p1.x
  const d1y = p3.y - p1.y
  const d2x = p4.x - p2.x
  const d2y = p4.y - p2.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) > 1e-6) {
    const s = ((p2.x - p1.x) * d2y - (p2.y - p1.y) * d2x) / denom
    if (s >= 0 && s <= 1) return { x: p1.x + d1x * s, y: p1.y + d1y * s }
  }
  return {
    x: (p1.x + p2.x + p3.x + p4.x) / 4,
    y: (p1.y + p2.y + p3.y + p4.y) / 4,
  }
}
