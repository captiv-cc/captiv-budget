// ════════════════════════════════════════════════════════════════════════════
// planPdfExport — export PDF d'un plan avec en-tête, légende et cartouche pro
// ════════════════════════════════════════════════════════════════════════════
//
// Partagé entre l'éditeur desk, le viewer de versions et la page publique.
// Paysage A3/A4 :
//   - bandeau titre (nom du plan · catégorie · date) ;
//   - image du canvas, légende en colonne droite ;
//   - CARTOUCHE en bande basse (si opts.cartouche — axe #9) : logos, projet /
//     réf / client / lieu / dates / version, personnes, échelle graphique
//     (barre dessinée : survit à une impression « ajuster à la page »),
//     contact, mention. Sans cartouche : layout historique (A4).
// jspdf en lazy import. Retourne un handle { blob, url, filename,
// download(), revoke() } — l'appelant choisit preview ou téléchargement.
// ════════════════════════════════════════════════════════════════════════════

import { buildLegend } from '../features/plans/canvas/shapes/legend'

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) || 136,
    parseInt(h.slice(2, 4), 16) || 136,
    parseInt(h.slice(4, 6), 16) || 136,
  ]
}

/**
 * @param {Editor} editor — instance tldraw
 * @param {object} opts
 *   { titre, sousTitre?, footer?,
 *     cartouche?  — config jsonb (cf. plansCanvasCartouche) → bande basse,
 *     logoImages? — dataURLs des logos, pré-résolus par l'appelant,
 *     version?    — numéro de version affiché dans le cartouche,
 *     metersPerPx? — échelle du plan (m / px canvas) pour la barre graphique }
 * @returns handle { blob, url, filename, download(), revoke() } | null si vide
 */
export async function exportPlanPdf(editor, opts) {
  const {
    titre,
    sousTitre = '',
    footer = '',
    cartouche = null,
    logoImages = [],
    version = null,
    metersPerPx = 0,
  } = opts

  const ids = [...editor.getCurrentPageShapeIds()]
  if (!ids.length) return null
  // Résolution plafonnée : au-delà de ~4096 px, aucun gain visible — et le
  // rendu + l'encodage PNG d'un canvas géant coûtent plusieurs secondes.
  const bounds = editor.getCurrentPageBounds()
  const exportScale = Math.min(2, 4096 / Math.max(bounds?.width || 2048, bounds?.height || 2048))
  const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: exportScale, padding: 24 })
  const dataUrl = await blobToDataURL(blob)
  const img = await loadImg(dataUrl)
  const legend = buildLegend(editor.store.allRecords())

  const { jsPDF } = await import('jspdf')
  const format = cartouche ? (cartouche.format === 'a4' ? 'a4' : 'a3') : 'a4'
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format })
  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()
  const margin = 8
  // Avec cartouche : pas de bandeau noir (le titre vit dans le bloc projet),
  // tout l'espace pour le plan.
  const headerH = cartouche ? 0 : 14
  const cartH = cartouche ? 34 : 0
  const legendW = legend.length ? (format === 'a3' ? 58 : 52) : 0

  // ── En-tête (layout historique uniquement) ─────────────────────────────
  if (!cartouche) {
    pdf.setFillColor(16, 18, 22)
    pdf.rect(0, 0, pw, headerH, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.text(titre || 'Plan technique', margin, 9)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    const right = [sousTitre, dateStr].filter(Boolean).join('  ·  ')
    pdf.text(right, pw - margin, 9, { align: 'right' })
  }

  // ── Image du plan ──────────────────────────────────────────────────────
  const zoneW = pw - margin * 2 - legendW
  const zoneH = ph - headerH - cartH - margin * 2
  const ratio = Math.min(zoneW / img.width, zoneH / img.height)
  const w = img.width * ratio
  const h = img.height * ratio
  pdf.addImage(dataUrl, 'PNG', margin + (zoneW - w) / 2, headerH + margin + (zoneH - h) / 2, w, h)

  // ── Légende (colonne droite, au-dessus du cartouche) ───────────────────
  if (legend.length) {
    const lx = pw - margin - legendW + 4
    let ly = headerH + margin + 4
    pdf.setTextColor(90, 90, 95)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.5)
    pdf.text('LÉGENDE', lx, ly)
    ly += 5
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    for (const entry of legend) {
      if (ly > ph - cartH - margin - 6) break
      const [r, g, b] = hexToRgb(entry.color)
      pdf.setFillColor(r, g, b)
      if (entry.kind === 'cam') {
        pdf.circle(lx + 1.5, ly - 1.2, 1.5, 'F')
      } else if (entry.kind === 'cable') {
        pdf.setDrawColor(r, g, b)
        pdf.setLineWidth(0.9)
        pdf.line(lx, ly - 1.2, lx + 3.4, ly - 1.2)
      } else {
        pdf.rect(lx, ly - 2.6, 3, 3, 'F')
      }
      pdf.setTextColor(40, 40, 45)
      pdf.text(entry.label.slice(0, 34), lx + 5, ly)
      ly += 5.4
    }
  }

  // ── Cartouche (bande basse) ────────────────────────────────────────────
  if (cartouche) {
    // Échelle papier : m réels par mm de papier (pour la barre graphique).
    // canvas px / mm papier = (px image / exportScale) / largeur dessinée mm.
    const canvasPxPerPaperMm = img.width / exportScale / w
    const metersPerPaperMm = metersPerPx > 0 ? metersPerPx * canvasPxPerPaperMm : 0
    await drawCartouche(pdf, {
      cartouche,
      titre,
      sousTitre,
      logoImages,
      version,
      metersPerPaperMm,
      x: margin,
      y: ph - margin - cartH,
      w: pw - margin * 2,
      h: cartH,
    })
  }

  // ── Pied de page ───────────────────────────────────────────────────────
  if (cartouche?.mention) {
    pdf.setTextColor(120, 120, 125)
    pdf.setFontSize(6.5)
    pdf.text(cartouche.mention, margin, ph - 3)
  }
  if (footer) {
    pdf.setTextColor(150, 150, 155)
    pdf.setFontSize(6.5)
    pdf.text(footer, pw - margin, ph - 3, { align: 'right' })
  }

  const nom = (titre || 'plan').replace(/[^a-zA-Z0-9À-ÿ ._-]/g, '').trim()
  return makeExportHandle(pdf.output('blob'), `${nom}.pdf`)
}

/* ─── Cartouche : logos | projet | personnes | échelle + contact ─────────── */

async function drawCartouche(pdf, { cartouche, titre, sousTitre, logoImages, version, metersPerPaperMm, x, y, w, h }) {
  const GRAY = [90, 90, 95]
  const DARK = [30, 30, 34]
  const pad = 3

  // Cadre + fond blanc.
  pdf.setFillColor(255, 255, 255)
  pdf.setDrawColor(120, 120, 125)
  pdf.setLineWidth(0.35)
  pdf.rect(x, y, w, h, 'FD')

  // ── Largeurs de cases ──
  const logos = (logoImages || []).slice(0, 3)
  const logosW = logos.length ? logos.length * 30 + pad * 2 : 0
  // A4 : une seule colonne de personnes (le bloc projet doit respirer).
  const maxPers = pdf.internal.pageSize.getWidth() > 400 ? 8 : 4
  const personnes = (cartouche.personnes || []).filter((p) => p.role || p.nom).slice(0, maxPers)
  const persW = personnes.length ? (personnes.length > 4 ? 104 : 56) : 0
  const scaleW = 58
  const projetW = w - logosW - persW - scaleW

  let cx = x

  // ── Case logos ──
  if (logos.length) {
    const imgs = await Promise.all(logos.map((src) => loadImg(src).catch(() => null)))
    let lx = cx + pad
    imgs.filter(Boolean).forEach((img) => {
      const maxW = 28
      const maxH = h - pad * 2
      const r = Math.min(maxW / img.width, maxH / img.height)
      const iw = img.width * r
      const ih = img.height * r
      pdf.addImage(img.src, lx + (maxW - iw) / 2, y + (h - ih) / 2, iw, ih)
      lx += 30
    })
    cx += logosW
    vSep(pdf, cx, y, h)
  }

  // ── Case projet ──
  {
    const lx = cx + pad
    let ly = y + 5.5
    // Titre du plan (le bandeau noir disparaît quand le cartouche est là) +
    // catégorie en gris.
    pdf.setTextColor(...DARK)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    const titreTxt = (titre || cartouche.projet || 'Plan technique').slice(0, 44)
    pdf.text(titreTxt, lx, ly)
    // Largeur mesurée AVANT de réduire la police (sinon la catégorie
    // s'imprime dans le titre).
    const titreW = pdf.getTextWidth(titreTxt)
    if (sousTitre) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.5)
      pdf.setTextColor(...GRAY)
      pdf.text(`· ${sousTitre.slice(0, 24)}`, lx + titreW + 2.5, ly)
    }
    ly += 5
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    const versionLine = version
      ? `V${version} du ${new Date().toLocaleDateString('fr-FR')}`
      : new Date().toLocaleDateString('fr-FR')
    // Rangées fixes + infos libres (Production, Prod. exé…), réparties sur
    // 2 colonnes dans la case.
    const rows = [
      cartouche.projet && ['Projet', cartouche.projet],
      cartouche.ref && ['Réf.', cartouche.ref],
      cartouche.client && ['Client', cartouche.client],
      cartouche.lieu && ['Lieu', cartouche.lieu],
      cartouche.dateEvenement && ['Événement', cartouche.dateEvenement],
      ['Version', versionLine],
      ...(cartouche.infos || [])
        .filter((i) => i.label || i.valeur)
        .map((i) => [i.label || '—', i.valeur || '']),
    ].filter(Boolean)
    const rowsPerCol = 5
    const colW = (projetW - pad * 2) / Math.min(2, Math.ceil(rows.length / rowsPerCol))
    rows.slice(0, rowsPerCol * 2).forEach(([label, value], i) => {
      const col = Math.floor(i / rowsPerCol)
      const rx = lx + col * colW
      const ry = ly + (i % rowsPerCol) * 4.4
      if (ry > y + h - 2) return
      const labelTxt = `${String(label).slice(0, 22)} :`
      pdf.setTextColor(...GRAY)
      pdf.text(labelTxt, rx, ry)
      pdf.setTextColor(...DARK)
      // Valeur APRÈS le libellé mesuré (16 mm mini pour l'alignement des
      // rangées courantes, poussée au-delà pour les libellés longs).
      const vx = rx + Math.max(16, pdf.getTextWidth(labelTxt) + 2)
      pdf.text(String(value).slice(0, 42), vx, ry)
    })
    cx += projetW
    vSep(pdf, cx, y, h)
  }

  // ── Case personnes (2 colonnes au-delà de 4) ──
  if (personnes.length) {
    const colW = 48
    let ly = y + 5.5
    let lx = cx + pad
    pdf.setFontSize(7)
    personnes.forEach((p, i) => {
      if (i === 4) {
        lx += colW + pad
        ly = y + 5.5
      }
      pdf.setTextColor(...GRAY)
      pdf.text((p.role || '—').slice(0, 32), lx, ly)
      pdf.setTextColor(...DARK)
      pdf.setFont('helvetica', 'bold')
      pdf.text((p.nom || '').slice(0, 32), lx, ly + 3.2)
      pdf.setFont('helvetica', 'normal')
      ly += 7.6
    })
    cx += persW
    vSep(pdf, cx, y, h)
  }

  // ── Case échelle + contact ──
  {
    const lx = cx + pad
    let ly = y + 5.5
    pdf.setFontSize(7)
    if (metersPerPaperMm > 0) {
      // Barre graphique : longueur ronde (m) tenant dans ~48 mm papier.
      const candidates = [0.5, 1, 2, 5, 10, 20, 50, 100, 200]
      let best = candidates[0]
      for (const c of candidates) {
        if (c / metersPerPaperMm <= 48) best = c
      }
      const barMm = best / metersPerPaperMm
      const seg = barMm / 4
      pdf.setDrawColor(...DARK)
      pdf.setLineWidth(0.25)
      for (let i = 0; i < 4; i += 1) {
        if (i % 2 === 0) pdf.setFillColor(30, 30, 34)
        else pdf.setFillColor(255, 255, 255)
        pdf.rect(lx + i * seg, ly, seg, 2, 'FD')
      }
      pdf.setTextColor(...GRAY)
      pdf.setFontSize(6)
      pdf.text('0', lx, ly + 5.4)
      pdf.text(fmtScaleMeters(best / 2), lx + barMm / 2, ly + 5.4, { align: 'center' })
      pdf.text(`${fmtScaleMeters(best)} m`, lx + barMm, ly + 5.4, { align: 'center' })
      pdf.setFontSize(7)
      pdf.setTextColor(...DARK)
      // « ~ » et pas « ≈ » : hors encodage Helvetica de jspdf (glyphes cassés).
      pdf.text(`Échelle ~1:${Math.round(metersPerPaperMm * 1000)}`, lx, ly + 10.4)
      ly += 14.4
    } else {
      pdf.setTextColor(...GRAY)
      pdf.text('Échelle non définie', lx, ly)
      ly += 4.4
    }
    if (cartouche.contact) {
      pdf.setTextColor(...GRAY)
      pdf.text('Contact :', lx, ly)
      pdf.setTextColor(...DARK)
      const lines = pdf.splitTextToSize(cartouche.contact, 44)
      pdf.text(lines.slice(0, 2), lx, ly + 3.6)
    }
  }
}

function vSep(pdf, x, y, h) {
  pdf.setDrawColor(190, 190, 195)
  pdf.setLineWidth(0.2)
  pdf.line(x, y + 1.5, x, y + h - 1.5)
}

function fmtScaleMeters(m) {
  return Number.isInteger(m) ? String(m) : String(m).replace('.', ',')
}

/** Handle d'export { blob, url, filename, download(), revoke() }. */
export function makeExportHandle(blob, filename) {
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
