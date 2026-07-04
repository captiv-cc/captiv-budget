// ════════════════════════════════════════════════════════════════════════════
// ItemShapeUtil — shape tldraw 'captiv-item' : élément de la bibliothèque
// ════════════════════════════════════════════════════════════════════════════
//
// Une seule ShapeUtil générique pour tout le catalogue hors caméras : le
// glyphe est résolu par `kind` (catalog.jsx), le label s'affiche dessous.
// ════════════════════════════════════════════════════════════════════════════

import { BaseBoxShapeUtil, HTMLContainer, T } from 'tldraw'
import { Glyph, catalogItem } from './catalog'

export const ITEM_SHAPE_TYPE = 'captiv-item'

export const itemShapeProps = {
  w: T.number,
  h: T.number,
  kind: T.string,
  label: T.string,
  couleur: T.string,
}

export class ItemShapeUtil extends BaseBoxShapeUtil {
  static type = ITEM_SHAPE_TYPE

  static props = itemShapeProps

  getDefaultProps() {
    return { w: 60, h: 60, kind: 'generic', label: 'Élément', couleur: '#a8a8a8' }
  }

  canEdit() {
    return false
  }

  component(shape) {
    const { w, h, kind, label, couleur } = shape.props
    const cat = catalogItem(kind)
    const fontLabel = Math.max(10, Math.round(h * 0.17))
    // Le label ne tourne pas avec l'élément (contre-rotation).
    const deg = ((shape.rotation || 0) * 180) / Math.PI
    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            overflow: 'visible',
          }}
        >
          <div
            style={{
              width: w,
              height: h,
              // Halo blanc derrière le glyphe : détache l'icône des zones
              // denses du fond de plan.
              filter:
                'drop-shadow(0 0 2px rgba(255,255,255,0.9)) drop-shadow(0 0 5px rgba(255,255,255,0.7))',
            }}
          >
            <Glyph glyph={cat?.glyph} color={couleur} label={label} />
          </div>
          {label ? (
            <div
              style={{
                marginTop: 3,
                transform: `rotate(${-deg}deg)`,
                fontSize: fontLabel,
                fontWeight: 700,
                color: '#fff',
                background: couleur,
                border: '1.5px solid rgba(255,255,255,0.9)',
                borderRadius: fontLabel,
                padding: `${Math.round(fontLabel * 0.18)}px ${Math.round(fontLabel * 0.65)}px`,
                whiteSpace: 'nowrap',
                lineHeight: 1.25,
              }}
            >
              {label}
            </div>
          ) : null}
        </div>
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
