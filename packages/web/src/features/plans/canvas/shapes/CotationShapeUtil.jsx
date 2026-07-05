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
    return shape.props.points.map((p, i) => ({
      id: `p${i}`,
      type: 'vertex',
      x: p.x,
      y: p.y,
      canSnap: true,
    }))
  }

  onHandleDrag(shape, { handle }) {
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
    const [a, b] = shape.props.points
    const lenPx = Math.hypot(b.x - a.x, b.y - a.y)
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    // Traits d'extrémité perpendiculaires.
    const tick = Math.max(6, Math.min(16, lenPx * 0.05))
    const nx = Math.sin(angle) * tick
    const ny = -Math.cos(angle) * tick
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2

    // Distance : mètres si échelle définie sur la page, sinon pixels.
    const page = this.editor.getPage(shape.parentId) || this.editor.getCurrentPage()
    const mpp = Number(page?.meta?.metersPerPx) || 0
    const texte = mpp > 0 ? `${fmtMeters(lenPx * mpp)} m` : `${Math.round(lenPx)} px`

    const fontLabel = Math.max(10, Math.min(15, Math.round(lenPx * 0.045)))
    const pillW = Math.round(texte.length * fontLabel * 0.62 + fontLabel * 1.2)
    const pillH = Math.round(fontLabel * 1.6)
    const trait = Math.max(1.5, fontLabel * 0.12)

    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {/* Liseré blanc pour le contraste sur fond dense */}
          <g stroke="#ffffff" strokeOpacity="0.9" strokeWidth={trait * 2.4} strokeLinecap="round">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <line x1={a.x - nx} y1={a.y - ny} x2={a.x + nx} y2={a.y + ny} />
            <line x1={b.x - nx} y1={b.y - ny} x2={b.x + nx} y2={b.y + ny} />
          </g>
          <g stroke={couleur} strokeWidth={trait} strokeLinecap="round">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <line x1={a.x - nx} y1={a.y - ny} x2={a.x + nx} y2={a.y + ny} />
            <line x1={b.x - nx} y1={b.y - ny} x2={b.x + nx} y2={b.y + ny} />
          </g>
          {/* Étiquette horizontale au milieu */}
          <rect
            x={midX - pillW / 2}
            y={midY - pillH - tick * 0.6}
            width={pillW}
            height={pillH}
            rx={pillH / 2}
            fill="#ffffff"
            stroke={couleur}
            strokeWidth={Math.max(1, trait * 0.7)}
          />
          <text
            x={midX}
            y={midY - pillH / 2 - tick * 0.6 + fontLabel * 0.36}
            textAnchor="middle"
            fontSize={fontLabel}
            fontWeight="700"
            fill="#1c1917"
          >
            {texte}
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
