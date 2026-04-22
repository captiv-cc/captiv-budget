// ════════════════════════════════════════════════════════════════════════════
// matosBilanPdf.js — PDF bilan de fin d'essais + ZIP multi-loueur (MAT-12)
// ════════════════════════════════════════════════════════════════════════════
//
// 3 entrées publiques :
//
//   1. buildBilanGlobalPDF(snapshot, { org })
//      → { blob, url, filename, download(), revoke() }
//      Rendu d'un PDF "bilan global" : résumé stats + tous les blocs/items
//      avec état (coché par, retiré, ajouté en cours d'essais), loueurs, et
//      fil de commentaires. Utilisé pour le PDF "vue d'ensemble" du ZIP.
//
//   2. buildBilanLoueurPDF(snapshot, { loueur, section, org })
//      → { blob, url, filename, download(), revoke() }
//      PDF bilan pour UN loueur (ou "Sans loueur" si loueur=null). Même style
//      que le bilan global mais scopé aux items de ce loueur.
//
//   3. buildBilanZip(snapshot, { org })
//      → { blob, url, filename, download(), revoke(), isZip: true,
//          globalPdf, loueurPdfs }
//      Assemble le bilan global + 1 PDF par loueur dans un ZIP prêt à uploader
//      vers Storage + archiver dans matos_version_attachments (MAT-12 RPC
//      check_action_close_essais).
//
// Le snapshot attendu est la sortie de `aggregateBilanData(session)` — cf.
// src/lib/matosBilanData.js. Les builders ne relisent PAS la session brute :
// toute l'agrégation / tri / stats est déjà faite.
//
// Style : aligné avec matosPdfExport.js (Work Sans + palette captiv) — mais
// module séparé pour ne pas ré-exporter les helpers privés. Si on veut
// mutualiser un jour, on extraira un `pdfBase.js`.
//
// TODO MAT-11 (photos) : quand les items auront un champ `photos[]`, on
// insèrera les miniatures après le fil de commentaires de chaque item. Le
// slot est commenté dans `renderItemBody`.
// ════════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { bilanPdfFilename, bilanZipFilename, versionLabel } from '../../lib/matosBilanData'

// ─── Palette + symboles ────────────────────────────────────────────────────
const C = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  header: [67, 67, 67],
  light: [243, 243, 243],
  gray: [120, 120, 120],
  lgray: [210, 210, 210],
  green: [34, 139, 58],
  amber: [201, 132, 17],
  red: [201, 51, 51],
  bluePale: [232, 242, 254],
  blue: [31, 111, 235],
}

const FLAG_COLOR = { ok: C.green, attention: C.amber, probleme: C.red }
const FLAG_LABEL = { ok: 'OK', attention: 'ATT.', probleme: 'PB', none: '–' }

// ─── Loaders d'assets (cache module) ──────────────────────────────────────
let _assetsCache = null

async function loadFontBase64(url) {
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
  }
  return btoa(bin)
}

async function loadImageDataUrl(url) {
  const res = await fetch(url)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function loadAssets() {
  if (_assetsCache) return _assetsCache
  const [wsReg, wsBold, wsMed, banner] = await Promise.all([
    loadFontBase64('/font/WorkSans-Regular.ttf'),
    loadFontBase64('/font/WorkSans-Bold.ttf'),
    loadFontBase64('/font/WorkSans-Medium.ttf'),
    loadImageDataUrl('/captiv-banner.png').catch(() => null),
  ])
  _assetsCache = { wsReg, wsBold, wsMed, banner }
  return _assetsCache
}

function makeDoc(assets, { orientation = 'portrait' } = {}) {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  doc.addFileToVFS('WorkSans-Regular.ttf', assets.wsReg)
  doc.addFont('WorkSans-Regular.ttf', 'WS', 'normal')
  doc.addFileToVFS('WorkSans-Bold.ttf', assets.wsBold)
  doc.addFont('WorkSans-Bold.ttf', 'WS', 'bold')
  doc.addFileToVFS('WorkSans-Medium.ttf', assets.wsMed)
  doc.addFont('WorkSans-Medium.ttf', 'WS', 'medium')
  doc.setFont('WS', 'normal')
  return doc
}

function finishDoc(doc, filename) {
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
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

// ─── Formatters ────────────────────────────────────────────────────────────
const fmtDate = (d) => {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('fr-FR')
  } catch {
    return ''
  }
}
const fmtDateTime = (d) => {
  if (!d) return ''
  try {
    return new Date(d).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function projectRef(project) {
  return project?.ref_projet || ''
}

// ─── Header / footer ───────────────────────────────────────────────────────
function drawHeader(doc, { title, subtitle, project, version, banner }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14

  if (banner) {
    try {
      doc.addImage(banner, 'PNG', M, 10, 45, 10)
    } catch {
      // tant pis, on continue sans logo
    }
  }

  doc.setFont('WS', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...C.black)
  doc.text(title, PW - M, 13, { align: 'right' })

  if (subtitle) {
    doc.setFont('WS', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.gray)
    doc.text(subtitle, PW - M, 18, { align: 'right' })
  }

  doc.setFontSize(7)
  doc.setTextColor(...C.gray)
  const left = [projectRef(project), project?.title].filter(Boolean).join(' · ')
  doc.text(left, M, 25)
  const right = [versionLabel(version), fmtDate(new Date())].filter(Boolean).join(' · ')
  doc.text(right, PW - M, 25, { align: 'right' })

  doc.setDrawColor(...C.lgray)
  doc.setLineWidth(0.25)
  doc.line(M, 28, PW - M, 28)
}

function drawFooter(doc, { org }) {
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 14
  const total = doc.internal.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setDrawColor(...C.lgray)
    doc.setLineWidth(0.25)
    doc.line(M, PH - 12, PW - M, PH - 12)
    doc.setFont('WS', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.gray)
    doc.text(org?.name || 'CAPTIV', M, PH - 7)
    doc.text(`Page ${i}/${total}`, PW - M, PH - 7, { align: 'right' })
  }
}

// ─── Bannière "clôturé" ────────────────────────────────────────────────────
function drawClotureBanner(doc, { y, closedAt, closedByName }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  const h = 10
  doc.setFillColor(...C.bluePale)
  doc.setDrawColor(...C.blue)
  doc.setLineWidth(0.2)
  doc.roundedRect(M, y, PW - M * 2, h, 1.5, 1.5, 'FD')

  doc.setFont('WS', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C.blue)
  doc.text('Essais clôturés', M + 3, y + 4)

  doc.setFont('WS', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.black)
  const parts = []
  if (closedAt) parts.push(fmtDateTime(closedAt))
  if (closedByName) parts.push(`par ${closedByName}`)
  doc.text(parts.join(' · '), M + 3, y + 8)
  return y + h + 3
}

// ─── Cartes stats (résumé) ─────────────────────────────────────────────────
function drawStatsCards(doc, { y, stats }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  const W = PW - M * 2
  const cardH = 14
  const gap = 2
  const cols = 4
  const cardW = (W - gap * (cols - 1)) / cols

  const cards = [
    { label: 'Items actifs',  value: String(stats.total), color: C.black },
    {
      label: 'Cochés',
      value: `${stats.checked}/${stats.total}`,
      sub: stats.total ? `${Math.round(stats.ratio * 100)} %` : '—',
      color: stats.total > 0 && stats.checked === stats.total ? C.green : C.black,
    },
    { label: 'Retirés',        value: String(stats.removed),  color: stats.removed ? C.red : C.gray },
    { label: 'Additifs',       value: String(stats.additifs), color: stats.additifs ? C.amber : C.gray },
  ]

  for (let i = 0; i < cols; i++) {
    const c = cards[i]
    const x = M + i * (cardW + gap)
    doc.setDrawColor(...C.lgray)
    doc.setFillColor(...C.light)
    doc.setLineWidth(0.15)
    doc.roundedRect(x, y, cardW, cardH, 1.2, 1.2, 'FD')

    doc.setFont('WS', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.gray)
    doc.text(c.label, x + 2.5, y + 3.8)

    doc.setFont('WS', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...c.color)
    doc.text(c.value, x + 2.5, y + 10)

    if (c.sub) {
      doc.setFont('WS', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.gray)
      doc.text(c.sub, x + cardW - 2.5, y + 10, { align: 'right' })
    }
  }

  // Ligne flags (pastilles colorées)
  const flagY = y + cardH + 4
  drawFlagBar(doc, { y: flagY, stats })
  return flagY + 6
}

function drawFlagBar(doc, { y, stats }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  let cx = M
  const segs = [
    { label: 'OK',          n: stats.byFlag.ok,        color: C.green },
    { label: 'Attention',   n: stats.byFlag.attention, color: C.amber },
    { label: 'Problème',    n: stats.byFlag.probleme,  color: C.red },
    { label: 'Sans flag',   n: stats.byFlag.none,      color: C.gray },
  ]
  doc.setFont('WS', 'normal')
  doc.setFontSize(8)
  for (const s of segs) {
    if (s.n === 0) continue
    doc.setFillColor(...s.color)
    doc.circle(cx + 1.4, y - 1.3, 1.2, 'F')
    doc.setTextColor(...C.black)
    const t = `${s.label} : ${s.n}`
    doc.text(t, cx + 3.5, y)
    cx += 3.5 + doc.getTextWidth(t) + 5
    if (cx > PW - M - 10) break
  }
}

// ─── Rendu d'un bloc ───────────────────────────────────────────────────────
function renderBlock(doc, { startY, block, items, renderPageHeader }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  let y = startY

  // Saut de page si le titre de bloc ne rentre plus.
  if (y > 260) {
    doc.addPage()
    renderPageHeader()
    y = 34
  }

  // Titre bloc
  doc.setFont('WS', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C.black)
  doc.text(block.titre || 'Bloc', M, y + 4)

  // Mini meta ligne : compte, coché, retiré, additifs
  const nTot = items.filter((it) => !it.removed_at).length
  const nChecked = items.filter((it) => !it.removed_at && it.pre_check_at).length
  const nRem = items.filter((it) => it.removed_at).length
  const nAdd = items.filter((it) => it.added_during_check).length
  const metaParts = [`${nTot} item${nTot > 1 ? 's' : ''}`, `${nChecked} cochés`]
  if (nRem) metaParts.push(`${nRem} retiré${nRem > 1 ? 's' : ''}`)
  if (nAdd) metaParts.push(`${nAdd} additif${nAdd > 1 ? 's' : ''}`)

  doc.setFont('WS', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.gray)
  doc.text(metaParts.join(' · '), PW - M, y + 4, { align: 'right' })
  y += 6

  if (items.length === 0) {
    doc.setFont('WS', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(...C.gray)
    doc.text('Aucun item.', M + 2, y + 3)
    return y + 6
  }

  const body = items.map((it) => [
    flagBilanCell(it.flag),
    buildBilanDesignationCell(it),
    { content: String(it.quantite ?? 1), styles: { halign: 'center' } },
    statusCell(it),
    loueursCellText(it),
    commentsCountCell(it),
  ])

  autoTable(doc, {
    startY: y,
    head: [['', 'Désignation', 'Qté', 'Statut', 'Loueur(s)', 'Notes']],
    body,
    theme: 'grid',
    styles: {
      font: 'WS',
      fontSize: 8,
      cellPadding: { top: 2, right: 2.5, bottom: 2, left: 2.5 },
      lineColor: C.lgray,
      lineWidth: 0.15,
      textColor: C.black,
      valign: 'middle',
    },
    headStyles: {
      fillColor: C.header,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 9,  halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 46 },
      4: { cellWidth: 40 },
      5: { cellWidth: 22 },
    },
    margin: { left: M, right: M, top: 32, bottom: 16 },
    didDrawPage: renderPageHeader,
    didDrawCell: (data) => {
      if (data.section !== 'body') return
      // Rangée entière barrée si l'item est retiré : on dessine une ligne grise
      // horizontale sur la cellule désignation uniquement (sinon ça traverse
      // les autres colonnes à bordures bien nettes).
      if (data.column.index === 1) {
        const raw = data.cell.raw
        if (raw?._removed) {
          const midY = data.cell.y + data.cell.height / 2
          doc.setDrawColor(...C.gray)
          doc.setLineWidth(0.3)
          doc.line(
            data.cell.x + 1.5,
            midY,
            data.cell.x + data.cell.width - 1.5,
            midY,
          )
        }
      }
    },
  })

  y = doc.lastAutoTable.finalY + 4

  // Rendu détaillé des commentaires (après le tableau, section compacte)
  const withComments = items.filter((it) => (it.comments || []).length > 0)
  if (withComments.length > 0) {
    if (y > 255) {
      doc.addPage()
      renderPageHeader()
      y = 34
    }
    doc.setFont('WS', 'medium')
    doc.setFontSize(9)
    doc.setTextColor(...C.gray)
    doc.text('Commentaires', M, y + 3)
    y += 5
    for (const it of withComments) {
      if (y > 270) {
        doc.addPage()
        renderPageHeader()
        y = 34
      }
      y = renderItemComments(doc, { y, item: it })
    }
    y += 2
  }

  return y + 3
}

function renderItemComments(doc, { y, item }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  const IW = PW - M * 2

  // Titre item
  doc.setFont('WS', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C.black)
  doc.text(String(item.designation || '—'), M + 2, y + 3)
  y += 5

  // Lignes commentaires
  for (const c of item.comments) {
    doc.setFont('WS', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.gray)
    const meta = `${c.author_name || '—'} · ${fmtDateTime(c.created_at)}`
    doc.text(meta, M + 4, y + 3)
    doc.setFontSize(8)
    doc.setTextColor(...C.black)
    const lines = doc.splitTextToSize(String(c.body || ''), IW - 8)
    doc.text(lines, M + 4, y + 7)
    y += 7 + lines.length * 3.3 + 1
  }

  // TODO MAT-11 : insérer ici les miniatures photos quand item.photos[] existe.
  //   for (const p of item.photos || []) {
  //     doc.addImage(p.dataUrl, 'JPEG', ...)
  //   }

  return y + 1
}

// ─── Cellules dédiées bilan ────────────────────────────────────────────────
function flagBilanCell(flag) {
  if (!flag || flag === 'none') {
    return { content: '–', styles: { halign: 'center', textColor: C.gray } }
  }
  return {
    content: FLAG_LABEL[flag] || '?',
    styles: {
      halign: 'center',
      fontStyle: 'bold',
      textColor: FLAG_COLOR[flag] || C.gray,
      fontSize: 7,
    },
  }
}

function buildBilanDesignationCell(it) {
  const designation = it.designation || '—'
  const hasLabel = it.label && String(it.label).trim().length > 0
  const label = hasLabel ? String(it.label).toUpperCase() : null
  const remarques = (it.remarques || '').trim() || null
  const parts = []
  if (label) parts.push(label)
  parts.push(designation)
  const line1 = parts.join(' · ')
  const content = remarques ? `${line1}\n${remarques}` : line1
  return {
    content,
    _removed: Boolean(it.removed_at),
    _designation: designation,
    _label: label,
    _remarques: remarques,
  }
}

function statusCell(it) {
  const lines = []
  if (it.pre_check_at) {
    lines.push(
      `✓ ${it.pre_check_by_name || '—'}${it.pre_check_at ? ' · ' + fmtDateTime(it.pre_check_at) : ''}`
    )
  } else {
    lines.push('Non coché')
  }
  if (it.removed_at) {
    lines.push(`Retiré — ${it.removed_by_name || '—'}`)
    if (it.removed_reason) lines.push(`(${it.removed_reason})`)
  }
  if (it.added_during_check) {
    lines.push(`Additif — ${it.added_by_name || '—'}`)
  }
  return {
    content: lines.join('\n'),
    styles: { fontSize: 7 },
  }
}

function loueursCellText(it) {
  const arr = it.loueurs || []
  if (arr.length === 0) return '—'
  return arr.map((l) => l?.nom || '?').join(', ')
}

function commentsCountCell(it) {
  const n = (it.comments || []).length
  if (n === 0) return '—'
  return {
    content: `${n} message${n > 1 ? 's' : ''}`,
    styles: { halign: 'center', fontStyle: 'bold' },
  }
}

// ─── Sélecteur "bloc par section" (global vs loueur) ──────────────────────
function sectionBlocks(section) {
  return section.blocks.filter((b) => b.items.length > 0)
}

// ═══ PDF GLOBAL ════════════════════════════════════════════════════════════
export async function buildBilanGlobalPDF(snapshot, { org } = {}) {
  if (!snapshot || !snapshot.version) {
    throw new Error('buildBilanGlobalPDF : snapshot invalide')
  }
  const assets = await loadAssets()
  const doc = makeDoc(assets)
  const M = 14

  const renderPageHeader = () =>
    drawHeader(doc, {
      title: 'BILAN ESSAIS',
      subtitle: 'Vue d\'ensemble',
      project: snapshot.project,
      version: snapshot.version,
      banner: assets.banner,
    })

  renderPageHeader()

  let y = 34
  if (snapshot.global.closedAt) {
    y = drawClotureBanner(doc, {
      y,
      closedAt: snapshot.global.closedAt,
      closedByName: snapshot.global.closedByName,
    })
  }
  y = drawStatsCards(doc, { y, stats: snapshot.global.stats })
  y += 2

  const blocks = sectionBlocks(snapshot.global)
  if (blocks.length === 0) {
    doc.setFont('WS', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...C.gray)
    doc.text('Aucun item dans cette version.', M, y + 4)
  } else {
    for (const { block, items } of blocks) {
      y = renderBlock(doc, { startY: y, block, items, renderPageHeader })
    }
  }

  drawFooter(doc, { org })
  return finishDoc(
    doc,
    bilanPdfFilename({ project: snapshot.project, version: snapshot.version }),
  )
}

// ═══ PDF PAR LOUEUR ════════════════════════════════════════════════════════
export async function buildBilanLoueurPDF(snapshot, { loueur, section, org } = {}) {
  if (!snapshot || !snapshot.version) {
    throw new Error('buildBilanLoueurPDF : snapshot invalide')
  }
  if (!section) {
    throw new Error('buildBilanLoueurPDF : section (loueur bucket) requis')
  }

  const assets = await loadAssets()
  const doc = makeDoc(assets)
  const M = 14
  const PW = doc.internal.pageSize.getWidth()

  const loueurNom = loueur?.nom || 'Sans loueur'
  const renderPageHeader = () =>
    drawHeader(doc, {
      title: 'BILAN ESSAIS',
      subtitle: `Loueur : ${loueurNom}`,
      project: snapshot.project,
      version: snapshot.version,
      banner: assets.banner,
    })

  renderPageHeader()

  let y = 34

  if (snapshot.global.closedAt) {
    y = drawClotureBanner(doc, {
      y,
      closedAt: snapshot.global.closedAt,
      closedByName: snapshot.global.closedByName,
    })
  }

  // En-tête loueur : pastille couleur + nom + nb refs/unités
  if (loueur?.couleur) {
    const rgb = hexToRgb(loueur.couleur) || C.gray
    doc.setFillColor(...rgb)
    doc.circle(M + 2.5, y + 2.5, 2.5, 'F')
  }
  doc.setFont('WS', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...C.black)
  doc.text(loueurNom, M + (loueur?.couleur ? 7 : 0), y + 4)

  const totalUnites = section.blocks
    .flatMap((b) => b.items)
    .reduce((s, it) => s + (Number(it.quantite) || 0), 0)
  const nRefs = section.blocks.reduce((s, b) => s + b.items.length, 0)

  doc.setFont('WS', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.gray)
  doc.text(
    `${nRefs} référence${nRefs > 1 ? 's' : ''} · ${totalUnites} unité${totalUnites > 1 ? 's' : ''}`,
    PW - M, y + 4, { align: 'right' },
  )
  y += 9

  y = drawStatsCards(doc, { y, stats: section.stats })
  y += 2

  const blocks = sectionBlocks(section)
  if (blocks.length === 0) {
    doc.setFont('WS', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...C.gray)
    doc.text('Aucun item assigné à ce loueur.', M, y + 4)
  } else {
    for (const { block, items } of blocks) {
      y = renderBlock(doc, { startY: y, block, items, renderPageHeader })
    }
  }

  drawFooter(doc, { org })
  return finishDoc(
    doc,
    bilanPdfFilename({
      project: snapshot.project,
      version: snapshot.version,
      loueur: loueur || { nom: 'sans-loueur' },
    }),
  )
}

// ═══ ZIP : global + 1 PDF / loueur ════════════════════════════════════════
export async function buildBilanZip(snapshot, { org } = {}) {
  if (!snapshot || !snapshot.version) {
    throw new Error('buildBilanZip : snapshot invalide')
  }

  let JSZip
  try {
    const mod = await import('jszip')
    JSZip = mod.default || mod
  } catch {
    throw new Error(
      'La lib jszip n\'est pas installée. Lance `npm install jszip` puis recharge la page.',
    )
  }

  const zip = new JSZip()

  // 1. Global
  const globalPdf = await buildBilanGlobalPDF(snapshot, { org })
  zip.file(globalPdf.filename, await globalPdf.blob.arrayBuffer())

  // 2. Par loueur — 1 PDF / bucket (y compris "Sans loueur" s'il existe)
  const loueurPdfs = []
  for (const section of snapshot.byLoueur) {
    const pdf = await buildBilanLoueurPDF(snapshot, {
      loueur: section.loueur,
      section,
      org,
    })
    zip.file(pdf.filename, await pdf.blob.arrayBuffer())
    loueurPdfs.push(pdf)
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  const url = URL.createObjectURL(zipBlob)
  const filename = bilanZipFilename({
    project: snapshot.project,
    version: snapshot.version,
  })

  return {
    blob: zipBlob,
    url,
    filename,
    isZip: true,
    globalPdf,
    loueurPdfs,
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
      try { globalPdf.revoke?.() } catch { /* noop */ }
      for (const p of loueurPdfs) try { p.revoke?.() } catch { /* noop */ }
    },
  }
}

// ─── Helpers couleur ───────────────────────────────────────────────────────
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
