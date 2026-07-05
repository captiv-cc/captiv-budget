// ════════════════════════════════════════════════════════════════════════════
// RailCamShapeUtil — 'captiv-railcam' : caméra sur ligne (cable-cam,
// travelling / slider)
// ════════════════════════════════════════════════════════════════════════════
//
// Le rail est une suite de points (poignées), droit ou courbe (spline
// Catmull-Rom, option travelling). La caméra glisse le long du rail via une
// poignée dédiée (camT ∈ 0..1). Badge numéroté + pastille label déplaçable,
// même pattern que captiv-camera.
//
// railKind : 'cable' (2 points, ancrages triangulaires) | 'travelling'
// (3 points par défaut, rail avec traverses).
// ════════════════════════════════════════════════════════════════════════════

import { ShapeUtil, Polyline2d, Vec, HTMLContainer, T } from 'tldraw'
import { sampleRail, pointAtT, nearestT, railSvgPath } from './railMath'

export const RAILCAM_SHAPE_TYPE = 'captiv-railcam'

export const railCamShapeProps = {
  points: T.arrayOf(T.object({ x: T.number, y: T.number })),
  spline: T.boolean,
  railKind: T.string, // 'cable' | 'travelling'
  camT: T.number,
  label: T.string,
  modele: T.string,
  support: T.string.optional(),
  couleur: T.string,
  numero: T.number,
  labelDx: T.number.optional(),
  labelDy: T.number.optional(),
}

function railLayout(props) {
  const pts = sampleRail(props.points, props.spline)
  const cam = pointAtT(pts, props.camT)
  // Échelle visuelle dérivée de la longueur du rail (badge borné).
  let len = 0
  for (let i = 1; i < pts.length; i += 1) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  const badge = Math.max(20, Math.min(56, Math.round(len * 0.055)))
  const fontBadge = Math.round(badge * 0.46)
  const fontLabel = Math.max(11, Math.round(badge * 0.42))
  const texte =
    props.label ||
    `Cam ${props.numero}${props.modele ? ` / ${props.modele}` : props.support ? ` · ${props.support}` : ''}`
  const pillW = Math.round(texte.length * fontLabel * 0.62 + fontLabel * 1.4)
  const pillH = Math.round(fontLabel * 1.7)
  const pillCx = cam.x + (props.labelDx ?? 0)
  const pillCy = cam.y + badge * 0.8 + pillH / 2 + (props.labelDy ?? 0)
  return { pts, cam, badge, fontBadge, fontLabel, texte, pillW, pillH, pillCx, pillCy }
}

export class RailCamShapeUtil extends ShapeUtil {
  static type = RAILCAM_SHAPE_TYPE

  static props = railCamShapeProps

  getDefaultProps() {
    return {
      points: [
        { x: 0, y: 0 },
        { x: 320, y: 0 },
      ],
      spline: false,
      railKind: 'cable',
      camT: 0.5,
      label: '',
      modele: '',
      support: 'Cable-cam',
      couleur: '#4d9fff',
      numero: 1,
      labelDx: 0,
      labelDy: 0,
    }
  }

  canEdit() {
    return false
  }

  canResize() {
    return false
  }

  hideRotateHandle() {
    return true
  }

  getGeometry(shape) {
    const pts = sampleRail(shape.props.points, shape.props.spline)
    return new Polyline2d({ points: pts.map((p) => new Vec(p.x, p.y)) })
  }

  getHandles(shape) {
    const { points, camT, spline } = shape.props
    const pts = sampleRail(points, spline)
    const cam = pointAtT(pts, camT)
    const L = railLayout(shape.props)
    return [
      ...points.map((p, i) => ({
        id: `p${i}`,
        type: 'vertex',
        x: p.x,
        y: p.y,
        canSnap: true,
      })),
      { id: 'cam', type: 'vertex', x: cam.x, y: cam.y, canSnap: false },
      { id: 'label', type: 'vertex', x: L.pillCx, y: L.pillCy, canSnap: false },
    ]
  }

  onHandleDrag(shape, { handle }) {
    const props = shape.props
    if (handle.id === 'cam') {
      const pts = sampleRail(props.points, props.spline)
      return {
        id: shape.id,
        type: shape.type,
        props: { camT: nearestT(pts, { x: handle.x, y: handle.y }) },
      }
    }
    if (handle.id === 'label') {
      const pts = sampleRail(props.points, props.spline)
      const cam = pointAtT(pts, props.camT)
      const L = railLayout(props)
      const baseCy = cam.y + L.badge * 0.8 + L.pillH / 2
      return {
        id: shape.id,
        type: shape.type,
        props: {
          labelDx: Math.round(handle.x - cam.x),
          labelDy: Math.round(handle.y - baseCy),
        },
      }
    }
    if (handle.id.startsWith('p')) {
      const idx = Number(handle.id.slice(1))
      if (Number.isNaN(idx) || !props.points[idx]) return undefined
      const points = props.points.map((p, i) =>
        i === idx ? { x: handle.x, y: handle.y } : p,
      )
      return { id: shape.id, type: shape.type, props: { points } }
    }
    return undefined
  }

  component(shape) {
    const { couleur, numero, railKind } = shape.props
    const L = railLayout(shape.props)
    const path = railSvgPath(L.pts)
    const trait = Math.max(2, L.badge * 0.1)
    const first = L.pts[0]
    const last = L.pts[L.pts.length - 1]

    // Traverses du travelling (petits ticks perpendiculaires).
    const ticks = []
    if (railKind === 'travelling') {
      for (let t = 0.08; t < 1; t += 0.12) {
        const p = pointAtT(L.pts, t)
        const nx = Math.sin(p.angle) * trait * 2.2
        const ny = -Math.cos(p.angle) * trait * 2.2
        ticks.push(
          <line
            key={t}
            x1={p.x - nx}
            y1={p.y - ny}
            x2={p.x + nx}
            y2={p.y + ny}
            stroke={couleur}
            strokeWidth={trait * 0.6}
          />,
        )
      }
    }

    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Liseré blanc sous le rail */}
          <path d={path} fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth={trait * 2} />
          <path
            d={path}
            fill="none"
            stroke={couleur}
            strokeWidth={trait}
            strokeDasharray={railKind === 'cable' ? `${trait * 3} ${trait * 2}` : undefined}
          />
          {ticks}
          {/* Ancrages aux extrémités */}
          {[first, last].map((p, i) => (
            <rect
              key={i}
              x={p.x - trait * 1.6}
              y={p.y - trait * 1.6}
              width={trait * 3.2}
              height={trait * 3.2}
              fill={couleur}
              stroke="#ffffff"
              strokeWidth={trait * 0.5}
              transform={railKind === 'cable' ? `rotate(45 ${p.x} ${p.y})` : undefined}
            />
          ))}
          {/* Ligne de rappel pastille */}
          {Math.hypot(shape.props.labelDx ?? 0, shape.props.labelDy ?? 0) > L.badge * 0.9 && (
            <line
              x1={L.cam.x}
              y1={L.cam.y}
              x2={L.pillCx}
              y2={L.pillCy}
              stroke={couleur}
              strokeWidth={Math.max(1.2, L.badge * 0.05)}
              strokeDasharray={`${L.badge * 0.14} ${L.badge * 0.14}`}
            />
          )}
          {/* Caméra sur le rail */}
          <circle
            cx={L.cam.x}
            cy={L.cam.y}
            r={L.badge / 2}
            fill={couleur}
            stroke="#ffffff"
            strokeWidth={Math.max(2, L.badge * 0.09)}
          />
          <text
            x={L.cam.x}
            y={L.cam.y + L.fontBadge * 0.36}
            textAnchor="middle"
            fontSize={L.fontBadge}
            fontWeight="700"
            fill="#ffffff"
          >
            {numero}
          </text>
          {/* Pastille label */}
          <rect
            x={L.pillCx - L.pillW / 2}
            y={L.pillCy - L.pillH / 2}
            width={L.pillW}
            height={L.pillH}
            rx={L.pillH / 2}
            fill={couleur}
            stroke="#ffffff"
            strokeWidth={Math.max(1.5, L.badge * 0.05)}
          />
          <text
            x={L.pillCx}
            y={L.pillCy + L.fontLabel * 0.36}
            textAnchor="middle"
            fontSize={L.fontLabel}
            fontWeight="700"
            fill="#ffffff"
          >
            {L.texte}
          </text>
        </svg>
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape) {
    const pts = sampleRail(shape.props.points, shape.props.spline)
    const path = new Path2D()
    pts.forEach((p, i) => {
      if (i === 0) path.moveTo(p.x, p.y)
      else path.lineTo(p.x, p.y)
    })
    return path
  }
}
