// ════════════════════════════════════════════════════════════════════════════
// livrablesPdfExport.js — Export PDF "Vue ensemble" des livrables (LIV-23)
// ════════════════════════════════════════════════════════════════════════════
//
// Génère un PDF A4 paysage formé d'un TABLEAU CROISÉ jours × livrables, avec
// cellules colorées selon la phase de travail courante. Inspiré du document
// de suivi V and B Fest.
//
// API publique :
//   buildLivrablesEnsemblePdf({ project, client, producer, blocks, livrables,
//     etapes, eventTypes, profilesById, versionNumber, generatedAt })
//   → { blob, url, filename, download(), revoke() }
//
// Phases (catégories d'event_type) :
//   PRÉ-PROD   bleu    ← category === 'pre_prod'
//   TOURNAGE   vert    ← category === 'tournage'
//   MONTAGE    orange  ← category === 'post_prod'
//   LIVRAISON  rouge   ← jour exact de date_livraison
//   OFF        blanc   ← aucune étape ce jour
// ════════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'

// ─── Palette ──────────────────────────────────────────────────────────────
const C = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  text: [40, 40, 40],
  textMuted: [110, 110, 110],
  textFaint: [160, 160, 160],
  border: [200, 200, 200],
  borderLight: [228, 228, 228],
  // Phases — saturation moyenne (lisible imprimé sans être flashy)
  phasePreProd:     [142, 188, 230],
  phasePreProdText: [25, 70, 130],
  phaseTournage:    [148, 205, 162],
  phaseTournageText:[25, 95, 50],
  phaseMontage:     [240, 178, 110],
  phaseMontageText: [150, 75, 15],
  phaseLivraison:   [225, 120, 120],
  phaseLivraisonText:[150, 30, 30],
  off: [250, 250, 250],
  weekend: [240, 240, 240],
  today: [210, 230, 255],
  blockHeaderBg: [245, 245, 248],
  rendusBg: [248, 248, 250],
}

const PHASE_DEFS = [
  { key: 'pre_prod',   label: 'Pré-prod',   fill: C.phasePreProd,   text: C.phasePreProdText },
  { key: 'tournage',   label: 'Tournage',   fill: C.phaseTournage,  text: C.phaseTournageText },
  { key: 'post_prod',  label: 'Montage',    fill: C.phaseMontage,   text: C.phaseMontageText },
  { key: 'delivery',   label: 'Livraison',  fill: C.phaseLivraison, text: C.phaseLivraisonText },
]

const MS_PER_DAY = 24 * 3600 * 1000

// ─── Helpers dates ────────────────────────────────────────────────────────

function parseLocalDate(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(yyyy_mm_dd).slice(0, 10))
  if (!m) return null
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
}

function dayKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function fmtDateFr(d) {
  if (!d) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function fmtDateShort(d) {
  if (!d) return ''
  const dows = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa']
  return `${dows[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`
}

function fmtDateDdMm(d) {
  if (!d) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMonteur(livrable, profilesById) {
  if (livrable.assignee_external?.trim()) return livrable.assignee_external.trim()
  if (livrable.assignee_profile_id && profilesById) {
    const p = profilesById.get?.(livrable.assignee_profile_id) ||
              profilesById[livrable.assignee_profile_id]
    if (p?.full_name) {
      const parts = p.full_name.trim().split(/\s+/)
      return parts.length === 1
        ? parts[0]
        : `${parts[0]} ${(parts[parts.length - 1] || '')[0] || ''}.`
    }
  }
  return ''
}

function fmtStatutShort(statut) {
  switch ((statut || '').toLowerCase()) {
    case 'brief':     return 'Brief'
    case 'en_cours':  return 'En cours'
    case 'a_valider': return 'À valider'
    case 'valide':    return 'Validé'
    case 'livre':     return 'Livré'
    case 'archive':   return 'Archivé'
    default:          return statut || ''
  }
}

// ─── Construction du modèle de données ────────────────────────────────────

export function buildEnsembleData({
  blocks = [],
  livrables = [],
  etapes = [],
  eventTypes = [],
  profilesById = null,
  paddingDays = 7,
  now = new Date(),
  // PROJ-PERIODES : si une période tournage est fournie (projet.metadata
  // .periodes.tournage), les jours correspondants sont peints en fond vert
  // pâle pour les cellules livrable qui n'ont pas d'étape ce jour-là.
  tournagePeriode = null,
}) {
  const eventTypesById = new Map(eventTypes.map((t) => [t.id, t]))
  const blocksById = new Map(blocks.map((b) => [b.id, b]))

  const activeLivrables = livrables.filter((l) => {
    if (!l || l.deleted_at) return false
    const block = blocksById.get(l.block_id)
    if (block?.deleted_at) return false
    return true
  })
  if (activeLivrables.length === 0) {
    return { days: [], livrables: [], blocks: [], rendusByDay: new Map(), tournageDays: new Set() }
  }

  // PROJ-PERIODES : ensemble des jours ISO (YYYY-MM-DD) couverts par la
  // période tournage du projet (single source of truth). Sert à peindre
  // les cellules livrables sans étape en vert pâle (background).
  const tournageDaysSet = new Set()
  if (tournagePeriode?.ranges?.length) {
    for (const r of tournagePeriode.ranges) {
      if (!r?.start || !r?.end) continue
      const sd = parseLocalDate(r.start)
      const ed = parseLocalDate(r.end)
      if (!sd || !ed) continue
      for (let t = sd.getTime(); t <= ed.getTime(); t += MS_PER_DAY) {
        const k = dayKey(new Date(t))
        if (k) tournageDaysSet.add(k)
      }
    }
  }

  // Fenêtre temporelle
  let minTs = Infinity
  let maxTs = -Infinity
  for (const l of activeLivrables) {
    const dd = parseLocalDate(l.date_livraison)
    if (dd) {
      const ts = dd.getTime()
      if (ts < minTs) minTs = ts
      if (ts > maxTs) maxTs = ts
    }
  }
  for (const e of etapes) {
    const sd = parseLocalDate(e.date_debut)
    const ed = parseLocalDate(e.date_fin || e.date_debut)
    if (sd) minTs = Math.min(minTs, sd.getTime())
    if (ed) maxTs = Math.max(maxTs, ed.getTime())
  }
  if (!isFinite(minTs)) minTs = now.getTime()
  if (!isFinite(maxTs)) maxTs = now.getTime() + 30 * MS_PER_DAY
  const startDate = new Date(minTs - paddingDays * MS_PER_DAY)
  startDate.setHours(0, 0, 0, 0)
  const endDate = new Date(maxTs + paddingDays * MS_PER_DAY)
  endDate.setHours(0, 0, 0, 0)

  // Liste des jours
  const days = []
  const todayKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  for (let t = startDate.getTime(); t <= endDate.getTime(); t += MS_PER_DAY) {
    const d = new Date(t)
    const dow = d.getDay()
    const k = dayKey(d)
    days.push({
      date: d,
      key: k,
      isWeekend: dow === 0 || dow === 6,
      isToday: k === todayKey,
    })
  }

  // Étapes par livrable
  const etapesByLivrable = new Map()
  for (const e of etapes) {
    if (!e?.livrable_id) continue
    if (!etapesByLivrable.has(e.livrable_id)) etapesByLivrable.set(e.livrable_id, [])
    etapesByLivrable.get(e.livrable_id).push(e)
  }

  // Compteur livraisons par jour (deliveries du jour J)
  const rendusByDay = new Map()

  // Enrichissement par livrable
  const enrichedLivrables = activeLivrables.map((l) => {
    const block = blocksById.get(l.block_id) || null
    const numero = (l.numero || '').toString().trim()
    const prefix = (block?.prefixe || '').toString().trim()
    const fullNumero =
      prefix && numero && !numero.startsWith(prefix) ? `${prefix}${numero}` : numero
    const nom = (l.nom || '').toString().trim() || 'Sans nom'
    const label = fullNumero ? `${fullNumero} · ${nom}` : nom

    const phaseByDay = new Map()
    const labelByDay = new Map() // libellé event_type par jour (pour affichage dans cellule)
    const livrableEtapes = etapesByLivrable.get(l.id) || []
    for (const e of livrableEtapes) {
      const sd = parseLocalDate(e.date_debut)
      const ed = parseLocalDate(e.date_fin || e.date_debut)
      if (!sd) continue
      const et = e.event_type_id ? eventTypesById.get(e.event_type_id) : null
      const category = et?.category || null
      const phase =
        category === 'pre_prod' || category === 'tournage' || category === 'post_prod'
          ? category
          : kindToPhase(e.kind)
      if (!phase) continue
      // Libellé à afficher dans la cellule : label event_type, sinon nom étape, sinon kind
      const cellLabel =
        (et?.label || '').trim() ||
        (e.nom || '').trim() ||
        (e.kind ? kindToFrLabel(e.kind) : '')
      const endTs = (ed || sd).getTime()
      for (let t = sd.getTime(); t <= endTs; t += MS_PER_DAY) {
        const k = dayKey(new Date(t))
        if (k) {
          phaseByDay.set(k, phase)
          if (cellLabel) labelByDay.set(k, cellLabel)
        }
      }
    }
    const dlDate = parseLocalDate(l.date_livraison)
    if (dlDate) {
      const k = dayKey(dlDate)
      if (k) {
        phaseByDay.set(k, 'delivery')
        labelByDay.set(k, 'Livraison')
        rendusByDay.set(k, (rendusByDay.get(k) || 0) + 1)
      }
    }

    return {
      id: l.id,
      label,
      fullNumero,
      nom,
      format: (l.format || '').toString(),
      duree: (l.duree || '').toString(),
      statut: l.statut || '',
      statutShort: fmtStatutShort(l.statut),
      monteur: fmtMonteur(l, profilesById),
      dateLivraison: dlDate,
      dateLivraisonStr: dlDate ? fmtDateDdMm(dlDate) : '',
      blockId: l.block_id || null,
      blockPrefixe: prefix || null,
      blockNom: block?.nom || null,
      blockCouleur: block?.couleur || null,
      blockSortOrder: block?.sort_order ?? 0,
      sortOrder: l.sort_order ?? 0,
      phaseByDay,
      labelByDay,
    }
  })

  enrichedLivrables.sort((a, b) => {
    if (a.blockSortOrder !== b.blockSortOrder) return a.blockSortOrder - b.blockSortOrder
    return a.sortOrder - b.sortOrder
  })

  // Groupage blocs (continu)
  const blockGroups = []
  for (const l of enrichedLivrables) {
    const last = blockGroups[blockGroups.length - 1]
    if (last && last.id === l.blockId) {
      last.livrableIds.push(l.id)
    } else {
      blockGroups.push({
        id: l.blockId,
        prefixe: l.blockPrefixe,
        nom: l.blockNom || 'Sans nom',
        couleur: l.blockCouleur,
        livrableIds: [l.id],
      })
    }
  }

  return {
    days,
    livrables: enrichedLivrables,
    blocks: blockGroups,
    rendusByDay,
    tournageDays: tournageDaysSet,
  }
}

function kindToPhase(kind) {
  switch (kind) {
    case 'production': return 'pre_prod'
    case 'da':         return 'pre_prod'
    case 'montage':    return 'post_prod'
    case 'sound':      return 'post_prod'
    case 'delivery':   return 'delivery'
    case 'feedback':   return 'post_prod'
    default:           return null
  }
}

function kindToFrLabel(kind) {
  switch (kind) {
    case 'production': return 'Production'
    case 'da':         return 'DA'
    case 'montage':    return 'Montage'
    case 'sound':      return 'Son'
    case 'delivery':   return 'Livraison'
    case 'feedback':   return 'Feedback'
    case 'autre':      return 'Autre'
    default:           return ''
  }
}

// ─── Helpers image (chargement async pour embed dans PDF) ────────────────

/**
 * Charge une image depuis une URL et renvoie un dataURL base64 + dimensions.
 * Renvoie null en cas d'échec (image manquante, CORS, 404…) → on laisse
 * l'export se poursuivre sans image plutôt que de bloquer.
 */
async function fetchImageAsDataUrl(url) {
  if (!url || typeof url !== 'string') return null
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'force-cache' })
    if (!res.ok) return null
    const blob = await res.blob()
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = reject
      fr.readAsDataURL(blob)
    })
    if (typeof dataUrl !== 'string') return null
    // Détecte format pour jsPDF (jsPDF accepte 'PNG', 'JPEG', 'JPG', 'WEBP')
    const fmt = /^data:image\/(png|jpe?g|webp)/i.exec(dataUrl)
    if (!fmt) return null
    const format = fmt[1].toUpperCase().replace('JPG', 'JPEG')
    return { dataUrl, format }
  } catch {
    return null
  }
}

// ─── Helpers couleurs ────────────────────────────────────────────────────

/** "#ff5733" → [255, 87, 51]. Renvoie null si invalide. */
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return null
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

/** Mélange un RGB avec du blanc pour obtenir un fond pâle (factor 0..1, 0=blanc). */
function tint(rgb, factor) {
  if (!rgb) return null
  const f = Math.max(0, Math.min(1, factor))
  return [
    Math.round(255 - (255 - rgb[0]) * f),
    Math.round(255 - (255 - rgb[1]) * f),
    Math.round(255 - (255 - rgb[2]) * f),
  ]
}

// ─── Helpers PDF ──────────────────────────────────────────────────────────

const PAGE_WIDTH_MM = 297
const PAGE_HEIGHT_MM = 210
const MARGIN_MM = 8

export async function buildLivrablesEnsemblePdf({
  project = {},
  client = '',
  producer = '',
  blocks = [],
  livrables = [],
  etapes = [],
  eventTypes = [],
  profilesById = null,
  versionNumber = '1',
  generatedAt = new Date(),
  // PROJ-PERIODES : période tournage du projet (single source of truth).
  // Si fournie, les jours correspondants sont peints en vert pâle.
  tournagePeriode = null,
}) {
  const data = buildEnsembleData({
    blocks, livrables, etapes, eventTypes, profilesById, now: generatedAt,
    tournagePeriode,
  })

  // Pré-chargement (best-effort) du visuel projet
  const coverUrl = project?.cover_url || project?.clients?.logo_url || null
  const projectImage = coverUrl ? await fetchImageAsDataUrl(coverUrl) : null

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'normal')

  drawTopBlackBanner(doc)
  drawHeader(doc, { project, client, producer, versionNumber, generatedAt, projectImage })

  if (data.livrables.length === 0) {
    doc.setFontSize(11)
    doc.setTextColor(...C.textMuted)
    doc.text('Aucun livrable actif dans ce projet.', MARGIN_MM, TABLE_START_Y)
  } else {
    drawCrossTable(doc, data, { startY: TABLE_START_Y })
  }

  drawFooter(doc)

  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const safeTitle = (project?.title || 'projet')
    .toString()
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'projet'
  const ymd = `${generatedAt.getFullYear()}${String(generatedAt.getMonth() + 1).padStart(2, '0')}${String(generatedAt.getDate()).padStart(2, '0')}`
  const filename = `Captiv-Livrables-${safeTitle}-V${versionNumber}-${ymd}.pdf`

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

// ─── Header ───────────────────────────────────────────────────────────────

/**
 * Bandeau noir pleine largeur en haut de la 1re page.
 * "captiv." en blanc gros + sous-titre "PLANNING DE POST-PRODUCTION…"
 */
function drawTopBlackBanner(doc) {
  doc.setFillColor(...C.black)
  doc.rect(0, 0, PAGE_WIDTH_MM, BANNER_H, 'F')

  // Logo "captiv." centré (gros, blanc)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...C.white)
  doc.text('captiv.', PAGE_WIDTH_MM / 2, 6.8, { align: 'center' })

  // Sous-titre
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.white)
  doc.text(
    "PLANNING DE POST-PRODUCTION — VUE D'ENSEMBLE",
    PAGE_WIDTH_MM / 2,
    11.5,
    { align: 'center' },
  )
}

function drawHeader(doc, {
  project, client, producer, versionNumber, generatedAt, projectImage,
}) {
  // Visuel projet (carré) à gauche, si dispo.
  // Hauteur du bloc client : 5 rangées × 4.5 = 22.5mm → image carrée 22.5×22.5
  const IMG_SIZE = 22.5
  let infoX = MARGIN_MM
  if (projectImage) {
    try {
      doc.addImage(
        projectImage.dataUrl, projectImage.format,
        MARGIN_MM, HEADER_BLOCK_Y, IMG_SIZE, IMG_SIZE,
        undefined, 'FAST',
      )
      // Cadre fin autour de l'image
      doc.setLineWidth(0.4)
      doc.setDrawColor(...C.text)
      doc.rect(MARGIN_MM, HEADER_BLOCK_Y, IMG_SIZE, IMG_SIZE, 'S')
      doc.setLineWidth(0.1)
      infoX = MARGIN_MM + IMG_SIZE + 2
    } catch {
      // image invalide → on continue sans
    }
  }

  // Mini-tableau client — encadré, label/valeur dans cellules.
  // Cellule réellement vide si le champ est vide (pas de fallback '—').
  drawClientInfoBox(doc, {
    x: infoX,
    y: HEADER_BLOCK_Y,
    rows: [
      ['CLIENT', client || ''],
      ['PROJET', project?.title || ''],
      ['PRODUCTEUR', producer || ''],
      ['DATE', fmtDateFr(generatedAt)],
      ['VERSION', `V${versionNumber}`],
    ],
  })

  // Légende phases (droite) — encadrée
  drawLegendBox(doc, {
    x: PAGE_WIDTH_MM - MARGIN_MM - 56,
    y: HEADER_BLOCK_Y,
  })
}

function drawClientInfoBox(doc, { x, y, rows }) {
  const labelW = 24
  const valueW = 50
  const rowH = 4.5
  const totalH = rows.length * rowH
  const totalW = labelW + valueW

  // Cadre extérieur (bord épais)
  doc.setLineWidth(0.4)
  doc.setDrawColor(...C.text)
  doc.rect(x, y, totalW, totalH, 'S')
  doc.setLineWidth(0.1)

  for (let i = 0; i < rows.length; i += 1) {
    const [label, value] = rows[i]
    const rowY = y + i * rowH

    // Cellule label (fond gris pâle)
    doc.setFillColor(...C.blockHeaderBg)
    doc.setDrawColor(...C.border)
    doc.rect(x, rowY, labelW, rowH, 'FD')
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C.textMuted)
    doc.text(label, x + 2, rowY + rowH - 1.5)

    // Cellule valeur (fond blanc)
    doc.setFillColor(...C.white)
    doc.setDrawColor(...C.border)
    doc.rect(x + labelW, rowY, valueW, rowH, 'FD')
    const v = String(value ?? '').trim()
    if (v) {
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...C.text)
      const truncated = v.length > 32 ? v.slice(0, 31) + '…' : v
      doc.text(truncated, x + labelW + 2, rowY + rowH - 1.5)
    }
  }

  // Cadre extérieur épais redessiné par-dessus pour priorité
  doc.setLineWidth(0.4)
  doc.setDrawColor(...C.text)
  doc.rect(x, y, totalW, totalH, 'S')
  doc.setLineWidth(0.1)
}

function drawLegendBox(doc, { x, y }) {
  const totalW = 56
  const titleH = 4.5
  const itemH = 4
  // Légende = uniquement les phases (pas "Off" : un cellule blanche se passe
  // de légende, elle ne porte pas de phase).
  const items = PHASE_DEFS
  const totalH = titleH + items.length * itemH

  // Cadre extérieur épais
  doc.setLineWidth(0.4)
  doc.setDrawColor(...C.text)
  doc.rect(x, y, totalW, totalH, 'S')
  doc.setLineWidth(0.1)

  // Titre PHASES (fond gris pâle)
  doc.setFillColor(...C.blockHeaderBg)
  doc.setDrawColor(...C.border)
  doc.rect(x, y, totalW, titleH, 'FD')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.textMuted)
  doc.text('PHASES', x + 2, y + titleH - 1.5)

  // Items
  for (let i = 0; i < items.length; i += 1) {
    const phase = items[i]
    const itemY = y + titleH + i * itemH

    // Swatch couleur dans cellule
    const swatchSize = 2.5
    const swatchX = x + 2
    const swatchY = itemY + (itemH - swatchSize) / 2
    doc.setFillColor(...phase.fill)
    doc.setDrawColor(...C.border)
    doc.rect(swatchX, swatchY, swatchSize, swatchSize, 'FD')

    // Label
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C.text)
    doc.text(phase.label, swatchX + swatchSize + 2, itemY + itemH - 1.5)

    // Bordure inter-item (sauf le dernier)
    if (i < items.length - 1) {
      doc.setDrawColor(...C.borderLight)
      doc.line(x, itemY + itemH, x + totalW, itemY + itemH)
    }
  }

  // Cadre extérieur épais re-dessiné
  doc.setLineWidth(0.4)
  doc.setDrawColor(...C.text)
  doc.rect(x, y, totalW, totalH, 'S')
  doc.setLineWidth(0.1)
}

function drawFooter(doc) {
  const total = doc.internal.getNumberOfPages()
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(...C.textMuted)
    doc.text(
      `captiv.cc · Page ${i}/${total}`,
      PAGE_WIDTH_MM - MARGIN_MM,
      PAGE_HEIGHT_MM - 4,
      { align: 'right' },
    )
  }
}

// ─── Tableau croisé ──────────────────────────────────────────────────────

// Hauteur de chaque sous-rangée du header colonne
// Pattern V&B Fest : Numéro · Livrable (vertical) · État · Format · Durée · Monteur · Livraison
const META_ROWS = [
  { key: 'fullNumero',  label: 'Numéro',   h: 4, bold: true },
  { key: 'statutShort', label: 'État',     h: 4 },
  { key: 'format',      label: 'Format',   h: 4 },
  { key: 'duree',       label: 'Durée',    h: 4 },
  { key: 'monteur',     label: 'Monteur',  h: 4 },
  { key: 'dateLivraisonStr', label: 'Livraison', h: 4 },
]
const META_TOTAL_H = META_ROWS.reduce((a, r) => a + r.h, 0)

// Layout constants
const DAY_COL_W = 22
const RENDUS_COL_W = 12
const BLOCK_HEADER_H = 5      // ligne bloc (couleur + nom)
const VERTICAL_LABEL_H = 30   // ligne nom livrable vertical (2 lignes possibles)
const ROW_H = 4.2
const BANNER_H = 14            // bandeau noir en haut
const HEADER_BLOCK_Y = 17      // y de départ du mini-tableau client + légende
const TABLE_START_Y = 46       // y de départ du tableau croisé
const FRAME_LW = 0.6           // épaisseur des bordures noires d'encadrement

function computeColumnWidth(livrablesCount) {
  const availableW = PAGE_WIDTH_MM - 2 * MARGIN_MM - DAY_COL_W - RENDUS_COL_W
  const minColW = 7
  // V&B-style : on étale les colonnes quand peu de livrables (jusqu'à 35 mm).
  const maxColW = 35
  return Math.max(minColW, Math.min(maxColW, availableW / Math.max(1, livrablesCount)))
}

function drawCrossTable(doc, data, { startY }) {
  const { days, livrables, blocks, rendusByDay, tournageDays } = data
  const livrableColW = computeColumnWidth(livrables.length)
  const tableLeft = MARGIN_MM
  const headerStartY = startY
  const headerTotalH = BLOCK_HEADER_H + VERTICAL_LABEL_H + META_TOTAL_H
  const bodyStartY = headerStartY + headerTotalH
  const totalW = DAY_COL_W + livrables.length * livrableColW + RENDUS_COL_W

  // Re-dessine la séparation noire épaisse entre header et body, et les
  // 3 bordures verticales fortes du body (gauche / DAY_COL_W / RENDUS) +
  // les séparateurs entre blocs. À appeler EN FIN DE PAGE car les cellules
  // body recouvrent les bordures avec leurs lignes fines.
  function reinforceBodyBorders(topY, bottomY) {
    doc.setLineWidth(FRAME_LW)
    doc.setDrawColor(...C.black)
    // ligne header→body (haut du body)
    doc.line(tableLeft, topY, tableLeft + totalW, topY)
    // 4 verticales : extérieures gauche/droite + DAY_COL_W + avant RENDUS
    doc.line(tableLeft, topY, tableLeft, bottomY)
    doc.line(tableLeft + totalW, topY, tableLeft + totalW, bottomY)
    doc.line(tableLeft + DAY_COL_W, topY, tableLeft + DAY_COL_W, bottomY)
    doc.line(
      tableLeft + DAY_COL_W + livrables.length * livrableColW, topY,
      tableLeft + DAY_COL_W + livrables.length * livrableColW, bottomY,
    )
    // séparateurs entre blocs
    let cx = tableLeft + DAY_COL_W
    for (let i = 0; i < blocks.length - 1; i += 1) {
      cx += blocks[i].livrableIds.length * livrableColW
      doc.line(cx, topY, cx, bottomY)
    }
    // ligne basse du body (clôture)
    doc.line(tableLeft, bottomY, tableLeft + totalW, bottomY)
    doc.setLineWidth(0.1)
  }

  // Page 1 : header complet
  drawTableHeader(doc, {
    tableLeft, headerY: headerStartY, livrableColW, livrables, blocks,
  })

  // Body : 1 ligne par jour
  let y = bodyStartY
  let bodyTopY = bodyStartY
  for (const day of days) {
    if (y + ROW_H > PAGE_HEIGHT_MM - MARGIN_MM - 6) {
      // Avant de passer à la page suivante, ré-affirmer les bordures noires
      // épaisses (le body a recouvert les bordures fines).
      reinforceBodyBorders(bodyTopY, y)
      doc.addPage()
      drawPageHeader(doc)
      const repeatY = MARGIN_MM + 6
      drawTableHeader(doc, {
        tableLeft, headerY: repeatY, livrableColW, livrables, blocks, isRepeat: true,
      })
      y = repeatY + headerTotalH
      bodyTopY = y
    }
    drawDayRow(doc, {
      tableLeft, y, livrableColW, livrables, day, rendusByDay,
      isTournageDay: tournageDays?.has(day.key) || false,
    })
    y += ROW_H
  }

  // Bordures noires épaisses sur le body de la dernière page
  reinforceBodyBorders(bodyTopY, y)
}

/**
 * Header de page sur les pages 2+ : juste un titre compact + repère projet.
 */
function drawPageHeader(doc) {
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.textMuted)
  doc.text(
    "Vue d'ensemble — suite",
    MARGIN_MM,
    MARGIN_MM + 2,
  )
}

/**
 * Render le header complet (bloc + nom vertical + 5 méta-rangées + labels
 * des méta-rangées dans la colonne JOUR à gauche).
 *
 * Pattern V&B : la colonne JOUR contient des labels (LIVRABLE / ÉTAT /
 * FORMAT / DURÉE / MONTEUR / LIVRAISON) au niveau de chaque sous-rangée.
 */
function drawTableHeader(doc, opts) {
  const { tableLeft, headerY, livrableColW, livrables, blocks } = opts
  const totalLivrablesW = livrables.length * livrableColW
  const headerTotalH = BLOCK_HEADER_H + VERTICAL_LABEL_H + META_TOTAL_H

  // Reset déterministe de l'état du document — évite que les mesures
  // getTextWidth() ne diffèrent entre page 1 et page 2 si la dernière
  // commande appelée avait laissé une autre taille de police active
  // (notamment drawDayRow / drawPageHeader qui changent la fontSize).
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setLineWidth(0.1)

  // ─── 1) Coin haut-gauche : cellule vide gris pâle ────────────────────
  // Sub-rangée 1 (BLOCK_HEADER_H) : ton ardoise pour s'aligner avec le
  // contour noir épais sans alourdir.
  doc.setFillColor(...C.blockHeaderBg)
  doc.setDrawColor(...C.black)
  doc.setLineWidth(FRAME_LW)
  doc.rect(tableLeft, headerY, DAY_COL_W, BLOCK_HEADER_H, 'FD')
  doc.setLineWidth(0.1)

  // Sub-rangée 2 (VERTICAL_LABEL_H) : "LIVRABLE" (rangée des noms verticaux)
  doc.setFillColor(...C.blockHeaderBg)
  doc.setDrawColor(...C.border)
  doc.rect(tableLeft, headerY + BLOCK_HEADER_H, DAY_COL_W, VERTICAL_LABEL_H, 'FD')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.textMuted)
  doc.text(
    'LIVRABLE',
    tableLeft + DAY_COL_W - 2,
    headerY + BLOCK_HEADER_H + VERTICAL_LABEL_H / 2,
    { align: 'right', baseline: 'middle' },
  )

  // Sub-rangées méta : 1 par méta, label à droite dans la cellule jour
  let metaLabelY = headerY + BLOCK_HEADER_H + VERTICAL_LABEL_H
  for (const meta of META_ROWS) {
    doc.setFillColor(...C.blockHeaderBg)
    doc.setDrawColor(...C.borderLight)
    doc.rect(tableLeft, metaLabelY, DAY_COL_W, meta.h, 'FD')
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C.textMuted)
    doc.text(
      meta.label.toUpperCase(),
      tableLeft + DAY_COL_W - 2,
      metaLabelY + meta.h - 1.3,
      { align: 'right' },
    )
    metaLabelY += meta.h
  }

  // Bordure droite épaisse sur la colonne JOUR (séparation forte body/header)
  doc.setLineWidth(FRAME_LW)
  doc.setDrawColor(...C.black)
  doc.line(tableLeft + DAY_COL_W, headerY, tableLeft + DAY_COL_W, headerY + headerTotalH)
  doc.setLineWidth(0.1)

  // ─── 2) Header de bloc (1re ligne) avec couleur saturée ──────────────
  // V&B : tint à 50% pour plus de présence + bordures épaisses entre blocs.
  let cursorX = tableLeft + DAY_COL_W
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    const colCount = block.livrableIds.length
    const w = colCount * livrableColW
    const blockColor = hexToRgb(block.couleur)
    const fill = blockColor ? tint(blockColor, 0.5) : C.blockHeaderBg
    doc.setFillColor(...fill)
    doc.setDrawColor(...C.black)
    doc.setLineWidth(FRAME_LW)
    doc.rect(cursorX, headerY, w, BLOCK_HEADER_H, 'FD')
    doc.setLineWidth(0.1)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...(blockColor ? mix(blockColor, [0, 0, 0], 0.5) : C.text))
    const label = block.prefixe ? `${block.prefixe} · ${block.nom}` : block.nom
    doc.text(
      (label || '').toUpperCase(),
      cursorX + w / 2,
      headerY + BLOCK_HEADER_H - 1.5,
      { align: 'center' },
    )
    cursorX += w
  }

  // ─── 3) Header colonne livrable : nom vertical + 5 méta ───────────────
  cursorX = tableLeft + DAY_COL_W
  for (let i = 0; i < livrables.length; i += 1) {
    const liv = livrables[i]
    const colY = headerY + BLOCK_HEADER_H

    doc.setDrawColor(...C.border)
    doc.setFillColor(...C.white)
    doc.rect(cursorX, colY, livrableColW, VERTICAL_LABEL_H, 'FD')

    // Nom vertical avec wrap automatique si trop long.
    drawVerticalLabel(doc, {
      cx: cursorX,
      colY,
      colW: livrableColW,
      cellH: VERTICAL_LABEL_H,
      text: liv.nom || liv.label || '',
    })

    // Méta-rangées (Numéro / État / Format / Durée / Monteur / Livraison)
    let metaY = colY + VERTICAL_LABEL_H
    for (const meta of META_ROWS) {
      doc.setFillColor(...(meta.bold ? C.blockHeaderBg : C.white))
      doc.setDrawColor(...C.borderLight)
      doc.rect(cursorX, metaY, livrableColW, meta.h, 'FD')
      const value = (liv[meta.key] || '').toString()
      if (value) {
        doc.setFontSize(meta.bold ? 6.5 : 6)
        doc.setFont('helvetica', meta.bold ? 'bold' : 'normal')
        doc.setTextColor(...C.text)
        const maxChars = Math.max(3, Math.floor(livrableColW * 0.9))
        const truncated = value.length > maxChars ? value.slice(0, maxChars - 1) + '…' : value
        doc.text(
          truncated,
          cursorX + livrableColW / 2,
          metaY + meta.h - 1.3,
          { align: 'center' },
        )
      }
      metaY += meta.h
    }

    cursorX += livrableColW
  }

  // ─── 4) Bordures épaisses noires entre blocs (verticales) ────────────
  let cx = tableLeft + DAY_COL_W
  doc.setLineWidth(FRAME_LW)
  doc.setDrawColor(...C.black)
  for (let i = 0; i < blocks.length - 1; i += 1) {
    cx += blocks[i].livrableIds.length * livrableColW
    doc.line(cx, headerY, cx, headerY + headerTotalH)
  }
  doc.setLineWidth(0.1)

  // ─── 5) Colonne RENDUS (header) ──────────────────────────────────────
  const rendusX = tableLeft + DAY_COL_W + totalLivrablesW
  doc.setFillColor(...C.blockHeaderBg)
  doc.setDrawColor(...C.black)
  doc.setLineWidth(FRAME_LW)
  doc.rect(rendusX, headerY, RENDUS_COL_W, headerTotalH, 'FD')
  doc.setLineWidth(0.1)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.textMuted)
  // Centrage vertical : on calcule la largeur du texte et on positionne le
  // baseline au milieu de la cellule + textW/2 (texte tourné de 90°,
  // s'écrit du bas vers le haut).
  const rendusText = 'RENDUS'
  const rendusTextW = doc.getTextWidth(rendusText)
  doc.text(
    rendusText,
    rendusX + RENDUS_COL_W / 2 + 1.4,
    headerY + headerTotalH / 2 + rendusTextW / 2,
    { angle: 90, align: 'left' },
  )

  // Cadre extérieur global du header (bordure très épaisse, pleine noire)
  doc.setLineWidth(FRAME_LW)
  doc.setDrawColor(...C.black)
  const fullW = DAY_COL_W + totalLivrablesW + RENDUS_COL_W
  doc.rect(tableLeft, headerY, fullW, headerTotalH, 'S')
  // Verticales noires épaisses redessinées EN DERNIER, car les rects fins
  // posés sur les cellules vertical-labels ont effacé les lignes posées
  // au step 1 :
  //   - séparation colonne JOUR / 1re colonne livrable (tableLeft + DAY_COL_W)
  //   - séparation dernière colonne livrable / colonne RENDUS
  doc.line(
    tableLeft + DAY_COL_W, headerY,
    tableLeft + DAY_COL_W, headerY + headerTotalH,
  )
  doc.line(
    tableLeft + DAY_COL_W + totalLivrablesW, headerY,
    tableLeft + DAY_COL_W + totalLivrablesW, headerY + headerTotalH,
  )
  // Ligne noire épaisse entre le header et le body (sera ré-affirmée
  // lors du dessin du body qui pose des bordures fines par cellule).
  doc.line(
    tableLeft, headerY + headerTotalH,
    tableLeft + fullW, headerY + headerTotalH,
  )
  doc.setLineWidth(0.1)
}

/**
 * Dessine un nom de livrable verticalement, avec wrap automatique sur 2
 * lignes parallèles si le texte est trop long pour une seule colonne tournée.
 *
 * En mode angle 90°, la "longueur de texte" devient la HAUTEUR de cellule
 * (cellH). On split en mots si dépassement, et on rend 2 textes verticaux
 * côte à côte dans la largeur de colonne.
 */
function drawVerticalLabel(doc, { cx, colY, colW, cellH, text }) {
  const t = (text || '').trim()
  if (!t) return

  const fontSize = 7.5
  doc.setFontSize(fontSize)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.text)

  // Marge basse pour ne pas coller au bord.
  const baselineY = colY + cellH - 1.5
  // Largeur effective de texte vertical = hauteur disponible.
  const availH = cellH - 3
  const textW = doc.getTextWidth(t)

  // Cas 1 : ça rentre sur 1 ligne.
  if (textW <= availH) {
    doc.text(t, cx + colW / 2 + fontSize * 0.18, baselineY, {
      angle: 90, align: 'left',
    })
    return
  }

  // Cas 2 : split en 2 lignes par mots si la colonne est assez large
  // (≥ 8 mm pour permettre 2 colonnes verticales).
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length >= 2 && colW >= 8) {
    // Cherche le meilleur split (équilibrage proche du milieu).
    let bestSplit = 1
    let bestDiff = Infinity
    for (let i = 1; i < words.length; i += 1) {
      const left = words.slice(0, i).join(' ')
      const right = words.slice(i).join(' ')
      const diff = Math.abs(doc.getTextWidth(left) - doc.getTextWidth(right))
      if (diff < bestDiff) {
        bestDiff = diff
        bestSplit = i
      }
    }
    const line1 = words.slice(0, bestSplit).join(' ')
    const line2 = words.slice(bestSplit).join(' ')
    const truncate = (s) => {
      let result = s
      while (doc.getTextWidth(result) > availH && result.length > 1) {
        result = result.slice(0, -1)
      }
      return result === s ? s : result.slice(0, -1) + '…'
    }
    const safe1 = truncate(line1)
    const safe2 = truncate(line2)
    // 2 lignes verticales : interligne ~2.8 mm autour du centre — assez
    // serré pour se lire comme un bloc compact, mais sans collage des
    // glyphes entre les 2 lignes.
    const interline = 2.8
    doc.text(safe1, cx + colW / 2 - interline / 2, baselineY, { angle: 90, align: 'left' })
    doc.text(safe2, cx + colW / 2 + interline / 2, baselineY, { angle: 90, align: 'left' })
    return
  }

  // Cas 3 : un seul mot trop long (ou colonne trop fine) → tronque sec.
  let truncated = t
  while (doc.getTextWidth(truncated) > availH && truncated.length > 1) {
    truncated = truncated.slice(0, -1)
  }
  if (truncated !== t) truncated = truncated.slice(0, -1) + '…'
  doc.text(truncated, cx + colW / 2 + fontSize * 0.18, baselineY, {
    angle: 90, align: 'left',
  })
}

/** Mélange linéaire 2 RGB. f=0 → a, f=1 → b. */
function mix(a, b, f) {
  return [
    Math.round(a[0] * (1 - f) + b[0] * f),
    Math.round(a[1] * (1 - f) + b[1] * f),
    Math.round(a[2] * (1 - f) + b[2] * f),
  ]
}

function drawDayRow(doc, opts) {
  const {
    tableLeft, y, livrableColW, livrables, day, rendusByDay,
    isTournageDay = false,
  } = opts
  // PROJ-PERIODES : couleur de fond "tournage projet" (vert pâle, plus
  // clair que la phase étape pour ne pas masquer une étape qui aurait
  // aussi la phase tournage).
  const tournageBgFill = tint(C.phaseTournage, 0.55)

  // Cellule jour
  if (day.isToday) {
    doc.setFillColor(...C.today)
  } else if (day.isWeekend) {
    doc.setFillColor(...C.weekend)
  } else {
    doc.setFillColor(...C.white)
  }
  doc.setDrawColor(...C.borderLight)
  doc.rect(tableLeft, y, DAY_COL_W, ROW_H, 'FD')
  doc.setTextColor(...C.text)
  doc.setFont('helvetica', day.isToday ? 'bold' : 'normal')
  doc.setFontSize(6.5)
  doc.text(fmtDateShort(day.date), tableLeft + 2, y + ROW_H - 1.4)
  if (day.isToday) {
    doc.setFontSize(5.5)
    doc.setTextColor(...C.phasePreProdText)
    doc.text('AUJ.', tableLeft + DAY_COL_W - 2, y + ROW_H - 1.4, { align: 'right' })
    doc.setFontSize(6)
    doc.setTextColor(...C.text)
  }
  doc.setFont('helvetica', 'normal')

  // Cellules livrables
  // Si la colonne est assez large (≥ 25 mm), on écrit le label de l'event_type
  // dans la cellule colorée (ex: "Étalonnage", "Dérush", "Livraison").
  const SHOW_CELL_LABEL_THRESHOLD = 25
  let cx = tableLeft + DAY_COL_W
  for (const liv of livrables) {
    const phase = liv.phaseByDay.get(day.key) || null
    // Priorité de couleur : phase étape > tournage projet > weekend > blanc.
    // Le tournage projet sert de fond seulement quand il n'y a pas d'étape.
    let fill = day.isWeekend ? C.weekend : C.white
    let textColor = null
    if (isTournageDay && !phase) {
      fill = tournageBgFill
    }
    if (phase) {
      const def = PHASE_DEFS.find((p) => p.key === phase)
      if (def) {
        fill = def.fill
        textColor = def.text
      }
    }
    doc.setFillColor(...fill)
    doc.setDrawColor(...C.borderLight)
    doc.rect(cx, y, livrableColW, ROW_H, 'FD')

    // Label dans la cellule (uniquement si large + phase présente)
    if (phase && livrableColW >= SHOW_CELL_LABEL_THRESHOLD) {
      const cellLabel = liv.labelByDay?.get(day.key)
      if (cellLabel) {
        doc.setFontSize(6)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...(textColor || C.text))
        const maxChars = Math.max(3, Math.floor(livrableColW * 0.5))
        const truncated = cellLabel.length > maxChars
          ? cellLabel.slice(0, maxChars - 1) + '…'
          : cellLabel
        doc.text(
          truncated,
          cx + livrableColW / 2,
          y + ROW_H - 1.4,
          { align: 'center' },
        )
        doc.setFont('helvetica', 'normal')
      }
    }

    cx += livrableColW
  }

  // Cellule RENDUS (compteur livraisons du jour)
  const rendus = rendusByDay.get(day.key) || 0
  doc.setFillColor(...(rendus > 0 ? C.phaseLivraison : C.rendusBg))
  doc.setDrawColor(...C.borderLight)
  doc.rect(cx, y, RENDUS_COL_W, ROW_H, 'FD')
  if (rendus > 0) {
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C.phaseLivraisonText)
    doc.text(
      String(rendus),
      cx + RENDUS_COL_W / 2,
      y + ROW_H - 1.3,
      { align: 'center' },
    )
    doc.setFont('helvetica', 'normal')
  }
}
