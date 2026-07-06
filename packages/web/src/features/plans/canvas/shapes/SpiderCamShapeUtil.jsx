// ════════════════════════════════════════════════════════════════════════════
// SpiderCamShapeUtil — 'captiv-spidercam' : 4 points d'accroche, câbles en
// croix, caméra à l'intersection
// ════════════════════════════════════════════════════════════════════════════
//
// Les 4 ancrages sont des poignées libres ; la caméra se place à
// l'intersection des diagonales p0-p2 / p1-p3 (centroïde si parallèles).
// Badge + pastille label déplaçable, même pattern que les autres caméras.
// ════════════════════════════════════════════════════════════════════════════

import { ShapeUtil, Group2d, Polyline2d, Vec, HTMLContainer, T } from 'tldraw'
import { diagonalsIntersection } from './railMath'

export const SPIDERCAM_SHAPE_TYPE = 'captiv-spidercam'

export const spiderCamShapeProps = {
  points: T.arrayOf(T.object({ x: T.number, y: T.number })), // 4 ancrages
  label: T.string,
  modele: T.string,
  support: T.string.optional(),
  couleur: T.string,
  numero: T.number,
  // Taille du badge figée à la pose (uniforme entre caméras du plan).
  uiScale: T.number.optional(),
  labelDx: T.number.optional(),
  labelDy: T.number.optional(),
  // Optique montée + remarques libres (reprises en nomenclature).
  optique: T.string.optional(),
  remarques: T.string.optional(),
}

function spiderLayout(props) {
  const [p0, p1, p2, p3] = props.points
  const cam = diagonalsIntersection(p0, p1, p2, p3)
  const span = Math.max(
    Math.hypot(p2.x - p0.x, p2.y - p0.y),
    Math.hypot(p3.x - p1.x, p3.y - p1.y),
  )
  const badge = props.uiScale || Math.max(20, Math.min(56, Math.round(span * 0.06)))
  const fontBadge = Math.round(badge * 0.46)
  const fontLabel = Math.max(11, Math.round(badge * 0.42))
  const texte =
    props.label ||
    `Cam ${props.numero}${props.modele ? ` / ${props.modele}` : ' · Spider'}`
  const pillW = Math.round(texte.length * fontLabel * 0.62 + fontLabel * 1.4)
  const pillH = Math.round(fontLabel * 1.7)
  const pillCx = cam.x + (props.labelDx ?? 0)
  const pillCy = cam.y + badge * 0.8 + pillH / 2 + (props.labelDy ?? 0)
  return { cam, badge, fontBadge, fontLabel, texte, pillW, pillH, pillCx, pillCy }
}

export class SpiderCamShapeUtil extends ShapeUtil {
  static type = SPIDERCAM_SHAPE_TYPE

  static props = spiderCamShapeProps

  getDefaultProps() {
    return {
      points: [
        { x: 0, y: 0 },
        { x: 320, y: 0 },
        { x: 320, y: 240 },
        { x: 0, y: 240 },
      ],
      label: '',
      modele: '',
      support: 'Spider cam',
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
    const [p0, p1, p2, p3] = shape.props.points
    return new Group2d({
      children: [
        new Polyline2d({ points: [new Vec(p0.x, p0.y), new Vec(p2.x, p2.y)] }),
        new Polyline2d({ points: [new Vec(p1.x, p1.y), new Vec(p3.x, p3.y)] }),
      ],
    })
  }

  getHandles(shape) {
    const L = spiderLayout(shape.props)
    return [
      ...shape.props.points.map((p, i) => ({
        id: `p${i}`,
        type: 'vertex',
        x: p.x,
        y: p.y,
        canSnap: true,
      })),
      { id: 'label', type: 'vertex', x: L.pillCx, y: L.pillCy, canSnap: false },
    ]
  }

  onHandleDrag(shape, { handle }) {
    const props = shape.props
    if (handle.id === 'label') {
      const L = spiderLayout(props)
      const baseCy = L.cam.y + L.badge * 0.8 + L.pillH / 2
      return {
        id: shape.id,
        type: shape.type,
        props: {
          labelDx: Math.round(handle.x - L.cam.x),
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
    const { couleur, numero } = shape.props
    const [p0, p1, p2, p3] = shape.props.points
    const L = spiderLayout(shape.props)
    const trait = Math.max(1.8, L.badge * 0.08)

    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Câbles en croix (liseré blanc + couleur) */}
          {[
            [p0, p2],
            [p1, p3],
          ].map(([a, b], i) => (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeOpacity="0.9" strokeWidth={trait * 2} />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={couleur}
                strokeWidth={trait}
                strokeDasharray={`${trait * 3} ${trait * 2}`}
              />
            </g>
          ))}
          {/* Ancrages */}
          {[p0, p1, p2, p3].map((p, i) => (
            <rect
              key={i}
              x={p.x - trait * 1.8}
              y={p.y - trait * 1.8}
              width={trait * 3.6}
              height={trait * 3.6}
              fill={couleur}
              stroke="#ffffff"
              strokeWidth={trait * 0.5}
              transform={`rotate(45 ${p.x} ${p.y})`}
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
          {/* Caméra au centre */}
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
    const [p0, p1, p2, p3] = shape.props.points
    const path = new Path2D()
    path.moveTo(p0.x, p0.y)
    path.lineTo(p2.x, p2.y)
    path.moveTo(p1.x, p1.y)
    path.lineTo(p3.x, p3.y)
    return path
  }
}
