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
// MAT-11E (photos) : les photos probleme sont rendues dans une section
// "Photos" en fin de bloc, groupées par item (rendu robuste : pas de
// surgery dans autoTable). Les photos pack ne sont incluses QUE dans le
// PDF global (usage interne remballe — cf. migration MAT-11A). Le prefetch
// est mutualisé au niveau `buildBilanZip` pour ne fetcher Storage qu'une
// fois pour N+1 PDFs.
// ════════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { bilanPdfFilename, bilanZipFilename, versionLabel } from '../../lib/matosBilanData'
import { getPhotoThumbnailUrl } from '../../lib/matosItemPhotos'
import { loadImageAsJpeg, computeLogoBox } from '../../lib/pdfImageLoader'
import { pickOrgLogo } from '../../lib/branding'

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
  // MAT-21 : tons pastels pour le relief visuel retirés / additifs
  removedFill: [252, 245, 245],  // rouge très pâle pour rangée retirée
  removedText: [140, 140, 140],  // gris pour texte retiré
  additifAccent: [22, 118, 55],  // vert saturé pour accent section additifs
  additifHead: [228, 240, 231],  // vert pâle pour header section additifs
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

// Helpers de chargement images factorisés dans lib/pdfImageLoader.js

async function loadAssets(org) {
  // Fonts en cache module-scope (indépendantes de l'org)
  if (!_assetsCache) {
    const [wsReg, wsBold, wsMed] = await Promise.all([
      loadFontBase64('/font/WorkSans-Regular.ttf'),
      loadFontBase64('/font/WorkSans-Bold.ttf'),
      loadFontBase64('/font/WorkSans-Medium.ttf'),
    ])
    _assetsCache = { wsReg, wsBold, wsMed }
  }
  // Logo banner rechargé par org (chaque org a son propre logo)
  const hasOrgLogo = Boolean(
    org?.logo_banner_url || org?.logo_url_clair || org?.logo_url_sombre
  )
  const bannerUrl = pickOrgLogo(org, 'banner')
  const bannerImage = await loadImageAsJpeg(bannerUrl).catch((e) => {
    if (hasOrgLogo) {
      console.error('[matosBilanPdf] logo org échoué, PDF sans logo:', e?.message)
    }
    return null
  })
  return { ..._assetsCache, bannerImage }
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
function drawHeader(doc, { title, subtitle, project, version, bannerImage }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14

  // Logo à gauche, taille calculée dynamiquement à partir du ratio naturel
  if (bannerImage) {
    try {
      const BOX_Y = 10
      const BOX_H = 14
      const BOX_W = 50
      const { width, height } = computeLogoBox(
        bannerImage.width, bannerImage.height, BOX_W, BOX_H
      )
      const finalY = BOX_Y + (BOX_H - height) / 2
      doc.addImage(bannerImage.dataUrl, 'JPEG', M, finalY, width, height)
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
    doc.text(org?.legal_name || org?.display_name || '', M, PH - 7)
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

// ─── MAT-21 : Ligne de synthèse narrative ──────────────────────────────────
//
// Une phrase compacte en italique placée JUSTE AVANT les cartes stats.
// Utile pour une lecture rapide : l'œil balaye la ligne puis plonge dans
// les cartes détaillées. Pas d'écho avec les cartes — on formule en texte
// naturel là où les cartes sont des chiffres bruts.
function drawSynthesisLine(doc, { y, stats }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14

  // Composition : "X items actifs · Y cochés (Z %) · N retirés · N additifs ·
  //                ⚠ P problèmes"  — segments omis si nuls.
  const parts = []
  const nActive = stats.total || 0
  parts.push(`${nActive} item${nActive > 1 ? 's' : ''} actif${nActive > 1 ? 's' : ''}`)
  if (nActive > 0) {
    const pct = Math.round((stats.ratio || 0) * 100)
    parts.push(`${stats.checked}/${nActive} coché${stats.checked > 1 ? 's' : ''} (${pct} %)`)
  } else {
    parts.push('0 coché')
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
      label: 'Cochés',
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
//
// MAT-21 : le bloc a désormais deux sous-sections :
//   1. Items "de base" (scope initial : ceux qui N'ont PAS été ajoutés en
//      cours d'essais). Les retirés y figurent aussi, avec un traitement
//      visuel dédié (fond rose pâle, texte gris, strikethrough, pastille
//      "RETIRÉ") pour signaler le changement de statut sans les cacher.
//   2. Section "Additifs" en fin de bloc pour ceux ajoutés en cours
//      d'essais (added_during_check). Encadrée en vert avec un en-tête
//      explicite, pour signaler clairement que ces items ne faisaient pas
//      partie du scope initial.
//
// Les commentaires sont rendus INLINE (rang colSpan=6 juste sous l'item
// concerné) — plus de section "Commentaires" orpheline en fin de bloc qui
// obligeait à faire le lien mental entre l'item et son commentaire.
//
// La ligne meta (compteur + retirés + additifs) reste au niveau du titre
// pour un coup d'œil rapide.
function renderBlock(doc, {
  startY, block, items, renderPageHeader,
  pack_photos = [], photoDataMap = null, includePack = false,
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

  // MAT-21 : split scope initial / additifs. Un additif retiré reste dans la
  // section additifs (avec styling retiré) pour préserver sa provenance.
  const mainItems = items.filter((it) => !it.added_during_check)
  const additifsItems = items.filter((it) => it.added_during_check)

  // ── Table principale (items du scope initial, retirés inclus) ──────────
  if (mainItems.length > 0) {
    renderItemsTable(doc, {
      startY: y,
      items: mainItems,
      renderPageHeader,
      variant: 'main',
    })
    y = doc.lastAutoTable.finalY + 4
  } else {
    // Bloc qui ne contient que des additifs : on affiche une mention discrète
    // avant la section additifs pour garder le contexte.
    doc.setFont('WS', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(...C.gray)
    doc.text('Aucun item du scope initial dans ce bloc.', M + 2, y + 3)
    y += 6
  }

  // ── Section additifs (en fin de bloc, avec accent vert) ────────────────
  if (additifsItems.length > 0) {
    y = renderAdditifsSection(doc, {
      startY: y,
      items: additifsItems,
      renderPageHeader,
    })
  }

  // MAT-21 : les commentaires sont désormais rendus inline sous chaque item
  // via buildBilanBodyRows — plus de section "Commentaires" orpheline en fin
  // de bloc.

  // ── MAT-11E : Photos (probleme par item + pack si includePack) ─────────
  if (photoDataMap) {
    y = renderBlockPhotos(doc, {
      startY: y,
      items,
      pack_photos,
      photoDataMap,
      includePack,
      renderPageHeader,
    })
  }

  return y + 3
}

// ─── MAT-21 : Tables d'items (scope initial + additifs) ───────────────────
//
// Deux fonctions exposées à `renderBlock` :
//   - renderItemsTable : table standard (head gris foncé) pour les items
//     du scope initial, retirés inclus avec traitement visuel.
//   - renderAdditifsSection : bandeau vert "ADDITIFS ·  ajoutés en cours
//     d'essais" + table avec head vert pâle.
//
// Les deux partagent :
//   - BILAN_HEAD : 6 colonnes (Désignation · Qté · Loueurs · Flag · Statut
//     · Comm.)
//   - BILAN_COLUMN_STYLES : largeurs fixes
//   - buildBilanBodyRows(items) : mapping item → tableau de cellules, avec
//     un flag `_removed` posé sur chacune pour que les hooks didParseCell /
//     didDrawCell puissent teinter le rang retiré et ajouter la pastille.
//
// Les retirés sont rendus inline (pas regroupés) : fond rouge très pâle,
// texte gris, rayé + pastille "RETIRÉ" en haut-droit de la cellule
// désignation. L'objectif est de préserver le contexte (ordre / voisins)
// tout en signalant fortement le changement de statut.

const BILAN_HEAD = [[
  'Désignation',
  { content: 'Qté', styles: { halign: 'center' } },
  'Loueurs',
  { content: 'Flag', styles: { halign: 'center' } },
  'Statut',
  { content: 'Comm.', styles: { halign: 'center' } },
]]

const BILAN_COLUMN_STYLES = {
  0: { cellWidth: 'auto' },
  1: { cellWidth: 10 },
  2: { cellWidth: 28 },
  3: { cellWidth: 12 },
  4: { cellWidth: 40 },
  5: { cellWidth: 16 },
}

const BILAN_TABLE_STYLES = {
  font: 'WS',
  fontSize: 8,
  cellPadding: 1.6,
  lineColor: C.lgray,
  lineWidth: 0.1,
  overflow: 'linebreak',
  valign: 'top',
}

function buildBilanBodyRows(items) {
  const rows = []
  for (const it of items) {
    const removed = Boolean(it.removed_at)
    const des = buildBilanDesignationCell(it)
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
    const flg = flagBilanCell(it.flag)
    flg._removed = removed
    const sta = statusCell(it)
    sta._removed = removed

    const rawCom = commentsCountCell(it)
    const com = typeof rawCom === 'string'
      ? { content: rawCom, _removed: removed, styles: { halign: 'center' } }
      : { ...rawCom, _removed: removed }

    rows.push([des, qte, lou, flg, sta, com])

    // MAT-21 : commentaires inline juste sous l'item concerné. Un rang
    // par commentaire, colSpan=6, indenté avec "»" pour lier visuellement
    // au rang parent. Plus besoin d'une section "Commentaires" en fin de
    // bloc — la relation item↔commentaire est directe.
    const comments = it.comments || []
    for (const c of comments) {
      rows.push(buildCommentRow(c))
    }
  }
  return rows
}

function buildCommentRow(c) {
  const author = c.author_name || '—'
  const date = fmtDateTime(c.created_at)
  const body = (c.body || '').trim() || '(vide)'
  // Format compact 1 ligne (wrap auto si trop long) : « » auteur · date — corps
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

function bilanDidParseCell(data) {
  if (data.section !== 'body') return
  const raw = data.cell.raw
  // Ligne retirée : fond rose pâle + texte gris + font non-gras
  // (on force l'override pour neutraliser les couleurs des flags etc.)
  if (raw && raw._removed) {
    data.cell.styles.fillColor = C.removedFill
    data.cell.styles.textColor = C.removedText
    data.cell.styles.fontStyle = 'normal'
  }
}

// Retourne un hook didDrawCell qui :
//   - dessine une pastille rouge "RETIRÉ" en haut-droit de la cellule
//     désignation
//   - trace un trait de rayure sur la 1ère ligne de texte (stoppé avant la
//     pastille pour ne pas l'écraser)
function makeBilanDidDrawCell(doc) {
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

    // Pastille rouge pleine
    doc.setFillColor(...C.red)
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 0.9, 0.9, 'F')
    doc.setFont('WS', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(...C.white)
    doc.text('RETIRÉ', badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.3, {
      align: 'center',
      baseline: 'middle',
    })

    // Rayure (strikethrough) sur la 1ère ligne, stoppée avant la pastille
    doc.setDrawColor(...C.removedText)
    doc.setLineWidth(0.2)
    const strikeStop = badgeX - 1
    const strikeY = cy + 4.2
    if (strikeStop > x + 2.5) {
      doc.line(x + 2, strikeY, strikeStop, strikeY)
    }
  }
}

function renderItemsTable(doc, { startY, items, renderPageHeader, variant = 'main' }) {
  const M = 14

  // `variant` est prévu pour de futures variantes (ex. archive) — pour
  // l'instant, seule 'main' est utilisée.
  void variant

  autoTable(doc, {
    startY,
    head: BILAN_HEAD,
    body: buildBilanBodyRows(items),
    theme: 'grid',
    styles: BILAN_TABLE_STYLES,
    headStyles: {
      font: 'WS',
      fontStyle: 'bold',
      fontSize: 7.5,
      fillColor: C.header,
      textColor: C.white,
    },
    columnStyles: BILAN_COLUMN_STYLES,
    margin: { left: M, right: M, top: 32, bottom: 16 },
    didDrawPage: renderPageHeader,
    didParseCell: bilanDidParseCell,
    didDrawCell: makeBilanDidDrawCell(doc),
  })
}

function renderAdditifsSection(doc, { startY, items, renderPageHeader }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  let y = startY

  // Saut de page si le bandeau + au moins la head ne rentrent pas.
  if (y > 258) {
    doc.addPage()
    renderPageHeader()
    y = 34
  }

  // Bandeau d'entrée : barre verticale accent vert + fond vert pâle
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
    head: BILAN_HEAD,
    body: buildBilanBodyRows(items),
    theme: 'grid',
    styles: BILAN_TABLE_STYLES,
    headStyles: {
      font: 'WS',
      fontStyle: 'bold',
      fontSize: 7.5,
      fillColor: C.additifHead,
      textColor: C.additifAccent,
      lineColor: C.additifAccent,
      lineWidth: 0.15,
    },
    columnStyles: BILAN_COLUMN_STYLES,
    margin: { left: M, right: M, top: 32, bottom: 16 },
    didDrawPage: renderPageHeader,
    didParseCell: bilanDidParseCell,
    didDrawCell: makeBilanDidDrawCell(doc),
  })

  return doc.lastAutoTable.finalY + 4
}

// MAT-21 : renderItemComments (section "Commentaires" orpheline en fin de
// bloc) retiré — les commentaires sont désormais rendus inline sous leur
// item via buildCommentRow + buildBilanBodyRows.
//
// ─── MAT-11E : Photos (prefetch + rendu) ─────────────────────────────────
//
// Architecture :
//   1. `prefetchPhotoDataUrls(snapshot)` — async : walk le snapshot,
//      collecte les photo IDs uniques, fetch les thumbnails Supabase
//      (transform on-the-fly, resize='cover') en parallèle et les convertit
//      en dataURL (input de jsPDF.addImage). Retourne une Map<photoId,
//      { dataUrl, format, width, height }> réutilisable entre PDFs.
//
//   2. `renderBlockPhotos(doc, { ..., photoDataMap, includePack })` —
//      ajoute à la fin d'un bloc (juste après table main + additifs) une
//      section "Photos" groupée par item + pack. Skip si rien à afficher.
//
// Le rendu est gracieux sur échec : si une photo ne peut pas être fetchée
// (URL expirée, réseau ko, MIME inconnu), elle est silencieusement omise
// du PDF — préférable à un crash ou un placeholder laid.

// Taille de thumbnail demandée à Supabase (cover-crop carré). 600px couvre
// confortablement un rendu à ~38mm à 200 DPI d'impression (600/1.5 ≈ 400 DPI
// réel) sans exploser le poids du PDF (~60 KB/photo en JPEG q=75).
const PHOTO_THUMB_SIZE = 600

function detectImageFormat(mimeType, storagePath) {
  const mime = String(mimeType || '').toLowerCase()
  if (mime === 'image/png') return 'PNG'
  if (mime === 'image/webp') return 'WEBP'
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'JPEG'
  const path = String(storagePath || '').toLowerCase()
  if (path.endsWith('.png')) return 'PNG'
  if (path.endsWith('.webp')) return 'WEBP'
  if (path.endsWith('.gif')) return 'GIF'
  // Supabase transform returns JPEG by default — safest fallback.
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
 * Walk un snapshot bilan et retourne une Map<photoId, { dataUrl, format,
 * width, height }> avec les thumbnails pré-fetchés. Mutualisé via
 * buildBilanZip pour éviter N+1 fetches sur ZIP.
 */
export async function prefetchPhotoDataUrls(snapshot, { size = PHOTO_THUMB_SIZE } = {}) {
  const seen = new Map()
  const collectSection = (section) => {
    if (!section || !Array.isArray(section.blocks)) return
    for (const b of section.blocks) {
      for (const p of b.pack_photos || []) {
        if (p?.id && !seen.has(p.id)) seen.set(p.id, p)
      }
      for (const it of b.items || []) {
        for (const p of it.photos || []) {
          if (p?.id && !seen.has(p.id)) seen.set(p.id, p)
        }
      }
    }
  }
  collectSection(snapshot?.global)
  for (const s of snapshot?.byLoueur || []) collectSection(s)

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

// ─── Rendu d'une grille de photos (thumbnails carrées) ─────────────────────
//
// Grille fixed-size (carrés) ergonomique pour le bilan : 4 par ligne à 40mm
// avec 2.5mm de gap tient sur la largeur utile A4 (182mm = 4×40 + 3×2.5 =
// 167.5mm). Les thumbnails arrivent déjà cover-croppées par Supabase — on
// les paint sans calcul d'aspect.
//
// Caption optionnelle (1 ligne, 6.5pt gris) sous chaque thumb, tronquée.
//
// Pagination : si la ligne de photos courante ne tient plus, on crée une
// nouvelle page et on continue. Le caller passe `renderPageHeader` pour
// re-draw header/cartes en cas de saut.

const PHOTO_THUMB_MM = 40        // Côté de la miniature (carré)
const PHOTO_GAP_MM = 2.5         // Espace entre deux miniatures
const PHOTO_CAPTION_H = 3.2      // Hauteur approximative de la caption (mm)

function renderPhotoGrid(doc, {
  startY, photos, photoDataMap, renderPageHeader,
  withCaption = true,
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
    if (!data?.dataUrl) continue // skip fails silencieux

    // Page break si la ligne courante ne rentre plus
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
      // Placeholder discret si addImage échoue (format inconnu, dataURL corrompu…)
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
        // Tronque à une ligne
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

  // Si on a écrit des photos sur la dernière ligne partielle, avance y.
  if (col !== 0) {
    y += cellH + PHOTO_GAP_MM
  }
  return y
}

// ─── Rendu de la section "Photos" d'un bloc ────────────────────────────────
//
// Structure :
//   ── Photos ──
//   ITEM · Désignation (N photos)
//   [thumb] [thumb] [thumb]
//   ITEM · Autre désignation (N photos)
//   [thumb]
//   Pack (N photos)                    ← seulement si includePack=true
//   [thumb] [thumb] [thumb]
//
// Skip complet si aucun item n'a de photo ET aucune pack photo (ou
// includePack=false). Retourne la nouvelle y.

function renderBlockPhotos(doc, {
  startY, items, pack_photos = [], photoDataMap, includePack, renderPageHeader,
}) {
  const itemsWithPhotos = (items || []).filter((it) => (it.photos || []).length > 0)
  const packPhotos = includePack ? (pack_photos || []) : []
  if (itemsWithPhotos.length === 0 && packPhotos.length === 0) return startY

  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 14
  let y = startY

  // Saut de page si le header de section ne rentre pas.
  if (y > PH - 24) {
    doc.addPage()
    renderPageHeader()
    y = 34
  }

  // Entête de section "Photos" — style discret (trait + label)
  doc.setDrawColor(...C.lgray)
  doc.setLineWidth(0.25)
  doc.line(M, y + 1.5, PW - M, y + 1.5)
  doc.setFont('WS', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.gray)
  const total = itemsWithPhotos.reduce((s, it) => s + it.photos.length, 0) + packPhotos.length
  doc.text(`PHOTOS · ${total} vignette${total > 1 ? 's' : ''}`, M, y + 4.5)
  y += 6.5

  // Sous-sections par item
  for (const it of itemsWithPhotos) {
    y = renderItemPhotosSubsection(doc, {
      startY: y,
      item: it,
      photoDataMap,
      renderPageHeader,
    })
  }

  // Sous-section pack (global uniquement)
  if (packPhotos.length > 0) {
    y = renderSubsectionHeader(doc, {
      startY: y,
      title: `Pack (${packPhotos.length} photo${packPhotos.length > 1 ? 's' : ''})`,
      accent: C.blue,
      renderPageHeader,
    })
    y = renderPhotoGrid(doc, {
      startY: y,
      photos: packPhotos,
      photoDataMap,
      renderPageHeader,
    })
  }

  return y + 1
}

function renderItemPhotosSubsection(doc, { startY, item, photoDataMap, renderPageHeader }) {
  const photos = item.photos || []
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

  // Saut de page si même le header + une thumbnail ne tiennent pas.
  if (y + 6 + PHOTO_THUMB_MM + PHOTO_CAPTION_H > PH - 16) {
    doc.addPage()
    renderPageHeader()
    y = 34
  }

  // Petit point coloré + titre
  doc.setFillColor(...accent)
  doc.circle(M + 1.2, y + 2.1, 0.9, 'F')
  doc.setFont('WS', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C.black)
  doc.text(title, M + 3.2, y + 2.8)
  return y + 5.5
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
//
// Option `photoDataMap` : si fournie, évite de re-fetcher les photos
// (mutualisation via buildBilanZip). Sinon, prefetch interne automatique.
export async function buildBilanGlobalPDF(snapshot, { org, photoDataMap = null } = {}) {
  if (!snapshot || !snapshot.version) {
    throw new Error('buildBilanGlobalPDF : snapshot invalide')
  }
  const assets = await loadAssets(org)
  const doc = makeDoc(assets)
  const M = 14

  // MAT-11E : prefetch photos si pas déjà fourni par l'appelant.
  const photos = photoDataMap || (await prefetchPhotoDataUrls(snapshot))

  const renderPageHeader = () =>
    drawHeader(doc, {
      title: 'BILAN ESSAIS',
      subtitle: 'Vue d\'ensemble',
      project: snapshot.project,
      version: snapshot.version,
      bannerImage: assets.bannerImage,
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
  // MAT-21 : synthèse narrative juste avant les cartes chiffrées.
  y = drawSynthesisLine(doc, { y, stats: snapshot.global.stats })
  y = drawStatsCards(doc, { y, stats: snapshot.global.stats })
  y += 2

  const blocks = sectionBlocks(snapshot.global)
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
        pack_photos: entry.pack_photos || [],
        photoDataMap: photos,
        includePack: true, // pack photos visibles dans PDF global uniquement
        renderPageHeader,
      })
    }
  }

  drawFooter(doc, { org })
  return finishDoc(
    doc,
    bilanPdfFilename({ project: snapshot.project, version: snapshot.version }),
  )
}

// ═══ PDF PAR LOUEUR ════════════════════════════════════════════════════════
//
// Option `photoDataMap` : si fournie, évite de re-fetcher (mutualisation
// via buildBilanZip). Sinon, prefetch interne automatique scoped au snapshot.
//
// Semantique photos : seules les photos probleme (ancrées aux items du
// loueur) sont rendues. Les pack photos restent cachées côté loueur (cf.
// migration MAT-11A : usage interne remballe, non-visible).
export async function buildBilanLoueurPDF(snapshot, { loueur, section, org, photoDataMap = null } = {}) {
  if (!snapshot || !snapshot.version) {
    throw new Error('buildBilanLoueurPDF : snapshot invalide')
  }
  if (!section) {
    throw new Error('buildBilanLoueurPDF : section (loueur bucket) requis')
  }

  const assets = await loadAssets(org)
  const doc = makeDoc(assets)
  const M = 14
  const PW = doc.internal.pageSize.getWidth()

  // MAT-11E : prefetch si pas fourni. Un snapshot "sectioné" a déjà les
  // items enrichis avec `photos: []` (kind=probleme), donc prefetchPhotoDataUrls
  // peut walker n'importe quel { blocks } — on passe la section entière comme
  // un mini-snapshot pour ne fetch que le nécessaire en mode standalone.
  const photos = photoDataMap || (await prefetchPhotoDataUrls({
    global: section,
    byLoueur: [],
  }))

  const loueurNom = loueur?.nom || 'Sans loueur'
  const renderPageHeader = () =>
    drawHeader(doc, {
      title: 'BILAN ESSAIS',
      subtitle: `Loueur : ${loueurNom}`,
      project: snapshot.project,
      version: snapshot.version,
      bannerImage: assets.bannerImage,
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

  // MAT-21 : synthèse narrative avant les cartes chiffrées.
  y = drawSynthesisLine(doc, { y, stats: section.stats })
  y = drawStatsCards(doc, { y, stats: section.stats })
  y += 2

  const blocks = sectionBlocks(section)
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
        pack_photos: entry.pack_photos || [],
        photoDataMap: photos,
        includePack: false, // photos pack masquées côté loueur (MAT-11A)
        renderPageHeader,
      })
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

  // MAT-11E : prefetch photos UNE SEULE FOIS et partage la dataURL map entre
  // tous les PDFs du ZIP. Évite N+1 round-trips Supabase Storage (une version
  // peut avoir ~50 photos × ~10 loueurs = 500 fetches sinon).
  const photoDataMap = await prefetchPhotoDataUrls(snapshot)

  // 1. Global
  const globalPdf = await buildBilanGlobalPDF(snapshot, { org, photoDataMap })
  zip.file(globalPdf.filename, await globalPdf.blob.arrayBuffer())

  // 2. Par loueur — 1 PDF / bucket (y compris "Sans loueur" s'il existe)
  const loueurPdfs = []
  for (const section of snapshot.byLoueur) {
    const pdf = await buildBilanLoueurPDF(snapshot, {
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
