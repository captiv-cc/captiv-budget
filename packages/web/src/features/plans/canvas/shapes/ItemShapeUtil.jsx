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
          <div style={{ width: w, height: h }}>
            <Glyph glyph={cat?.glyph} color={couleur} label={label} />
          </div>
          {label ? (
            <div
              style={{
                marginTop: 2,
                fontSize: 11,
                fontWeight: 600,
                color: couleur,
                whiteSpace: 'nowrap',
                textShadow: '0 1px 3px rgba(0,0,0,0.6)',
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
