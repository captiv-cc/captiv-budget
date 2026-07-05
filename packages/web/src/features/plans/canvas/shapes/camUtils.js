// ════════════════════════════════════════════════════════════════════════════
// camUtils — helpers communs aux 3 types de shapes caméra
// ════════════════════════════════════════════════════════════════════════════

import { CAMERA_SHAPE_TYPE } from './CameraShapeUtil'
import { RAILCAM_SHAPE_TYPE } from './RailCamShapeUtil'
import { SPIDERCAM_SHAPE_TYPE } from './SpiderCamShapeUtil'
import { ZONE_SHAPE_TYPE } from './ZoneShapeUtil'
import { COTE_SHAPE_TYPE } from './CotationShapeUtil'
import { CABLE_SHAPE_TYPE } from './CableShapeUtil'

export const CAM_SHAPE_TYPES = [CAMERA_SHAPE_TYPE, RAILCAM_SHAPE_TYPE, SPIDERCAM_SHAPE_TYPE]

export const CAPTIV_SHAPE_TYPES = [
  ...CAM_SHAPE_TYPES,
  'captiv-item',
  ZONE_SHAPE_TYPE,
  COTE_SHAPE_TYPE,
  CABLE_SHAPE_TYPE,
]

/** Prochain numéro de caméra libre, tous types confondus (box/rail/spider). */
export function nextCamNumero(editor) {
  const cams = editor
    .getCurrentPageShapes()
    .filter((s) => CAM_SHAPE_TYPES.includes(s.type))
  return cams.reduce((m, s) => Math.max(m, s.props.numero || 0), 0) + 1
}
