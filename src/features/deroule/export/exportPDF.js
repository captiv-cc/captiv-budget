// ════════════════════════════════════════════════════════════════════════════
// exportPDF.js — Export PDF du déroulé (FEST-6.C)
// ════════════════════════════════════════════════════════════════════════════
//
// Génère un PDF A4 paysage horizontal, une page par jour sélectionné.
// Layout :
//   - Header (~22mm) : titre projet + date du jour + nb créneaux
//   - Body (~165mm)  : grille horaire avec time col + lanes côte à côte
//   - Footer (~8mm)  : "Généré par Captiv le DD/MM/YYYY"
//
// API publique :
//   buildDerouleMultiJourPdf({
//     project,            // { id, title, ref_projet, ... }
//     deroulesData,       // Array<{ deroule, lanes, creneaux, membres }>
//     generatedAt,        // Date
//   })
//   → { blob, url, filename, download(), revoke() }
// ════════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import {
  sortLanesForExport,
  computeTimeBounds,
  getCreneauxForLane,
  getMultiLaneCreneaux,
  getCreneauColor,
  getCreneauAlertColor,
  formatHumanDate,
  formatShortDate,
  buildHourGraduations,
  getLaneShortLabel,
  getMembreFullName,
  sanitizeFilename,
  TYPE_LABELS,
} from './derouleExport'
import { hasAlerte, formatMinHHMM } from '../../../lib/deroule'

// ─── Configuration A4 paysage ────────────────────────────────────────────
const PAGE_W = 297 // mm
const PAGE_H = 210 // mm
const MARGIN_X = 10
const MARGIN_TOP = 8
const MARGIN_BOTTOM = 8

const HEADER_H = 18
const FOOTER_H = 8
const LANE_HEADER_H = 9
const TIME_COL_W = 14

// ─── Palette (RGB triplets) ──────────────────────────────────────────────
const C = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  text: [40, 40, 40],
  textMuted: [110, 110, 110],
  textFaint: [160, 160, 160],
  border: [200, 200, 200],
  borderLight: [228, 228, 228],
  borderDark: [120, 120, 120],
  bgRow: [248, 248, 248],
  bgHeader: [240, 240, 245],
  alertImportant: [245, 158, 11], // orange
  alertInfo: [59, 130, 246], // blue
}

// ─── Helpers couleur ─────────────────────────────────────────────────────
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return [128, 128, 128]
  const m = hex.replace('#', '')
  if (m.length !== 6) return [128, 128, 128]
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return [128, 128, 128]
  return [r, g, b]
}

function rgbLighten([r, g, b], pct = 0.85) {
  return [
    Math.round(r + (255 - r) * pct),
    Math.round(g + (255 - g) * pct),
    Math.round(b + (255 - b) * pct),
  ]
}

function rgbDarken([r, g, b], pct = 0.2) {
  return [
    Math.round(r * (1 - pct)),
    Math.round(g * (1 - pct)),
    Math.round(b * (1 - pct)),
  ]
}

// ─── Rendu d'une page (un jour) ───────────────────────────────────────────
function renderDayPage(pdf, { project, deroule, lanes, creneaux, membres, generatedAt }) {
  // ─── Header ───────────────────────────────────────────────────────────
  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(...C.text)
  pdf.text(project?.title || 'Projet', MARGIN_X, MARGIN_TOP + 5)

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(...C.textMuted)
  pdf.text(formatHumanDate(deroule?.date_jour), MARGIN_X, MARGIN_TOP + 11)

  if (project?.ref_projet) {
    pdf.setFontSize(8)
    pdf.setTextColor(...C.textFaint)
    pdf.text(
      `Réf : ${project.ref_projet}`,
      PAGE_W - MARGIN_X,
      MARGIN_TOP + 5,
      { align: 'right' },
    )
  }

  const totalCreneaux = (creneaux || []).length
  pdf.setFontSize(9)
  pdf.setTextColor(...C.textMuted)
  pdf.text(
    `${totalCreneaux} créneau${totalCreneaux > 1 ? 'x' : ''}`,
    PAGE_W - MARGIN_X,
    MARGIN_TOP + 11,
    { align: 'right' },
  )

  // Ligne séparation header / body
  pdf.setDrawColor(...C.borderLight)
  pdf.setLineWidth(0.2)
  pdf.line(
    MARGIN_X,
    MARGIN_TOP + HEADER_H - 2,
    PAGE_W - MARGIN_X,
    MARGIN_TOP + HEADER_H - 2,
  )

  // ─── Body : grille horaire ────────────────────────────────────────────
  const sortedLanes = sortLanesForExport(lanes)
  if (sortedLanes.length === 0) {
    pdf.setFontSize(11)
    pdf.setTextColor(...C.textFaint)
    pdf.text(
      'Aucune lane configurée',
      PAGE_W / 2,
      PAGE_H / 2,
      { align: 'center' },
    )
    return
  }

  const { minStart, maxEnd } = computeTimeBounds(deroule, creneaux)
  const durationMin = maxEnd - minStart
  const bodyTop = MARGIN_TOP + HEADER_H
  const bodyBottom = PAGE_H - MARGIN_BOTTOM - FOOTER_H
  const bodyHeight = bodyBottom - bodyTop
  const gridTop = bodyTop + LANE_HEADER_H
  const gridHeight = bodyHeight - LANE_HEADER_H
  const pxPerMin = gridHeight / durationMin

  const gridLeft = MARGIN_X + TIME_COL_W
  const gridRight = PAGE_W - MARGIN_X
  const gridWidth = gridRight - gridLeft

  // Largeur de chaque lane (égale réparti)
  const laneW = gridWidth / sortedLanes.length

  // ─── Headers des lanes ────────────────────────────────────────────────
  for (let i = 0; i < sortedLanes.length; i += 1) {
    const lane = sortedLanes[i]
    const x = gridLeft + i * laneW
    // Bandeau coloré au top selon le type
    const baseHex = `#${(lane.couleur || effectiveColorForLaneType(lane.type)).replace('#', '')}`
    const tint = rgbLighten(hexToRgb(baseHex), 0.88)
    pdf.setFillColor(...tint)
    pdf.rect(x, bodyTop, laneW, LANE_HEADER_H, 'F')
    // Bordure colorée au top
    pdf.setDrawColor(...hexToRgb(baseHex))
    pdf.setLineWidth(0.6)
    pdf.line(x, bodyTop, x + laneW, bodyTop)
    // Label
    pdf.setFontSize(8.5)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(...C.text)
    const label = getLaneShortLabel(lane, membres)
    pdf.text(label || '—', x + 1.5, bodyTop + LANE_HEADER_H - 2.5, {
      maxWidth: laneW - 3,
    })
    // Bordures verticales entre lanes
    pdf.setDrawColor(...C.borderLight)
    pdf.setLineWidth(0.15)
    pdf.line(x, bodyTop, x, bodyBottom)
  }
  // Bordure droite finale
  pdf.setDrawColor(...C.borderLight)
  pdf.line(gridRight, bodyTop, gridRight, bodyBottom)

  // ─── Time column + graduations ────────────────────────────────────────
  pdf.setFillColor(...C.white)
  pdf.rect(MARGIN_X, gridTop, TIME_COL_W, gridHeight, 'F')

  const grads = buildHourGraduations(minStart, maxEnd)
  for (const g of grads) {
    const y = gridTop + (g.minutes - minStart) * pxPerMin
    // Ligne horizontale qui traverse toute la grille
    pdf.setDrawColor(...C.borderLight)
    pdf.setLineWidth(0.1)
    pdf.line(MARGIN_X + TIME_COL_W, y, gridRight, y)
    // Label heure
    pdf.setFontSize(7)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(...C.textMuted)
    pdf.text(g.label, MARGIN_X + TIME_COL_W - 1, y + 1, { align: 'right' })
  }

  // ─── Créneaux par lane ────────────────────────────────────────────────
  for (let i = 0; i < sortedLanes.length; i += 1) {
    const lane = sortedLanes[i]
    const xLane = gridLeft + i * laneW
    const laneCreneaux = getCreneauxForLane(creneaux, lane.id, true) // pas de multi_lane ici
    for (const c of laneCreneaux) {
      renderCreneauBox(pdf, c, {
        x: xLane + 0.4,
        y: gridTop + (c.heure_debut_min - minStart) * pxPerMin,
        w: laneW - 0.8,
        h: Math.max(2, (c.heure_fin_min - c.heure_debut_min) * pxPerMin),
      })
    }
  }

  // ─── Créneaux multi-lane (en couche par-dessus toute la grille) ───────
  const multi = getMultiLaneCreneaux(creneaux)
  for (const c of multi) {
    renderCreneauBox(pdf, c, {
      x: gridLeft + 0.4,
      y: gridTop + (c.heure_debut_min - minStart) * pxPerMin,
      w: gridWidth - 0.8,
      h: Math.max(2, (c.heure_fin_min - c.heure_debut_min) * pxPerMin),
      membres,
      multiLane: true,
    })
  }

  // ─── Footer ───────────────────────────────────────────────────────────
  pdf.setFontSize(7.5)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(...C.textFaint)
  const footerY = PAGE_H - MARGIN_BOTTOM - 1
  pdf.text(
    `Captiv DESK — généré le ${formatDateTime(generatedAt)}`,
    MARGIN_X,
    footerY,
  )
  pdf.text(
    formatShortDate(deroule?.date_jour),
    PAGE_W - MARGIN_X,
    footerY,
    { align: 'right' },
  )
}

/**
 * Dessine une "box" représentant un créneau dans la grille.
 */
function renderCreneauBox(pdf, creneau, { x, y, w, h, multiLane = false }) {
  if (h < 1) return
  const baseColor = getCreneauColor(creneau)
  const rgb = hexToRgb(baseColor)
  const fill = rgbLighten(rgb, 0.78)
  // Fond
  pdf.setFillColor(...fill)
  pdf.rect(x, y, w, h, 'F')
  // Bordure gauche colorée (signature visuelle)
  pdf.setFillColor(...rgb)
  pdf.rect(x, y, 0.6, h, 'F')
  // Cadre fin pour démarquer
  pdf.setDrawColor(...rgbDarken(rgb, 0.4))
  pdf.setLineWidth(0.1)
  pdf.rect(x, y, w, h, 'S')

  // Texte interne (titre + horaires)
  pdf.setTextColor(...C.text)
  pdf.setFont('helvetica', 'bold')
  const titleFontSize = h > 8 ? 8 : 7
  pdf.setFontSize(titleFontSize)
  const titleY = y + 2.5
  const titre = creneau.titre || TYPE_LABELS[creneau.type] || '—'
  // Wrap titre sur 2-3 lignes max
  const maxLines = h > 16 ? 3 : h > 8 ? 2 : 1
  const titleLines = pdf.splitTextToSize(titre, w - 2)
  for (let i = 0; i < Math.min(titleLines.length, maxLines); i += 1) {
    pdf.text(titleLines[i], x + 1.5, titleY + i * (titleFontSize * 0.4))
  }

  // Horaires (si la place le permet)
  if (h >= 7) {
    const horaireY = titleY + Math.min(titleLines.length, maxLines) * (titleFontSize * 0.4) + 0.8
    if (horaireY + 2 < y + h - 0.5) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(6.5)
      pdf.setTextColor(...C.textMuted)
      pdf.text(
        `${formatMinHHMM(creneau.heure_debut_min)}–${formatMinHHMM(creneau.heure_fin_min)}`,
        x + 1.5,
        horaireY,
      )
    }
  }

  // Alerte (icône + texte court si présente)
  if (hasAlerte(creneau) && h >= 11) {
    const alertColor = getCreneauAlertColor(creneau)
    const alertRgb = alertColor ? hexToRgb(alertColor) : C.alertImportant
    pdf.setFontSize(6.5)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(...alertRgb)
    const alertY = y + h - 1
    const alertLabel = creneau.alerte_niveau === 'important' ? '⚠ ' : 'ℹ '
    pdf.text(
      `${alertLabel}${creneau.alerte_text || ''}`,
      x + 1.5,
      alertY,
      { maxWidth: w - 2 },
    )
  }

  // Indicateur multi-lane
  if (multiLane) {
    pdf.setFontSize(6.5)
    pdf.setTextColor(...C.textFaint)
    pdf.text('↔', x + w - 3, y + 2.5)
  }
}

// Fallback couleur par type de lane si lane.couleur null
function effectiveColorForLaneType(type) {
  switch (type) {
    case 'lieu':
      return '7C3AED' // violet
    case 'personne':
      return 'F97316' // orange
    case 'global':
      return '6B7280' // gray
    case 'equipe':
      return '0891B2' // cyan
    default:
      return '888888'
  }
}

function formatDateTime(d) {
  const date = d || new Date()
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} à ${h}:${m}`
}

// ─── API publique ─────────────────────────────────────────────────────────

/**
 * Build le PDF multi-jours.
 *
 * @param {object} args
 * @param {object} args.project
 * @param {Array<{ deroule, lanes, creneaux, membres }>} args.deroulesData
 * @param {Date} [args.generatedAt]
 * @returns {{ blob, url, filename, download, revoke }}
 */
export function buildDerouleMultiJourPdf({
  project,
  deroulesData,
  generatedAt,
}) {
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  })

  const now = generatedAt || new Date()

  if (!Array.isArray(deroulesData) || deroulesData.length === 0) {
    pdf.setFontSize(14)
    pdf.text('Aucun déroulé à exporter', PAGE_W / 2, PAGE_H / 2, {
      align: 'center',
    })
  } else {
    for (let i = 0; i < deroulesData.length; i += 1) {
      if (i > 0) pdf.addPage()
      const { deroule, lanes, creneaux, membres } = deroulesData[i]
      renderDayPage(pdf, {
        project,
        deroule,
        lanes,
        creneaux,
        membres,
        generatedAt: now,
      })
    }
  }

  const blob = pdf.output('blob')
  const url = URL.createObjectURL(blob)
  const safeName = sanitizeFilename(project?.title || 'projet')
  let dateRange = ''
  if (deroulesData.length === 1) {
    dateRange = `_${deroulesData[0].deroule?.date_jour || ''}`
  } else if (deroulesData.length > 1) {
    const first = deroulesData[0].deroule?.date_jour
    const last = deroulesData[deroulesData.length - 1].deroule?.date_jour
    dateRange = `_${first}_${last}`
  }
  const filename = `deroule_${safeName}${dateRange}.pdf`

  return {
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
  }
}

// Note: getMembreFullName est importé mais utilisé via getLaneShortLabel.
// Reexport pour usage externe potentiel.
export { getMembreFullName }
