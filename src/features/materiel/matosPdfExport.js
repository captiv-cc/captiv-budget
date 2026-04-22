// ════════════════════════════════════════════════════════════════════════════
// Export PDF — Outil Matériel
// ════════════════════════════════════════════════════════════════════════════
//
// Trois exports spécialisés :
//
//   1. exportMatosGlobalPDF      — la liste complète organisée par bloc.
//                                  Colonnes : Flag / Désignation / Qté / Loueur(s)
//   2. exportMatosChecklistPDF   — la liste complète en mode "tournage" :
//                                  Flag / Désignation / Qté / Pré / Post / Prod
//                                  / Loueur(s) / Remarques (cases ■/□ reflétant
//                                  l'état BDD).
//   3. exportMatosLoueursPDF     — un PDF combiné avec une section par loueur
//                                  (saut de page entre chaque). Colonnes :
//                                  Désignation / Qté.
//   4. exportMatosLoueursZip     — 1 PDF par loueur, dans un ZIP. Charge
//                                  `jszip` en dynamic import — si pas installé,
//                                  lève une erreur explicite.
//   5. exportMatosLoueurSinglePDF — 1 PDF pour UN loueur (utilisé par le bouton
//                                  PDF de LoueurRecapPanel).
//
// Style : repris de `src/lib/pdfExport.js` (Work Sans + logo captiv + palette
// noire/grise). On colocate ce helper dans `features/materiel/` plutôt que
// dans `lib/` parce qu'il est spécifique au domaine matériel.
//
// API — TOUTES les fonctions renvoient un objet de la forme :
//   { blob, url, filename, download(), revoke(), isZip? }
// et ne déclenchent PAS le download automatiquement. L'appelant peut :
//   - afficher `.url` dans un `<iframe>` pour prévisualiser
//   - appeler `.download()` pour déclencher le save
//   - appeler `.revoke()` quand on a fini (libère l'URL Blob)
// ════════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  black: [0, 0, 0],
  header: [67, 67, 67], // #434343
  white: [255, 255, 255],
  light: [243, 243, 243], // #f3f3f3
  gray: [120, 120, 120],
  lgray: [210, 210, 210],
  green: [34, 139, 58],
  amber: [201, 132, 17],
  red: [201, 51, 51],
}

// Couleurs par flag (alignées avec MATOS_FLAGS dans lib/materiel.js)
const FLAG_COLOR = {
  ok: C.green,
  attention: C.amber,
  probleme: C.red,
}

// Symbole par flag (rendu texte, supporté par Work Sans)
const FLAG_SYMBOL = {
  ok: '●',
  attention: '●',
  probleme: '●',
}

// ─── Loaders ────────────────────────────────────────────────────────────────
async function loadFontBase64(url) {
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192)
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
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

// Emballe un jsPDF doc en objet prévisualisable / téléchargeable.
// Ne déclenche PAS le download automatiquement — laisse l'appelant choisir
// entre preview (utilise `.url`) et download direct (`.download()`).
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

// Charge fonts + logo UNE SEULE fois par session (cache module-scope).
let _assetsCache = null
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

// ─── Utilitaires ────────────────────────────────────────────────────────────
const fmtDate = (d) => new Date(d).toLocaleDateString('fr-FR')

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

function versionLabel(v) {
  if (!v) return ''
  const num = `V${v.numero ?? v.version_number ?? '?'}`
  return v.label ? `${num} — ${v.label}` : num
}

function projectRef(project) {
  return project?.ref_projet || ''
}

// ─── Header / Footer (communs) ──────────────────────────────────────────────
function drawHeader(doc, { title, subtitle, project, activeVersion, banner }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14

  // Logo à gauche (45x10mm)
  if (banner) {
    try {
      doc.addImage(banner, 'PNG', M, 10, 45, 10)
    } catch {
      // pas grave, on affiche le titre sans logo
    }
  }

  // Titre à droite
  doc.setFont('WS', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...C.black)
  doc.text(title, PW - M, 13, { align: 'right' })

  doc.setFont('WS', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.gray)
  if (subtitle) doc.text(subtitle, PW - M, 18, { align: 'right' })

  // Ligne 2 : ref + projet (à gauche sous le logo) + version + date (à droite)
  doc.setFontSize(7)
  doc.setTextColor(...C.gray)
  const left = [projectRef(project), project?.title].filter(Boolean).join(' · ')
  doc.text(left, M, 25)

  const right = [versionLabel(activeVersion), fmtDate(new Date())]
    .filter(Boolean)
    .join(' · ')
  doc.text(right, PW - M, 25, { align: 'right' })

  // Ligne de séparation
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

// ─── Construction des lignes ────────────────────────────────────────────────
// ⚠️ Le hook useMateriel expose `itemsByBlock`, `loueursByItem` et
// `loueursById` comme des Map (pas des objets). `mget()` gère les deux cas
// pour être tolérant si le shape change.
function mget(mapOrObj, key) {
  if (!mapOrObj) return undefined
  if (typeof mapOrObj.get === 'function') return mapOrObj.get(key)
  return mapOrObj[key]
}

function loueursForItem(item, loueursByItem, loueursById) {
  const arr = mget(loueursByItem, item.id) || []
  return arr
    .map((pivot) => {
      const l = mget(loueursById, pivot.loueur_id)
      const nom = l?.nom || '?'
      const ref = pivot.numero_reference ? ` (${pivot.numero_reference})` : ''
      return `${nom}${ref}`
    })
    .join(', ')
}

function flagCell(flag) {
  const f = flag || 'ok'
  return {
    content: FLAG_SYMBOL[f] || '●',
    styles: {
      textColor: FLAG_COLOR[f] || C.gray,
      halign: 'center',
      fontStyle: 'bold',
    },
  }
}

// Case à cocher texte : ■ si ok, □ sinon
function checkCell(done) {
  return {
    content: done ? '■' : '□',
    styles: {
      halign: 'center',
      textColor: done ? C.black : C.gray,
    },
  }
}

// ─── Helpers label/libre & remarques (MAT-7 layout polish) ─────────────────
//
// Construit la cellule "Désignation" enrichie de metadata pour un rendu
// custom via `didDrawCell` :
//   - `_label` (UPPERCASE) si le bloc est `affichage === 'config'` avec label
//   - `_libre` = true si l'item a une designation libre (pas dans la BDD)
//   - `_designation` (texte brut) pour le rendu du segment principal
//   - `_remarques` (texte brut) si `includeRemarques` et remarques non vide
//     → rendu en italique gris, sous la ligne principale, dans la même cellule
// Le `content` passé à autoTable contient les lignes séparées par `\n` pour
// que la hauteur de cellule soit calculée correctement (on redessine par
// dessus dans `didDrawCell`).
function buildDesignationCell(block, it, { includeRemarques = false } = {}) {
  const designation = it.designation || '—'
  // MAT-17 : affichage du label pour toutes les listes (config ET classique).
  const hasLabel = Boolean(it.label)
  const label = hasLabel ? String(it.label).toUpperCase() : null
  // Le tag "libre" n'a de sens que pour les listes classiques. En mode config
  // caméras, toutes les désignations sont forcément libres (on écrit "Sony
  // FX6" sans attendre le catalogue) — afficher la pastille polluerait chaque
  // ligne sans apporter d'info.
  const isLibre =
    designation !== '—' && !it.materiel_bdd_id && block.affichage !== 'config'
  const remarques = includeRemarques ? (it.remarques || '').trim() : ''
  const parts = []
  if (label) parts.push(label)
  parts.push(designation)
  if (isLibre) parts.push('(libre)')
  const line1 = parts.join(' · ')
  const content = remarques ? `${line1}\n${remarques}` : line1
  return {
    content,
    _label: label,
    _designation: designation,
    _libre: isLibre,
    _remarques: remarques || null,
  }
}

// Récupère la valeur de padding pour un côté donné depuis les styles autoTable.
function padOf(styles, side, fallback = 2) {
  const cp = styles?.cellPadding
  if (cp == null) return fallback
  if (typeof cp === 'number') return cp
  return cp[side] ?? fallback
}

// Re-dessine la cellule Désignation avec :
//   - ligne 1 : LABEL (bold) + séparateur · + désignation + pastille `libre`
//   - ligne 2+ : remarques (italique, gris clair) sous-jacente dans la MÊME
//                cellule, wrap naturel
// Le tout vertically-centré dans la cellule. Doit être appelé dans
// `didDrawCell` d'autoTable.
function redrawDesignationCell(doc, data) {
  if (data.section !== 'body') return
  const raw = data.cell.raw
  if (!raw || typeof raw !== 'object') return
  if (!raw._label && !raw._libre && !raw._remarques) return

  const cell = data.cell
  const fontSize = cell.styles.fontSize || 8

  // Couvrir le texte original avec la couleur de fond de la cellule.
  const fill = cell.styles.fillColor
  if (Array.isArray(fill)) doc.setFillColor(fill[0], fill[1], fill[2])
  else doc.setFillColor(255, 255, 255)
  doc.rect(cell.x + 0.15, cell.y + 0.15, cell.width - 0.3, cell.height - 0.3, 'F')

  const padLeft = padOf(cell.styles, 'left', 2.5)
  const padRight = padOf(cell.styles, 'right', 2.5)
  const padTop = padOf(cell.styles, 'top', 2)
  const padBottom = padOf(cell.styles, 'bottom', 2)
  const innerW = cell.width - padLeft - padRight
  const innerH = cell.height - padTop - padBottom

  // Conversion pt → mm et hauteur de ligne autoTable-like.
  const fsMm = (fontSize / 72) * 25.4
  const lineH = fsMm * 1.15
  const remFontSize = Math.max(6, fontSize - 0.5)
  const remFsMm = (remFontSize / 72) * 25.4
  const remLineH = remFsMm * 1.18

  // Pré-calcul des lignes de remarques (pour la hauteur totale du contenu).
  let remLines = []
  if (raw._remarques) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(remFontSize)
    remLines = doc.splitTextToSize(raw._remarques, innerW)
  }
  const totalContentH = lineH + remLines.length * remLineH

  // Centrage vertical : top de la ligne principale.
  const startTop = cell.y + padTop + Math.max(0, (innerH - totalContentH) / 2)

  // ── Ligne principale ───────────────────────────────────────────────────
  let cx = cell.x + padLeft
  const rightLimit = cell.x + cell.width - padRight
  const mainTop = startTop

  if (raw._label) {
    doc.setFont('WS', 'bold')
    doc.setFontSize(fontSize)
    doc.setTextColor(35, 35, 35)
    doc.text(raw._label, cx, mainTop, { baseline: 'top' })
    cx += doc.getTextWidth(raw._label)

    doc.setFont('WS', 'normal')
    doc.setTextColor(150, 150, 150)
    const sep = '  ·  '
    doc.text(sep, cx, mainTop, { baseline: 'top' })
    cx += doc.getTextWidth(sep)
  }

  // Désignation principale
  doc.setFont('WS', 'normal')
  doc.setFontSize(fontSize)
  doc.setTextColor(0, 0, 0)
  let desig = raw._designation || ''
  const reservedForPill = raw._libre ? 9 : 0
  const availW = rightLimit - cx - reservedForPill
  if (doc.getTextWidth(desig) > availW && availW > 4) {
    while (desig.length > 1 && doc.getTextWidth(desig + '…') > availW) {
      desig = desig.slice(0, -1)
    }
    desig += '…'
  }
  doc.text(desig, cx, mainTop, { baseline: 'top' })
  cx += doc.getTextWidth(desig)

  // Pastille "libre" alignée sur la ligne principale.
  if (raw._libre) {
    cx += 1.5
    doc.setFontSize(6.5)
    doc.setFont('WS', 'bold')
    const pillText = 'libre'
    const tw = doc.getTextWidth(pillText)
    const pw = tw + 2
    const ph = 2.8
    const py = mainTop + Math.max(0, (fsMm - ph) / 2) + 0.3
    if (cx + pw <= rightLimit) {
      doc.setFillColor(225, 225, 225)
      doc.roundedRect(cx, py, pw, ph, 0.6, 0.6, 'F')
      doc.setTextColor(95, 95, 95)
      doc.text(pillText, cx + 1, py + ph / 2 + 0.1, { baseline: 'middle' })
    }
  }

  // ── Remarques (italique gris clair, sous la ligne principale) ─────────
  if (remLines.length > 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(remFontSize)
    doc.setTextColor(135, 135, 135)
    let rTop = startTop + lineH
    for (const rl of remLines) {
      doc.text(rl, cell.x + padLeft, rTop, { baseline: 'top' })
      rTop += remLineH
    }
  }
}

// Dessine sous le titre d'un bloc une ligne meta : "N item(s) · ● X / ● Y / ● Z"
// (compteur d'items + répartition par flag). Le baselineY est la Y du texte.
function drawBlockMetaLine(doc, { x, y, items, colSpacing = 3 }) {
  const ok = items.filter((it) => (it.flag || 'ok') === 'ok').length
  const att = items.filter((it) => it.flag === 'attention').length
  const pb = items.filter((it) => it.flag === 'probleme').length
  const count = items.length
  let cx = x

  doc.setFont('WS', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.gray)
  const countText = `${count} item${count > 1 ? 's' : ''}`
  doc.text(countText, cx, y)
  cx += doc.getTextWidth(countText) + colSpacing

  const segs = [
    { n: ok, color: C.green },
    { n: att, color: C.amber },
    { n: pb, color: C.red },
  ]
  for (const s of segs) {
    if (s.n === 0) continue
    doc.setTextColor(...C.gray)
    doc.text('· ', cx, y)
    cx += doc.getTextWidth('· ')
    doc.setFont('WS', 'bold')
    doc.setTextColor(...s.color)
    doc.text('●', cx, y)
    cx += doc.getTextWidth('●') + 0.8
    doc.setFont('WS', 'normal')
    doc.setTextColor(...C.gray)
    const t = String(s.n)
    doc.text(t, cx, y)
    cx += doc.getTextWidth(t) + colSpacing
  }
}

// ─── Export 1 : Liste globale ───────────────────────────────────────────────
export async function exportMatosGlobalPDF({
  project,
  activeVersion,
  blocks = [],
  itemsByBlock = {},
  loueursByItem = {},
  loueursById,
  org,
}) {
  const assets = await loadAssets()
  const doc = makeDoc(assets)
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  const IW = PW - M * 2

  const renderPageHeader = () =>
    drawHeader(doc, {
      title: 'MATÉRIEL',
      subtitle: 'Liste globale',
      project,
      activeVersion,
      banner: assets.banner,
    })

  renderPageHeader()
  let y = 34

  if (!blocks.length) {
    doc.setFont('WS', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...C.gray)
    doc.text('Aucun bloc dans cette version.', M, y)
  }

  for (const block of blocks) {
    const items = mget(itemsByBlock, block.id) || []

    // Titre de bloc
    if (y > 260) {
      doc.addPage()
      renderPageHeader()
      y = 34
    }
    doc.setFont('WS', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...C.black)
    doc.text(block.titre || 'Bloc', M, y + 4)
    // Ligne meta (compteur + flags)
    drawBlockMetaLine(doc, { x: M, y: y + 8.5, items })
    let afterMetaY = y + 10
    if (block.description) {
      doc.setFont('WS', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.gray)
      const lines = doc.splitTextToSize(block.description, IW)
      doc.text(lines, M, afterMetaY + 3)
      afterMetaY += 3 + lines.length * 3.2
    }
    y = afterMetaY

    // Body : 1 row par item, remarques intégrées à la cellule Désignation
    // (rendu italique gris dans `redrawDesignationCell`).
    const body = items.map((it) => {
      const loueurs = loueursForItem(it, loueursByItem, loueursById)
      return [
        flagCell(it.flag),
        buildDesignationCell(block, it, { includeRemarques: true }),
        { content: String(it.quantite ?? 1), styles: { halign: 'center' } },
        loueurs || '—',
      ]
    })

    autoTable(doc, {
      startY: y + 1,
      head: [['', 'Désignation', 'Qté', 'Loueur(s)']],
      body: body.length
        ? body
        : [
            [
              { content: '—', colSpan: 4, styles: { halign: 'center', textColor: C.gray } },
            ],
          ],
      theme: 'grid',
      styles: {
        font: 'WS',
        fontSize: 8,
        cellPadding: { top: 2, right: 2.5, bottom: 2, left: 2.5 },
        lineColor: C.lgray,
        lineWidth: 0.15,
        textColor: C.black,
      },
      headStyles: {
        fillColor: C.header,
        textColor: C.white,
        fontStyle: 'bold',
        fontSize: 7.5,
        halign: 'left',
      },
      columnStyles: {
        0: { cellWidth: 7, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 14, halign: 'center' },
        3: { cellWidth: 60 },
      },
      margin: { left: M, right: M, top: 32, bottom: 16 },
      didDrawPage: renderPageHeader,
      didDrawCell: (data) => {
        if (data.column.index === 1) redrawDesignationCell(doc, data)
      },
    })

    y = doc.lastAutoTable.finalY + 6
  }

  drawFooter(doc, { org })
  return finishDoc(doc, buildFilename(project, activeVersion, 'materiel-global'))
}

// ─── Export 2 : Checklist tournage ──────────────────────────────────────────
export async function exportMatosChecklistPDF({
  project,
  activeVersion,
  blocks = [],
  itemsByBlock = {},
  loueursByItem = {},
  loueursById,
  org,
}) {
  const assets = await loadAssets()
  // Paysage pour accommoder les 8 colonnes
  const doc = makeDoc(assets, { orientation: 'landscape' })
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  const IW = PW - M * 2

  const renderPageHeader = () =>
    drawHeader(doc, {
      title: 'CHECKLIST',
      subtitle: 'Pré / Post / Prod',
      project,
      activeVersion,
      banner: assets.banner,
    })

  renderPageHeader()
  let y = 34

  if (!blocks.length) {
    doc.setFont('WS', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...C.gray)
    doc.text('Aucun bloc dans cette version.', M, y)
  }

  for (const block of blocks) {
    const items = mget(itemsByBlock, block.id) || []

    if (y > 180) {
      doc.addPage()
      renderPageHeader()
      y = 34
    }
    doc.setFont('WS', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...C.black)
    doc.text(block.titre || 'Bloc', M, y + 4)
    // Ligne meta (compteur + flags)
    drawBlockMetaLine(doc, { x: M, y: y + 8.5, items })
    let afterMetaY = y + 10
    if (block.description) {
      doc.setFont('WS', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.gray)
      const lines = doc.splitTextToSize(block.description, IW)
      doc.text(lines, M, afterMetaY + 3)
      afterMetaY += 3 + lines.length * 3.2
    }
    y = afterMetaY

    const body = items.map((it) => {
      const loueurs = loueursForItem(it, loueursByItem, loueursById)
      return [
        flagCell(it.flag),
        buildDesignationCell(block, it),
        { content: String(it.quantite ?? 1), styles: { halign: 'center' } },
        checkCell(Boolean(it.pre_check_at)),
        checkCell(Boolean(it.post_check_at)),
        checkCell(Boolean(it.prod_check_at)),
        loueurs || '—',
        it.remarques || '',
      ]
    })

    autoTable(doc, {
      startY: y + 1,
      head: [['', 'Désignation', 'Qté', 'Pré', 'Post', 'Prod', 'Loueur(s)', 'Remarques']],
      body: body.length
        ? body
        : [
            [
              {
                content: '—',
                colSpan: 8,
                styles: { halign: 'center', textColor: C.gray },
              },
            ],
          ],
      theme: 'grid',
      styles: {
        font: 'WS',
        fontSize: 8,
        cellPadding: { top: 2, right: 2.5, bottom: 2, left: 2.5 },
        lineColor: C.lgray,
        lineWidth: 0.15,
        textColor: C.black,
      },
      headStyles: {
        fillColor: C.header,
        textColor: C.white,
        fontStyle: 'bold',
        fontSize: 7.5,
        halign: 'left',
      },
      columnStyles: {
        0: { cellWidth: 7, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 12, halign: 'center' },
        3: { cellWidth: 14 },
        4: { cellWidth: 14 },
        5: { cellWidth: 14 },
        6: { cellWidth: 55 },
        7: { cellWidth: 60 },
      },
      margin: { left: M, right: M, top: 32, bottom: 16 },
      didDrawPage: renderPageHeader,
      didDrawCell: (data) => {
        if (data.column.index === 1) redrawDesignationCell(doc, data)
      },
    })

    y = doc.lastAutoTable.finalY + 6
  }

  drawFooter(doc, { org })
  return finishDoc(doc, buildFilename(project, activeVersion, 'checklist'))
}

// ─── Export 3 : Par loueur (PDF combiné) ────────────────────────────────────
//
// Reçoit recapByLoueur = [{ loueur, lignes: [{ designation, qte, ... }] }]
// et un `selectedLoueurIds` optionnel pour filtrer.
export async function exportMatosLoueursPDF({
  project,
  activeVersion,
  recapByLoueur = [],
  org,
  selectedLoueurIds = null, // null = tous
}) {
  const assets = await loadAssets()
  const doc = makeDoc(assets)
  const M = 14

  const entries = selectedLoueurIds
    ? recapByLoueur.filter((r) => selectedLoueurIds.includes(r.loueur.id))
    : recapByLoueur

  if (!entries.length) {
    drawHeader(doc, {
      title: 'MATÉRIEL',
      subtitle: 'Par loueur',
      project,
      activeVersion,
      banner: assets.banner,
    })
    doc.setFont('WS', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...C.gray)
    doc.text('Aucun loueur affecté.', M, 34)
    drawFooter(doc, { org })
    return finishDoc(doc, buildFilename(project, activeVersion, 'materiel-par-loueur'))
  }

  entries.forEach((r, idx) => {
    if (idx > 0) doc.addPage()
    renderLoueurSection(doc, {
      project,
      activeVersion,
      loueur: r.loueur,
      lignes: r.lignes,
      banner: assets.banner,
    })
  })

  drawFooter(doc, { org })
  return finishDoc(doc, buildFilename(project, activeVersion, 'materiel-par-loueur'))
}

// ─── Export 4 : Par loueur — ZIP (1 PDF / loueur) ───────────────────────────
//
// Charge `jszip` en dynamic import. Si pas installé, lève une erreur
// explicite que l'appelant pourra afficher en toast.
export async function exportMatosLoueursZip({
  project,
  activeVersion,
  recapByLoueur = [],
  org,
  selectedLoueurIds = null,
}) {
  let JSZip
  try {
    const mod = await import('jszip')
    JSZip = mod.default || mod
  } catch {
    throw new Error(
      'La lib jszip n\'est pas installée. Lance `npm install jszip` puis recharge la page.',
    )
  }

  const assets = await loadAssets()
  const entries = selectedLoueurIds
    ? recapByLoueur.filter((r) => selectedLoueurIds.includes(r.loueur.id))
    : recapByLoueur

  if (!entries.length) {
    throw new Error('Aucun loueur à exporter.')
  }

  const zip = new JSZip()
  for (const r of entries) {
    const doc = makeDoc(assets)
    renderLoueurSection(doc, {
      project,
      activeVersion,
      loueur: r.loueur,
      lignes: r.lignes,
      banner: assets.banner,
    })
    drawFooter(doc, { org })
    const blob = doc.output('blob')
    const buf = await blob.arrayBuffer()
    const filename = buildFilename(project, activeVersion, `loueur-${slug(r.loueur.nom)}`)
    zip.file(filename, buf)
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(zipBlob)
  const filename = buildZipFilename(project, activeVersion)
  // Les ZIP ne sont pas preview-ables en iframe → l'appelant doit utiliser
  // .download() directement. On expose la même forme pour symétrie.
  return {
    blob: zipBlob,
    url,
    filename,
    isZip: true,
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

// ─── Export 5 : Un seul loueur (usage LoueurRecapPanel) ─────────────────────
export async function exportMatosLoueurSinglePDF({
  project,
  activeVersion,
  loueur,
  lignes = [],
  org,
}) {
  const assets = await loadAssets()
  const doc = makeDoc(assets)
  renderLoueurSection(doc, {
    project,
    activeVersion,
    loueur,
    lignes,
    banner: assets.banner,
  })
  drawFooter(doc, { org })
  return finishDoc(doc, buildFilename(project, activeVersion, `loueur-${slug(loueur.nom)}`))
}

// ─── Rendu d'une section loueur ─────────────────────────────────────────────
function renderLoueurSection(doc, { project, activeVersion, loueur, lignes, banner }) {
  const M = 14
  const PW = doc.internal.pageSize.getWidth()

  drawHeader(doc, {
    title: 'MATÉRIEL',
    subtitle: `Loueur : ${loueur.nom}`,
    project,
    activeVersion,
    banner,
  })

  let y = 34

  // Pastille de couleur + nom du loueur en grand
  const couleur = hexToRgb(loueur.couleur) || C.gray
  doc.setFillColor(...couleur)
  doc.circle(M + 2.5, y + 2.5, 2.5, 'F')
  doc.setFont('WS', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...C.black)
  doc.text(loueur.nom || '—', M + 7, y + 4)

  const totalUnites = lignes.reduce((s, l) => s + (l.qte || 0), 0)
  doc.setFont('WS', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.gray)
  doc.text(
    `${lignes.length} référence${lignes.length > 1 ? 's' : ''} · ${totalUnites} unité${totalUnites > 1 ? 's' : ''}`,
    PW - M,
    y + 4,
    { align: 'right' },
  )

  y += 8

  const body = lignes.length
    ? lignes.map((l) => [
        buildLoueurDesignationCell(l),
        { content: `×${l.qte || 0}`, styles: { halign: 'right', fontStyle: 'bold' } },
      ])
    : [[{ content: '—', colSpan: 2, styles: { halign: 'center', textColor: C.gray } }]]

  autoTable(doc, {
    startY: y,
    head: [['Désignation', 'Qté']],
    body,
    theme: 'grid',
    styles: {
      font: 'WS',
      fontSize: 9,
      cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 },
      lineColor: C.lgray,
      lineWidth: 0.15,
      textColor: C.black,
    },
    headStyles: {
      fillColor: C.header,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: M, right: M, top: 32, bottom: 16 },
    // MAT-17 : rendu custom pour afficher le label en préfixe bold (comme
    // dans le PDF global). Réutilise redrawDesignationCell qui sait gérer
    // les lignes sans remarques/libre (branches prises en no-op).
    didDrawCell: (data) => redrawDesignationCell(doc, data),
    didDrawPage: () => {
      // Redessiner le header si on passe en page 2+ pour ce loueur
      drawHeader(doc, {
        title: 'MATÉRIEL',
        subtitle: `Loueur : ${loueur.nom}`,
        project,
        activeVersion,
        banner,
      })
    },
  })
}

// ─── Cellule Désignation pour un PDF loueur (ligne agrégée du recap) ────────
// Ne reprend pas buildDesignationCell(block, it) car ici on n'a pas d'item
// DB mais une ligne de computeRecapByLoueur. Même shape de retour pour que
// redrawDesignationCell puisse la traiter.
function buildLoueurDesignationCell(l) {
  const designation = l.designation || '—'
  const label = l.label ? String(l.label).toUpperCase() : null
  const parts = []
  if (label) parts.push(label)
  parts.push(designation)
  return {
    content: parts.join(' · '),
    _label: label,
    _designation: designation,
    _libre: false,
    _remarques: null,
  }
}

// ─── Helpers nommage / couleur ──────────────────────────────────────────────
function slug(s) {
  return String(s || 'loueur')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function buildFilename(project, activeVersion, suffix) {
  const parts = [
    project?.ref_projet || slug(project?.title || 'projet'),
    activeVersion ? `v${activeVersion.numero ?? activeVersion.version_number ?? 1}` : null,
    suffix,
  ].filter(Boolean)
  return `${parts.join('_')}.pdf`
}

function buildZipFilename(project, activeVersion) {
  const parts = [
    project?.ref_projet || slug(project?.title || 'projet'),
    activeVersion ? `v${activeVersion.numero ?? activeVersion.version_number ?? 1}` : null,
    'materiel-par-loueur',
  ].filter(Boolean)
  return `${parts.join('_')}.zip`
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
