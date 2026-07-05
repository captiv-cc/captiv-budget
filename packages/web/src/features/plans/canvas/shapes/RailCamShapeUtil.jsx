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
  // Taille du badge figée à la pose (uniforme entre caméras du plan).
  uiScale: T.number.optional(),
  labelDx: T.number.optional(),
  labelDy: T.number.optional(),
}

function railLayout(props) {
  const pts = sampleRail(props.points, props.spline)
  const cam = pointAtT(pts, props.camT)
  // uiScale prime ; fallback legacy : dérivé de la longueur du rail.
  let len = 0
  for (let i = 1; i < pts.length; i += 1) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  const badge = props.uiScale || Math.max(20, Math.min(56, Math.round(len * 0.055)))
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
    const { points, camT, spline, railKind } = shape.props
    const pts = sampleRail(points, spline)
    const cam = pointAtT(pts, camT)
    const L = railLayout(shape.props)
    const handles = [
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
    // Travelling : poignées « + » au milieu des segments pour ajouter un
    // point (glisser pour créer, comme la shape line native).
    if (railKind === 'travelling') {
      for (let i = 0; i < points.length - 1; i += 1) {
        handles.push({
          id: `mid${i}`,
          type: 'create',
          x: (points[i].x + points[i + 1].x) / 2,
          y: (points[i].y + points[i + 1].y) / 2,
          canSnap: false,
        })
      }
    }
    return handles
  }

  // Double-clic sur un point intermédiaire : suppression (min 2 points).
  onDoubleClickHandle(shape, handle) {
    if (!handle.id.startsWith('p')) return undefined
    const props = shape.props
    if (props.points.length <= 2) return undefined
    const idx = Number(handle.id.slice(1))
    if (Number.isNaN(idx)) return undefined
    const points = props.points.filter((_, i) => i !== idx)
    return {
      id: shape.id,
      type: shape.type,
      props: { points, spline: props.spline && points.length >= 3 },
    }
  }

  // tldraw garde le MÊME id de poignée pendant tout le drag : l'insertion
  // depuis une poignée « create » doit être idempotente (1er appel = insère,
  // suivants = déplace le point inséré).
  onHandleDragStart() {
    this._midInsert = null
  }

  onHandleDragEnd() {
    this._midInsert = null
  }

  onHandleDragCancel() {
    this._midInsert = null
  }

  onHandleDrag(shape, { handle }) {
    const props = shape.props
    if (handle.id.startsWith('mid')) {
      const idx = Number(handle.id.slice(3))
      if (Number.isNaN(idx)) return undefined
      const points = [...props.points]
      if (this._midInsert === `${shape.id}:${handle.id}`) {
        // Point déjà inséré pendant ce drag : on le déplace.
        points[idx + 1] = { x: handle.x, y: handle.y }
      } else {
        points.splice(idx + 1, 0, { x: handle.x, y: handle.y })
        this._midInsert = `${shape.id}:${handle.id}`
      }
      return { id: shape.id, type: shape.type, props: { points } }
    }
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
    // Affordance « + » au milieu des segments quand le rail est sélectionné
    // (la poignée native 'create' est discrète — on la souligne).
    const isSelected = this.editor.getOnlySelectedShapeId?.() === shape.id
    const plusMarks =
      isSelected && railKind === 'travelling'
        ? shape.props.points.slice(0, -1).map((p, i) => {
            const next = shape.props.points[i + 1]
            const mx = (p.x + next.x) / 2
            const my = (p.y + next.y) / 2
            // Sous le badge caméra → on ne dessine pas (la poignée native
            // resterait masquée et le clic irait à la caméra).
            if (Math.hypot(mx - L.cam.x, my - L.cam.y) < L.badge * 0.9) return null
            const r = Math.max(7, L.badge * 0.3)
            return (
              <g key={`plus-${i}`} opacity="0.85">
                <circle cx={mx} cy={my} r={r} fill="#ffffff" stroke={couleur} strokeWidth={1.5} />
                <path
                  d={`M ${mx - r * 0.45} ${my} H ${mx + r * 0.45} M ${mx} ${my - r * 0.45} V ${my + r * 0.45}`}
                  stroke={couleur}
                  strokeWidth={Math.max(1.5, r * 0.2)}
                  strokeLinecap="round"
                />
              </g>
            )
          })
        : null

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
          {plusMarks}
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
