// ════════════════════════════════════════════════════════════════════════════
// CameraShapeUtil — shape tldraw 'captiv-camera' : caméra + cône de vue
// ════════════════════════════════════════════════════════════════════════════
//
// Géométrie : la box de la shape EST le cône — apex (position caméra) au
// centre bas, ouverture vers le haut. Le badge numéroté + label sont rendus
// à l'apex. La focale pilote la largeur du cône (w = 2·h·tan(θ/2), plein
// format 36mm) ; l'utilisateur peut aussi resizer librement (l'angle affiché
// dans le panneau Propriétés est alors recalculé depuis w/h).
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
    }
  }

  canEdit() {
    return false
  }

  component(shape) {
    const { w, h, couleur, showCone, numero, label, modele } = shape.props
    const badge = 26
    const apexX = w / 2
    const apexY = h
    const texte = label || `Cam ${numero}${modele ? ` / ${modele}` : ''}`

    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          {showCone && (
            <path
              d={`M ${apexX} ${apexY} L 0 0 L ${w} 0 Z`}
              fill={couleur}
              fillOpacity="0.14"
              stroke={couleur}
              strokeOpacity="0.55"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
          )}
          <circle
            cx={apexX}
            cy={apexY - badge / 2}
            r={badge / 2}
            fill={couleur}
            stroke="#ffffff"
            strokeWidth="2"
          />
          <text
            x={apexX}
            y={apexY - badge / 2 + 4}
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill="#ffffff"
          >
            {numero}
          </text>
          <text
            x={apexX}
            y={apexY + 14}
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill={couleur}
            style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 3 }}
          >
            {texte}
          </text>
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
