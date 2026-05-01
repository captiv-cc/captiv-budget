// ════════════════════════════════════════════════════════════════════════════
// livrablesSharePdfExport.js — Export PDF "Vue client" (LIV-24E)
// ════════════════════════════════════════════════════════════════════════════
//
// Génère un PDF A4 portrait propre, partageable au client en pièce jointe
// d'email. Volontairement différent de LIV-23 (qui est un Gantt jours ×
// livrables pour usage interne) : ici on présente l'avancement projet de
// manière narrative, calquée sur la page web /share/livrables/:token.
//
// Layout :
//   Page 1 :
//     Header (50 mm)   : vignette projet + titre + ref + date màj
//     Bandeau périodes : tournage, livraison master, deadline (chips)
//     Liste livrables  : groupés par bloc, chaque livrable avec ses versions
//   Pages suivantes : pagination naturelle de la liste si débordement.
//
// API publique :
//   buildLivrablesSharePdf(payload, options?) → { blob, url, filename,
//     download(), revoke() }
//
//   payload : retour de share_livrables_fetch (RPC) — exactement la même
//             shape que ce que la page web consomme.
//   options : { generatedAt? }
//
// Toutes les couleurs sont en RGB hardcodé pour stabilité d'impression.
// Les CSS vars de l'app (utilisées en web) ne sont pas accessibles ici.
// ════════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'

// ─── Palette ──────────────────────────────────────────────────────────────
// Choisie pour rester lisible imprimé : saturation moyenne, contraste ≥ 4.5.
const C = {
  black:        [15, 23, 42],     // titres
  text:         [30, 41, 59],     // corps
  textMuted:    [71, 85, 105],    // secondaire
  textFaint:    [148, 163, 184],  // tertiaire (dates, méta)
  border:       [203, 213, 225],
  borderLight:  [226, 232, 240],
  white:        [255, 255, 255],
  bgCard:       [248, 250, 252],
  bgAlt:        [252, 252, 253],
  // Statuts livrables
  statutBriefBg:        [241, 245, 249], statutBriefText:        [100, 116, 139],
  statutEnCoursBg:      [219, 234, 254], statutEnCoursText:      [37, 99, 235],
  statutAValiderBg:     [254, 243, 199], statutAValiderText:     [180, 83, 9],
  statutValideBg:       [220, 252, 231], statutValideText:       [22, 101, 52],
  statutLivreBg:        [209, 250, 229], statutLivreText:        [4, 120, 87],
  statutArchiveBg:      [241, 245, 249], statutArchiveText:      [100, 116, 139],
  // Statuts versions
  versionEnAttenteBg:   [254, 243, 199], versionEnAttenteText:   [180, 83, 9],
  versionRetoursBg:     [254, 226, 226], versionRetoursText:     [185, 28, 28],
  versionValideBg:      [220, 252, 231], versionValideText:      [22, 101, 52],
  versionRejeteBg:      [254, 226, 226], versionRejeteText:      [185, 28, 28],
  // Périodes (correspond aux bandes du timeline web)
  periodePrepa:         [219, 234, 254], periodePrepaText:       [37, 99, 235],
  periodeTournage:      [220, 252, 231], periodeTournageText:    [22, 101, 52],
  periodeEnvoiV1:       [243, 232, 255], periodeEnvoiV1Text:     [126, 34, 206],
  periodeMaster:        [254, 243, 199], periodeMasterText:      [180, 83, 9],
  periodeDeadline:      [254, 226, 226], periodeDeadlineText:    [185, 28, 28],
}

const STATUT_META = {
  brief:     { label: 'À démarrer',     bg: C.statutBriefBg,     text: C.statutBriefText },
  en_cours:  { label: 'En préparation', bg: C.statutEnCoursBg,   text: C.statutEnCoursText },
  a_valider: { label: 'À valider',      bg: C.statutAValiderBg,  text: C.statutAValiderText },
  valide:    { label: 'Validé',         bg: C.statutValideBg,    text: C.statutValideText },
  livre:     { label: 'Livré',          bg: C.statutLivreBg,     text: C.statutLivreText },
  archive:   { label: 'Archivé',        bg: C.statutArchiveBg,   text: C.statutArchiveText },
}

const VERSION_STATUT_META = {
  en_attente:         { label: 'En attente de retour', bg: C.versionEnAttenteBg, text: C.versionEnAttenteText },
  retours_a_integrer: { label: 'Retours à intégrer',   bg: C.versionRetoursBg,   text: C.versionRetoursText },
  valide:             { label: 'Validée',              bg: C.versionValideBg,    text: C.versionValideText },
  rejete:             { label: 'Rejetée',              bg: C.versionRejeteBg,    text: C.versionRejeteText },
}

const PERIODE_META = [
  { key: 'prepa',             label: 'Préparation',      bg: C.periodePrepa,    text: C.periodePrepaText },
  { key: 'tournage',          label: 'Tournage',         bg: C.periodeTournage, text: C.periodeTournageText },
  { key: 'envoi_v1',          label: 'Envoi V1',         bg: C.periodeEnvoiV1,  text: C.periodeEnvoiV1Text },
  { key: 'livraison_master',  label: 'Livraison master', bg: C.periodeMaster,   text: C.periodeMasterText },
  { key: 'deadline',          label: 'Deadline',         bg: C.periodeDeadline, text: C.periodeDeadlineText },
]

// Page A4 portrait + marges
const PAGE_W = 210
const PAGE_H = 297
const MARGIN_X = 14
const MARGIN_TOP = 14
const MARGIN_BOTTOM = 14
const CONTENT_W = PAGE_W - MARGIN_X * 2

// ─── API publique ─────────────────────────────────────────────────────────

export async function buildLivrablesSharePdf(payload, options = {}) {
  const { share, project, blocks = [], livrables = [], versions = [] } = payload || {}
  const generatedAt = options.generatedAt || payload?.generated_at || new Date().toISOString()

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  doc.setFont('helvetica', 'normal')

  // Charge l'image de cover (asynchrone) en data URL si présente. On
  // continue sans bloquer si la fetch échoue (CORS, 404, etc.) — le header
  // tombera sur le placeholder gris.
  let coverDataUrl = null
  if (project?.cover_url) {
    try {
      coverDataUrl = await urlToDataUrl(project.cover_url)
    } catch {
      coverDataUrl = null
    }
  }

  let y = MARGIN_TOP

  // ─── 1. Header ──────────────────────────────────────────────────────────
  y = drawHeader(doc, { project, share, generatedAt, coverDataUrl }, y)

  // ─── 2. Bandeau périodes (optionnel) ────────────────────────────────────
  if (share?.config?.show_periodes && project?.periodes) {
    y = drawPeriodes(doc, project.periodes, y + 6)
  }

  // ─── 3. Liste livrables groupés par bloc ────────────────────────────────
  drawLivrablesList(doc, { blocks, livrables, versions, config: share?.config || {} }, y + 6)

  // ─── 4. Footer pages ────────────────────────────────────────────────────
  applyFooter(doc, { generatedAt, project })

  // ─── 5. Build blob/url ──────────────────────────────────────────────────
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const filename = makeFilename(project)
  return {
    blob,
    url,
    filename,
    download: () => {
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    },
    revoke: () => URL.revokeObjectURL(url),
  }
}

// ─── 1. Header ────────────────────────────────────────────────────────────

function drawHeader(doc, { project, share, generatedAt, coverDataUrl }, y) {
  const COVER_SIZE = 28 // mm
  const left = MARGIN_X
  const top = y

  // Vignette projet (carrée à gauche)
  if (coverDataUrl) {
    try {
      doc.addImage(coverDataUrl, 'JPEG', left, top, COVER_SIZE, COVER_SIZE, undefined, 'FAST')
    } catch {
      drawCoverPlaceholder(doc, left, top, COVER_SIZE)
    }
  } else {
    drawCoverPlaceholder(doc, left, top, COVER_SIZE)
  }

  // Bordure douce autour de l'image
  doc.setDrawColor(...C.borderLight)
  doc.setLineWidth(0.2)
  doc.rect(left, top, COVER_SIZE, COVER_SIZE)

  // Bloc texte à droite
  const tx = left + COVER_SIZE + 6
  let ty = top + 4

  // Eyebrow
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C.textMuted)
  doc.text('AVANCEMENT DES LIVRABLES', tx, ty)
  ty += 6

  // Titre projet
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...C.black)
  doc.text(project?.title || 'Projet', tx, ty + 2)
  ty += 8

  // Ligne méta : ref · label partage
  const metaParts = []
  if (project?.ref_projet) metaParts.push(project.ref_projet)
  if (share?.label) metaParts.push(share.label)
  if (metaParts.length > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C.textMuted)
    doc.text(metaParts.join('  ·  '), tx, ty + 2)
    ty += 5
  }

  // Date génération
  doc.setFontSize(8)
  doc.setTextColor(...C.textFaint)
  doc.text(`Mis à jour ${formatDateTimeFR(generatedAt)}`, tx, ty + 2)

  return top + COVER_SIZE
}

function drawCoverPlaceholder(doc, x, y, size) {
  doc.setFillColor(50, 65, 85)
  doc.rect(x, y, size, size, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(255, 255, 255, 0.5)
  doc.text('—', x + size / 2 - 1.5, y + size / 2 + 1.5)
}

// ─── 2. Bandeau périodes ──────────────────────────────────────────────────

function drawPeriodes(doc, periodes, y) {
  // Filtre les périodes effectivement remplies.
  const filled = PERIODE_META
    .map((m) => ({ meta: m, periode: periodes?.[m.key] }))
    .filter(({ periode }) => Array.isArray(periode?.ranges) && periode.ranges.some((r) => r?.start && r?.end))
  if (filled.length === 0) return y

  // Card avec titre "Calendrier projet" et chips
  const cardX = MARGIN_X
  const cardY = y
  const cardW = CONTENT_W
  let cy = cardY + 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C.textMuted)
  doc.text('CALENDRIER PROJET', cardX + 4, cy + 1)
  cy += 5

  // Chips périodes : "PRÉPARATION · 2 jours" puis pills "13-14/05"
  for (const { meta, periode } of filled) {
    const ranges = (periode.ranges || [])
      .filter((r) => r?.start && r?.end)
      .sort((a, b) => (a.start < b.start ? -1 : 1))
    const days = countDays(periode)

    // Label
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C.textMuted)
    const labelText = `${meta.label.toUpperCase()}  ·  ${days} JOUR${days > 1 ? 'S' : ''}`
    doc.text(labelText, cardX + 4, cy + 3)

    // Pills à droite
    let px = cardX + 60
    doc.setFontSize(8)
    for (const range of ranges) {
      const text = formatRangeFr(range)
      const w = doc.getTextWidth(text) + 8
      doc.setFillColor(...meta.bg)
      doc.setDrawColor(...meta.text)
      doc.setLineWidth(0.2)
      doc.roundedRect(px, cy - 1, w, 5, 1.5, 1.5, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...meta.text)
      doc.text(text, px + 4, cy + 2.5)
      px += w + 2
    }
    cy += 7
  }

  // Cadre card autour
  const cardH = cy - cardY + 2
  doc.setDrawColor(...C.borderLight)
  doc.setLineWidth(0.3)
  doc.roundedRect(cardX, cardY, cardW, cardH, 2, 2)

  return cardY + cardH
}

// ─── 3. Liste livrables ───────────────────────────────────────────────────

function drawLivrablesList(doc, { blocks, livrables, versions, config }, y) {
  // Indexe versions par livrable
  const versionsByLivrable = new Map()
  for (const v of versions) {
    if (!versionsByLivrable.has(v.livrable_id)) versionsByLivrable.set(v.livrable_id, [])
    versionsByLivrable.get(v.livrable_id).push(v)
  }

  // Groupe livrables par bloc en gardant l'ordre
  const groups = []
  for (const b of blocks) {
    const lvs = livrables.filter((l) => l.block_id === b.id)
    if (lvs.length > 0) groups.push({ block: b, livrables: lvs })
  }

  for (const group of groups) {
    y = ensurePageSpace(doc, y, 14)
    y = drawBlockHeader(doc, group.block, group.livrables.length, y)
    for (const livrable of group.livrables) {
      const vers = versionsByLivrable.get(livrable.id) || []
      y = drawLivrableCard(doc, livrable, vers, group.block, config, y)
      y += 3
    }
    y += 4
  }

  return y
}

function drawBlockHeader(doc, block, count, y) {
  // Pastille couleur + titre
  const cy = y + 4
  const dotColor = parseColor(block.couleur) || [100, 116, 139]
  doc.setFillColor(...dotColor)
  doc.circle(MARGIN_X + 1.5, cy - 1, 1.2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C.text)
  doc.text((block.nom || '').toUpperCase(), MARGIN_X + 5, cy)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...C.textFaint)
  doc.text(`·  ${count} livrable${count > 1 ? 's' : ''}`, MARGIN_X + 5 + doc.getTextWidth((block.nom || '').toUpperCase()) + 3, cy)
  return y + 7
}

function drawLivrableCard(doc, livrable, versions, block, config, y) {
  // Estime hauteur card pour pagination
  const versionsToShow = versions
  const versionsCount = versionsToShow.length
  const baseHeight = 14 // Header card
  // Hauteur des versions : ~7mm chacune + 3mm si feedback non vide
  let versionsHeight = 0
  if (versionsCount > 0) {
    versionsHeight += 6 // titre "VERSIONS"
    for (const v of versionsToShow) {
      versionsHeight += 7
      if (config.show_feedback && v.feedback_client) {
        versionsHeight += estimateFeedbackHeight(doc, v.feedback_client)
      }
    }
    versionsHeight += 3
  }
  const totalHeight = baseHeight + versionsHeight + 4

  y = ensurePageSpace(doc, y, totalHeight)
  const cardX = MARGIN_X
  const cardY = y
  const cardW = CONTENT_W
  let cy = cardY + 5

  // ── Header card : numero + nom + statut ───────────────────────────────
  const prefix = (block?.prefixe || '').trim()
  const numero = (livrable.numero || '').trim()
  const fullNumero = prefix && numero && !numero.startsWith(prefix) ? `${prefix}${numero}` : numero

  // Numero (font mono left)
  if (fullNumero) {
    doc.setFont('courier', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C.textMuted)
    doc.text(fullNumero, cardX + 4, cy + 1)
  }
  // Nom
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C.black)
  const nameX = fullNumero ? cardX + 4 + doc.getTextWidth(fullNumero) + 4 : cardX + 4
  doc.text(livrable.nom || 'Sans titre', nameX, cy + 1)

  // Statut pill (à droite)
  const statutMeta = STATUT_META[livrable.statut] || STATUT_META.brief
  drawPill(doc, cardX + cardW - 4, cy - 1, statutMeta.label.toUpperCase(), statutMeta, { align: 'right' })

  cy += 5
  // Ligne méta : format · durée · livraison
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.textMuted)
  const metaParts = []
  if (livrable.format) metaParts.push(livrable.format)
  if (livrable.duree) metaParts.push(livrable.duree)
  if (livrable.date_livraison) metaParts.push(`Livraison ${formatDateFR(livrable.date_livraison)}`)
  if (metaParts.length > 0) {
    doc.text(metaParts.join('  ·  '), cardX + 4, cy + 2)
    cy += 5
  } else {
    cy += 1
  }

  // ── Bandeau liens du livrable (Frame / Drive) ─────────────────────────
  // Note : on évite les caractères Unicode (flèche →) qui ne sont pas dans
  // helvetica → rendu cassé + getTextWidth faussé → chevauchement des liens.
  // Le guillemet français » est dans Latin-1 et fonctionne correctement.
  if (livrable.lien_frame || livrable.lien_drive) {
    cy += 2
    // Label "LIENS"
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C.textFaint)
    doc.text('LIENS', cardX + 4, cy + 1)
    const labelW = doc.getTextWidth('LIENS')
    let lx = cardX + 4 + labelW + 4
    // Liens
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    if (livrable.lien_frame) {
      const text = 'Voir sur Frame \u00BB' // » Latin-1
      doc.setTextColor(...C.black)
      doc.textWithLink(text, lx, cy + 1, { url: normalizeUrl(livrable.lien_frame) })
      lx += doc.getTextWidth(text) + 6
    }
    if (livrable.lien_drive) {
      const text = 'Master sur Drive \u00BB'
      doc.setTextColor(...C.text)
      doc.textWithLink(text, lx, cy + 1, { url: normalizeUrl(livrable.lien_drive) })
    }
    cy += 5
  }

  // ── Versions ──────────────────────────────────────────────────────────
  if (versionsCount > 0) {
    cy += 1
    // Bande versions (fond grisé)
    const versionsTop = cy
    doc.setFillColor(...C.bgAlt)
    doc.rect(cardX + 1, versionsTop, cardW - 2, versionsHeight, 'F')
    cy += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C.textFaint)
    doc.text('VERSIONS', cardX + 4, cy)
    cy += 3

    for (const v of versionsToShow) {
      cy = drawVersionRow(doc, v, config, cardX, cy, cardW)
    }
  }

  // Cadre card global
  const cardH = cy - cardY + 2
  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.3)
  doc.roundedRect(cardX, cardY, cardW, cardH, 2, 2)

  return cardY + cardH
}

// Hauteur d'une ligne version (mm). Doit être ≥ hauteur d'un pill (~5.5 mm)
// + un peu d'air pour ne pas que le pill déborde sur la ligne suivante.
const VERSION_ROW_HEIGHT = 7

function drawVersionRow(doc, v, config, cardX, y, cardW) {
  const isEnvoyee = Boolean(v.date_envoi)
  const validationMeta = VERSION_STATUT_META[v.statut_validation] || VERSION_STATUT_META.en_attente

  // Y central de la row = baseline du texte + alignement du pill autour.
  const textBaseline = y + 3.5
  const pillY = y + 0.6 // top du pill, pour qu'il soit centré sur la row

  // Numero label (mono bold)
  doc.setFont('courier', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C.text)
  doc.text(v.numero_label || '?', cardX + 5, textBaseline)

  // État
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.textMuted)
  let stateText
  if (isEnvoyee) stateText = `Envoyée le ${formatDateFR(v.date_envoi)}`
  else if (v.date_envoi_prevu && config.show_envoi_prevu) stateText = `Envoi prévu le ${formatDateFR(v.date_envoi_prevu)}`
  else stateText = 'À venir'
  doc.text(stateText, cardX + 18, textBaseline)

  // Pill statut validation (si envoyée) au centre-droit
  if (isEnvoyee) {
    const stateW = doc.getTextWidth(stateText)
    const pillX = cardX + 18 + stateW + 3
    drawPill(doc, pillX, pillY, validationMeta.label, validationMeta, { align: 'left', smaller: true })
  }

  // Lien Frame à droite (si présent)
  if (v.lien_frame) {
    const text = 'Voir \u00BB'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C.black)
    const tw = doc.getTextWidth(text)
    doc.textWithLink(text, cardX + cardW - 5 - tw, textBaseline, { url: normalizeUrl(v.lien_frame) })
  }

  y += VERSION_ROW_HEIGHT

  // Feedback client (si présent et autorisé) — italique, en dessous
  if (config.show_feedback && v.feedback_client) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(...C.textMuted)
    const fw = cardW - 12
    const lines = doc.splitTextToSize(`« ${v.feedback_client} »`, fw)
    for (const line of lines) {
      doc.text(line, cardX + 8, y + 2)
      y += 3.2
    }
    y += 1
  }

  return y
}

function estimateFeedbackHeight(doc, text) {
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  const fw = CONTENT_W - 12
  const lines = doc.splitTextToSize(`« ${text} »`, fw)
  return lines.length * 3.2 + 2
}

// ─── Footer pages ─────────────────────────────────────────────────────────

function applyFooter(doc, { generatedAt, project }) {
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)

    // Ligne séparatrice fine au-dessus du footer
    doc.setDrawColor(...C.borderLight)
    doc.setLineWidth(0.2)
    doc.line(MARGIN_X, PAGE_H - 12, PAGE_W - MARGIN_X, PAGE_H - 12)

    // Ligne 1 (signature Captiv en gras à gauche, pagination à droite)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C.text)
    doc.text('CAPTIV', MARGIN_X, PAGE_H - 8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C.textMuted)
    doc.text(' · Production audiovisuelle', MARGIN_X + doc.getTextWidth('CAPTIV'), PAGE_H - 8)

    const right1 = `Page ${i} / ${pageCount}`
    const tw1 = doc.getTextWidth(right1)
    doc.text(right1, PAGE_W - MARGIN_X - tw1, PAGE_H - 8)

    // Ligne 2 (titre projet à gauche, date génération à droite)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.textFaint)
    doc.text(project?.title || 'Projet', MARGIN_X, PAGE_H - 4.5)
    const right2 = formatDateTimeFR(generatedAt)
    const tw2 = doc.getTextWidth(right2)
    doc.text(right2, PAGE_W - MARGIN_X - tw2, PAGE_H - 4.5)
  }
}

// ─── Helpers de layout ────────────────────────────────────────────────────

function ensurePageSpace(doc, y, requiredHeight) {
  if (y + requiredHeight > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage()
    return MARGIN_TOP
  }
  return y
}

function drawPill(doc, x, y, label, meta, { align = 'left', smaller = false } = {}) {
  const fontSize = smaller ? 7 : 7
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(fontSize)
  const tw = doc.getTextWidth(label)
  const padX = 2.2
  const padY = 1.2
  const w = tw + padX * 2
  const h = fontSize * 0.5 + padY * 2
  const px = align === 'right' ? x - w : x
  doc.setFillColor(...meta.bg)
  doc.setDrawColor(...meta.text)
  doc.setLineWidth(0.15)
  doc.roundedRect(px, y, w, h, 1.2, 1.2, 'FD')
  doc.setTextColor(...meta.text)
  doc.text(label, px + padX, y + h - padY - 0.5)
}

// ─── Fetch image url → data URL ───────────────────────────────────────────

async function urlToDataUrl(url) {
  // Note : nécessite que l'URL réponde avec CORS autorisé. Supabase Storage
  // public le fait par défaut.
  const response = await fetch(url, { mode: 'cors' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ─── Format helpers ───────────────────────────────────────────────────────

function formatDateFR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return iso || ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

function formatDateTimeFR(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mn = String(d.getMinutes()).padStart(2, '0')
  return `le ${dd}/${mm}/${yyyy} à ${hh}:${mn}`
}

function formatRangeFr(range) {
  const sm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(range?.start || ''))
  const em = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(range?.end || ''))
  if (!sm || !em) return ''
  if (sm[0] === em[0]) return `${sm[3]}/${sm[2]}`
  if (sm[1] === em[1] && sm[2] === em[2]) return `${sm[3]}-${em[3]}/${sm[2]}`
  return `${sm[3]}/${sm[2]}-${em[3]}/${em[2]}`
}

function countDays(periode) {
  let total = 0
  for (const range of periode?.ranges || []) {
    if (!range?.start || !range?.end) continue
    const s = isoToTs(range.start)
    const e = isoToTs(range.end)
    if (s == null || e == null) continue
    total += Math.max(1, Math.round((e - s) / 86_400_000) + 1)
  }
  return total
}

function isoToTs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

function parseColor(hex) {
  if (typeof hex !== 'string') return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const v = m[1]
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

function normalizeUrl(url) {
  if (!url) return ''
  const t = String(url).trim()
  if (!t) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t
  return `https://${t}`
}

function makeFilename(project) {
  const title = (project?.title || 'projet').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
  const date = new Date().toISOString().slice(0, 10)
  return `livrables-${title}-${date}.pdf`
}
