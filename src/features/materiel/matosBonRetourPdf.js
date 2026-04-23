// ════════════════════════════════════════════════════════════════════════════
// matosBonRetourPdf.js — PDF Bon de retour (MAT-13E / MAT-13H)
// ════════════════════════════════════════════════════════════════════════════
//
// Entrées publiques (MAT-13H) :
//
//   buildBonRetourGlobalPdf(snapshot, { org, photoDataMap })
//   buildBonRetourLoueurPdf(snapshot, { loueur, section, org, photoDataMap })
//   buildBonRetourZip(snapshot, { org })
//     → { blob, url, filename, download(), revoke() }
//
//   buildBonRetourPdf — alias de buildBonRetourGlobalPdf (backward compat
//   MAT-13E ; préservé pour les callers hooks `close()` / `preview()`).
//
// Trois variantes d'export, miroir de MAT-22 côté bilan essais :
//   • Global   : un seul PDF combiné, tous les loueurs confondus
//   • Loueur   : un PDF filtré sur un bucket (id loueur ou "Sans loueur")
//   • ZIP      : global + 1 PDF/loueur empaquetés (partage photoDataMap)
//
// Page de garde + synthèse rendu + tableau par bloc (cochés via post_check_at,
// retirés inline avec pastille "RETIRÉ", additifs en fin de bloc) + annexe
// photos kind='retour'.
//
// MAT-13G : chaque PDF injecte les feedbacks saisis en checklist :
//   • Global → `snapshot.version.rendu_feedback`
//   • Loueur → les DEUX : global (contextuel) + loueur-specific (primaire)
//     depuis `snapshot.version_loueur_infos[*].rendu_feedback`
//   • Si un feedback est vide, le bloc correspondant est simplement omis.
//
// Le snapshot attendu est la sortie de `aggregateBilanData(session)` (même
// shape que le bilan essais — MAT-12). Les seules différences exploitées
// côté rendu :
//   - cloture        : snapshot.version.rendu_closed_at / rendu_closed_by_name
//   - status item    : on lit post_check_at / post_check_by_name
//   - commentaires   : on filtre kind='rendu' (avant de les rendre inline)
//   - photos item    : on lit it.photos_retour (kind='retour'). Pas de pack
//                      photos : usage interne remballe, hors périmètre rendu.
//
// Style : aligné avec matosBilanPdf.js (Work Sans + palette captiv) — avec
// un accent orange pour signaler la phase rendu vs. le bleu des essais.
// Helpers volontairement dupliqués (pas d'extraction pdfBase.js) pour garder
// les deux modules décorrélés — la coïncidence stylistique est maintenue à
// la main.
// ════════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { versionLabel, NO_LOUEUR_BUCKET_ID } from '../../lib/matosBilanData'
import {
  bonRetourPdfFilename,
  bonRetourLoueurPdfFilename,
  bonRetourZipFilename,
} from '../../lib/matosRendu'
import { getPhotoThumbnailUrl } from '../../lib/matosItemPhotos'

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
  // MAT-13E : accents orange pour la phase rendu (vs. bleu pour essais)
  renduAccent: [204, 75, 12],   // burnt orange pour bandeaux cloture / titres
  renduPale:   [254, 235, 215], // pêche pâle pour fond bandeau cloture
  // Repris de matosBilanPdf.js : tons pastels retirés / additifs
  removedFill: [252, 245, 245],
  removedText: [140, 140, 140],
  additifAccent: [22, 118, 55],
  additifHead: [228, 240, 231],
}

const FLAG_COLOR = { ok: C.green, attention: C.amber, probleme: C.red }
const FLAG_LABEL = { ok: 'OK', attention: 'ATT.', probleme: 'PB', none: '–' }

// ─── Loaders d'assets (cache module) ──────────────────────────────────────
//
// Cache privé au module : deux PDFs (bilan essais + bon-retour) peuvent
// coexister dans la même session sans recharger les fonts, mais chacun
// garde son cache — la duplication est acceptée pour ne pas créer un
// pdfBase.js partagé.
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
  doc.setTextColor(...C.renduAccent)
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

// ─── Bannière "rendu clôturé" (accent orange) ─────────────────────────────
function drawClotureBanner(doc, { y, closedAt, closedByName }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  const h = 10
  doc.setFillColor(...C.renduPale)
  doc.setDrawColor(...C.renduAccent)
  doc.setLineWidth(0.2)
  doc.roundedRect(M, y, PW - M * 2, h, 1.5, 1.5, 'FD')

  doc.setFont('WS', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C.renduAccent)
  doc.text('Rendu clôturé', M + 3, y + 4)

  doc.setFont('WS', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.black)
  const parts = []
  if (closedAt) parts.push(fmtDateTime(closedAt))
  if (closedByName) parts.push(`par ${closedByName}`)
  doc.text(parts.join(' · '), M + 3, y + 8)
  return y + h + 3
}

// ─── Bloc feedback (MAT-13G) ──────────────────────────────────────────────
//
// Rendu d'un cartouche orange pâle avec un titre en gras et le texte
// libre saisi en checklist. Largeur pleine page, hauteur dynamique calculée
// via `splitTextToSize`. Si `body` est vide (après trim), on no-op et on
// renvoie `y` inchangé — la gestion du "skip si vide" est donc à la charge
// de l'appelant (on garde le helper idempotent).
//
// On tolère un saut de page si le bloc ne rentre plus : on déplace tout le
// cartouche sur la page suivante en redessinant le header.
function drawFeedbackBlock(doc, { y, title, body, renderPageHeader }) {
  const text = String(body || '').trim()
  if (!text) return y
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 14
  const innerPadX = 3
  const innerPadY = 3.2
  const titleH = 4.5

  doc.setFont('WS', 'normal')
  doc.setFontSize(8.5)
  const lines = doc.splitTextToSize(text, PW - M * 2 - innerPadX * 2)
  const bodyH = lines.length * 3.8
  const h = innerPadY + titleH + 1 + bodyH + innerPadY

  // Saut de page si le cartouche ne rentre plus (header = 32, footer = 16)
  if (y + h > PH - 16) {
    doc.addPage()
    if (typeof renderPageHeader === 'function') renderPageHeader()
    y = 34
  }

  doc.setFillColor(...C.renduPale)
  doc.setDrawColor(...C.renduAccent)
  doc.setLineWidth(0.2)
  doc.roundedRect(M, y, PW - M * 2, h, 1.5, 1.5, 'FD')

  doc.setFont('WS', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.renduAccent)
  doc.text(title || 'Feedback', M + innerPadX, y + innerPadY + 2.6)

  doc.setFont('WS', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.black)
  doc.text(lines, M + innerPadX, y + innerPadY + titleH + 3)

  return y + h + 3
}

// ─── Stats rendu (dérivées du snapshot, basées sur post_check_at) ─────────
//
// Ne réutilise PAS `section.stats` (qui compte pre_check_at = essais). On
// re-dérive un objet de même shape pour alimenter `drawSynthesisLine` et
// `drawStatsCards` sans surcharge.
function computeRenduStats(section) {
  const stats = {
    total: 0,
    checked: 0,
    removed: 0,
    additifs: 0,
    ratio: 0,
    byFlag: { ok: 0, attention: 0, probleme: 0, none: 0 },
  }
  const allItems = (section?.blocks || []).flatMap((b) => b.items || [])
  for (const it of allItems) {
    const isRemoved = Boolean(it?.removed_at)
    const isAdditif = Boolean(it?.added_during_check)
    if (isAdditif) stats.additifs += 1
    if (isRemoved) {
      stats.removed += 1
      continue
    }
    stats.total += 1
    if (it?.post_check_at) stats.checked += 1
    const flag = it?.flag
    if (flag === 'ok') stats.byFlag.ok += 1
    else if (flag === 'attention') stats.byFlag.attention += 1
    else if (flag === 'probleme') stats.byFlag.probleme += 1
    else stats.byFlag.none += 1
  }
  stats.ratio = stats.total > 0 ? stats.checked / stats.total : 0
  return stats
}

// ─── Ligne de synthèse narrative ──────────────────────────────────────────
//
// Formulation rendu : "X items actifs · Y/X rendus (Z %) · N retirés · N
// additifs · ⚠ P problèmes". Cohérent avec la version essais, mais le mot-
// clé "rendus" remplace "cochés" pour éviter toute ambiguïté de phase.
function drawSynthesisLine(doc, { y, stats }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14

  const parts = []
  const nActive = stats.total || 0
  parts.push(`${nActive} item${nActive > 1 ? 's' : ''} actif${nActive > 1 ? 's' : ''}`)
  if (nActive > 0) {
    const pct = Math.round((stats.ratio || 0) * 100)
    parts.push(`${stats.checked}/${nActive} rendu${stats.checked > 1 ? 's' : ''} (${pct} %)`)
  } else {
    parts.push('0 rendu')
  }
  if (stats.removed > 0) {
    parts.push(`${stats.removed} retiré${stats.removed > 1 ? 's' : ''}`)
  }
  if (stats.additifs > 0) {
    parts.push(`${stats.additifs} additif${stats.additifs > 1 ? 's' : ''}`)
  }
  const nPb = stats.byFlag?.probleme || 0
  const nAtt = stats.byFlag?.attention || 0
  if (nPb > 0) parts.push(`${nPb} problème${nPb > 1 ? 's' : ''}`)
  else if (nAtt > 0) parts.push(`${nAtt} attention${nAtt > 1 ? 's' : ''}`)

  const text = 'Synthèse — ' + parts.join(' · ')

  doc.setFont('WS', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.gray)
  const lines = doc.splitTextToSize(text, PW - M * 2)
  doc.text(lines, M, y + 3.5)
  return y + lines.length * 4 + 2
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
      label: 'Rendus',
      value: `${stats.checked}/${stats.total}`,
      sub: stats.total ? `${Math.round(stats.ratio * 100)} %` : '—',
      color: stats.total > 0 && stats.checked === stats.total ? C.green : C.black,
    },
    { label: 'Retirés',        value: String(stats.removed),  color: stats.removed ? C.red : C.gray },
    { label: 'Additifs',       value: String(stats.additifs), color: stats.additifs ? C.additifAccent : C.gray },
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

  // Ligne flags (pastilles colorées) — mêmes flags que l'essais (le flag
  // de l'item est partagé entre phases côté modèle).
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
//
// Même structure que le bilan : deux sous-sections (scope initial +
// additifs), commentaires kind='rendu' inline sous chaque item, puis
// annexe photos retour en fin de bloc.
function renderBlock(doc, {
  startY, block, items, renderPageHeader, photoDataMap = null,
}) {
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

  // Mini meta ligne : compte, rendus, retirés, additifs
  const nTot = items.filter((it) => !it.removed_at).length
  const nReturned = items.filter((it) => !it.removed_at && it.post_check_at).length
  const nRem = items.filter((it) => it.removed_at).length
  const nAdd = items.filter((it) => it.added_during_check).length
  const metaParts = [`${nTot} item${nTot > 1 ? 's' : ''}`, `${nReturned} rendus`]
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

  // Split scope initial / additifs (miroir du bilan essais)
  const mainItems = items.filter((it) => !it.added_during_check)
  const additifsItems = items.filter((it) => it.added_during_check)

  if (mainItems.length > 0) {
    renderItemsTable(doc, { startY: y, items: mainItems, renderPageHeader })
    y = doc.lastAutoTable.finalY + 4
  } else {
    doc.setFont('WS', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(...C.gray)
    doc.text('Aucun item du scope initial dans ce bloc.', M + 2, y + 3)
    y += 6
  }

  if (additifsItems.length > 0) {
    y = renderAdditifsSection(doc, { startY: y, items: additifsItems, renderPageHeader })
  }

  // Annexe photos retour à l'échelle du bloc
  if (photoDataMap) {
    y = renderBlockPhotosRetour(doc, { startY: y, items, photoDataMap, renderPageHeader })
  }

  return y + 3
}

// ─── Tables d'items ────────────────────────────────────────────────────────
//
// 6 colonnes :
//   Désignation · Qté · Loueurs · Flag · Statut (rendu/retiré/additif) · Comm.
//
// Le statut est dérivé de post_check_at (pas pre_check_at). Les
// commentaires rendus en colSpan=6 sont filtrés kind='rendu' (les notes
// essais ne polluent pas le bon de retour).

const RENDU_HEAD = [[
  'Désignation',
  { content: 'Qté', styles: { halign: 'center' } },
  'Loueurs',
  { content: 'Flag', styles: { halign: 'center' } },
  'Statut',
  { content: 'Comm.', styles: { halign: 'center' } },
]]

const RENDU_COLUMN_STYLES = {
  0: { cellWidth: 'auto' },
  1: { cellWidth: 10 },
  2: { cellWidth: 28 },
  3: { cellWidth: 12 },
  4: { cellWidth: 40 },
  5: { cellWidth: 16 },
}

const RENDU_TABLE_STYLES = {
  font: 'WS',
  fontSize: 8,
  cellPadding: 1.6,
  lineColor: C.lgray,
  lineWidth: 0.1,
  overflow: 'linebreak',
  valign: 'top',
}

function buildRenduBodyRows(items) {
  const rows = []
  for (const it of items) {
    const removed = Boolean(it.removed_at)
    const des = buildDesignationCell(it)
    des._removed = removed

    const qte = {
      content: String(it.quantite ?? ''),
      _removed: removed,
      styles: { halign: 'center' },
    }
    const lou = {
      content: loueursCellText(it),
      _removed: removed,
      styles: { fontSize: 7 },
    }
    const flg = flagCell(it.flag)
    flg._removed = removed
    const sta = statusCellRendu(it)
    sta._removed = removed

    const renduComments = (it.comments || []).filter((c) => c.kind === 'rendu')
    const rawCom = commentsCountCell(renduComments)
    const com = typeof rawCom === 'string'
      ? { content: rawCom, _removed: removed, styles: { halign: 'center' } }
      : { ...rawCom, _removed: removed }

    rows.push([des, qte, lou, flg, sta, com])

    for (const c of renduComments) {
      rows.push(buildCommentRow(c))
    }
  }
  return rows
}

function buildCommentRow(c) {
  const author = c.author_name || '—'
  const date = fmtDateTime(c.created_at)
  const body = (c.body || '').trim() || '(vide)'
  return [
    {
      content: `»  ${author} · ${date}  —  ${body}`,
      colSpan: 6,
      _comment: true,
      styles: {
        halign: 'left',
        fontSize: 7,
        fontStyle: 'italic',
        textColor: C.gray,
        fillColor: [249, 249, 249],
        cellPadding: { top: 1, bottom: 1, left: 8, right: 3 },
        lineWidth: 0.05,
        lineColor: [235, 235, 235],
      },
    },
  ]
}

function renduDidParseCell(data) {
  if (data.section !== 'body') return
  const raw = data.cell.raw
  if (raw && raw._removed) {
    data.cell.styles.fillColor = C.removedFill
    data.cell.styles.textColor = C.removedText
    data.cell.styles.fontStyle = 'normal'
  }
}

function makeRenduDidDrawCell(doc) {
  return (data) => {
    if (data.section !== 'body') return
    if (data.column.index !== 0) return
    const raw = data.cell.raw
    if (!raw || !raw._removed) return

    const { x, y: cy, width } = data.cell
    const padX = 1.6
    const padY = 1.4
    const badgeW = 13
    const badgeH = 3.8
    const badgeX = x + width - badgeW - padX
    const badgeY = cy + padY

    doc.setFillColor(...C.red)
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 0.9, 0.9, 'F')
    doc.setFont('WS', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(...C.white)
    doc.text('RETIRÉ', badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.3, {
      align: 'center',
      baseline: 'middle',
    })

    doc.setDrawColor(...C.removedText)
    doc.setLineWidth(0.2)
    const strikeStop = badgeX - 1
    const strikeY = cy + 4.2
    if (strikeStop > x + 2.5) {
      doc.line(x + 2, strikeY, strikeStop, strikeY)
    }
  }
}

function renderItemsTable(doc, { startY, items, renderPageHeader }) {
  const M = 14

  autoTable(doc, {
    startY,
    head: RENDU_HEAD,
    body: buildRenduBodyRows(items),
    theme: 'grid',
    styles: RENDU_TABLE_STYLES,
    headStyles: {
      font: 'WS',
      fontStyle: 'bold',
      fontSize: 7.5,
      fillColor: C.header,
      textColor: C.white,
    },
    columnStyles: RENDU_COLUMN_STYLES,
    margin: { left: M, right: M, top: 32, bottom: 16 },
    didDrawPage: renderPageHeader,
    didParseCell: renduDidParseCell,
    didDrawCell: makeRenduDidDrawCell(doc),
  })
}

function renderAdditifsSection(doc, { startY, items, renderPageHeader }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  let y = startY

  if (y > 258) {
    doc.addPage()
    renderPageHeader()
    y = 34
  }

  const hh = 6.5
  const w = PW - M * 2
  const barW = 1.4
  doc.setFillColor(...C.additifHead)
  doc.roundedRect(M, y, w, hh, 0.8, 0.8, 'F')
  doc.setFillColor(...C.additifAccent)
  doc.rect(M, y, barW, hh, 'F')

  doc.setFont('WS', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.additifAccent)
  doc.text("ADDITIFS  ·  ajoutés en cours d'essais", M + barW + 2, y + 4.3)

  doc.setFont('WS', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.additifAccent)
  doc.text(
    `${items.length} item${items.length > 1 ? 's' : ''}`,
    M + w - 2, y + 4.3, { align: 'right' },
  )

  y += hh + 0.5

  autoTable(doc, {
    startY: y,
    head: RENDU_HEAD,
    body: buildRenduBodyRows(items),
    theme: 'grid',
    styles: RENDU_TABLE_STYLES,
    headStyles: {
      font: 'WS',
      fontStyle: 'bold',
      fontSize: 7.5,
      fillColor: C.additifHead,
      textColor: C.additifAccent,
      lineColor: C.additifAccent,
      lineWidth: 0.15,
    },
    columnStyles: RENDU_COLUMN_STYLES,
    margin: { left: M, right: M, top: 32, bottom: 16 },
    didDrawPage: renderPageHeader,
    didParseCell: renduDidParseCell,
    didDrawCell: makeRenduDidDrawCell(doc),
  })

  return doc.lastAutoTable.finalY + 4
}

// ─── Cellules dédiées ──────────────────────────────────────────────────────
function flagCell(flag) {
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

function buildDesignationCell(it) {
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

// Cellule Statut rendu : "✓ X · DATE" (rendu) ou "Non rendu". Ajoute les
// infos retiré / additif si applicable (motif retiré inclus).
function statusCellRendu(it) {
  const lines = []
  if (it.post_check_at) {
    lines.push(
      `✓ ${it.post_check_by_name || '—'}${it.post_check_at ? ' · ' + fmtDateTime(it.post_check_at) : ''}`
    )
  } else {
    lines.push('Non rendu')
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

function commentsCountCell(comments) {
  const n = (comments || []).length
  if (n === 0) return '—'
  return {
    content: `${n} message${n > 1 ? 's' : ''}`,
    styles: { halign: 'center', fontStyle: 'bold' },
  }
}

// ─── Photos retour : prefetch + rendu ──────────────────────────────────────
//
// Walk uniquement les `photos_retour` des items (kind='retour' ancrées
// item_id). Pas de pack_photos côté rendu.

const PHOTO_THUMB_SIZE = 600
const PHOTO_THUMB_MM = 40
const PHOTO_GAP_MM = 2.5
const PHOTO_CAPTION_H = 3.2

function detectImageFormat(mimeType, storagePath) {
  const mime = String(mimeType || '').toLowerCase()
  if (mime === 'image/png') return 'PNG'
  if (mime === 'image/webp') return 'WEBP'
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'JPEG'
  const path = String(storagePath || '').toLowerCase()
  if (path.endsWith('.png')) return 'PNG'
  if (path.endsWith('.webp')) return 'WEBP'
  if (path.endsWith('.gif')) return 'GIF'
  return 'JPEG'
}

async function fetchPhotoAsDataUrl(storagePath, { size = PHOTO_THUMB_SIZE } = {}) {
  try {
    const url = await getPhotoThumbnailUrl(storagePath, { size, expiresIn: 3600 })
    if (!url) return null
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * Walk le snapshot et retourne une Map<photoId, { dataUrl, format, width,
 * height }> pour toutes les photos kind='retour' ancrées aux items. Exposé
 * au cas où un caller veut mutualiser le prefetch (ex. preview + clôture
 * enchaînés) — sinon buildBonRetourPdf le fait automatiquement.
 */
export async function prefetchRenduPhotoDataUrls(snapshot, { size = PHOTO_THUMB_SIZE } = {}) {
  const seen = new Map()
  // On walk la section globale ET byLoueur (MAT-13H : pour un usage
  // "section only" on peut passer { global: section, byLoueur: [] }, mais
  // pour un ZIP on partage le même Map entre tous les PDFs → on accepte
  // aussi snapshot.byLoueur pour de la robustesse).
  const sections = []
  if (snapshot?.global) sections.push(snapshot.global)
  if (Array.isArray(snapshot?.byLoueur)) {
    for (const s of snapshot.byLoueur) {
      if (s) sections.push(s)
    }
  }
  for (const section of sections) {
    if (!Array.isArray(section.blocks)) continue
    for (const b of section.blocks) {
      for (const it of b.items || []) {
        for (const p of it.photos_retour || []) {
          if (p?.id && !seen.has(p.id)) seen.set(p.id, p)
        }
      }
    }
  }

  const entries = await Promise.all(
    [...seen.values()].map(async (p) => {
      const dataUrl = await fetchPhotoAsDataUrl(p.storage_path, { size })
      return [p.id, {
        dataUrl,
        format: detectImageFormat(p.mime_type, p.storage_path),
        width: Number.isFinite(p.width) ? p.width : null,
        height: Number.isFinite(p.height) ? p.height : null,
      }]
    }),
  )
  return new Map(entries)
}

function renderPhotoGrid(doc, {
  startY, photos, photoDataMap, renderPageHeader, withCaption = true,
}) {
  if (!photos || photos.length === 0) return startY
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 14
  const W = PW - M * 2
  const perRow = Math.max(1, Math.floor((W + PHOTO_GAP_MM) / (PHOTO_THUMB_MM + PHOTO_GAP_MM)))
  const cellW = PHOTO_THUMB_MM
  const cellH = PHOTO_THUMB_MM + (withCaption ? PHOTO_CAPTION_H : 0)

  let x = M
  let y = startY
  let col = 0

  for (const p of photos) {
    const data = photoDataMap?.get(p.id)
    if (!data?.dataUrl) continue

    if (y + cellH > PH - 16) {
      doc.addPage()
      renderPageHeader()
      y = 34
      x = M
      col = 0
    }

    try {
      doc.addImage(data.dataUrl, data.format || 'JPEG', x, y, cellW, PHOTO_THUMB_MM, undefined, 'FAST')
    } catch {
      doc.setDrawColor(...C.lgray)
      doc.setLineWidth(0.2)
      doc.rect(x, y, cellW, PHOTO_THUMB_MM)
      doc.setFont('WS', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.gray)
      doc.text('(image indisponible)', x + cellW / 2, y + PHOTO_THUMB_MM / 2, {
        align: 'center',
        baseline: 'middle',
      })
    }

    if (withCaption) {
      const caption = (p.caption || '').trim()
      const meta = [
        p.uploaded_by_name || '',
        p.created_at ? fmtDate(p.created_at) : '',
      ].filter(Boolean).join(' · ')
      const line = caption || meta
      if (line) {
        doc.setFont('WS', 'normal')
        doc.setFontSize(6.5)
        doc.setTextColor(...C.gray)
        const maxW = cellW
        const [firstLine] = doc.splitTextToSize(line, maxW)
        doc.text(firstLine, x + 0.3, y + PHOTO_THUMB_MM + 2.4)
      }
    }

    col += 1
    if (col >= perRow) {
      col = 0
      x = M
      y += cellH + PHOTO_GAP_MM
    } else {
      x += cellW + PHOTO_GAP_MM
    }
  }

  if (col !== 0) {
    y += cellH + PHOTO_GAP_MM
  }
  return y
}

function renderBlockPhotosRetour(doc, {
  startY, items, photoDataMap, renderPageHeader,
}) {
  const itemsWithPhotos = (items || []).filter((it) => (it.photos_retour || []).length > 0)
  if (itemsWithPhotos.length === 0) return startY

  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 14
  let y = startY

  if (y > PH - 24) {
    doc.addPage()
    renderPageHeader()
    y = 34
  }

  // Entête de section "Photos retour"
  doc.setDrawColor(...C.lgray)
  doc.setLineWidth(0.25)
  doc.line(M, y + 1.5, PW - M, y + 1.5)
  doc.setFont('WS', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.renduAccent)
  const total = itemsWithPhotos.reduce((s, it) => s + it.photos_retour.length, 0)
  doc.text(`PHOTOS RETOUR · ${total} vignette${total > 1 ? 's' : ''}`, M, y + 4.5)
  y += 6.5

  for (const it of itemsWithPhotos) {
    y = renderItemPhotosSubsection(doc, { startY: y, item: it, photoDataMap, renderPageHeader })
  }

  return y + 1
}

function renderItemPhotosSubsection(doc, { startY, item, photoDataMap, renderPageHeader }) {
  const photos = item.photos_retour || []
  if (photos.length === 0) return startY
  const designation = item.designation || '—'
  const labelPrefix = item.label ? `${String(item.label).toUpperCase()} · ` : ''
  const title = `${labelPrefix}${designation} (${photos.length} photo${photos.length > 1 ? 's' : ''})`
  let y = renderSubsectionHeader(doc, {
    startY, title, accent: FLAG_COLOR[item.flag] || C.gray, renderPageHeader,
  })
  y = renderPhotoGrid(doc, { startY: y, photos, photoDataMap, renderPageHeader })
  return y
}

function renderSubsectionHeader(doc, { startY, title, accent = C.gray, renderPageHeader }) {
  const PH = doc.internal.pageSize.getHeight()
  const M = 14
  let y = startY

  if (y + 6 + PHOTO_THUMB_MM + PHOTO_CAPTION_H > PH - 16) {
    doc.addPage()
    renderPageHeader()
    y = 34
  }

  doc.setFillColor(...accent)
  doc.circle(M + 1.2, y + 2.1, 0.9, 'F')
  doc.setFont('WS', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C.black)
  doc.text(title, M + 3.2, y + 2.8)
  return y + 5.5
}

// ═══ PDF BON DE RETOUR — GLOBAL (MAT-13E / MAT-13H) ════════════════════════
//
// Option `photoDataMap` : si fournie (via `prefetchRenduPhotoDataUrls`),
// évite un re-fetch (utile pour preview + clôture enchaînés, ou pour le ZIP
// qui partage la map entre tous les PDFs). Sinon prefetch interne automatique.
//
// MAT-13G : le feedback global (`snapshot.version.rendu_feedback`) est rendu
// juste après la bannière de clôture éventuelle. Omis si vide.
export async function buildBonRetourGlobalPdf(snapshot, { org, photoDataMap = null } = {}) {
  if (!snapshot || !snapshot.version) {
    throw new Error('buildBonRetourGlobalPdf : snapshot invalide')
  }
  const assets = await loadAssets()
  const doc = makeDoc(assets)
  const M = 14

  // Prefetch photos retour si pas déjà fourni par l'appelant.
  const photos = photoDataMap || (await prefetchRenduPhotoDataUrls(snapshot))

  const renderPageHeader = () =>
    drawHeader(doc, {
      title: 'BON DE RETOUR',
      subtitle: 'Rendu matériel — vue d\'ensemble',
      project: snapshot.project,
      version: snapshot.version,
      banner: assets.banner,
    })

  renderPageHeader()

  let y = 34
  const renduClosedAt = snapshot.version?.rendu_closed_at || null
  const renduClosedByName = snapshot.version?.rendu_closed_by_name || null
  if (renduClosedAt) {
    y = drawClotureBanner(doc, { y, closedAt: renduClosedAt, closedByName: renduClosedByName })
  }

  // MAT-13G : feedback global (no-op si vide).
  y = drawFeedbackBlock(doc, {
    y,
    title: 'Feedback rendu — tous loueurs',
    body: snapshot.version?.rendu_feedback || '',
    renderPageHeader,
  })

  const renduStats = computeRenduStats(snapshot.global)
  y = drawSynthesisLine(doc, { y, stats: renduStats })
  y = drawStatsCards(doc, { y, stats: renduStats })
  y += 2

  const blocks = (snapshot.global?.blocks || []).filter((b) => b.items.length > 0)
  if (blocks.length === 0) {
    doc.setFont('WS', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...C.gray)
    doc.text('Aucun item dans cette version.', M, y + 4)
  } else {
    for (const entry of blocks) {
      y = renderBlock(doc, {
        startY: y,
        block: entry.block,
        items: entry.items,
        photoDataMap: photos,
        renderPageHeader,
      })
    }
  }

  drawFooter(doc, { org })
  return finishDoc(
    doc,
    bonRetourPdfFilename({ project: snapshot.project, version: snapshot.version }),
  )
}

// Backward-compat alias (MAT-13E). Les callers existants (hooks close/preview)
// passent par cette entrée ; on la garde même shape + même filename.
export const buildBonRetourPdf = buildBonRetourGlobalPdf

// ═══ PDF BON DE RETOUR — PAR LOUEUR (MAT-13H) ══════════════════════════════
//
// Filtre le rendu sur un seul bucket loueur (ou "Sans loueur"). La section
// est passée par l'appelant (pré-résolue via `snapshot.byLoueur`) pour
// éviter la duplication de logique de dispatch.
//
// Feedbacks affichés dans l'ordre :
//   1. feedback loueur-specific (primaire, cf. `version_loueur_infos`)
//   2. feedback global (contexte secondaire, plus discret possible à
//      terme — pour l'instant même cartouche, juste un titre différent)
//
// Les deux sont omis si vides.
export async function buildBonRetourLoueurPdf(snapshot, {
  loueur,
  section,
  org,
  photoDataMap = null,
} = {}) {
  if (!snapshot || !snapshot.version) {
    throw new Error('buildBonRetourLoueurPdf : snapshot invalide')
  }
  if (!section) {
    throw new Error('buildBonRetourLoueurPdf : section (loueur bucket) requis')
  }

  const assets = await loadAssets()
  const doc = makeDoc(assets)
  const M = 14
  const PW = doc.internal.pageSize.getWidth()

  // Prefetch si pas fourni. On passe la section comme mini-snapshot pour
  // ne fetch que les photos du bucket en mode standalone.
  const photos = photoDataMap || (await prefetchRenduPhotoDataUrls({
    global: section,
    byLoueur: [],
  }))

  const loueurNom = loueur?.nom || 'Sans loueur'
  const renderPageHeader = () =>
    drawHeader(doc, {
      title: 'BON DE RETOUR',
      subtitle: `Loueur : ${loueurNom}`,
      project: snapshot.project,
      version: snapshot.version,
      banner: assets.banner,
    })

  renderPageHeader()

  let y = 34

  const renduClosedAt = snapshot.version?.rendu_closed_at || null
  const renduClosedByName = snapshot.version?.rendu_closed_by_name || null
  if (renduClosedAt) {
    y = drawClotureBanner(doc, { y, closedAt: renduClosedAt, closedByName: renduClosedByName })
  }

  // En-tête loueur : pastille couleur + nom + nb refs/unités
  if (loueur?.couleur) {
    const rgb = _hexToRgb(loueur.couleur) || C.gray
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

  // MAT-13G : feedback loueur-specific (primaire).
  const loueurInfo = (snapshot.version_loueur_infos || []).find(
    (row) => row?.loueur_id === (loueur?.id || null),
  )
  const loueurFeedback = loueurInfo?.rendu_feedback || ''
  y = drawFeedbackBlock(doc, {
    y,
    title: `Feedback pour ${loueurNom}`,
    body: loueurFeedback,
    renderPageHeader,
  })

  // MAT-13G : feedback global (contextuel — utile si ça s'applique à tous
  // les loueurs en plus du loueur-specific).
  y = drawFeedbackBlock(doc, {
    y,
    title: 'Feedback général',
    body: snapshot.version?.rendu_feedback || '',
    renderPageHeader,
  })

  // Stats recalculées sur la section (pas sur snapshot.global).
  const renduStats = computeRenduStats(section)
  y = drawSynthesisLine(doc, { y, stats: renduStats })
  y = drawStatsCards(doc, { y, stats: renduStats })
  y += 2

  const blocks = (section.blocks || []).filter((b) => b.items.length > 0)
  if (blocks.length === 0) {
    doc.setFont('WS', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...C.gray)
    doc.text('Aucun item assigné à ce loueur.', M, y + 4)
  } else {
    for (const entry of blocks) {
      y = renderBlock(doc, {
        startY: y,
        block: entry.block,
        items: entry.items,
        photoDataMap: photos,
        renderPageHeader,
      })
    }
  }

  drawFooter(doc, { org })
  return finishDoc(
    doc,
    bonRetourLoueurPdfFilename({
      project: snapshot.project,
      version: snapshot.version,
      loueur: loueur || { nom: 'sans-loueur' },
    }),
  )
}

// ═══ ZIP : global + 1 PDF / loueur (MAT-13H) ══════════════════════════════
//
// Même pattern que buildBilanZip : on partage photoDataMap pour éviter N+1
// round-trips Storage.
export async function buildBonRetourZip(snapshot, { org } = {}) {
  if (!snapshot || !snapshot.version) {
    throw new Error('buildBonRetourZip : snapshot invalide')
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

  const photoDataMap = await prefetchRenduPhotoDataUrls(snapshot)

  // 1. Global
  const globalPdf = await buildBonRetourGlobalPdf(snapshot, { org, photoDataMap })
  zip.file(globalPdf.filename, await globalPdf.blob.arrayBuffer())

  // 2. Par loueur — 1 PDF / bucket (y compris "Sans loueur" s'il existe)
  const loueurPdfs = []
  for (const section of snapshot.byLoueur || []) {
    const pdf = await buildBonRetourLoueurPdf(snapshot, {
      loueur: section.loueur,
      section,
      org,
      photoDataMap,
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
  const filename = bonRetourZipFilename({
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

// ─── Helper couleur (module-local — dupliqué de matosBilanPdf pour
// garder les deux modules décorrélés, cf. header de fichier) ──────────────
function _hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Re-export du sentinelle pour commodité (utilisé côté BonRetourExportModal).
export { NO_LOUEUR_BUCKET_ID }
