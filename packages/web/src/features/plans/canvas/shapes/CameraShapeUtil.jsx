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
    // Tailles proportionnelles au cône : lisible sur un petit croquis comme
    // sur un fond de plan de 3000px (badge ~11% de la hauteur, bornés).
    const badge = Math.max(22, Math.min(64, Math.round(h * 0.11)))
    const fontBadge = Math.round(badge * 0.46)
    const fontLabel = Math.max(11, Math.round(badge * 0.42))
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
              fillOpacity="0.22"
              stroke={couleur}
              strokeOpacity="0.85"
              strokeWidth={Math.max(1.5, badge * 0.08)}
              strokeDasharray={`${badge * 0.3} ${badge * 0.22}`}
            />
          )}
          <circle
            cx={apexX}
            cy={apexY - badge / 2}
            r={badge / 2}
            fill={couleur}
            stroke="#ffffff"
            strokeWidth={Math.max(2, badge * 0.09)}
          />
          <text
            x={apexX}
            y={apexY - badge / 2 + fontBadge * 0.36}
            textAnchor="middle"
            fontSize={fontBadge}
            fontWeight="700"
            fill="#ffffff"
          >
            {numero}
          </text>
          <text
            x={apexX}
            y={apexY + fontLabel + 4}
            textAnchor="middle"
            fontSize={fontLabel}
            fontWeight="700"
            fill={couleur}
            style={{
              // Halo double (blanc épais) : lisible sur fond de plan clair
              // comme sur canvas sombre.
              paintOrder: 'stroke',
              stroke: 'rgba(255,255,255,0.9)',
              strokeWidth: fontLabel * 0.35,
            }}
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
