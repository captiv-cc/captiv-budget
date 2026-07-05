// ════════════════════════════════════════════════════════════════════════════
// legend — légende dérivée du contenu d'un plan (caméras, éléments, zones)
// ════════════════════════════════════════════════════════════════════════════
// Partagé entre la page publique (sidebar) et l'export PDF.

import { CAM_SHAPE_TYPES } from './camUtils'
import { ZONE_SHAPE_TYPE } from './ZoneShapeUtil'

/**
 * @param {Array} records — records tldraw (store.allRecords() ou doc Yjs)
 * @returns {Array<{label: string, color: string, kind: 'cam'|'item'}>}
 */
export function buildLegend(records) {
  const entries = []
  const camGroups = new Map() // support → { color, count }
  const itemGroups = new Map() // label → { color, count }
  records.forEach((r) => {
    if (r.typeName !== 'shape') return
    if (CAM_SHAPE_TYPES.includes(r.type)) {
      const key = r.props?.support || 'Caméra'
      const g = camGroups.get(key) || { color: r.props?.couleur || '#4d9fff', count: 0 }
      g.count += 1
      camGroups.set(key, g)
    } else if (r.type === 'captiv-item') {
      const key = r.props?.label || 'Élément'
      const g = itemGroups.get(key) || { color: r.props?.couleur || '#a8a8a8', count: 0 }
      g.count += 1
      itemGroups.set(key, g)
    } else if (r.type === ZONE_SHAPE_TYPE) {
      entries.push({
        label: `Zone ${r.props?.label || ''}`.trim(),
        color: r.props?.couleur || '#9c5ffd',
        kind: 'item',
      })
    }
  })
  camGroups.forEach((g, key) => entries.push({ label: `${key} (${g.count})`, color: g.color, kind: 'cam' }))
  itemGroups.forEach((g, key) =>
    entries.push({ label: g.count > 1 ? `${key} (${g.count})` : key, color: g.color, kind: 'item' }),
  )
  return entries.slice(0, 14)
}
