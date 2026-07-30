// ════════════════════════════════════════════════════════════════════════════
// logistiquePdfExport — PDF « Synthèse logistique » (Logistique V1, P3)
// ════════════════════════════════════════════════════════════════════════════
//
// Le document qu'on envoie à la prod du festival : repas par jour (ventilés
// par prise en charge, Client mis en avant), chambres/personnes par nuit et
// rooming list par hébergement, planning des arrivées/départs.
// SANS coûts ni coordonnées perso (décision Hugo).
//
// Chargé en lazy import depuis la vue Synthèse. Helpers header/footer/fonts
// répliqués de matosPdfExport (privés là-bas) — même gabarit visuel.
// ════════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { loadImageAsJpeg, computeLogoBox } from '../../lib/pdfImageLoader'
import { pickOrgLogo } from '../../lib/branding'
import {
  membreDisplayName,
  membrePosteLabel,
  frDay,
  frDayShort,
} from './logistiqueSynthese'

const C = {
  black: [0, 0, 0],
  header: [67, 67, 67],
  white: [255, 255, 255],
  gray: [120, 120, 120],
  lgray: [210, 210, 210],
  green: [34, 139, 58],
  blue: [37, 99, 235],
  amber: [201, 132, 17],
  purple: [124, 93, 220],
}

// ─── Fonts / assets (répliqués de matosPdfExport, cache module) ────────────
async function loadFontBase64(url) {
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192)
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
  return btoa(bin)
}

let _fontsCache = null
async function loadFonts() {
  if (_fontsCache) return _fontsCache
  const [wsReg, wsBold, wsMed] = await Promise.all([
    loadFontBase64('/font/WorkSans-Regular.ttf'),
    loadFontBase64('/font/WorkSans-Bold.ttf'),
    loadFontBase64('/font/WorkSans-Medium.ttf'),
  ])
  _fontsCache = { wsReg, wsBold, wsMed }
  return _fontsCache
}

async function loadAssets(org) {
  const fonts = await loadFonts()
  const bannerUrl = pickOrgLogo(org, 'banner')
  const bannerImage = await loadImageAsJpeg(bannerUrl).catch(() => null)
  return { ...fonts, bannerImage }
}

function makeDoc(assets) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
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

function drawHeader(doc, { project, bannerImage }) {
  const PW = doc.internal.pageSize.getWidth()
  const M = 14
  if (bannerImage) {
    try {
      const { width, height } = computeLogoBox(bannerImage.width, bannerImage.height, 50, 14)
      doc.addImage(bannerImage.dataUrl, 'JPEG', M, 10 + (14 - height) / 2, width, height)
    } catch {
      /* sans logo */
    }
  }
  doc.setFont('WS', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...C.black)
  doc.text('LOGISTIQUE', PW - M, 13, { align: 'right' })
  doc.setFont('WS', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.gray)
  doc.text('Synthèse — repas · hébergements · arrivées & départs', PW - M, 18, {
    align: 'right',
  })
  doc.setFontSize(7)
  const left = [project?.ref_projet, project?.title].filter(Boolean).join(' · ')
  doc.text(left, M, 25)
  doc.text(new Date().toLocaleDateString('fr-FR'), PW - M, 25, { align: 'right' })
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

function sectionTitle(doc, y, label, color) {
  const M = 14
  doc.setFont('WS', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...color)
  doc.text(label.toUpperCase(), M, y)
  return y + 3
}

const TABLE_BASE = {
  theme: 'grid',
  styles: {
    font: 'WS',
    fontSize: 8,
    cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
    lineColor: C.lgray,
    lineWidth: 0.15,
    textColor: C.black,
  },
  headStyles: {
    fillColor: C.header,
    textColor: C.white,
    fontStyle: 'bold',
    fontSize: 7.5,
    halign: 'center',
  },
  margin: { left: 14, right: 14, top: 32, bottom: 16 },
}

/**
 * @param {Object} args { project, org, synthese } — synthese = computeSynthese()
 */
export async function exportLogistiqueSynthesePDF({ project, org, synthese }) {
  const assets = await loadAssets(org)
  const doc = makeDoc(assets)
  const redraw = () => drawHeader(doc, { project, bannerImage: assets.bannerImage })
  redraw()
  let y = 36

  const { repasParJour, totauxRepas, hebs, nuitsSansHeb, mouvements } = synthese

  // ── 1. Repas — colonnes dynamiques : seules les prises en charge
  //    réellement utilisées apparaissent (retour Hugo). ──────────────────────
  if (repasParJour.length) {
    const statutLabel = { client: 'Client', production: 'Prod', defraye: 'Défrayé' }
    const cols = ['midi', 'soir'].flatMap((svc) =>
      ['client', 'production', 'defraye']
        .filter((k) => totauxRepas[svc][k] > 0)
        .map((k) => ({ svc, k })),
    )
    y = sectionTitle(doc, y, 'Repas', C.green)
    autoTable(doc, {
      ...TABLE_BASE,
      startY: y,
      head: [
        [
          { content: 'Jour', styles: { halign: 'left' } },
          ...cols.map(({ svc, k }) => ({
            content: `${svc === 'midi' ? 'Midi' : 'Soir'} ${statutLabel[k]}`,
          })),
        ],
      ],
      body: [
        ...repasParJour.map((j) => [
          { content: frDayShort(j.date), styles: { halign: 'left', fontStyle: 'bold' } },
          ...cols.map(({ svc, k }) => ({
            content: j[svc][k] || '',
            styles: {
              halign: 'center',
              fontStyle: k === 'client' && j[svc][k] ? 'bold' : 'normal',
              textColor: k === 'client' && j[svc][k] ? C.green : C.black,
            },
          })),
        ]),
        [
          { content: 'TOTAL', styles: { halign: 'left', fontStyle: 'bold' } },
          ...cols.map(({ svc, k }) => ({
            content: totauxRepas[svc][k],
            styles: { halign: 'center', fontStyle: 'bold' },
          })),
        ],
      ],
      didDrawPage: redraw,
    })
    y = (doc.lastAutoTable?.finalY || y) + 10
  }

  // ── 2. Hébergements (nuits + rooming) ────────────────────────────────────
  for (const { hebergement: h, nuitsParDate, rooming } of hebs) {
    if (!rooming.length) continue
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage()
      redraw()
      y = 36
    }
    y = sectionTitle(doc, y, h.nom, C.purple)
    if (h.adresse) {
      doc.setFont('WS', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...C.gray)
      doc.text(h.adresse.replace(/\n+/g, ' · '), 14, y + 1)
      y += 4
    }
    if (nuitsParDate.length) {
      autoTable(doc, {
        ...TABLE_BASE,
        startY: y,
        head: [
          [
            { content: 'Nuit du', styles: { halign: 'left' } },
            ...nuitsParDate.map((n) => ({ content: frDayShort(n.date) })),
          ],
        ],
        body: [
          [
            { content: 'Personnes', styles: { halign: 'left', fontStyle: 'bold' } },
            ...nuitsParDate.map((n) => ({
              content: String(n.pers),
              styles: { halign: 'center', fontStyle: 'bold' },
            })),
          ],
          ...(nuitsParDate.some((n) => n.chambres)
            ? [
                [
                  { content: 'Chambres', styles: { halign: 'left' } },
                  ...nuitsParDate.map((n) => ({
                    content: n.chambres ? String(n.chambres) : '',
                    styles: { halign: 'center' },
                  })),
                ],
              ]
            : []),
        ],
        didDrawPage: redraw,
      })
      y = (doc.lastAutoTable?.finalY || y) + 4
    }
    autoTable(doc, {
      ...TABLE_BASE,
      startY: y,
      head: [
        [
          { content: 'Personne', styles: { halign: 'left' } },
          { content: 'Chambre' },
          { content: 'PDJ' },
          { content: 'Check-in' },
          { content: 'Check-out' },
          { content: 'Nuits' },
        ],
      ],
      body: rooming.map((r) => [
        {
          content: `${membreDisplayName(r.membre)}${membrePosteLabel(r.membre) ? `  ·  ${membrePosteLabel(r.membre)}` : ''}`,
          styles: { halign: 'left' },
        },
        { content: r.chambre || '', styles: { halign: 'center' } },
        { content: r.pdj ? 'Oui' : '', styles: { halign: 'center' } },
        { content: frDayShort(r.checkin), styles: { halign: 'center' } },
        { content: frDayShort(r.checkout), styles: { halign: 'center' } },
        { content: String(r.nuits), styles: { halign: 'center', fontStyle: 'bold' } },
      ]),
      didDrawPage: redraw,
    })
    y = (doc.lastAutoTable?.finalY || y) + 10
  }
  if (nuitsSansHeb > 0) {
    doc.setFont('WS', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.amber)
    doc.text(`${nuitsSansHeb} nuit(s) sans hébergement affecté`, 14, y)
    y += 8
  }

  // ── 3. Arrivées / départs ────────────────────────────────────────────────
  if (mouvements.length) {
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage()
      redraw()
      y = 36
    }
    y = sectionTitle(doc, y, 'Arrivées & départs', C.blue)
    const body = []
    for (const m of mouvements) {
      body.push([
        {
          content: frDay(m.date),
          colSpan: 3,
          styles: {
            fontStyle: 'bold',
            fillColor: [243, 243, 243],
            halign: 'left',
          },
        },
      ])
      for (const e of m.arrivees) {
        body.push([
          { content: 'Arrivée', styles: { textColor: C.green, fontStyle: 'bold' } },
          { content: `${e.heure || ''}  ${membreDisplayName(e.membre)}`, styles: { halign: 'left' } },
          { content: e.detail || '', styles: { halign: 'left', textColor: C.gray } },
        ])
      }
      for (const e of m.departs) {
        body.push([
          { content: 'Départ', styles: { textColor: C.amber, fontStyle: 'bold' } },
          { content: `${e.heure || ''}  ${membreDisplayName(e.membre)}`, styles: { halign: 'left' } },
          { content: e.detail || '', styles: { halign: 'left', textColor: C.gray } },
        ])
      }
    }
    autoTable(doc, {
      ...TABLE_BASE,
      startY: y,
      head: [],
      body,
      columnStyles: {
        0: { cellWidth: 20, halign: 'center' },
        1: { cellWidth: 70 },
        2: { cellWidth: 'auto' },
      },
      didDrawPage: redraw,
    })
  }

  drawFooter(doc, { org })
  const slug = (project?.ref_projet || project?.title || 'projet')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
  return finishDoc(doc, `${slug}_logistique-synthese.pdf`)
}
