// ════════════════════════════════════════════════════════════════════════════
// exportPNG.js — Export PNG vertical fond d'écran cadreur (FEST-6.B)
// ════════════════════════════════════════════════════════════════════════════
//
// Génère une image PNG format portrait 9:19.5 (1170x2532 px iPhone 14 Pro Max
// lock screen) pour 1 cadreur sélectionné. Pensée pour fond d'écran verrouillé
// — le cadreur a son planning sous les yeux dès qu'il consulte son téléphone.
//
// Contenu :
//   - Header (titre du projet + date + nom du cadreur)
//   - Grille horaire avec :
//     - toutes les lanes de type 'global'
//     - toutes les lanes de type 'lieu' (scènes)
//     - la lane du cadreur sélectionné
//   - Footer (DESK. + heure de génération)
//
// Pas de QR code (V1). Le cadreur peut se référer à la version web via Captiv.
//
// API publique :
//   buildDerouleCadreurPng({
//     project,
//     deroulesData,   // Array<{ deroule, lanes, creneaux, membres }>
//     membreId,       // id du cadreur cible
//     generatedAt,
//   })
//   → { blob, url, filename, download(), revoke() }
//
// Si deroulesData a plusieurs jours, on rend un PNG pour le PREMIER jour
// (ou on pourrait étendre à une zip pour V2).
// ════════════════════════════════════════════════════════════════════════════

import {
  filterLanesForCadreurExport,
  computeTimeBounds,
  getCreneauxForLane,
  getMultiLaneCreneaux,
  getCreneauColor,
  formatHumanDate,
  buildHourGraduations,
  getLaneShortLabel,
  getMembreFullName,
  sanitizeFilename,
  TYPE_LABELS,
} from './derouleExport'
import { effectiveAlerte, formatMinHHMM } from '../../../lib/deroule'
import { getProjectCreneauTypes } from '../../../lib/creneauTypes'

// ─── Dimensions cible (iPhone Pro Max lock screen, ratio 9:19.5) ──────────
const W = 1170
const H = 2532
// Densité utile : 3x → on dessine en HD natif (pas d'upscale)

// Marges
const PAD_X = 50
const HEADER_H = 240
const FOOTER_H = 90
const LANE_HEADER_H = 80
const TIME_COL_W = 90

// ─── Palette (dark theme adapté au fond d'écran) ──────────────────────────
const C = {
  bg: '#0E1014',
  bgPanel: '#15181F',
  bgRow: '#1A1F2A',
  bgRowAlt: '#171C26',
  text: '#F2F4F8',
  textMuted: '#A6ADBC',
  textFaint: '#666D7A',
  border: '#2A3142',
  borderLight: '#1E2433',
  accent: '#3B82F6', // blue
  golden: '#F59E0B',
  green: '#22C55E',
  alertImportant: '#F59E0B',
  alertInfo: '#3B82F6',
}

function ensureCanvas() {
  if (typeof document === 'undefined') {
    throw new Error('exportPNG nécessite un environnement DOM (window)')
  }
  return document.createElement('canvas')
}

// ─── Helpers couleur ──────────────────────────────────────────────────────
function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string') return `rgba(128,128,128,${alpha})`
  const m = hex.replace('#', '')
  if (m.length !== 6) return `rgba(128,128,128,${alpha})`
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return `rgba(128,128,128,${alpha})`
  return `rgba(${r},${g},${b},${alpha})`
}

function normalizeHex(hex) {
  if (!hex || typeof hex !== 'string') return '#888888'
  return hex.startsWith('#') ? hex : `#${hex}`
}

// ─── Helpers texte ────────────────────────────────────────────────────────
/**
 * Wrap un texte sur N lignes max avec ellipsis sur la dernière si overflow.
 * Retourne un tableau de lignes.
 */
function wrapText(ctx, text, maxWidth, maxLines = 2) {
  if (!text) return []
  const words = String(text).split(/\s+/)
  const lines = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (ctx.measureText(test).width <= maxWidth) {
      current = test
    } else {
      if (current) lines.push(current)
      current = word
      if (lines.length >= maxLines) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  // Ellipsis sur la dernière si on a dû couper
  if (lines.length === maxLines) {
    let last = lines[lines.length - 1]
    while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1)
    }
    if (lines.length === maxLines && words.length > lines.flatMap((l) => l.split(/\s+/)).length) {
      lines[lines.length - 1] = `${last}…`
    }
  }
  return lines
}

// ─── Rendu principal ──────────────────────────────────────────────────────
function renderToCanvas({ project, deroule, lanes, creneaux, membres, membreId, generatedAt }) {
  const canvas = ensureCanvas()
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D non disponible')

  // Index des créneaux pour la lookup d'alertes héritées (effectiveAlerte).
  const creneauxById = new Map()
  for (const c of creneaux || []) creneauxById.set(c.id, c)

  // Types projet (core + custom) — pour résoudre les couleurs des types
  // personnalisés. Sans ça, les créneaux de types custom rendent en gris
  // fallback dans l'export.
  const projectTypes = getProjectCreneauTypes(project)

  // ─── Fond global ──────────────────────────────────────────────────────
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)

  // ─── Header ───────────────────────────────────────────────────────────
  // Bandeau dégradé subtil au top
  const gradTop = ctx.createLinearGradient(0, 0, 0, HEADER_H)
  gradTop.addColorStop(0, '#1A1F2C')
  gradTop.addColorStop(1, C.bg)
  ctx.fillStyle = gradTop
  ctx.fillRect(0, 0, W, HEADER_H)

  // Titre projet
  ctx.fillStyle = C.text
  ctx.font = '700 56px -apple-system, system-ui, sans-serif'
  ctx.textBaseline = 'top'
  const projectTitle = project?.title || 'Déroulé'
  ctx.fillText(projectTitle, PAD_X, 50, W - PAD_X * 2)

  // Date du jour
  ctx.fillStyle = C.textMuted
  ctx.font = '500 36px -apple-system, system-ui, sans-serif'
  const dateLabel = formatHumanDate(deroule?.date_jour)
  ctx.fillText(dateLabel, PAD_X, 120, W - PAD_X * 2)

  // Cadreur destinataire
  ctx.fillStyle = C.accent
  ctx.font = '600 32px -apple-system, system-ui, sans-serif'
  const cadreurName = getMembreFullName(membreId, membres)
  ctx.fillText(`Pour ${cadreurName}`, PAD_X, 180, W - PAD_X * 2)

  // ─── Body : grille horaire ────────────────────────────────────────────
  const filteredLanes = filterLanesForCadreurExport(lanes, membreId)
  if (filteredLanes.length === 0) {
    ctx.fillStyle = C.textFaint
    ctx.font = '500 32px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Aucune lane à afficher', W / 2, H / 2)
    ctx.textAlign = 'start'
    return canvas
  }

  const { minStart, maxEnd } = computeTimeBounds(deroule, creneaux)
  const durationMin = maxEnd - minStart
  const bodyTop = HEADER_H
  const bodyBottom = H - FOOTER_H
  const bodyHeight = bodyBottom - bodyTop
  const gridTop = bodyTop + LANE_HEADER_H
  const gridHeight = bodyHeight - LANE_HEADER_H
  const pxPerMin = gridHeight / durationMin

  const gridLeft = PAD_X + TIME_COL_W
  const gridRight = W - PAD_X
  const gridWidth = gridRight - gridLeft
  const laneW = gridWidth / filteredLanes.length

  // ─── Lane headers ─────────────────────────────────────────────────────
  for (let i = 0; i < filteredLanes.length; i += 1) {
    const lane = filteredLanes[i]
    const x = gridLeft + i * laneW
    const baseHex = normalizeHex(lane.couleur || effectiveColorForLaneType(lane.type))
    // Background tinté
    ctx.fillStyle = hexToRgba(baseHex, 0.12)
    ctx.fillRect(x, bodyTop, laneW, LANE_HEADER_H)
    // Bandeau coloré au top
    ctx.fillStyle = baseHex
    ctx.fillRect(x, bodyTop, laneW, 4)
    // Label centré
    ctx.fillStyle = C.text
    ctx.font = '600 28px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = getLaneShortLabel(lane, membres)
    const lines = wrapText(ctx, label, laneW - 16, 2)
    const startY = bodyTop + LANE_HEADER_H / 2 - ((lines.length - 1) * 32) / 2
    for (let j = 0; j < lines.length; j += 1) {
      ctx.fillText(lines[j], x + laneW / 2, startY + j * 32)
    }
    ctx.textAlign = 'start'
    ctx.textBaseline = 'top'
    // Bordure verticale entre lanes
    ctx.strokeStyle = C.borderLight
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, bodyTop)
    ctx.lineTo(x, bodyBottom)
    ctx.stroke()
  }
  // Bordure droite finale
  ctx.beginPath()
  ctx.moveTo(gridRight, bodyTop)
  ctx.lineTo(gridRight, bodyBottom)
  ctx.stroke()

  // ─── Time column + graduations ────────────────────────────────────────
  ctx.fillStyle = C.bgPanel
  ctx.fillRect(PAD_X, gridTop, TIME_COL_W, gridHeight)

  const grads = buildHourGraduations(minStart, maxEnd)
  for (const g of grads) {
    const y = gridTop + (g.minutes - minStart) * pxPerMin
    // Ligne horizontale qui traverse toute la grille
    ctx.strokeStyle = C.borderLight
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD_X + TIME_COL_W, y)
    ctx.lineTo(gridRight, y)
    ctx.stroke()
    // Label heure
    ctx.fillStyle = C.textMuted
    ctx.font = '500 22px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(g.label, PAD_X + TIME_COL_W - 8, y)
    ctx.textAlign = 'start'
    ctx.textBaseline = 'top'
  }

  // ─── Créneaux par lane ────────────────────────────────────────────────
  for (let i = 0; i < filteredLanes.length; i += 1) {
    const lane = filteredLanes[i]
    const xLane = gridLeft + i * laneW
    const laneCreneaux = getCreneauxForLane(creneaux, lane.id, true)
    for (const c of laneCreneaux) {
      renderCreneauBox(ctx, c, {
        x: xLane + 4,
        y: gridTop + (c.heure_debut_min - minStart) * pxPerMin,
        w: laneW - 8,
        h: Math.max(8, (c.heure_fin_min - c.heure_debut_min) * pxPerMin),
        creneauxById,
        projectTypes,
      })
    }
  }

  // ─── Créneaux multi-lane (transverses) ────────────────────────────────
  const multi = getMultiLaneCreneaux(creneaux)
  for (const c of multi) {
    renderCreneauBox(ctx, c, {
      x: gridLeft + 4,
      y: gridTop + (c.heure_debut_min - minStart) * pxPerMin,
      w: gridWidth - 8,
      h: Math.max(8, (c.heure_fin_min - c.heure_debut_min) * pxPerMin),
      membres,
      multiLane: true,
      creneauxById,
      projectTypes,
    })
  }

  // ─── Footer ───────────────────────────────────────────────────────────
  ctx.fillStyle = C.bgPanel
  ctx.fillRect(0, H - FOOTER_H, W, FOOTER_H)

  ctx.fillStyle = C.textMuted
  ctx.font = '500 24px -apple-system, system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('DESK.', PAD_X, H - FOOTER_H / 2)
  ctx.textAlign = 'right'
  const now = generatedAt || new Date()
  const dateStr = now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  ctx.fillText(`Généré le ${dateStr}`, W - PAD_X, H - FOOTER_H / 2)
  ctx.textAlign = 'start'
  ctx.textBaseline = 'top'

  return canvas
}

/**
 * Dessine une box de créneau à l'intérieur du canvas.
 */
function renderCreneauBox(ctx, creneau, { x, y, w, h, multiLane = false, creneauxById = null, projectTypes = null }) {
  if (h < 8) return
  const baseHex = normalizeHex(getCreneauColor(creneau, projectTypes))
  // effectiveAlerte() résout aussi l'héritage soft-link (créneau source).
  const ea = effectiveAlerte(creneau, creneauxById)
  const showAlerte = Boolean(ea)
  // Couleur d'alerte directement depuis ea.niveau (cohérent avec UI).
  const alertColor = showAlerte
    ? ea.niveau === 'info'
      ? '#3B82F6'
      : '#F59E0B'
    : null

  // Fond très sombre teinté
  ctx.fillStyle = hexToRgba(baseHex, 0.15)
  ctx.beginPath()
  roundRect(ctx, x, y, w, h, 6)
  ctx.fill()

  // Bordure gauche colorée
  ctx.fillStyle = baseHex
  ctx.fillRect(x, y, 4, h)

  // Cadre fin
  ctx.strokeStyle = hexToRgba(baseHex, 0.45)
  ctx.lineWidth = 1
  ctx.beginPath()
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6)
  ctx.stroke()

  // ─── Icône alerte (triangle vectoriel) en haut-droite ─────────────────
  // Toujours rendue quand hasAlerte (même sur les petits blocs), pour que
  // le cadreur ait toujours le signal visuel. Le texte de l'alerte vient
  // plus bas si la place le permet (>= 70px de hauteur).
  // On dessine un triangle plein avec un "!" blanc — plus fiable que
  // l'emoji ⚠ qui peut ne pas être supporté par la police système canvas.
  const ALERT_ICON_SIZE = 22
  const ALERT_ICON_MARGIN = 8
  let titleRightInset = 0
  if (showAlerte) {
    titleRightInset = ALERT_ICON_SIZE + 6
    const triCx = x + w - ALERT_ICON_MARGIN - ALERT_ICON_SIZE / 2
    const triCy = y + ALERT_ICON_MARGIN + ALERT_ICON_SIZE / 2
    const triR = ALERT_ICON_SIZE / 2
    ctx.fillStyle = alertColor
    ctx.beginPath()
    if (ea.niveau === 'info') {
      // Cercle pour info
      ctx.arc(triCx, triCy, triR, 0, Math.PI * 2)
    } else {
      // Triangle pour important
      ctx.moveTo(triCx, triCy - triR)
      ctx.lineTo(triCx + triR, triCy + triR * 0.85)
      ctx.lineTo(triCx - triR, triCy + triR * 0.85)
      ctx.closePath()
    }
    ctx.fill()
    // "!" ou "i" blanc au centre
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '900 16px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      ea.niveau === 'info' ? 'i' : '!',
      triCx,
      triCy + (ea.niveau === 'info' ? 1 : 2),
    )
    ctx.textAlign = 'start'
    ctx.textBaseline = 'top'
  }

  // Texte interne
  ctx.fillStyle = C.text
  const titleFontSize = h > 80 ? 28 : h > 50 ? 24 : 20
  ctx.font = `700 ${titleFontSize}px -apple-system, system-ui, sans-serif`
  ctx.textBaseline = 'top'
  const titre = creneau.titre || TYPE_LABELS[creneau.type] || '—'
  const maxLines = h > 130 ? 3 : h > 80 ? 2 : 1
  // Réserve la place de l'icône d'alerte sur la 1ère ligne du titre.
  const titleMaxW = Math.max(8, w - 24 - titleRightInset)
  const titleLines = wrapText(ctx, titre, titleMaxW, maxLines)
  let yCursor = y + 12
  for (let i = 0; i < titleLines.length; i += 1) {
    ctx.fillText(titleLines[i], x + 14, yCursor)
    yCursor += titleFontSize * 1.1
  }

  // Horaires
  if (h >= 50) {
    yCursor += 4
    ctx.fillStyle = C.textMuted
    ctx.font = '500 18px -apple-system, system-ui, sans-serif'
    ctx.fillText(
      `${formatMinHHMM(creneau.heure_debut_min)} – ${formatMinHHMM(creneau.heure_fin_min)}`,
      x + 14,
      yCursor,
    )
    yCursor += 22
  }

  // Lieu si la place le permet
  if (h >= 80 && creneau.lieu_text) {
    ctx.fillStyle = C.textFaint
    ctx.font = '500 16px -apple-system, system-ui, sans-serif'
    ctx.fillText(`📍 ${creneau.lieu_text}`, x + 14, yCursor, w - 28)
    yCursor += 20
  }

  // Texte d'alerte (sous le lieu/horaires) — seuil baissé de 95 à 70 pour
  // qu'un bloc de 1h soit éligible. Si vraiment pas la place, l'icône en
  // haut-droite reste visible comme signal minimal.
  if (showAlerte && h >= 70 && yCursor + 18 < y + h - 4) {
    ctx.fillStyle = alertColor
    ctx.font = '700 16px -apple-system, system-ui, sans-serif'
    const alertLines = wrapText(ctx, ea.text || '', w - 24, 2)
    for (const line of alertLines) {
      if (yCursor + 18 >= y + h - 4) break
      ctx.fillText(line, x + 14, yCursor)
      yCursor += 18
    }
  }

  // Indicateur multi-lane (icône en haut à droite) — uniquement si pas
  // d'alerte (l'alerte occupe déjà ce coin). Sinon on l'omet pour V1.
  if (multiLane && !showAlerte) {
    ctx.fillStyle = C.textFaint
    ctx.font = '600 20px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('↔', x + w - 10, y + 10)
    ctx.textAlign = 'start'
  }
}

/**
 * Polyfill helper pour roundRect (Safari < 16).
 */
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, radius)
    return
  }
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

// Fallback couleur par type de lane
function effectiveColorForLaneType(type) {
  switch (type) {
    case 'lieu':
      return '7C3AED'
    case 'personne':
      return 'F97316'
    case 'global':
      return '6B7280'
    case 'equipe':
      return '0891B2'
    default:
      return '888888'
  }
}

// ─── API publique ─────────────────────────────────────────────────────────

/**
 * Build le PNG du fond d'écran cadreur.
 * Si deroulesData a plusieurs jours, on prend le PREMIER (V1).
 *
 * @returns Promise<{ blob, url, filename, download, revoke }>
 */
export function buildDerouleCadreurPng({
  project,
  deroulesData,
  membreId,
  generatedAt,
}) {
  if (!Array.isArray(deroulesData) || deroulesData.length === 0) {
    return Promise.reject(new Error('Aucun jour sélectionné pour l\'export PNG'))
  }
  // V1 : on rend le PREMIER jour seulement. V2 : multi-jours en zip ou strip.
  const { deroule, lanes, creneaux, membres } = deroulesData[0]
  const canvas = renderToCanvas({
    project,
    deroule,
    lanes,
    creneaux,
    membres,
    membreId,
    generatedAt: generatedAt || new Date(),
  })

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Échec de la conversion canvas → blob'))
          return
        }
        const url = URL.createObjectURL(blob)
        const safeProject = sanitizeFilename(project?.title || 'projet')
        const safeCadreur = sanitizeFilename(
          getMembreFullName(membreId, membres || []),
        )
        const filename = `deroule_${safeProject}_${safeCadreur}_${deroule?.date_jour || ''}.png`
        resolve({
          blob,
          url,
          filename,
          download() {
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
          },
          revoke() {
            URL.revokeObjectURL(url)
          },
        })
      },
      'image/png',
      0.95,
    )
  })
}
