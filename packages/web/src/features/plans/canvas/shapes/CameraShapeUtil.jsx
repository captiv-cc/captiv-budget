// ════════════════════════════════════════════════════════════════════════════
// CameraShapeUtil — shape tldraw 'captiv-camera' : caméra + cône de vue
// ════════════════════════════════════════════════════════════════════════════
//
// Géométrie : la box de la shape EST le cône — apex (position caméra) au
// centre bas, ouverture vers le haut. Le badge numéroté + la pastille label
// sont rendus à l'apex, contre-rotés (toujours horizontaux à l'écran).
// La focale pilote la largeur du cône (w = 2·h·tan(θ/2), plein format 36mm).
//
// Pastille déplaçable : poignée native tldraw (getHandles/onHandleDrag) →
// labelDx/labelDy (offset en espace écran, optionnels pour la compat des
// docs déjà sauvegardés). Une ligne de rappel relie la caméra à sa pastille
// quand elle est éloignée.
//
// Rotation native tldraw (poignée) = orientation de la caméra.
// ════════════════════════════════════════════════════════════════════════════

import { BaseBoxShapeUtil, HTMLContainer, T } from 'tldraw'

export const CAMERA_SHAPE_TYPE = 'captiv-camera'
export const CAMERA_DEFAULT_H = 240

export const cameraShapeProps = {
  w: T.number,
  h: T.number,
  label: T.string,
  modele: T.string,
  focale: T.number,
  couleur: T.string,
  showCone: T.boolean,
  numero: T.number,
  // Offset manuel de la pastille (espace écran, non-roté). Optionnels :
  // les shapes créées avant cette version n'ont pas ces props.
  labelDx: T.number.optional(),
  labelDy: T.number.optional(),
}

// Dimensions dérivées, partagées entre component / handles.
function cameraLayout(props) {
  const { w, h } = props
  const badge = Math.max(22, Math.min(64, Math.round(h * 0.11)))
  const fontBadge = Math.round(badge * 0.46)
  const fontLabel = Math.max(11, Math.round(badge * 0.42))
  const texte =
    props.label || `Cam ${props.numero}${props.modele ? ` / ${props.modele}` : ''}`
  const pillW = Math.round(texte.length * fontLabel * 0.62 + fontLabel * 1.4)
  const pillH = Math.round(fontLabel * 1.7)
  const apexX = w / 2
  const apexY = h
  const badgeCy = apexY - badge / 2
  // Centre de la pastille, offset inclus (dans le repère contre-roté).
  const pillCx = apexX + (props.labelDx ?? 0)
  const pillCy = apexY + badge * 0.25 + pillH / 2 + (props.labelDy ?? 0)
  return { badge, fontBadge, fontLabel, texte, pillW, pillH, apexX, apexY, badgeCy, pillCx, pillCy }
}

// Rotation d'un point autour d'un centre (radians).
function rotatePoint(px, py, cx, cy, rad) {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

export class CameraShapeUtil extends BaseBoxShapeUtil {
  static type = CAMERA_SHAPE_TYPE

  static props = cameraShapeProps

  getDefaultProps() {
    return {
      w: 160,
      h: CAMERA_DEFAULT_H,
      label: '',
      modele: 'FX6',
      focale: 35,
      couleur: '#4d9fff',
      showCone: true,
      numero: 1,
      labelDx: 0,
      labelDy: 0,
    }
  }

  canEdit() {
    return false
  }

  // ── Poignée de déplacement de la pastille ──────────────────────────────────
  // La pastille est dessinée dans un groupe contre-roté autour du badge : la
  // poignée (en espace local shape) doit suivre la position VISUELLE →
  // rotation inverse autour du centre du badge.
  getHandles(shape) {
    const L = cameraLayout(shape.props)
    const rot = shape.rotation || 0
    const q = rotatePoint(L.pillCx, L.pillCy, L.apexX, L.badgeCy, -rot)
    return [
      {
        id: 'label',
        type: 'vertex',
        x: q.x,
        y: q.y,
        canSnap: false,
      },
    ]
  }

  onHandleDrag(shape, { handle }) {
    if (handle.id !== 'label') return undefined
    const L = cameraLayout(shape.props)
    const rot = shape.rotation || 0
    // Inverse de getHandles : local → repère contre-roté de la pastille.
    const p = rotatePoint(handle.x, handle.y, L.apexX, L.badgeCy, rot)
    const baseCy = L.apexY + L.badge * 0.25 + L.pillH / 2
    return {
      id: shape.id,
      type: shape.type,
      props: {
        labelDx: Math.round(p.x - L.apexX),
        labelDy: Math.round(p.y - baseCy),
      },
    }
  }

  component(shape) {
    const { couleur, showCone, numero } = shape.props
    const w = shape.props.w
    const h = shape.props.h
    const L = cameraLayout(shape.props)
    const traitCone = Math.max(1.5, L.badge * 0.07)
    const offset = Math.hypot(shape.props.labelDx ?? 0, shape.props.labelDy ?? 0)

    // Le texte ne doit JAMAIS tourner avec la caméra : contre-rotation du
    // groupe badge+pastille autour du centre du badge.
    const deg = ((shape.rotation || 0) * 180) / Math.PI

    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          {showCone && (
            <g>
              {/* Liseré blanc sous le trait couleur : contraste sur les
                  zones denses du fond de plan. */}
              <path
                d={`M ${L.apexX} ${L.apexY} L 0 0 L ${w} 0 Z`}
                fill={couleur}
                fillOpacity="0.22"
                stroke="#ffffff"
                strokeOpacity="0.9"
                strokeWidth={traitCone * 2.2}
              />
              <path
                d={`M ${L.apexX} ${L.apexY} L 0 0 L ${w} 0 Z`}
                fill="none"
                stroke={couleur}
                strokeWidth={traitCone}
                strokeDasharray={`${L.badge * 0.3} ${L.badge * 0.22}`}
              />
            </g>
          )}
          <g transform={`rotate(${-deg} ${L.apexX} ${L.badgeCy})`}>
            {/* Ligne de rappel badge → pastille quand elle est décalée */}
            {offset > L.badge * 0.9 && (
              <line
                x1={L.apexX}
                y1={L.apexY}
                x2={L.pillCx}
                y2={L.pillCy}
                stroke={couleur}
                strokeWidth={Math.max(1.2, L.badge * 0.05)}
                strokeDasharray={`${L.badge * 0.14} ${L.badge * 0.14}`}
              />
            )}
            <circle
              cx={L.apexX}
              cy={L.badgeCy}
              r={L.badge / 2}
              fill={couleur}
              stroke="#ffffff"
              strokeWidth={Math.max(2, L.badge * 0.09)}
            />
            <text
              x={L.apexX}
              y={L.badgeCy + L.fontBadge * 0.36}
              textAnchor="middle"
              fontSize={L.fontBadge}
              fontWeight="700"
              fill="#ffffff"
            >
              {numero}
            </text>
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
          </g>
        </svg>
      </HTMLContainer>
    )
  }

  // tldraw v5 : l'indicateur de sélection est un Path2D (indicator() JSX est
  // déprécié et n'est plus rendu).
  getIndicatorPath(shape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}
