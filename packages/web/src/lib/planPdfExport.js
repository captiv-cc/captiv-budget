// ════════════════════════════════════════════════════════════════════════════
// planPdfExport — export PDF d'un plan éditable avec en-tête + légende
// ════════════════════════════════════════════════════════════════════════════
//
// Partagé entre l'éditeur desk et la page publique. A4 paysage :
//   - bandeau titre (nom du plan · sous-titre · date) ;
//   - image du canvas à gauche ;
//   - colonne légende à droite (dérivée du contenu, buildLegend).
// jspdf en lazy import (déjà dans les deps du projet).
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
 * Exporte le plan en PDF A4 paysage avec en-tête et légende.
 * @param {Editor} editor — instance tldraw
 * @param {object} opts { titre, sousTitre?, footer? }
 */
export async function exportPlanPdf(editor, { titre, sousTitre = '', footer = '' }) {
  const ids = [...editor.getCurrentPageShapeIds()]
  if (!ids.length) return false
  const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: 2, padding: 24 })
  const dataUrl = await blobToDataURL(blob)
  const img = await loadImg(dataUrl)
  const legend = buildLegend(editor.store.allRecords())

  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pw = pdf.internal.pageSize.getWidth() // 297
  const ph = pdf.internal.pageSize.getHeight() // 210
  const margin = 8
  const headerH = 14
  const legendW = legend.length ? 52 : 0

  // ── En-tête ────────────────────────────────────────────────────────────
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

  // ── Image du plan ──────────────────────────────────────────────────────
  const zoneW = pw - margin * 2 - legendW
  const zoneH = ph - headerH - margin * 2
  const ratio = Math.min(zoneW / img.width, zoneH / img.height)
  const w = img.width * ratio
  const h = img.height * ratio
  pdf.addImage(dataUrl, 'PNG', margin + (zoneW - w) / 2, headerH + margin + (zoneH - h) / 2, w, h)

  // ── Légende ────────────────────────────────────────────────────────────
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
      if (ly > ph - margin - 6) break
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

  // ── Pied de page ───────────────────────────────────────────────────────
  if (footer) {
    pdf.setTextColor(150, 150, 155)
    pdf.setFontSize(6.5)
    pdf.text(footer, pw - margin, ph - 3, { align: 'right' })
  }

  const nom = (titre || 'plan').replace(/[^a-zA-Z0-9À-ÿ ._-]/g, '').trim()
  pdf.save(`${nom}.pdf`)
  return true
}
