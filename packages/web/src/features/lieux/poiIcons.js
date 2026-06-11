// ════════════════════════════════════════════════════════════════════════════
// poiIcons.js — jeu d'icônes POI (emoji) + chargement comme images MapLibre
// ════════════════════════════════════════════════════════════════════════════
//
// On rend chaque emoji sur un canvas → ImageData → map.addImage(). Avantages :
// riche en couleurs, recognizable, ZÉRO dépendance de sprite/serveur de glyphes
// (le canvas utilise les fonts emoji système). Le `name` d'image = la clé icône
// stockée dans projet_lieu_pois.icon (ex 'stage').
// ════════════════════════════════════════════════════════════════════════════

export const POI_ICON_EMOJI = {
  pin: '📍',
  flag: '🚩',
  star: '⭐',
  camera: '📷',
  video: '🎥',
  truck: '🚚',
  tent: '⛺',
  parking: '🅿️',
  info: 'ℹ️',
  'first-aid': '⛑️',
  toilet: '🚻',
  food: '🍔',
  stage: '🎤',
  music: '🎵',
  door: '🚪',
}

export const POI_ICON_OPTIONS = ['', ...Object.keys(POI_ICON_EMOJI)]

export function emojiFor(name) {
  return POI_ICON_EMOJI[name] || ''
}

/**
 * Charge toutes les icônes emoji dans la map (idempotent via hasImage).
 * Appeler après le 'load' de la map, avant d'ajouter le layer symbol.
 */
export function loadPoiIconImages(map) {
  const ratio = 2
  const sizeCss = 22
  const px = sizeCss * ratio
  for (const [name, emoji] of Object.entries(POI_ICON_EMOJI)) {
    if (map.hasImage && map.hasImage(name)) continue
    try {
      const canvas = document.createElement('canvas')
      canvas.width = px
      canvas.height = px
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, px, px)
      ctx.font = `${Math.round(px * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(emoji, px / 2, px / 2 + px * 0.04)
      const data = ctx.getImageData(0, 0, px, px)
      map.addImage(name, data, { pixelRatio: ratio })
    } catch (err) {
      console.warn('[poiIcons] addImage échoué', name, err)
    }
  }
}
