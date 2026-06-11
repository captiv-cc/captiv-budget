// ════════════════════════════════════════════════════════════════════════════
// derouleColors — couleurs créneaux / lanes (miroir du web)
// ════════════════════════════════════════════════════════════════════════════
//
// Réplique EXACTE de packages/web/src/lib/deroule.js (CRENEAU_TYPE_COLORS,
// LANE_TYPE_DEFAULT_COLORS, CADREUR_COLOR_PALETTE, effectiveCouleurCreneau,
// effectiveLaneColor, colorFromIdString) pour garantir la parité visuelle
// Timeline mobile ↔ web. À garder synchronisé si la palette web évolue.
//
// ════════════════════════════════════════════════════════════════════════════

// Type de créneau → couleur (palette Tailwind 300/400 désaturée).
export const CRENEAU_TYPE_COLORS = {
  // Cool
  install: '#94A3B8',
  show: '#93C5FD',
  interview: '#67E8F9',
  drone: '#5EEAD4',
  postprod: '#A5B4FC',
  brief: '#C4B5FD',
  ambiance: '#D8B4FE',
  // Warm
  tournage: '#FCD34D',
  repas: '#FDBA74',
  captation: '#FCA5A5',
  transport: '#FDA4AF',
  // Neutral
  pause: '#D1D5DB',
  autre: '#9CA3AF',
  indispo: '#888888',
}

// Couleur par défaut par type de lane (hex sans #).
export const LANE_TYPE_DEFAULT_COLORS = {
  global: '5F5E5A',
  equipe: '888780',
  lieu: '7F77DD',
  personne: '378ADD',
}

// Palette cadreur (hex sans #) — couleur stable dérivée du membre_id.
export const CADREUR_COLOR_PALETTE = [
  '378ADD',
  'D85A30',
  '1D9E75',
  'D4537E',
  'BA7517',
  '639922',
  '7F77DD',
]

/**
 * Couleur effective d'un créneau (avec #).
 * Priorité : couleur stockée > type core > 'autre'.
 */
export function effectiveCouleurCreneau(creneau) {
  if (creneau?.couleur && /^#?[0-9a-f]{3,8}$/i.test(creneau.couleur)) {
    return creneau.couleur.startsWith('#') ? creneau.couleur : `#${creneau.couleur}`
  }
  if (creneau?.type && CRENEAU_TYPE_COLORS[creneau.type]) {
    return CRENEAU_TYPE_COLORS[creneau.type]
  }
  return CRENEAU_TYPE_COLORS.autre
}

/** Hash déterministe string → index palette (identique au web). */
function colorFromIdString(id, palette) {
  if (!id || !palette?.length) return palette?.[0] || '888888'
  let h = 0
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return palette[Math.abs(h) % palette.length]
}

/**
 * Couleur effective d'une lane (AVEC # pour usage RN).
 * Priorité : couleur stockée > (personne → palette dérivée du membre_id) > type.
 */
export function effectiveLaneColor(lane) {
  if (!lane) return `#${LANE_TYPE_DEFAULT_COLORS.equipe}`
  const stored = (lane.couleur || '').replace('#', '').trim()
  if (stored) return `#${stored}`
  if (lane.type === 'personne') {
    if (lane.membre_id) return `#${colorFromIdString(lane.membre_id, CADREUR_COLOR_PALETTE)}`
    const i = Math.max(0, (lane.sort_order ?? 0) - 1) % CADREUR_COLOR_PALETTE.length
    return `#${CADREUR_COLOR_PALETTE[i]}`
  }
  return `#${LANE_TYPE_DEFAULT_COLORS[lane.type] || LANE_TYPE_DEFAULT_COLORS.equipe}`
}
