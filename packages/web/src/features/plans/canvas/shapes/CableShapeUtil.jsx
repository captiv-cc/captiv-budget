// ════════════════════════════════════════════════════════════════════════════
// CableShapeUtil + CableTool — 'captiv-cable' : parcours de câble typé
// ════════════════════════════════════════════════════════════════════════════
//
// Tracé « plume » (CableTool) : clic par clic pour poser les points, aperçu
// du segment sous le curseur, double-clic ou Entrée pour terminer, Échap
// pour annuler. Retouche ensuite comme un travelling : poignées sur les
// points, « + » au milieu des segments, double-clic pour supprimer un point,
// option trajectoire courbe.
//
// Type (CABLE_TYPES) → couleur + tirets. Si l'échelle du plan est définie,
// l'étiquette affiche le métrage (déplaçable, ligne de rappel).
// ════════════════════════════════════════════════════════════════════════════

import { ShapeUtil, StateNode, Polyline2d, Vec, HTMLContainer, T, createShapeId } from 'tldraw'
import { CABLE_TYPES } from './catalog'
import { sampleRail, pointAtT, railSvgPath } from './railMath'
import { fmtMeters } from './scale'

export const CABLE_SHAPE_TYPE = 'captiv-cable'

export const cableShapeProps = {
  points: T.arrayOf(T.object({ x: T.number, y: T.number })),
  cableType: T.string,
  label: T.string,
  spline: T.boolean,
  labelDx: T.number.optional(),
  labelDy: T.number.optional(),
}

function cableMeta(props) {
  return CABLE_TYPES[props.cableType] || CABLE_TYPES.autre
}

/** Longueur du chemin échantillonné (px canvas). */
export function cableLengthPx(props) {
  const pts = sampleRail(props.points, props.spline)
  let len = 0
  for (let i = 1; i < pts.length; i += 1) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return len
}

function cableLayout(props, mpp) {
  const pts = sampleRail(props.points, props.spline)
  const lenPx = cableLengthPx(props)
  const type = cableMeta(props)
  const metrage = mpp > 0 ? `${fmtMeters(lenPx * mpp)} m` : null
  const texte = [props.label || type.label, metrage].filter(Boolean).join(' · ')
  const mid = pointAtT(pts, 0.5)
  return { pts, type, texte, mid }
}

export class CableShapeUtil extends ShapeUtil {
  static type = CABLE_SHAPE_TYPE

  static props = cableShapeProps

  getDefaultProps() {
    return {
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      cableType: 'autre',
      label: '',
      spline: false,
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
    const { points } = shape.props
    const handles = points.map((p, i) => ({
      id: `p${i}`,
      type: 'vertex',
      x: p.x,
      y: p.y,
      canSnap: true,
    }))
    for (let i = 0; i < points.length - 1; i += 1) {
      handles.push({
        id: `mid${i}`,
        type: 'create',
        x: (points[i].x + points[i + 1].x) / 2,
        y: (points[i].y + points[i + 1].y) / 2,
        canSnap: false,
      })
    }
    return handles
  }

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
        points[idx + 1] = { x: handle.x, y: handle.y }
      } else {
        points.splice(idx + 1, 0, { x: handle.x, y: handle.y })
        this._midInsert = `${shape.id}:${handle.id}`
      }
      return { id: shape.id, type: shape.type, props: { points } }
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

  component(shape) {
    const page = this.editor.getPage(shape.parentId) || this.editor.getCurrentPage()
    const mpp = Number(page?.meta?.metersPerPx) || 0
    const L = cableLayout(shape.props, mpp)
    const path = railSvgPath(L.pts)
    const trait = 3
    const isSelected = this.editor.getOnlySelectedShapeId?.() === shape.id

    // Label discret le long du câble : orienté sur la tangente au milieu,
    // retourné si nécessaire pour rester lisible, décalé au-dessus du trait.
    let labelDeg = (L.mid.angle * 180) / Math.PI
    if (labelDeg > 90 || labelDeg < -90) labelDeg += 180
    const rad = (labelDeg * Math.PI) / 180
    const labelX = L.mid.x + Math.sin(rad) * 7
    const labelY = L.mid.y - Math.cos(rad) * 7

    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <path d={path} fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth={trait + 2.5} strokeLinecap="round" strokeLinejoin="round" />
          <path
            d={path}
            fill="none"
            stroke={L.type.color}
            strokeWidth={trait}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={L.type.dash || undefined}
          />
          {/* Extrémités */}
          {[L.pts[0], L.pts[L.pts.length - 1]].map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={trait * 1.4} fill={L.type.color} stroke="#fff" strokeWidth="1.4" />
          ))}
          {/* Affordance + sur les segments quand sélectionné */}
          {isSelected &&
            shape.props.points.slice(0, -1).map((p, i) => {
              const next = shape.props.points[i + 1]
              const mx = (p.x + next.x) / 2
              const my = (p.y + next.y) / 2
              return (
                <g key={`plus-${i}`} opacity="0.85">
                  <circle cx={mx} cy={my} r="7" fill="#ffffff" stroke={L.type.color} strokeWidth="1.4" />
                  <path d={`M ${mx - 3} ${my} H ${mx + 3} M ${mx} ${my - 3} V ${my + 3}`} stroke={L.type.color} strokeWidth="1.6" strokeLinecap="round" />
                </g>
              )
            })}
          {/* Label discret, une fois, le long du câble */}
          <text
            x={labelX}
            y={labelY}
            transform={`rotate(${labelDeg} ${labelX} ${labelY})`}
            textAnchor="middle"
            fontSize="9"
            fontWeight="600"
            fill={L.type.color}
            style={{ paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.9)', strokeWidth: 2.5 }}
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

/* ─── CableTool — tracé clic-par-clic (plume) ───────────────────────────── */

const CLICK_EPSILON = 3

export class CableTool extends StateNode {
  static id = 'captiv-cable'

  onEnter(info) {
    this.cableType = info?.cableType || 'autre'
    this.shapeId = null
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  onExit() {
    this._finalize()
    this.editor.setCursor({ type: 'default', rotation: 0 })
  }

  _local(shape, pagePoint) {
    return { x: pagePoint.x - shape.x, y: pagePoint.y - shape.y }
  }

  onPointerDown() {
    const p = this.editor.inputs.currentPagePoint
    if (!this.shapeId) {
      const id = createShapeId()
      this.shapeId = id
      this.editor.createShape({
        id,
        type: CABLE_SHAPE_TYPE,
        x: p.x,
        y: p.y,
        meta: { layer: 'cables' },
        props: {
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 0 }, // point d'aperçu, suit le curseur
          ],
          cableType: this.cableType,
          label: '',
          spline: false,
        },
      })
      return
    }
    const shape = this.editor.getShape(this.shapeId)
    if (!shape) return
    const local = this._local(shape, p)
    const points = [...shape.props.points]
    points[points.length - 1] = local
    points.push(local)
    this.editor.updateShape({ id: shape.id, type: shape.type, props: { points } })
  }

  onPointerMove() {
    if (!this.shapeId) return
    const shape = this.editor.getShape(this.shapeId)
    if (!shape) return
    const local = this._local(shape, this.editor.inputs.currentPagePoint)
    const points = [...shape.props.points]
    points[points.length - 1] = local
    this.editor.updateShape({ id: shape.id, type: shape.type, props: { points } })
  }

  onDoubleClick() {
    this._complete()
  }

  onKeyDown(info) {
    if (info.key === 'Enter') this._complete()
  }

  onCancel() {
    // Échap : abandonne le tracé en cours.
    if (this.shapeId) {
      this.editor.deleteShapes([this.shapeId])
      this.shapeId = null
    }
    this.editor.setCurrentTool('select')
  }

  // Retire l'aperçu + les doublons du double-clic ; supprime si dégénéré.
  _finalize() {
    if (!this.shapeId) return null
    const shape = this.editor.getShape(this.shapeId)
    this.shapeId = null
    if (!shape) return null
    const cleaned = []
    for (const pt of shape.props.points) {
      const prev = cleaned[cleaned.length - 1]
      if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > CLICK_EPSILON) cleaned.push(pt)
    }
    if (cleaned.length < 2) {
      this.editor.deleteShapes([shape.id])
      return null
    }
    this.editor.updateShape({ id: shape.id, type: shape.type, props: { points: cleaned } })
    return shape.id
  }

  _complete() {
    const id = this._finalize()
    this.editor.setCurrentTool('select')
    if (id) this.editor.setSelectedShapes([id])
  }
}
