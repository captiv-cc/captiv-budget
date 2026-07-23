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
  formatHumanDate,
  formatShortDate,
  buildHourGraduations,
  getLaneShortLabel,
  getMembreFullName,
  sanitizeFilename,
  TYPE_LABELS,
} from './derouleExport'
import { effectiveAlerte, ALERTE_COLORS, isCreneauUnavailable, formatMinHHMM } from '../../../lib/deroule'
import { getProjectCreneauTypes } from '../../../lib/creneauTypes'
import { loadImageAsPng, computeLogoBox } from '../../../lib/pdfImageLoader'

// ─── Configuration A4 paysage ────────────────────────────────────────────
const PAGE_W = 297 // mm
const PAGE_H = 210 // mm
const MARGIN_X = 10
const MARGIN_TOP = 8
const MARGIN_BOTTOM = 8

const HEADER_H = 22
const FOOTER_H = 8
const LANE_HEADER_H = 9
const TIME_COL_W = 14
const COVER_SIZE = 14 // mm — taille de l'icône projet dans le header

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
function renderDayPage(pdf, { project, deroule, lanes, creneaux, membres, generatedAt, coverImage }) {
  // Index par id pour le lookup d'alerte héritée via soft link.
  const creneauxById = new Map()
  for (const c of creneaux || []) creneauxById.set(c.id, c)
  // Types projet (core + custom) — pour résoudre les couleurs des types
  // personnalisés. Sans ça, les blocs de types custom rendent en gris fallback.
  const projectTypes = getProjectCreneauTypes(project)
  // ─── Header : cover icône + titre + client + date + ref + nb créneaux ──
  let textLeftX = MARGIN_X
  if (coverImage) {
    // Place l'image cover : carré 14×14 en haut à gauche, respecte le ratio
    const box = computeLogoBox(
      coverImage.width,
      coverImage.height,
      COVER_SIZE,
      COVER_SIZE,
    )
    const imgX = MARGIN_X
    const imgY = MARGIN_TOP + 1
    // Centrer la box dans le carré COVER_SIZE
    const offsetX = (COVER_SIZE - box.width) / 2
    const offsetY = (COVER_SIZE - box.height) / 2
    try {
      pdf.addImage(
        coverImage.dataUrl,
        'PNG',
        imgX + offsetX,
        imgY + offsetY,
        box.width,
        box.height,
        undefined,
        'FAST',
      )
    } catch (e) {
      console.warn('[exportPDF] addImage cover failed', e)
    }
    textLeftX = MARGIN_X + COVER_SIZE + 3.5
  }

  // Titre projet (bold, taille augmentée)
  pdf.setFontSize(15)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(...C.text)
  pdf.text(project?.title || 'Projet', textLeftX, MARGIN_TOP + 5)

  // Nom client (gris medium) - juste sous le titre
  const clientName = project?.clients?.nom_commercial || ''
  let nextLineY = MARGIN_TOP + 10
  if (clientName) {
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(...C.textMuted)
    pdf.text(clientName, textLeftX, nextLineY)
    nextLineY += 4.5
  }

  // Date du jour (gris clair)
  pdf.setFontSize(9.5)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(...C.textMuted)
  pdf.text(formatHumanDate(deroule?.date_jour), textLeftX, nextLineY)

  // Bloc droit : ref + nb créneaux
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

  // (I) Bandes horaires alternées toutes les 2h pour faciliter le scan
  // vertical. On démarre la 1ère bande à l'heure pleine en-dessous de
  // minStart pour rester aligné avec les graduations.
  const firstHour = Math.ceil(minStart / 60) * 60
  for (let m = firstHour; m < maxEnd; m += 120) {
    const bandStart = m
    const bandEnd = Math.min(m + 60, maxEnd)
    if (bandEnd <= bandStart) continue
    const yBand = gridTop + (bandStart - minStart) * pxPerMin
    const hBand = (bandEnd - bandStart) * pxPerMin
    pdf.setFillColor(250, 250, 252) // très très clair, presque invisible
    pdf.rect(gridLeft, yBand, gridWidth, hBand, 'F')
  }

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
        creneauxById,
        projectTypes,
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
      creneauxById,
      projectTypes,
    })
  }

  // ─── Footer ───────────────────────────────────────────────────────────
  pdf.setFontSize(7.5)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(...C.textFaint)
  const footerY = PAGE_H - MARGIN_BOTTOM - 1
  pdf.text(
    `DESK. — généré le ${formatDateTime(generatedAt)}`,
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
 * Format durée compact (cohérent avec la timeline app).
 *   < 60min → "30min"
 *   exact 60 → "1h"
 *   sinon → "1h45"
 */
function formatDureeShort(min) {
  if (typeof min !== 'number' || min <= 0) return ''
  const h = Math.floor(min / 60)
  const m = Math.floor(min % 60)
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

/**
 * Trace un triangle d'alerte vectoriel (filled) avec un "!" blanc à
 * l'intérieur. ⚠ ne s'imprime pas avec helvetica → on dessine.
 *
 * Le triangle fait `size` mm de côté, ancré bottom-left en (x, y).
 */
function drawWarningTriangle(pdf, x, y, size, [r, g, b]) {
  pdf.setFillColor(r, g, b)
  // Triangle pointe vers le haut
  const apex = { x: x + size / 2, y: y - size + 0.2 }
  const bl = { x, y }
  const br = { x: x + size, y }
  pdf.triangle(apex.x, apex.y, bl.x, bl.y, br.x, br.y, 'F')
  // "!" blanc centré
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(size * 2.0)
  pdf.text('!', x + size / 2, y - size * 0.25, { align: 'center' })
}

/**
 * Trace un pattern de hachures diagonales par-dessus une zone, pour
 * représenter les créneaux 'indispo' (cohérent avec la timeline app).
 *
 * Diagonales 45° (sens bas-gauche → haut-droite), clampées au rectangle.
 * Paramètre c = u + v (u: horizontal local 0..w ; v: vertical local 0..h
 * où v est mesuré depuis le BAS du rect). On balaie c de 0 à w+h.
 */
function drawHatchOverlay(pdf, x, y, w, h, [r, g, b]) {
  pdf.setDrawColor(r, g, b)
  pdf.setLineWidth(0.18)
  const spacing = 1.6 // mm entre lignes
  for (let c = 0; c <= w + h; c += spacing) {
    const u1 = Math.max(0, c - h)
    const v1 = Math.min(c, h)
    const u2 = Math.min(c, w)
    const v2 = Math.max(0, c - w)
    // v mesuré depuis le bas → Y_pdf = y + h - v
    pdf.line(x + u1, y + h - v1, x + u2, y + h - v2)
  }
}

/**
 * Dessine une "box" représentant un créneau dans la grille.
 */
function renderCreneauBox(pdf, creneau, { x, y, w, h, multiLane = false, creneauxById = null, projectTypes = null }) {
  if (h < 1) return
  const baseColor = getCreneauColor(creneau, projectTypes)
  const rgb = hexToRgb(baseColor)
  const fill = rgbLighten(rgb, 0.78)
  const isIndispo = isCreneauUnavailable(creneau)
  // effectiveAlerte() résout aussi l'héritage soft-link.
  const ea = effectiveAlerte(creneau, creneauxById)

  // Fond
  pdf.setFillColor(...fill)
  pdf.rect(x, y, w, h, 'F')

  // (G) Indispo : pattern hachuré par-dessus le fond
  if (isIndispo) {
    drawHatchOverlay(pdf, x, y, w, h, rgbDarken(rgb, 0.15))
  }

  // Bordure gauche colorée (signature visuelle)
  pdf.setFillColor(...rgb)
  pdf.rect(x, y, 0.6, h, 'F')
  // Cadre fin pour démarquer
  pdf.setDrawColor(...rgbDarken(rgb, 0.4))
  pdf.setLineWidth(0.1)
  pdf.rect(x, y, w, h, 'S')

  // ─── Calcul de la place dispo / réservation badge durée ───────────────
  // (D) Badge durée en haut à droite (uniquement si h >= 8 et w >= 22)
  const dureeMin = (creneau.heure_fin_min || 0) - (creneau.heure_debut_min || 0)
  const dureeStr = formatDureeShort(dureeMin)
  let badgeWidth = 0
  if (h >= 8 && w >= 22 && dureeStr) {
    pdf.setFontSize(6.5)
    pdf.setFont('helvetica', 'normal')
    badgeWidth = pdf.getTextWidth(dureeStr) + 2
    pdf.setTextColor(...C.textFaint)
    pdf.text(dureeStr, x + w - 1.5, y + 3, { align: 'right' })
  }

  // (A) Bande d'alerte : calculée AVANT le texte pour borner contentMaxY.
  const showAlerte = Boolean(ea) && h >= 9
  const alertColorHex = showAlerte
    ? ALERTE_COLORS[ea.niveau] || ALERTE_COLORS.important
    : null
  const alertRgb = alertColorHex ? hexToRgb(alertColorHex) : C.alertImportant
  const ALERT_BAND_H = 4.2 // mm
  const alertBandY = showAlerte ? y + h - ALERT_BAND_H : null
  const contentMaxY = showAlerte ? alertBandY - 0.6 : y + h - 0.5

  // ─── Texte interne (titre + horaires + lieu) ──────────────────────────
  // Heure de début TOUJOURS visible. Créneau < 20 min → début seul ; sinon
  // plage début–fin.
  const startStr = formatMinHHMM(creneau.heure_debut_min)
  const startOnly = dureeMin < 20
  const timeStr = startOnly
    ? startStr
    : `${startStr}–${formatMinHHMM(creneau.heure_fin_min)}`

  pdf.setTextColor(...C.text)
  const titleFontSize = h > 8 ? 8 : 7
  const lineH = titleFontSize * 0.4
  const titleY = y + 2.5
  const titre = creneau.titre || TYPE_LABELS[creneau.type] || '—'
  const maxLines = h > 16 ? 3 : h > 8 ? 2 : 1
  const titleMaxW = Math.max(8, w - 2 - badgeWidth - 1)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(titleFontSize)
  const titleLines = pdf.splitTextToSize(titre, titleMaxW)
  const nTitleLines = Math.min(titleLines.length, maxLines)
  // La ligne d'horaire dédiée tient-elle sous le titre ?
  const timeLineFits = titleY + nTitleLines * lineH + 0.8 + 2 < contentMaxY

  let cursorY
  if (timeLineFits) {
    // Titre normal + ligne d'horaire dédiée dessous.
    for (let i = 0; i < nTitleLines; i += 1) {
      pdf.text(titleLines[i], x + 1.5, titleY + i * lineH)
    }
    cursorY = titleY + nTitleLines * lineH + 0.8
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6.5)
    pdf.setTextColor(...C.textMuted)
    pdf.text(timeStr, x + 1.5, cursorY)
    cursorY += 3
  } else {
    // Pas la place pour une ligne dédiée → heure de début préfixée au titre,
    // mais EN PETIT GRIS (cohérente avec les autres horaires) ; titre en gras.
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6.5)
    const timeW = pdf.getTextWidth(startStr) + 1.5
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(titleFontSize)
    // Wrap : 1ère ligne réduite par la largeur de l'heure, suite pleine largeur.
    let lines
    if (pdf.getTextWidth(titleLines[0] || '') <= titleMaxW - timeW) {
      lines = titleLines
    } else {
      const firstFit = pdf.splitTextToSize(titre, Math.max(6, titleMaxW - timeW))
      const first = firstFit[0] || titre
      const rest = titre.slice(first.length).replace(/^\s+/, '')
      const restLines = rest ? pdf.splitTextToSize(rest, titleMaxW) : []
      lines = [first, ...restLines]
    }
    const nLines = Math.min(lines.length, maxLines)
    pdf.setTextColor(...C.text)
    for (let i = 0; i < nLines; i += 1) {
      pdf.text(lines[i], i === 0 ? x + 1.5 + timeW : x + 1.5, titleY + i * lineH)
    }
    // Heure de début en petit gris, posée dans l'espace réservé en tête de ligne.
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6.5)
    pdf.setTextColor(...C.textMuted)
    pdf.text(startStr, x + 1.5, titleY)
    cursorY = titleY + nLines * lineH + 0.8
  }

  // (F) Lieu sous les horaires (si présent et place dispo)
  if (creneau.lieu_text && h >= 11 && cursorY + 2 < contentMaxY) {
    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(6)
    pdf.setTextColor(...C.textMuted)
    const lieuLines = pdf.splitTextToSize(creneau.lieu_text, w - 2.5)
    if (lieuLines[0]) {
      pdf.text(lieuLines[0], x + 1.5, cursorY)
    }
  }

  // (A) Alerte : bande de fond orange/bleu + triangle vectoriel + texte
  if (showAlerte) {
    const bgRgb = rgbLighten(alertRgb, 0.75)
    pdf.setFillColor(...bgRgb)
    pdf.rect(x + 0.6, alertBandY, w - 0.6, ALERT_BAND_H, 'F')
    // Triangle (taille 2.4mm) ancré à 1mm du bord gauche, base sur la
    // baseline du texte d'alerte.
    const triSize = 2.4
    const triX = x + 1.6
    const triBaseY = alertBandY + ALERT_BAND_H - 0.8
    drawWarningTriangle(pdf, triX, triBaseY, triSize, alertRgb)
    // Texte alerte (sans symbole — le triangle fait le job)
    pdf.setFontSize(6.5)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(...rgbDarken(alertRgb, 0.35))
    const alertTextX = triX + triSize + 1
    pdf.text(
      ea.text || '',
      alertTextX,
      alertBandY + ALERT_BAND_H - 1.3,
      { maxWidth: w - (alertTextX - x) - 1 },
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
export async function buildDerouleMultiJourPdf({
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

  // Preload de l'icône projet (cover_url). Si échec, on continue sans
  // image (header s'adapte automatiquement via textLeftX).
  let coverImage = null
  if (project?.cover_url) {
    try {
      coverImage = await loadImageAsPng(project.cover_url)
    } catch (e) {
      console.warn('[exportPDF] cover_url load failed', e)
    }
  }

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
        coverImage,
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
