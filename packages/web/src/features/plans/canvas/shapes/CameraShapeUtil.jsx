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
    const traitCone = Math.max(1.5, badge * 0.07)
    const apexX = w / 2
    const apexY = h
    const badgeCy = apexY - badge / 2
    const texte = label || `Cam ${numero}${modele ? ` / ${modele}` : ''}`

    // Pastille label : fond plein couleur + texte blanc (lisible sur plan
    // dense), largeur approximée depuis la longueur du texte.
    const pillW = Math.round(texte.length * fontLabel * 0.62 + fontLabel * 1.4)
    const pillH = Math.round(fontLabel * 1.7)
    const pillY = apexY + badge * 0.25

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
                d={`M ${apexX} ${apexY} L 0 0 L ${w} 0 Z`}
                fill={couleur}
                fillOpacity="0.22"
                stroke="#ffffff"
                strokeOpacity="0.9"
                strokeWidth={traitCone * 2.2}
              />
              <path
                d={`M ${apexX} ${apexY} L 0 0 L ${w} 0 Z`}
                fill="none"
                stroke={couleur}
                strokeWidth={traitCone}
                strokeDasharray={`${badge * 0.3} ${badge * 0.22}`}
              />
            </g>
          )}
          <g transform={`rotate(${-deg} ${apexX} ${badgeCy})`}>
            <circle
              cx={apexX}
              cy={badgeCy}
              r={badge / 2}
              fill={couleur}
              stroke="#ffffff"
              strokeWidth={Math.max(2, badge * 0.09)}
            />
            <text
              x={apexX}
              y={badgeCy + fontBadge * 0.36}
              textAnchor="middle"
              fontSize={fontBadge}
              fontWeight="700"
              fill="#ffffff"
            >
              {numero}
            </text>
            <rect
              x={apexX - pillW / 2}
              y={pillY}
              width={pillW}
              height={pillH}
              rx={pillH / 2}
              fill={couleur}
              stroke="#ffffff"
              strokeWidth={Math.max(1.5, badge * 0.05)}
            />
            <text
              x={apexX}
              y={pillY + pillH / 2 + fontLabel * 0.36}
              textAnchor="middle"
              fontSize={fontLabel}
              fontWeight="700"
              fill="#ffffff"
            >
              {texte}
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
