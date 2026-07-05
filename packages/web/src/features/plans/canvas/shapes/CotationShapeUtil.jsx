// ════════════════════════════════════════════════════════════════════════════
// CotationShapeUtil — 'captiv-cote' : cotation entre deux points
// ════════════════════════════════════════════════════════════════════════════
//
// Ligne à deux poignées avec traits d'extrémité perpendiculaires et étiquette
// de distance automatique : mètres si l'échelle du plan est définie
// (meta.metersPerPx de la page), pixels sinon (avec indication).
// ════════════════════════════════════════════════════════════════════════════

import { ShapeUtil, Polyline2d, Vec, HTMLContainer, T } from 'tldraw'
import { fmtMeters } from './scale'

export const COTE_SHAPE_TYPE = 'captiv-cote'

export const coteShapeProps = {
  points: T.arrayOf(T.object({ x: T.number, y: T.number })), // exactement 2
  couleur: T.string,
  // Offset manuel de l'étiquette (poignée dédiée).
  labelDx: T.number.optional(),
  labelDy: T.number.optional(),
}

// Géométrie dérivée, partagée component / handles.
function coteLayout(props, mpp) {
  const [a, b] = props.points
  const lenPx = Math.hypot(b.x - a.x, b.y - a.y)
  const texte = mpp > 0 ? `${fmtMeters(lenPx * mpp)} m` : `${Math.round(lenPx)} px`
  const fontLabel = Math.max(9, Math.min(12, Math.round(lenPx * 0.03)))
  const pillW = Math.round(texte.length * fontLabel * 0.62 + fontLabel * 1.2)
  const pillH = Math.round(fontLabel * 1.6)
  const tick = Math.max(6, Math.min(16, lenPx * 0.05))
  const midX = (a.x + b.x) / 2
  const midY = (a.y + b.y) / 2
  // Centre de l'étiquette : au-dessus du milieu + offset manuel.
  const pillCx = midX + (props.labelDx ?? 0)
  const pillCy = midY - pillH / 2 - tick * 0.6 + (props.labelDy ?? 0)
  return { a, b, lenPx, texte, fontLabel, pillW, pillH, tick, midX, midY, pillCx, pillCy }
}

export class CotationShapeUtil extends ShapeUtil {
  static type = COTE_SHAPE_TYPE

  static props = coteShapeProps

  getDefaultProps() {
    return {
      points: [
        { x: 0, y: 0 },
        { x: 240, y: 0 },
      ],
      couleur: '#a8a8a8',
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
    const [a, b] = shape.props.points
    return new Polyline2d({ points: [new Vec(a.x, a.y), new Vec(b.x, b.y)] })
  }

  getHandles(shape) {
    const L = coteLayout(shape.props, 0)
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
    if (handle.id === 'label') {
      const L = coteLayout({ ...shape.props, labelDx: 0, labelDy: 0 }, 0)
      return {
        id: shape.id,
        type: shape.type,
        props: {
          labelDx: Math.round(handle.x - L.pillCx),
          labelDy: Math.round(handle.y - L.pillCy),
        },
      }
    }
    if (!handle.id.startsWith('p')) return undefined
    const idx = Number(handle.id.slice(1))
    if (Number.isNaN(idx) || !shape.props.points[idx]) return undefined
    const points = shape.props.points.map((p, i) =>
      i === idx ? { x: handle.x, y: handle.y } : p,
    )
    return { id: shape.id, type: shape.type, props: { points } }
  }

  component(shape) {
    const { couleur } = shape.props
    // Distance : mètres si échelle définie sur la page, sinon pixels.
    const page = this.editor.getPage(shape.parentId) || this.editor.getCurrentPage()
    const mpp = Number(page?.meta?.metersPerPx) || 0
    const L = coteLayout(shape.props, mpp)
    const angle = Math.atan2(L.b.y - L.a.y, L.b.x - L.a.x)
    const nx = Math.sin(angle) * L.tick
    const ny = -Math.cos(angle) * L.tick
    const trait = Math.max(1.5, L.fontLabel * 0.12)
    const offset = Math.hypot(shape.props.labelDx ?? 0, shape.props.labelDy ?? 0)

    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Liseré blanc pour le contraste sur fond dense */}
          <g stroke="#ffffff" strokeOpacity="0.9" strokeWidth={trait * 2.4} strokeLinecap="round">
            <line x1={L.a.x} y1={L.a.y} x2={L.b.x} y2={L.b.y} />
            <line x1={L.a.x - nx} y1={L.a.y - ny} x2={L.a.x + nx} y2={L.a.y + ny} />
            <line x1={L.b.x - nx} y1={L.b.y - ny} x2={L.b.x + nx} y2={L.b.y + ny} />
          </g>
          <g stroke={couleur} strokeWidth={trait} strokeLinecap="round">
            <line x1={L.a.x} y1={L.a.y} x2={L.b.x} y2={L.b.y} />
            <line x1={L.a.x - nx} y1={L.a.y - ny} x2={L.a.x + nx} y2={L.a.y + ny} />
            <line x1={L.b.x - nx} y1={L.b.y - ny} x2={L.b.x + nx} y2={L.b.y + ny} />
          </g>
          {/* Ligne de rappel quand l'étiquette est éloignée */}
          {offset > L.pillH * 1.5 && (
            <line
              x1={L.midX}
              y1={L.midY}
              x2={L.pillCx}
              y2={L.pillCy}
              stroke={couleur}
              strokeWidth={Math.max(1, trait * 0.7)}
              strokeDasharray={`${trait * 3} ${trait * 3}`}
            />
          )}
          {/* Étiquette (déplaçable par poignée) */}
          <rect
            x={L.pillCx - L.pillW / 2}
            y={L.pillCy - L.pillH / 2}
            width={L.pillW}
            height={L.pillH}
            rx={L.pillH / 2}
            fill="#ffffff"
            stroke={couleur}
            strokeWidth={Math.max(1, trait * 0.7)}
          />
          <text
            x={L.pillCx}
            y={L.pillCy + L.fontLabel * 0.36}
            textAnchor="middle"
            fontSize={L.fontLabel}
            fontWeight="700"
            fill="#1c1917"
          >
            {L.texte}
          </text>
        </svg>
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape) {
    const [a, b] = shape.props.points
    const path = new Path2D()
    path.moveTo(a.x, a.y)
    path.lineTo(b.x, b.y)
    return path
  }
}
