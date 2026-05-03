// ════════════════════════════════════════════════════════════════════════════
// equipeTechlistPdfExport.js — Export PDF de la techlist (EQUIPE-P4.1)
// ════════════════════════════════════════════════════════════════════════════
//
// Génère un PDF A4 paysage de la tech list — global (tous lots) ou filtré
// sur un lot précis. Rendu tabulaire calqué sur les techlists Excel utilisées
// en régie (lignes denses, colonnes alignées, sections par catégorie).
//
// Layout :
//   Header        : vignette projet + titre + ref + scope + date génération
//   Bandeau lots  : chips colorés des lots couverts (multi-lot uniquement)
//   Stats         : N personnes · N attributions · N validées
//   Sections      : "À TRIER" en haut, puis chaque catégorie (PRODUCTION,
//                   EQUIPE TECHNIQUE, POST PRODUCTION + custom)
//   Pour chaque section :
//     - Ligne d'en-tête de catégorie (full-width, gras)
//     - Ligne d'en-tête de colonnes (Poste / Personne / Régime / Tél / Email
//       / Secteur / Présence / Logistique / Lot)
//     - Lignes de données, zebra, séparées par bordures fines
//   Pagination    : les en-têtes de colonnes sont redessinés en haut de
//                   chaque nouvelle page pour rester lisible.
//   Footer        : signature org + pagination + date génération
//
// API publique :
//   buildTechlistPdf(payload, options?) → { blob, url, filename, download(), revoke() }
//
//   payload : { project, org?, rows, lots, scope, presenceDays?, showSensitive }
//     - project       : { id, title, ref_projet?, cover_url? }
//     - org           : { name?, tagline? } (optionnel, footer)
//     - rows          : Array<row> — déjà filtrées par le caller. Ordre conservé.
//     - lots          : Array<{ id, title, color }> — lots concernés
//     - scope         : 'all' | string (lotId)
//     - presenceDays  : Array<ISO> — jours de tournage à afficher en colonnes
//                       Présence (extraits de project.metadata.periodes.tournage).
//                       Optionnel, peut être vide → colonne Présence masquée.
//     - showSensitive : bool (par défaut true — coordonnées visibles)
//   options : { generatedAt? }
// ════════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import {
  fullNameFromPersona,
  effectiveSecteur,
} from '../../lib/crew'
import { pickOrgLogo } from '../../lib/branding'
import { loadImageAsJpeg, computeLogoBox } from '../../lib/pdfImageLoader'

// ─── Palette ──────────────────────────────────────────────────────────────
const C = {
  black:        [15, 23, 42],
  text:         [30, 41, 59],
  textMuted:    [71, 85, 105],
  textFaint:    [148, 163, 184],
  border:       [203, 213, 225],
  borderLight:  [226, 232, 240],
  white:        [255, 255, 255],
  bgZebra:      [248, 250, 252],
  bgHeader:     [241, 245, 249],
  bgSection:    [30, 41, 59],   // sombre, comme l'exemple
  bgATrier:     [254, 243, 199],
  fgATrier:     [120, 53, 15],
  // Présence
  presenceBg:   [220, 252, 231],
  presenceFg:   [22, 101, 52],
}

// Page A4 paysage
const PAGE_W = 297
const PAGE_H = 210
const MARGIN_X = 10
const MARGIN_TOP = 10
const MARGIN_BOTTOM = 14
const CONTENT_W = PAGE_W - MARGIN_X * 2  // 277

// Hauteurs (mm)
const ROW_H = 7        // hauteur d'une row 1 ligne
const ROW_H_TALL = 11  // hauteur d'une row 2 lignes (poste qui wrap)
const SECTION_H = 7
// COLHEAD_H rehaussé à 8mm pour permettre l'affichage Présence en 2 niveaux :
//   ligne du haut = lettre (M, plus grande), ligne du bas = date (12/05, plus petite)
// Les autres colonnes (Poste, Personne, etc.) ont leur label centré verticalement
// dans cette hauteur.
const COLHEAD_H = 8

// ─── API publique ─────────────────────────────────────────────────────────

export async function buildTechlistPdf(payload, options = {}) {
  const {
    project,
    org = null,
    rows = [],
    lots = [],
    scope = 'all',
    presenceDays = [],
    showSensitive = true,
    // EQUIPE-P4-CATEGORIES : ordre custom des catégories (drag & drop côté
    // Crew list). Si fourni, on respecte cet ordre dans les sections du PDF ;
    // sinon fallback DEFAULT_CATEGORIES.
    categoryOrder = [],
  } = payload || {}
  const generatedAt = options.generatedAt || new Date().toISOString()

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  doc.setFont('helvetica', 'normal')

  // Org banner : on charge UNIQUEMENT si l'org a son propre logo configuré.
  // Pas de fallback Captiv (décision Hugo P4.1d : respecter l'identité de
  // l'org cliente — un PDF "vierge" est préférable à un PDF estampillé Captiv).
  const hasOrgLogo = Boolean(
    org?.logo_banner_url || org?.logo_url_clair || org?.logo_url_sombre,
  )
  let bannerImage = null
  if (hasOrgLogo) {
    try {
      bannerImage = await loadImageAsJpeg(pickOrgLogo(org, 'banner'))
    } catch (e) {
      console.error('[equipeTechlistPdfExport] logo org échoué :', e?.message)
      bannerImage = null
    }
  }

  // Cover du projet (carrée). Best-effort : si pas de cover ou échec chargement,
  // on n'affiche rien (le bloc texte titre s'étend pour combler).
  let coverImage = null
  if (project?.cover_url) {
    try {
      coverImage = await loadImageAsJpeg(project.cover_url)
    } catch {
      coverImage = null
    }
  }

  const scopedLot = scope !== 'all' ? lots.find((l) => l.id === scope) : null
  const showLotCol = scope === 'all' && lots.length > 1

  // Couleur de marque de l'org pour les bandeaux de section. Default = bgSection
  // historique si pas de brand_color (org pas encore paramétrée).
  const brandColor = parseColor(org?.brand_color) || C.bgSection
  // Texte blanc ou noir selon la luminance (auto-contrast pour brand colors
  // claires comme du jaune ou du beige).
  const brandTextColor = isLightColor(brandColor) ? C.black : C.white

  // Détermine si on a au moins une row avec un régime alimentaire
  // (pour décider d'afficher la colonne Régime alim).
  const showAlimCol = rows.some((r) => Boolean(r?.persona?.contact?.regime_alimentaire))

  // Colonnes résolues une fois (les widths sont stables sur tout le doc)
  const cols = resolveColumns({
    showLotCol,
    showAlimCol,
    presenceDays,
  })

  let y = MARGIN_TOP

  // ─── 1. Header ──────────────────────────────────────────────────────────
  y = drawHeader(doc, { project, scope, scopedLot, generatedAt, bannerImage, coverImage }, y)

  // ─── 2. Bandeau lots couverts (si multi-lot ET scope='all') ─────────────
  // En export d'un lot spécifique, le lot est déjà mentionné dans le header
  // ("Lot · Principal") — la légende des couleurs serait redondante puisqu'on
  // n'affiche qu'un seul lot dans le tableau.
  if (lots.length > 1 && scope === 'all') {
    y = drawLotsBannerCompact(doc, lots, scope, y + 3)
  } else {
    y += 2
  }

  // ─── 3. Stats compactes (uniquement le nb de personnes) ────────────────
  y = drawStats(doc, rows, y + 2)

  // ─── 4. Tableau ────────────────────────────────────────────────────────
  drawTable(
    doc,
    { rows, cols, showSensitive, presenceDays, brandColor, brandTextColor, categoryOrder },
    y + 3,
  )

  // ─── 5. Footer ──────────────────────────────────────────────────────────
  applyFooter(doc, { generatedAt, project, org, scope, scopedLot })

  // ─── 6. Build blob/url ──────────────────────────────────────────────────
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const filename = makeFilename(project, scopedLot)
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

function drawHeader(doc, { project, scope, scopedLot, generatedAt, bannerImage, coverImage }, y) {
  // Layout possible :
  //   [ Banner org 50×14 ]   [ Bloc texte titre/ref/scope/date ]   [ Cover 18×18 ]
  // Banner et cover sont indépendants : si l'un manque, l'autre reste à sa
  // place. Le bloc texte s'adapte à l'espace dispo.
  const BANNER_BOX_W = 50
  const BANNER_BOX_H = 14
  const COVER_SIZE = 18
  const top = y
  let bannerHeight = 0

  // Banner top-left (si configuré pour l'org)
  if (bannerImage) {
    try {
      const { width, height } = computeLogoBox(
        bannerImage.width, bannerImage.height, BANNER_BOX_W, BANNER_BOX_H,
      )
      const finalY = top + (BANNER_BOX_H - height) / 2
      doc.addImage(bannerImage.dataUrl, 'JPEG', MARGIN_X, finalY, width, height)
      bannerHeight = BANNER_BOX_H
    } catch {
      bannerHeight = 0
    }
  }

  // Cover top-right (carré) — si dispo et chargée avec succès
  let coverDrawn = false
  if (coverImage) {
    try {
      const cx = PAGE_W - MARGIN_X - COVER_SIZE
      const cy = top
      doc.addImage(coverImage.dataUrl, 'JPEG', cx, cy, COVER_SIZE, COVER_SIZE)
      // Bordure douce
      doc.setDrawColor(...C.borderLight)
      doc.setLineWidth(0.2)
      doc.rect(cx, cy, COVER_SIZE, COVER_SIZE)
      coverDrawn = true
    } catch {
      coverDrawn = false
    }
  }

  // Bloc texte au milieu (entre banner et cover)
  const tx = bannerHeight > 0 ? MARGIN_X + BANNER_BOX_W + 8 : MARGIN_X
  let ty = top + 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C.textMuted)
  doc.text('CREW LIST', tx, ty)
  ty += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...C.black)
  doc.text(project?.title || 'Projet', tx, ty + 2)
  ty += 6

  const metaParts = []
  if (project?.ref_projet) metaParts.push(project.ref_projet)
  if (scope === 'all') metaParts.push('Tous lots')
  else if (scopedLot) metaParts.push(`Lot · ${scopedLot.title}`)
  metaParts.push(`Mis à jour ${formatDateTimeFR(generatedAt)}`)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.textMuted)
  doc.text(metaParts.join('  ·  '), tx, ty + 2)

  // Hauteur retournée : max entre banner / cover / texte
  const textBlockH = ty + 4 - top
  const coverH = coverDrawn ? COVER_SIZE : 0
  return top + Math.max(bannerHeight, coverH, textBlockH)
}

// ─── 2. Bandeau lots couverts ─────────────────────────────────────────────

// Version compacte (sans cadre, sans encart) — sert de légende des dots de
// la colonne Lot du tableau. Affichée sur 1 ligne en petite typo.
function drawLotsBannerCompact(doc, lots, scope, y) {
  const cy = y + 3
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...C.textFaint)
  doc.text('LOTS', MARGIN_X, cy)

  let px = MARGIN_X + 10
  doc.setFontSize(7)
  for (const lot of lots) {
    const isActive = scope === 'all' || scope === lot.id
    const dim = !isActive ? 0.4 : 1
    const color = parseColor(lot.color) || [100, 116, 139]
    const fg = withAlpha(color, dim)
    const text = lot.title || '—'
    const textW = doc.getTextWidth(text)
    const w = textW + 5 + 2.5
    if (px + w > PAGE_W - MARGIN_X) break
    doc.setFillColor(...fg)
    doc.circle(px + 1.4, cy - 1.1, 0.85, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...fg)
    doc.text(text, px + 3.5, cy)
    px += w + 2
  }
  return cy + 1
}

// ─── 3. Stats compactes ───────────────────────────────────────────────────

function drawStats(doc, rows, y) {
  const personaSet = new Set(rows.map((r) => r.persona_key))
  const totalPersonae = personaSet.size

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.textMuted)
  const txt = `${totalPersonae} personne${totalPersonae > 1 ? 's' : ''}`
  doc.text(txt, MARGIN_X, y + 3)
  return y + 5
}

// ─── 4. Tableau ───────────────────────────────────────────────────────────

function resolveColumns({ showLotCol, showAlimCol, presenceDays }) {
  // Ordre P4.1d (décision Hugo) : Lot en 1ère colonne (juste un dot coloré).
  // Logistique a été retirée du PDF techlist (sera dans un PDF dédié dans
  // la future tab Logistique/Régie).
  // Régime a été supprimé. Poste élargi à 45mm + wrap 2 lignes pour ne
  // jamais couper un mot.
  const cols = []
  if (showLotCol) {
    cols.push({ key: 'lot', w: 6, label: '', align: 'center' })
  }
  cols.push(
    { key: 'poste',     w: 45, label: 'Poste',     align: 'left' },
    { key: 'personne',  w: 38, label: 'Personne',  align: 'left' },
    { key: 'tel',       w: 26, label: 'Téléphone', align: 'left' },
    { key: 'email',     w: 50, label: 'Email',     align: 'left' },
    { key: 'secteur',   w: 20, label: 'Secteur',   align: 'left' },
  )
  // Alim : optionnelle, en queue
  const tailCols = []
  if (showAlimCol) tailCols.push({ key: 'alim', w: 18, label: 'Alim.', align: 'left' })

  // Présence : prend toute la largeur restante (flex). La largeur de chaque
  // cellule-jour est calculée dynamiquement par drawPresenceCells. Avec
  // Logistique supprimée, on a beaucoup de place pour afficher tous les jours.
  const fixedSum = [...cols, ...tailCols].reduce((s, c) => s + c.w, 0)
  const presenceFlexW = Math.max(0, CONTENT_W - fixedSum)
  const nbDays = presenceDays?.length || 0
  if (nbDays > 0 && presenceFlexW > 8) {
    cols.push({
      key: 'presence',
      w: presenceFlexW,
      label: 'Présence',
      align: 'center',
    })
  }
  for (const t of tailCols) cols.push(t)

  // Calcule x pour chaque colonne
  let x = MARGIN_X
  for (const c of cols) {
    c.x = x
    x += c.w
  }
  return cols
}

function drawTable(doc, { rows, cols, showSensitive, presenceDays, brandColor, brandTextColor, categoryOrder = [] }, y) {
  // EQUIPE-P4-CATEGORIES : on respecte l'ordre custom posé côté Crew list
  // (drag & drop des headers de catégories, persisté en localStorage côté
  // admin et dans projects.metadata.equipe.category_order côté share).
  // À TRIER reste toujours en premier ; les catégories non listées dans
  // categoryOrder sont placées à la fin (DEFAULT_CATEGORIES en priorité,
  // puis custom dans l'ordre d'apparition).
  const A_TRIER_KEY = '__a_trier__'
  const buckets = new Map()
  for (const r of rows) {
    const cat = r.category || A_TRIER_KEY
    if (!buckets.has(cat)) buckets.set(cat, [])
    buckets.get(cat).push(r)
  }
  const DEFAULT = ['PRODUCTION', 'EQUIPE TECHNIQUE', 'POST PRODUCTION']
  const ordered = []
  const seen = new Set()
  if (buckets.has(A_TRIER_KEY)) {
    ordered.push([A_TRIER_KEY, buckets.get(A_TRIER_KEY)])
    seen.add(A_TRIER_KEY)
  }
  // 1. Ordre custom posé par l'admin
  const order = Array.isArray(categoryOrder) ? categoryOrder : []
  for (const cat of order) {
    if (cat && buckets.has(cat) && !seen.has(cat)) {
      ordered.push([cat, buckets.get(cat)])
      seen.add(cat)
    }
  }
  // 2. Reste : DEFAULT en priorité, puis custom dans l'ordre d'apparition
  for (const cat of DEFAULT) {
    if (buckets.has(cat) && !seen.has(cat)) {
      ordered.push([cat, buckets.get(cat)])
      seen.add(cat)
    }
  }
  for (const [cat, list] of buckets.entries()) {
    if (cat === A_TRIER_KEY || seen.has(cat)) continue
    ordered.push([cat, list])
    seen.add(cat)
  }

  if (ordered.length === 0) {
    // Empty state
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...C.textMuted)
    doc.text('Aucune attribution dans ce périmètre.', MARGIN_X, y + 6)
    return y + 12
  }

  // Premier en-tête de colonnes
  y = drawColumnHeaders(doc, cols, presenceDays, y)

  for (const [cat, sectionRows] of ordered) {
    if (sectionRows.length === 0) continue
    // Section header (pleine largeur, fond = brand color de l'org)
    y = ensureSpace(doc, y, SECTION_H + ROW_H, () => drawColumnHeaders(doc, cols, presenceDays, MARGIN_TOP))
    y = drawSectionHeader(
      doc,
      cat === A_TRIER_KEY ? 'À TRIER' : cat,
      sectionRows.length,
      cat === A_TRIER_KEY,
      brandColor,
      brandTextColor,
      y,
    )
    for (let i = 0; i < sectionRows.length; i++) {
      // Hauteur dynamique : si le poste ne tient pas en 1 ligne, on passe
      // en row "tall" 2 lignes. Plus jamais de troncature sur le poste.
      const { rowH, posteLines } = computeRowGeometry(doc, sectionRows[i], cols)
      const newY = ensureSpace(doc, y, rowH, () => drawColumnHeaders(doc, cols, presenceDays, MARGIN_TOP))
      // Si on vient de paginer, redessine le mini-header de section pour rappel
      if (newY < y) {
        y = drawSectionHeader(
          doc,
          (cat === A_TRIER_KEY ? 'À TRIER' : cat) + ' (suite)',
          sectionRows.length - i,
          cat === A_TRIER_KEY,
          brandColor,
          brandTextColor,
          newY,
        )
      } else {
        y = newY
      }
      drawTableRow(doc, sectionRows[i], cols, {
        showSensitive,
        presenceDays,
        zebra: i % 2 === 1,
        rowH,
        posteLines,
      }, y)
      y += rowH
    }
  }

  return y
}

// Pré-calcule la géométrie d'une row (hauteur + lignes du poste).
// On wrappe le poste sur 2 lignes max si nécessaire pour ne JAMAIS couper
// un mot. Au-delà de 2 lignes, on tronque la 2e ligne avec ellipse.
function computeRowGeometry(doc, row, cols) {
  const posteCol = cols.find((c) => c.key === 'poste')
  if (!posteCol) return { rowH: ROW_H, posteLines: ['—'] }
  const persona = row.persona || {}
  // Override > devis > contact : cohérent avec AttributionRow + share web.
  // Si l'admin a renommé le poste côté Crew list (row.specialite), on
  // affiche ce nom plutôt que la valeur d'origine de la ligne de devis.
  const poste =
    row.specialite ||
    row.devis_line?.produit ||
    persona.contact?.specialite ||
    '—'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  let lines = doc.splitTextToSize(poste, posteCol.w - 3)
  doc.setFont('helvetica', 'normal')
  if (!Array.isArray(lines) || lines.length === 0) lines = [poste]
  if (lines.length > 2) {
    // Cap à 2 lignes : on tronque la 2e avec ellipse propre
    const second = truncate(doc, lines.slice(1).join(' '), posteCol.w - 3)
    lines = [lines[0], second]
  }
  const rowH = lines.length > 1 ? ROW_H_TALL : ROW_H
  return { rowH, posteLines: lines }
}

function drawColumnHeaders(doc, cols, presenceDays, y) {
  // Fond gris clair
  doc.setFillColor(...C.bgHeader)
  doc.rect(MARGIN_X, y, CONTENT_W, COLHEAD_H, 'F')
  // Bordure bottom
  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.3)
  doc.line(MARGIN_X, y + COLHEAD_H, MARGIN_X + CONTENT_W, y + COLHEAD_H)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.textMuted)
  // Vertical centerline pour les labels 1-ligne (Poste, Personne, etc.)
  // dans la hauteur agrandie du header (9mm).
  const labelBaselineY = y + COLHEAD_H / 2 + 1.3
  for (const c of cols) {
    if (c.key === 'presence') {
      // Cellule présence : layout custom 3 niveaux (jour / lettre / mois)
      drawPresenceHeader(doc, c, presenceDays, y)
      continue
    }
    const label = c.label || ''
    const cx = c.align === 'center' ? c.x + c.w / 2 - doc.getTextWidth(label) / 2 : c.x + 1.5
    doc.text(label, cx, labelBaselineY)
  }

  return y + COLHEAD_H
}

// Dessine l'en-tête de la colonne Présence en 2 niveaux par cellule :
//   lettre (M)       ← haut, plus grande, en gras
//   date (12/05)     ← bas, plus petite, regular
// Le bloc M / 12/05 est centré horizontalement dans la cellule.
function drawPresenceHeader(doc, col, presenceDays, y) {
  const nbDays = presenceDays.length
  if (nbDays === 0) return
  const cellW = col.w / nbDays
  doc.setTextColor(...C.textMuted)
  for (let i = 0; i < nbDays; i++) {
    const iso = presenceDays[i]
    const letter = dayLetter(iso)
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')) || []
    const day = m[3] || ''
    const month = m[2] || ''
    const date = day && month ? `${day}/${month}` : ''
    const cxCenter = col.x + i * cellW + cellW / 2

    // Lettre (haut) — taille principale
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.text(letter, cxCenter - doc.getTextWidth(letter) / 2, y + 3.2)

    // Date (bas) — plus petite
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.5)
    doc.text(date, cxCenter - doc.getTextWidth(date) / 2, y + COLHEAD_H - 1)
  }
  // Reset à la fin pour ne pas perturber les autres dessins
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
}

function drawSectionHeader(doc, label, count, isATrier, brandColor, brandTextColor, y) {
  // À TRIER conserve sa couleur warning sémantique. Les autres sections
  // utilisent la brand color de l'org (paramétrée par l'admin) avec
  // contraste auto-calculé pour le texte.
  const bg = isATrier ? C.bgATrier : brandColor
  const fg = isATrier ? C.fgATrier : brandTextColor
  doc.setFillColor(...bg)
  doc.rect(MARGIN_X, y, CONTENT_W, SECTION_H, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...fg)
  doc.text(label, MARGIN_X + 2.5, y + SECTION_H - 2.2)
  doc.setFont('helvetica', 'normal')
  const labelW = doc.getTextWidth(label)
  doc.setTextColor(...fg)
  doc.text(`·  ${count} poste${count > 1 ? 's' : ''}`, MARGIN_X + 2.5 + labelW + 3, y + SECTION_H - 2.2)
  return y + SECTION_H
}

function drawTableRow(doc, row, cols, { showSensitive, presenceDays, zebra, rowH, posteLines }, y) {
  // Zebra (background couvrant toute la row, hauteur dynamique)
  if (zebra) {
    doc.setFillColor(...C.bgZebra)
    doc.rect(MARGIN_X, y, CONTENT_W, rowH, 'F')
  }
  // Bordure bottom fine
  doc.setDrawColor(...C.borderLight)
  doc.setLineWidth(0.15)
  doc.line(MARGIN_X, y + rowH, MARGIN_X + CONTENT_W, y + rowH)

  const persona = row.persona || {}
  const fullName = fullNameFromPersona(persona)
  const telephoneRaw = showSensitive
    ? (persona.contact?.telephone || row.telephone || '')
    : ''
  const telephone = formatPhone(telephoneRaw)
  const email = showSensitive
    ? (persona.contact?.email || row.email || '')
    : ''
  const secteur = effectiveSecteur(persona) || ''

  // Baseline Y pour le texte 1 ligne dans cette row :
  //   row normale (7mm) → y + 4.5  (= rowH - 2.5)
  //   row tall (11mm) → y + 6.5    (vertically centered)
  const oneLineY = rowH === ROW_H ? y + ROW_H - 2.5 : y + rowH - 4.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.text)

  for (const c of cols) {
    const cellX = c.x + 1.5
    const cellMaxW = c.w - 3
    switch (c.key) {
      case 'poste': {
        // 1 ou 2 lignes selon posteLines (calculé en amont par computeRowGeometry).
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...C.text)
        if (posteLines.length > 1) {
          doc.text(posteLines[0], cellX, y + 4)
          doc.text(posteLines[1], cellX, y + 8)
        } else {
          doc.text(posteLines[0], cellX, oneLineY)
        }
        doc.setFont('helvetica', 'normal')
        break
      }
      case 'personne': {
        doc.setTextColor(...C.text)
        doc.text(truncate(doc, fullName, cellMaxW), cellX, oneLineY)
        break
      }
      case 'tel': {
        doc.setTextColor(...C.text)
        doc.text(truncate(doc, telephone || '—', cellMaxW), cellX, oneLineY)
        break
      }
      case 'email': {
        doc.setTextColor(...C.text)
        doc.text(truncate(doc, email || '—', cellMaxW), cellX, oneLineY)
        break
      }
      case 'secteur': {
        doc.setTextColor(...C.textMuted)
        doc.text(truncate(doc, secteur || '—', cellMaxW), cellX, oneLineY)
        break
      }
      case 'presence': {
        drawPresenceCells(doc, c, persona.presence_days || [], presenceDays, y, rowH)
        break
      }
      case 'lot': {
        // Décision Hugo P4.1c : juste le dot coloré (la légende "LOTS COUVERTS"
        // tout en haut sert de référence pour les couleurs).
        const lot = row._lot
        if (lot) {
          const color = parseColor(lot.color) || [100, 116, 139]
          doc.setFillColor(...color)
          doc.circle(c.x + c.w / 2, y + rowH / 2, 1.1, 'F')
        }
        break
      }
      case 'alim': {
        const alim = persona.contact?.regime_alimentaire || ''
        doc.setTextColor(...C.textMuted)
        doc.setFontSize(7.5)
        doc.text(truncate(doc, alim || '—', cellMaxW), cellX, oneLineY)
        doc.setFontSize(8)
        break
      }
      default:
        break
    }
  }

  // Séparateurs verticaux fins entre colonnes
  doc.setDrawColor(...C.borderLight)
  doc.setLineWidth(0.1)
  for (let i = 1; i < cols.length; i++) {
    const sx = cols[i].x
    doc.line(sx, y, sx, y + rowH)
  }
}

function drawPresenceCells(doc, col, personaDays, allDays, y, rowH) {
  const nbDays = allDays.length
  if (nbDays === 0) return
  const cellW = col.w / nbDays
  const personaSet = new Set(personaDays)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  // Vertical center du X dans la row
  const baseLineY = rowH === ROW_H ? y + ROW_H - 2.5 : y + rowH - 4.5
  for (let i = 0; i < nbDays; i++) {
    const iso = allDays[i]
    const present = personaSet.has(iso)
    const cx = col.x + i * cellW
    if (present) {
      doc.setFillColor(...C.presenceBg)
      doc.rect(cx + 0.3, y + 1.2, cellW - 0.6, rowH - 2.4, 'F')
      doc.setTextColor(...C.presenceFg)
      const x = 'X'
      doc.text(x, cx + cellW / 2 - doc.getTextWidth(x) / 2, baseLineY)
    }
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
}

// ─── 5. Footer ────────────────────────────────────────────────────────────

function applyFooter(doc, { generatedAt, project, org, scope, scopedLot }) {
  const orgName = org?.name || 'Captiv'
  const orgTagline = !org
    ? ' · Production audiovisuelle'
    : (org?.tagline ? ` · ${org.tagline}` : '')

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setDrawColor(...C.borderLight)
    doc.setLineWidth(0.2)
    doc.line(MARGIN_X, PAGE_H - 10, PAGE_W - MARGIN_X, PAGE_H - 10)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C.text)
    if (orgName) {
      doc.text(orgName, MARGIN_X, PAGE_H - 6)
      if (orgTagline) {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...C.textMuted)
        doc.text(orgTagline, MARGIN_X + doc.getTextWidth(orgName), PAGE_H - 6)
      }
    }
    const right1 = `Page ${i} / ${pageCount}`
    const tw1 = doc.getTextWidth(right1)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C.text)
    doc.text(right1, PAGE_W - MARGIN_X - tw1, PAGE_H - 6)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C.textFaint)
    const scopeLabel = scope === 'all' ? 'Tous lots' : (scopedLot?.title || '')
    const left2 = scopeLabel ? `${project?.title || 'Projet'} · ${scopeLabel}` : (project?.title || 'Projet')
    doc.text(left2, MARGIN_X, PAGE_H - 3)
    const right2 = formatDateTimeFR(generatedAt)
    const tw2 = doc.getTextWidth(right2)
    doc.text(right2, PAGE_W - MARGIN_X - tw2, PAGE_H - 3)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function ensureSpace(doc, y, requiredHeight, onNewPage) {
  if (y + requiredHeight > PAGE_H - MARGIN_BOTTOM - 4) {
    doc.addPage()
    let newY = MARGIN_TOP
    if (typeof onNewPage === 'function') {
      newY = onNewPage()
    }
    return newY
  }
  return y
}

function withAlpha(rgb, alpha) {
  const a = Math.max(0, Math.min(1, alpha))
  return rgb.map((c) => Math.round(c * a + 255 * (1 - a)))
}

// Détermine si une couleur RGB est "claire" pour choisir un texte noir/blanc
// dessus. Formule de luminance perceptuelle (Rec. 601, suffisante pour des
// fonds de bandeau).
function isLightColor(rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3) return false
  const [r, g, b] = rgb
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160
}

// Formate un numéro de téléphone français (10 chiffres commençant par 0 ou
// préfixe 33) en groupes de 2 séparés par des espaces. Ex:
//   "0641675554"   → "06 41 67 55 54"
//   "+33641675554" → "+33 6 41 67 55 54"
// Tout autre format est retourné tel quel (lecture brute > formatage cassé).
function formatPhone(phone) {
  if (!phone) return ''
  const raw = String(phone).trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10 && digits[0] === '0') {
    return digits.match(/.{2}/g).join(' ')
  }
  if (digits.length === 11 && digits.startsWith('33')) {
    const local = digits.slice(2)
    return '+33 ' + local[0] + ' ' + local.slice(1).match(/.{2}/g).join(' ')
  }
  return raw
}

function truncate(doc, text, maxWidthMm) {
  if (!text) return ''
  if (doc.getTextWidth(text) <= maxWidthMm) return text
  let s = String(text)
  while (s.length > 0 && doc.getTextWidth(s + '…') > maxWidthMm) {
    s = s.slice(0, -1)
  }
  return s + '…'
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

// Lettre du jour de la semaine (français : L M M J V S D)
function dayLetter(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return '?'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return ['D', 'L', 'M', 'M', 'J', 'V', 'S'][d.getDay()] || '?'
}

function parseColor(hex) {
  if (typeof hex !== 'string') return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const v = m[1]
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

function makeFilename(project, scopedLot) {
  const title = (project?.title || 'projet').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
  const date = new Date().toISOString().slice(0, 10)
  const lotPart = scopedLot ? `-${scopedLot.title.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}` : ''
  return `techlist-${title}${lotPart}-${date}.pdf`
}
