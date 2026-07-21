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
import { CAM_SHAPE_TYPES } from '../features/plans/canvas/shapes/camUtils'

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
  // JPEG et pas PNG : un fond de plan rasterisé en ~4096 px compresse
  // très mal en PNG (PDF à 200 Mo constaté) ; en JPEG q0.85 sur fond
  // blanc opaque, même rendu visuel pour ~2 % du poids.
  const { blob } = await editor.toImage(ids, {
    format: 'jpeg',
    quality: 0.85,
    background: true,
    scale: exportScale,
    padding: 24,
  })
  const dataUrl = await blobToDataURL(blob)
  const img = await loadImg(dataUrl)

  // Colonne droite : listing des caméras dans l'ordre (label, puis modèle ·
  // optique quand renseignés) + légende couleurs des câbles avec métrage.
  const records = editor.store.allRecords()
  const cams = records
    .filter((r) => r.typeName === 'shape' && CAM_SHAPE_TYPES.includes(r.type))
    .map((r) => r.props)
    .sort((a, b) => (a.numero || 0) - (b.numero || 0))
  const cableEntries = buildLegend(records).filter((e) => e.kind === 'cable')
  const hasColumn = cams.length > 0 || cableEntries.length > 0

  const { jsPDF } = await import('jspdf')
  const format = cartouche ? (cartouche.format === 'a4' ? 'a4' : 'a3') : 'a4'
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format })
  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()
  const margin = 8
  // Avec cartouche : pas de bandeau noir (le titre vit dans le bloc projet),
  // tout l'espace pour le plan. Hauteur ADAPTÉE au contenu (A4 étroit =
  // bloc projet sur 1 colonne = plus de rangées → bande plus haute), pour
  // ne JAMAIS perdre d'information.
  const headerH = cartouche ? 0 : 14
  let cartH = 0
  if (cartouche) {
    const persCount = Math.min(
      (cartouche.personnes || []).filter((p) => p.role || p.nom).length,
      8,
    )
    const rowsCount =
      ['projet', 'ref', 'client', 'lieu', 'dateEvenement'].filter((k) => cartouche[k]).length +
      1 + // Version
      (cartouche.infos || []).filter((i) => i.label || i.valeur).length
    const projetRowsPerCol = format === 'a4' ? rowsCount : Math.ceil(rowsCount / 2)
    const hProjet = 13 + projetRowsPerCol * 4.4
    const hPers = 8 + Math.ceil(persCount / 2) * 7.6
    cartH = Math.min(64, Math.max(34, hProjet, hPers))
  }
  const legendW = hasColumn ? (format === 'a3' ? 58 : 52) : 0

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
  pdf.addImage(dataUrl, 'JPEG', margin + (zoneW - w) / 2, headerH + margin + (zoneH - h) / 2, w, h)

  // ── Colonne droite : caméras dans l'ordre + câbles ─────────────────────
  if (hasColumn) {
    const lx = pw - margin - legendW + 4
    const maxY = ph - cartH - margin - 4
    let ly = headerH + margin + 4

    if (cams.length) {
      pdf.setTextColor(90, 90, 95)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7.5)
      pdf.text('CAMÉRAS', lx, ly)
      ly += 5
      for (const cam of cams) {
        const sub = [cam.modele, cam.optique].filter(Boolean).join(' · ')
        const rowH = sub ? 7.4 : 4.4
        if (ly + rowH > maxY) break
        const [r, g, b] = hexToRgb(cam.couleur)
        pdf.setFillColor(r, g, b)
        pdf.circle(lx + 1.5, ly - 1.2, 1.5, 'F')
        pdf.setTextColor(30, 30, 34)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(7.5)
        const nom = cam.label || `Cam ${cam.numero}${cam.support ? ` · ${cam.support}` : ''}`
        pdf.text(nom.slice(0, 32), lx + 5, ly)
        if (sub) {
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(6.5)
          pdf.setTextColor(110, 110, 115)
          pdf.text(sub.slice(0, 40), lx + 5, ly + 3.2)
        }
        ly += rowH
      }
      ly += 3
    }

    if (cableEntries.length && ly + 6 < maxY) {
      pdf.setTextColor(90, 90, 95)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7.5)
      pdf.text('CÂBLES', lx, ly)
      ly += 5
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.5)
      for (const entry of cableEntries) {
        if (ly > maxY) break
        const [r, g, b] = hexToRgb(entry.color)
        pdf.setDrawColor(r, g, b)
        pdf.setLineWidth(0.9)
        pdf.line(lx, ly - 1.2, lx + 3.4, ly - 1.2)
        pdf.setTextColor(40, 40, 45)
        pdf.text(entry.label.slice(0, 34), lx + 5, ly)
        ly += 4.6
      }
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

  // ── Largeurs de cases (compactées en A4 : la page est étroite, on garde
  //    TOUTE l'information — c'est la hauteur qui s'adapte, cf. cartH) ──
  const compact = pdf.internal.pageSize.getWidth() < 400
  const logoSlot = compact ? 24 : 30
  const logos = (logoImages || []).slice(0, 3)
  const logosW = logos.length ? logos.length * logoSlot + pad * 2 : 0
  const personnes = (cartouche.personnes || []).filter((p) => p.role || p.nom).slice(0, 8)
  const persColW = compact ? 44 : 50
  const persCols = personnes.length > 4 ? 2 : personnes.length ? 1 : 0
  const persW = persCols ? persCols * persColW + pad * 2 : 0
  const scaleW = compact ? 50 : 58
  const projetW = w - logosW - persW - scaleW

  let cx = x

  // ── Case logos ──
  if (logos.length) {
    const imgs = await Promise.all(logos.map((src) => loadImg(src).catch(() => null)))
    let lx = cx + pad
    imgs.filter(Boolean).forEach((img) => {
      const maxW = logoSlot - 2
      const maxH = Math.min(24, h - pad * 2)
      const r = Math.min(maxW / img.width, maxH / img.height)
      const iw = img.width * r
      const ih = img.height * r
      pdf.addImage(img.src, lx + (maxW - iw) / 2, y + (h - ih) / 2, iw, ih)
      lx += logoSlot
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
    const titreTxt = fitText(
      pdf,
      titre || cartouche.projet || 'Plan technique',
      projetW - pad * 2 - (sousTitre ? 16 : 0),
    )
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
    // Rangées fixes + infos libres (Production, Prod. exé…).
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
    // 2 colonnes SEULEMENT si chacune a une vraie largeur (≥ 55 mm) — sinon
    // tout en 1 colonne, la hauteur de bande (cartH) a été calculée pour.
    const rowsPerColByHeight = Math.max(1, Math.floor((h - 12.5) / 4.4))
    const canTwoCols = (projetW - pad * 2) / 2 >= 55
    const cols = rows.length > rowsPerColByHeight && canTwoCols ? 2 : 1
    const colW = (projetW - pad * 2) / cols
    rows.slice(0, rowsPerColByHeight * cols).forEach(([label, value], i) => {
      const col = Math.floor(i / rowsPerColByHeight)
      const rx = lx + col * colW
      const ry = ly + (i % rowsPerColByHeight) * 4.4
      if (ry > y + h - 2) return
      const labelTxt = `${fitText(pdf, label, 26)} :`
      pdf.setTextColor(...GRAY)
      pdf.text(labelTxt, rx, ry)
      pdf.setTextColor(...DARK)
      // Valeur après le libellé mesuré, tronquée AU MILLIMÈTRE pour ne
      // jamais déborder sur la colonne / case suivante.
      const vx = rx + Math.max(16, pdf.getTextWidth(labelTxt) + 2)
      pdf.text(fitText(pdf, value, colW - (vx - rx) - 2), vx, ry)
    })
    cx += projetW
    vSep(pdf, cx, y, h)
  }

  // ── Case personnes (2 colonnes au-delà de 4, réparties équitablement) ──
  if (personnes.length) {
    const perCol = persCols === 2 ? Math.ceil(personnes.length / 2) : personnes.length
    pdf.setFontSize(7)
    personnes.forEach((p, i) => {
      const col = Math.floor(i / perCol)
      const lx = cx + pad + col * persColW
      const ly = y + 5.5 + (i % perCol) * 7.6
      if (ly + 3.2 > y + h - 1) return
      pdf.setTextColor(...GRAY)
      pdf.text(fitText(pdf, p.role || '—', persColW - 3), lx, ly)
      pdf.setTextColor(...DARK)
      pdf.setFont('helvetica', 'bold')
      pdf.text(fitText(pdf, p.nom || '', persColW - 3), lx, ly + 3.2)
      pdf.setFont('helvetica', 'normal')
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
      // Barre graphique : longueur ronde (m) tenant dans la case.
      const barMax = scaleW - 14
      const candidates = [0.5, 1, 2, 5, 10, 20, 50, 100, 200]
      let best = candidates[0]
      for (const c of candidates) {
        if (c / metersPerPaperMm <= barMax) best = c
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

/** Tronque un texte à une largeur PAPIER (mm), mesurée avec la police
    courante — garantit zéro débordement de case, contrairement à une
    troncature en nombre de caractères. */
function fitText(pdf, text, maxW) {
  let t = String(text ?? '')
  if (pdf.getTextWidth(t) <= maxW) return t
  while (t.length > 1 && pdf.getTextWidth(`${t}…`) > maxW) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
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
