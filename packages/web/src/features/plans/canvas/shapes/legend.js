// ════════════════════════════════════════════════════════════════════════════
// legend — légende dérivée du contenu d'un plan (caméras, éléments, zones)
// ════════════════════════════════════════════════════════════════════════════
// Partagé entre la page publique (sidebar) et l'export PDF.

import { CAM_SHAPE_TYPES } from './camUtils'
import { ZONE_SHAPE_TYPE } from './ZoneShapeUtil'
import { CABLE_SHAPE_TYPE, cableLengthPx } from './CableShapeUtil'
import { CABLE_TYPES } from './catalog'

/**
 * @param {Array} records — records tldraw (store.allRecords() ou doc Yjs)
 * @returns {Array<{label: string, color: string, kind: 'cam'|'item'|'cable'}>}
 */
export function buildLegend(records) {
  const entries = []
  const camGroups = new Map() // support → { color, count }
  const itemGroups = new Map() // label → { color, count }
  const cableGroups = new Map() // type → { count, lenPx }
  records.forEach((r) => {
    if (r.typeName !== 'shape') return
    if (r.type === CABLE_SHAPE_TYPE) {
      const key = r.props?.cableType || 'autre'
      const g = cableGroups.get(key) || { count: 0, lenPx: 0 }
      g.count += 1
      g.lenPx += cableLengthPx(r.props)
      cableGroups.set(key, g)
      return
    }
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
  // Câbles : couleur + quantité SEULEMENT (décision Hugo 2026-07-07) — le
  // cumul de métrage n'était pas actionnable en légende ; le métrage
  // détaillé par tirage vit dans la nomenclature.
  cableGroups.forEach((g, key) => {
    const type = CABLE_TYPES[key] || CABLE_TYPES.autre
    entries.push({
      label: `${type.label} (${g.count})`,
      color: type.color,
      kind: 'cable',
    })
  })
  return entries.slice(0, 16)
}
