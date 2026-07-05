// ════════════════════════════════════════════════════════════════════════════
// ZoneShapeUtil — 'captiv-zone' : zone nommée avec dimensions et surface
// ════════════════════════════════════════════════════════════════════════════
//
// Rectangle translucide + nom centré. Si l'échelle du plan est définie
// (meta.metersPerPx sur la page, cf. étalonnage PlanEditor), affiche les
// dimensions réelles et la surface : « 12,0 × 8,0 m · 96 m² ».
// ════════════════════════════════════════════════════════════════════════════

import { BaseBoxShapeUtil, HTMLContainer, T } from 'tldraw'
import { fmtMeters } from './scale'

export const ZONE_SHAPE_TYPE = 'captiv-zone'

export const zoneShapeProps = {
  w: T.number,
  h: T.number,
  label: T.string,
  couleur: T.string,
  showDims: T.boolean,
}

export class ZoneShapeUtil extends BaseBoxShapeUtil {
  static type = ZONE_SHAPE_TYPE

  static props = zoneShapeProps

  getDefaultProps() {
    return { w: 320, h: 200, label: 'Zone', couleur: '#9c5ffd', showDims: true }
  }

  canEdit() {
    return false
  }

  component(shape) {
    const { w, h, label, couleur, showDims } = shape.props
    // Échelle de la page (posée par l'étalonnage, synchronisée via le doc).
    const page = this.editor.getPage(shape.parentId) || this.editor.getCurrentPage()
    const mpp = Number(page?.meta?.metersPerPx) || 0
    const fontName = Math.max(12, Math.min(40, Math.round(Math.min(w, h) * 0.13)))
    const fontDims = Math.max(10, Math.round(fontName * 0.62))

    let dims = null
    if (showDims && mpp > 0) {
      const wm = w * mpp
      const hm = h * mpp
      dims = `${fmtMeters(wm)} × ${fmtMeters(hm)} m · ${fmtMeters(wm * hm)} m²`
    }

    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `${couleur}20`,
            border: `2px dashed ${couleur}`,
            borderRadius: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              fontSize: fontName,
              fontWeight: 700,
              letterSpacing: 1,
              color: couleur,
              textTransform: 'uppercase',
              textAlign: 'center',
              textShadow: '0 0 4px rgba(255,255,255,0.7)',
              maxWidth: '92%',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
            }}
          >
            {label}
          </div>
          {dims && (
            <div
              style={{
                fontSize: fontDims,
                fontWeight: 600,
                color: couleur,
                opacity: 0.85,
                textShadow: '0 0 4px rgba(255,255,255,0.7)',
              }}
            >
              {dims}
            </div>
          )}
        </div>
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}
