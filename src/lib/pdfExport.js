/**
 * Export PDF devis
 * Style : blanc/noir, Work Sans. Toutes les infos visibles (logo,
 * raison sociale, mentions légales, blocs annulation/règlement/CGV)
 * sont tirées dynamiquement de l'organisation via `org`.
 */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { calcLine, calcSynthese, fmtEur, TAUX_DEFAUT } from './cotisations'
import { getBlocInfo } from './blocs'
import { listLivrablesForDevisPdf } from './livrables'
import { pickOrgLogo } from './branding'

// Calcul du SIREN à partir d'un SIRET : 9 premiers chiffres formattés
// en groupes de 3 (ex: "898201025 00019" → "898 201 025"). Renvoie ''
// si le SIRET est vide ou ne contient pas assez de chiffres.
function computeSiren(siret) {
  if (!siret) return ''
  const digits = String(siret).replace(/\D/g, '').slice(0, 9)
  if (digits.length < 9) return ''
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  black: [0, 0, 0],
  header: [67, 67, 67], // #434343
  white: [255, 255, 255],
  light: [243, 243, 243], // #f3f3f3
  gray: [120, 120, 120],
  lgray: [210, 210, 210],
}

// ─── Loaders ──────────────────────────────────────────────────────────────────
async function loadFontBase64(url) {
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192)
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
  return btoa(bin)
}

// Charge une image et la **renormalise en JPEG** via un canvas. Évite les
// crashs jsPDF ("Invalid string length", "Incomplete or corrupt PNG file")
// quand l'utilisateur uploade un format que le parser PNG strict de jsPDF
// n'aime pas (PNG avec alpha, WebP, JPG annoncé comme PNG, etc.).
//
// Pourquoi JPEG plutôt que PNG en sortie : le parser JPEG de jsPDF est
// nettement plus tolérant. La transparence est gérée en peignant le canvas
// en blanc avant de dessiner l'image (les PDFs sont sur fond blanc, donc
// c'est sans conséquence visuelle).
//
// Si l'image n'est pas chargeable (URL invalide, CORS, 404), la promesse
// rejette → l'appelant peut retomber sur un fallback.
async function loadImageAsJpeg(url) {
  if (!url) throw new Error('loadImageAsJpeg: url manquante')
  // Étape 1 — fetch + ObjectURL : on récupère l'image en blob via fetch
  // (qui gère mieux les conditions cross-origin que le crossOrigin de
  // <img>), puis on crée une URL locale via URL.createObjectURL. L'Image
  // qui charge depuis une URL locale n'a plus de souci CORS.
  const res = await fetch(url)
  if (!res.ok) throw new Error(`loadImageAsJpeg: HTTP ${res.status} sur ${url}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 0
          const h = img.naturalHeight || img.height || 0
          if (!w || !h) {
            reject(new Error('loadImageAsJpeg: image vide (0x0)'))
            return
          }
          console.log(`[loadImageAsJpeg] image chargée: ${w}×${h} pour ${url}`)
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          // Fond blanc opaque pour neutraliser les pixels transparents
          // (sinon JPEG les rendrait en noir).
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
          // Détection d'un échec silencieux de toDataURL : si le canvas
          // ne peut pas encoder (image trop grande, format pixel exotique,
          // mémoire saturée), il retourne "data:," sans throw. On le
          // détecte et on rejette pour permettre le fallback en cascade.
          if (!dataUrl || !dataUrl.startsWith('data:image/') || dataUrl.length < 100) {
            reject(new Error(
              `loadImageAsJpeg: toDataURL retourne un data URL invalide (${dataUrl?.length || 0} chars) ` +
              `pour image ${w}×${h}. L'image source est probablement trop grande ou dans un format ` +
              `non supporté (essayer de la redimensionner < 2000px).`
            ))
            return
          }
          resolve(dataUrl)
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error(`loadImageAsJpeg: échec décodage ${url}`))
      img.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────
// fmtEurPdf : remplace les espaces insécables (U+00A0, U+202F) par des espaces
// normaux pour que jsPDF mesure et aligne correctement les montants.
const fmtEurPdf = (v) => fmtEur(v).replace(/[\u00A0\u202F]/g, ' ')

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')

function addDays(d, n) {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt
}

function devisNum(devis, project) {
  if (project?.ref_projet) return `DE${project.ref_projet}`
  const d = new Date(devis.created_at || Date.now())
  const y = String(d.getFullYear())
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `DE${y}${m}-V${devis.version_number || 1}`
}

function getCatLabel(cat) {
  const info = getBlocInfo(cat.name)
  if (!info.isCanonical) return cat.name || '—'
  const raw = info.label
  const nice = raw.charAt(0) + raw.slice(1).toLowerCase()
  return `${info.canonicalIdx + 1}/ ${nice}`
}

// ─── Champs infos projet ──────────────────────────────────────────────────────
const LABELS_C1 = {
  type_projet: 'Type',
  titre_projet: 'Titre',
  agence: 'Agence',
  production: 'Production',
  production_executive: 'Production exécutive',
  realisateur: 'Réalisateur',
  producteur: 'Producteur',
}

const LABELS_C2 = {
  nb_livrables: 'Nb Livrables',
  prepa_jours: 'Prépa',
  prepa_dates: 'Dates prépa',
  tournage_jours: 'Nb Jours Tournage',
  tournage_dates: 'Tournage',
  lieu_tournage: 'Lieu tournage',
  envoi_v1: 'Envoi V1',
  livraison_master: 'Livraison MASTER',
  deadline: 'Deadline',
  format_master: 'Format master',
  duree_master: 'Durée master',
}

// ─── Export principal ─────────────────────────────────────────────────────────
export async function exportDevisPDF(devis, project, client, org, taux = TAUX_DEFAUT) {
  // Choix du logo bannière selon org : version horizontale prioritaire,
  // fallback sur logo clair, puis sur l'image Captiv en dur.
  const bannerUrl = pickOrgLogo(org, 'banner')
  console.log('[pdfExport] banner URL choisie:', bannerUrl)
  const [wsRegB64, wsBoldB64, wsMedB64, bannerDataUrl, livrablesPdf] = await Promise.all([
    loadFontBase64('/font/WorkSans-Regular.ttf'),
    loadFontBase64('/font/WorkSans-Bold.ttf'),
    loadFontBase64('/font/WorkSans-Medium.ttf'),
    // Cascade de fallbacks : URL choisie → /captiv-banner.png → null
    // (le PDF se génère sans logo plutôt que de crasher tout l'export)
    loadImageAsJpeg(bannerUrl)
      .catch((e) => {
        console.warn('[pdfExport] banner principal échoué, fallback /captiv-banner.png:', e?.message)
        return loadImageAsJpeg('/captiv-banner.png')
      })
      .catch((e) => {
        console.error('[pdfExport] banner fallback aussi échoué, PDF sans logo:', e?.message)
        return null
      }),
    // LIV-19 — livrables réels du projet filtrés par lot du devis (génériques
    // sans lot inclus). Si erreur, on retombe silencieusement sur [].
    listLivrablesForDevisPdf(project?.id, devis?.lot_id || null).catch(() => []),
  ])
  console.log('[pdfExport] banner data URL:', bannerDataUrl
    ? `${bannerDataUrl.slice(0, 50)}... (${bannerDataUrl.length} chars)`
    : 'null')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 14
  const IW = PW - M * 2 // 182 mm

  doc.addFileToVFS('WorkSans-Regular.ttf', wsRegB64)
  doc.addFont('WorkSans-Regular.ttf', 'WS', 'normal')
  doc.addFileToVFS('WorkSans-Bold.ttf', wsBoldB64)
  doc.addFont('WorkSans-Bold.ttf', 'WS', 'bold')
  doc.addFileToVFS('WorkSans-Medium.ttf', wsMedB64)
  doc.addFont('WorkSans-Medium.ttf', 'WS', 'medium')

  // ── Données ──────────────────────────────────────────────────────────────────
  const meta = project?.metadata || {}
  const categories = devis.categories || []
  const globalAdj = devis.globalAdj || {
    marge_globale_pct: devis.marge_globale_pct || 0,
    assurance_pct: devis.assurance_pct || 0,
    remise_globale_pct: devis.remise_globale_pct || 0,
    remise_globale_montant: devis.remise_globale_montant || 0,
  }

  const allLines = categories.flatMap((cat) =>
    (cat.lines || []).map((l) => ({ ...l, dans_marge: cat.dans_marge !== false })),
  )
  const activeLines = allLines.filter((l) => l.use_line)
  const synth = calcSynthese(
    activeLines,
    devis.tva_rate || 20,
    devis.acompte_pct || 30,
    taux,
    globalAdj,
  )

  const NUM = devisNum(devis, project)
  const DATE_DEVIS = fmtDate(devis.date_devis || devis.created_at || new Date())
  const DATE_VALIDITE = fmtDate(addDays(devis.date_devis || devis.created_at || new Date(), 30))

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const txt = (text, x, y, opts = {}) => {
    if (text === null || text === undefined || text === '') return
    doc.setFontSize(opts.size || 7)
    doc.setFont('WS', opts.bold ? 'bold' : opts.medium ? 'medium' : 'normal')
    doc.setTextColor(...(opts.color || C.black))
    doc.text(String(text), x, y, { align: opts.align || 'left', maxWidth: opts.maxW })
  }

  const hline = (x1, y, x2, color = C.lgray, lw = 0.25) => {
    doc.setDrawColor(...color)
    doc.setLineWidth(lw)
    doc.line(x1, y, x2, y)
  }

  const fillRect = (x, y, w, h, color) => {
    doc.setFillColor(...color)
    doc.rect(x, y, w, h, 'F')
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  const orgFooterName = org?.legal_name || org?.display_name || ''
  const drawFooter = (pageNum) => {
    hline(M, PH - 12, PW - M, C.lgray, 0.3)
    txt(orgFooterName, M, PH - 7, { size: 7 })
    txt(`Page ${pageNum}`, PW - M, PH - 7, { size: 7, align: 'right' })
  }

  // ── Détail header (idempotent) ────────────────────────────────────────────────
  const drawnDetailHeaders = new Set()
  const drawDetailHeader = () => {
    const pn = doc.internal.getCurrentPageInfo().pageNumber
    if (drawnDetailHeaders.has(pn)) return
    drawnDetailHeaders.add(pn)
    txt(`${NUM} | PROJET : ${project?.title || '—'}`, PW / 2, 11, {
      size: 7.5,
      bold: true,
      align: 'center',
    })
    txt('Détail du devis', PW / 2, 15.5, { size: 6.5, color: C.gray, align: 'center' })
    hline(M, 18, PW - M, C.lgray, 0.2)
  }

  // ╔══════════════════════════════════════════╗
  // ║  PAGE 1                                  ║
  // ╚══════════════════════════════════════════╝

  // ── Logo + DEVIS (pas de hline séparatrice) ──────────────────────────────────
  // bannerDataUrl est garanti JPEG si non-null (renormalisé via canvas).
  // Si null (chargement échoué + fallback échoué), on omet le logo plutôt
  // que de crasher l'export.
  if (bannerDataUrl) {
    try {
      doc.addImage(bannerDataUrl, 'JPEG', M, 10, 45, 10)
    } catch (e) {
      console.error('[pdfExport] addImage banner échoué:', e?.message || e)
    }
  } else {
    console.warn('[pdfExport] aucun bannerDataUrl, PDF généré sans logo')
  }

  txt('DEVIS', PW - M, 13, { size: 20, bold: true, align: 'right' })
  txt(NUM, PW - M, 18.5, { size: 7.5, align: 'right' })
  txt(DATE_DEVIS, PW - M, 23.5, { size: 7.5, align: 'right' })
  // ← pas de hline ici

  // ── Contacts ─────────────────────────────────────────────────────────────────
  let y = 30
  const halfW = IW / 2 - 4
  const rightX = M + halfW + 8

  // Pré-calcul hauteur bloc client → fond gris avant de dessiner le texte
  doc.setFont('WS', 'normal')
  doc.setFontSize(6.5)
  let clientBlockH = 0
  if (client?.raison_sociale || client?.nom_commercial) clientBlockH += 3.8
  if (client?.contact_name) clientBlockH += 3.4
  if (client?.address) clientBlockH += doc.splitTextToSize(client.address || '', halfW).length * 3.4
  if (client?.email) clientBlockH += 3.4
  // +4mm de padding en haut du bloc client → "ligne vide" avant le nom
  if (clientBlockH > 0) fillRect(rightX - 4, y - 3, halfW + 4, clientBlockH + 10, C.light)

  // Émetteur (gauche, pas de fond) — toutes les infos viennent de org
  let ly = y
  const senderName = org?.legal_name || org?.display_name || ''
  if (senderName) {
    txt(senderName, M, ly, { size: 7.5, bold: true })
    ly += 3.8
  }
  if (org?.address) {
    doc.splitTextToSize(org.address, halfW).forEach((l) => {
      txt(l, M, ly, { size: 6.5, color: C.gray })
      ly += 3.4
    })
  }
  ly += 0.5
  if (org?.contact_name) {
    txt(org.contact_name, M, ly, { size: 6.5, bold: true, color: C.gray })
    ly += 3.4
  }
  if (org?.email) {
    txt(org.email, M, ly, { size: 6.5, color: C.gray })
    ly += 3.4
  }
  if (org?.phone) {
    txt(org.phone, M, ly, { size: 6.5, color: C.gray })
    ly += 3.4
  }

  // Client (droite, sur fond gris déjà dessiné) — démarre 4mm plus bas (ligne vide en haut)
  let cy = y + 4
  if (client?.raison_sociale || client?.nom_commercial) {
    txt(client?.raison_sociale || client?.nom_commercial, rightX, cy, { size: 7.5, bold: true })
    cy += 3.8
  }
  if (client?.contact_name) {
    txt(client.contact_name, rightX, cy, { size: 6.5, color: C.gray })
    cy += 3.4
  }
  if (client?.address) {
    doc.splitTextToSize(client.address, halfW).forEach((l) => {
      txt(l, rightX, cy, { size: 6.5, color: C.gray })
      cy += 3.4
    })
  }
  if (client?.email) {
    txt(client.email, rightX, cy, { size: 6.5, color: C.gray })
    cy += 3.4
  }

  y = Math.max(ly, cy) + 5
  // ← pas de hline ici non plus

  // ── 3 mini-tableaux : PROJET | CLIENT | RÉFÉRENCE (espacés) ──────────────────
  const gap = 3 // blanc entre les 3 blocs
  const colP = Math.round(IW * 0.55) - gap // ≈ 97 mm
  const colCl = Math.round(IW * 0.22) // ≈ 40 mm
  const colR = IW - colP - colCl - 2 * gap // reste ≈ 39 mm
  const x2 = M + colP + gap
  const x3 = x2 + colCl + gap
  const bandH = 4.5 // réduit (était 5.5)
  const valH = 6 // réduit (était 7.5)

  // Headers (fond sombre, texte blanc)
  fillRect(M, y, colP, bandH, C.header)
  fillRect(x2, y, colCl, bandH, C.header)
  fillRect(x3, y, colR, bandH, C.header)
  txt('PROJET', M + 3, y + 3.1, { size: 6.5, bold: true, color: C.white })
  txt('CLIENT', x2 + 3, y + 3.1, { size: 6.5, bold: true, color: C.white })
  txt('RÉFÉRENCE', x3 + 3, y + 3.1, { size: 6.5, bold: true, color: C.white })
  y += bandH

  // Valeurs (fond clair)
  fillRect(M, y, colP, valH, C.light)
  fillRect(x2, y, colCl, valH, C.light)
  fillRect(x3, y, colR, valH, C.light)
  txt(project?.title || '—', M + 3, y + 4.2, { size: 7.5, bold: true, maxW: colP - 6 })
  txt(client?.raison_sociale || client?.nom_commercial || '—', x2 + 3, y + 4.2, { size: 7, maxW: colCl - 6 })
  txt(project?.ref_projet || '—', x3 + 3, y + 4.2, { size: 7 })
  y += valH + 3

  // ── Infos projet — 3 colonnes ─────────────────────────────────────────────────
  // Largeurs : ~57 | ~57 | reste, avec 4mm de gap entre chaque
  const c1W = 57,
    c2W = 57,
    c3W = IW - c1W - c2W - 8
  const c1X = M,
    c2X = M + c1W + 4,
    c3X = c2X + c2W + 4
  const lblW = 32 // largeur colonne label (right-aligned à c_X + lblW)

  // Col 1 : Général / Production / Équipe — label right-aligné
  let p1y = y
  for (const [key, lbl] of Object.entries(LABELS_C1)) {
    const val = String(meta[key] || project?.[key] || '')
    if (!val) continue
    txt(`${lbl} :`, c1X + lblW, p1y, { size: 6, color: C.gray, align: 'right' })
    txt(val, c1X + lblW + 2, p1y, { size: 6, maxW: c1W - lblW - 2 })
    p1y += 3.4
  }

  // Col 2 : Planning / Livrables — label right-aligné
  let p2y = y
  for (const [key, lbl] of Object.entries(LABELS_C2)) {
    const val = String(meta[key] || project?.[key] || '')
    if (!val) continue
    txt(`${lbl} :`, c2X + lblW, p2y, { size: 6, color: C.gray, align: 'right' })
    txt(val, c2X + lblW + 2, p2y, { size: 6, maxW: c2W - lblW - 2 })
    p2y += 3.4
  }

  // Col 3 : Tableur livrables (LIV-19B — basé sur la table livrables réelle,
  // filtré par devis_lot_id du devis courant + livrables génériques NULL).
  // Si 0 livrable filtré → la section est complètement cachée (pas de
  // titre, pas d'espace réservé).
  let p3y = y
  if (livrablesPdf && livrablesPdf.length > 0) {
    txt('Livrable(s) :', c3X, p3y, { size: 6, color: C.gray })
    p3y += 3.4
    livrablesPdf.slice(0, 8).forEach((liv, i) => {
      const numero = (liv.numero || '').toString().trim()
      const prefix = numero ? `${numero}` : `#${i + 1}`
      const parts = [`${prefix} | ${liv.nom || ''}`]
      if (liv.format) parts.push(liv.format)
      if (liv.duree) parts.push(liv.duree)
      doc.splitTextToSize(parts.join(' | '), c3W).forEach((l) => {
        txt(l, c3X, p3y, { size: 6, color: C.gray })
        p3y += 3.1
      })
    })
  }

  y = Math.max(p1y, p2y, p3y) + 4

  // ── Récapitulatif ─────────────────────────────────────────────────────────────
  const RECAP_ROW_H = 4.2 // compact rows
  const RECAP_HDR_H = 5 // header height

  // Header: dark background, white text
  fillRect(M, y, IW, RECAP_HDR_H, C.header)
  txt('Récapitulatif', M + 2, y + 3.4, { size: 6.5, bold: true, color: C.white })
  txt('Sous-totaux HT', PW - M - 2, y + 3.4, {
    size: 6.5,
    bold: true,
    color: C.white,
    align: 'right',
  })
  y += RECAP_HDR_H

  // Bloc rows (alternating light / white)
  // Pré-calcul largeur max des montants pour alignement tabulaire
  const recapAmounts = categories.map((cat) => {
    const catLines = (cat.lines || []).filter((l) => l.use_line)
    return fmtEurPdf(catLines.reduce((s, l) => s + calcLine(l, taux).prixVenteHT, 0))
  })
  doc.setFont('WS', 'normal')
  doc.setFontSize(6.5)
  const maxAmtW = Math.max(...recapAmounts.map((a) => doc.getTextWidth(a)))

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i]
    const amt = recapAmounts[i]
    if (i % 2 === 0) fillRect(M, y, IW, RECAP_ROW_H, C.light)
    txt(getCatLabel(cat), M + 2, y + 3.0, { size: 6.5 })
    // Alignement : tous les montants cadrés à droite sur la même colonne
    const amtX = PW - M - 2
    txt(amt, amtX, y + 3.0, { size: 6.5, align: 'right' })
    y += RECAP_ROW_H
  }

  // Espace entre récap et sous-total (sans doublon SOUS-TOTAL GLOBAL)
  y += 5

  // ── Tableau sous-total ─────────────────────────────────────────────────────
  const ST_ROW_H = 5
  const pctX = PW - M - 28 // position colonne % (serrée à droite)

  // Blocs hors marge → annotation "(Hors [BLOC1, BLOC2])"
  const horsMargeBlocs = categories.filter((c) => c.dans_marge === false).map((c) => getCatLabel(c))
  const horsMargeNote = horsMargeBlocs.length > 0 ? ` (Hors ${horsMargeBlocs.join(', ')})` : ''

  // SOUS-TOTAL PARTIEL
  fillRect(M, y, IW, ST_ROW_H, C.light)
  txt('SOUS-TOTAL PARTIEL (HT)', M + 2, y + 3.5, { size: 7, bold: true })
  txt(fmtEurPdf(synth.sousTotal), PW - M - 2, y + 3.5, { size: 7, bold: true, align: 'right' })
  y += ST_ROW_H

  // Remise globale (en premier)
  if (synth.montantRemiseGlobale > 0) {
    txt('Remise globale', M + 2, y + 3.5, { size: 6.5 })
    txt(`${globalAdj.remise_globale_pct || ''}%`, pctX, y + 3.5, { size: 6.5, align: 'right' })
    txt(`- ${fmtEurPdf(synth.montantRemiseGlobale)}`, PW - M - 2, y + 3.5, {
      size: 6.5,
      align: 'right',
    })
    y += ST_ROW_H
  }

  if (globalAdj.assurance_pct > 0) {
    txt('Assurances', M + 2, y + 3.5, { size: 6.5 })
    txt(`${globalAdj.assurance_pct}%`, pctX, y + 3.5, { size: 6.5, align: 'right' })
    txt(fmtEurPdf(synth.montantAssurance), PW - M - 2, y + 3.5, { size: 6.5, align: 'right' })
    y += ST_ROW_H
  }

  if (globalAdj.marge_globale_pct > 0) {
    txt(`Marges + Frais généraux${horsMargeNote}`, M + 2, y + 3.5, { size: 6.5 })
    txt(`${globalAdj.marge_globale_pct}%`, pctX, y + 3.5, { size: 6.5, align: 'right' })
    txt(fmtEurPdf(synth.montantMargeGlobale), PW - M - 2, y + 3.5, { size: 6.5, align: 'right' })
    y += ST_ROW_H
  }

  if (synth.totalCharges > 0) {
    txt('Cotisations sociales', M + 2, y + 3.5, { size: 6.5 })
    txt(fmtEurPdf(synth.totalCharges), PW - M - 2, y + 3.5, { size: 6.5, align: 'right' })
    y += ST_ROW_H
  }

  hline(M, y, PW - M, C.lgray, 0.2)
  y += 5

  // ── Section basse ─────────────────────────────────────────────────────────────
  const BANNER_H = 10
  const FOOTER_H = 14
  const BOTTOM_Y = PH - FOOTER_H - BANNER_H // 273
  const notesW = IW * 0.55 - 4
  const totsX = M + notesW + 8
  const totsW = IW - notesW - 8

  let ny = y + 6 // espace entre tableau sous-total et notes légales

  if (project?.note_prod) {
    txt('HORS DEVIS / NOTE DE PROD', M, ny, { size: 6, bold: true })
    ny += 3.5
    doc.splitTextToSize(project.note_prod, notesW).forEach((l) => {
      txt(l, M, ny, { size: 5.5, color: C.gray })
      ny += 2.8
    })
    ny += 2
  }

  // Helper pour rendre un bloc texte multi-paragraphes (split sur \n).
  // Le bloc est entièrement masqué si le texte est vide → permet à une
  // org de masquer un bloc en laissant son champ vide dans Paramètres.
  const drawTextBlock = (title, body) => {
    if (!body || !String(body).trim()) return
    txt(title, M, ny, { size: 6, bold: true })
    ny += 3.5
    String(body).split('\n').forEach((line) => {
      doc.splitTextToSize(line, notesW).forEach((l) => {
        txt(l, M, ny, { size: 5.5, color: C.gray })
        ny += 2.8
      })
    })
    ny += 2
  }

  drawTextBlock('ANNULATION / REPORT', org?.pdf_devis_annulation_text)

  // Modalités de règlement : la première ligne (acompte) est calculée
  // dynamiquement à partir du devis (% + montant TTC). Le reste vient
  // du texte fixe de l'org (solde, majoration, etc.).
  const acomptePct = devis.acompte_pct || 30
  const acompteLine = `Acompte : ${acomptePct}% du montant total à la commande (${fmtEurPdf(synth.acompte)} TTC)`
  const reglementBody = [acompteLine, org?.pdf_devis_reglement_text || '']
    .filter((s) => String(s).trim())
    .join('\n')
  drawTextBlock('MODALITÉS DE RÈGLEMENT', reglementBody)

  drawTextBlock('CGV', org?.pdf_devis_cgv_text)

  // Totaux droite — TOTAL HT en priorité (fond sombre), TTC en fond clair
  const RH = 5.5
  let ty = y

  // TOTAL HT — le plus important → fond sombre
  fillRect(totsX, ty, totsW, RH + 1, C.header)
  txt('TOTAL (HT)', totsX + 2, ty + 4.3, { size: 7, bold: true, color: C.white })
  txt(fmtEurPdf(synth.totalHTFinal), totsX + totsW - 2, ty + 4.3, {
    size: 8,
    bold: true,
    color: C.white,
    align: 'right',
  })
  ty += RH + 1

  // TVA — fond clair, compact
  fillRect(totsX, ty, totsW, RH, C.light)
  txt('TVA', totsX + 2, ty + 3.8, { size: 6.5, bold: true })
  txt(`${devis.tva_rate || 20}%`, totsX + totsW * 0.5, ty + 3.8, { size: 6.5, align: 'center' })
  txt(fmtEurPdf(synth.tva), totsX + totsW - 2, ty + 3.8, { size: 6.5, align: 'right' })
  ty += RH

  // TOTAL TTC — fond clair (moins important que HT)
  fillRect(totsX, ty, totsW, RH, C.light)
  txt('TOTAL (TTC)', totsX + 2, ty + 3.8, { size: 6.5, bold: true })
  txt(fmtEurPdf(synth.totalTTC), totsX + totsW - 2, ty + 3.8, {
    size: 6.5,
    bold: true,
    align: 'right',
  })
  ty += RH

  // Acompte — fond blanc pour le détacher des totaux
  txt('Acompte à la commande', totsX + 2, ty + 3.8, { size: 6 })
  txt(`${devis.acompte_pct || 30}%`, totsX + totsW * 0.5, ty + 3.8, { size: 6, align: 'center' })
  txt(fmtEurPdf(synth.acompte), totsX + totsW - 2, ty + 3.8, { size: 7, bold: true, align: 'right' })
  ty += RH

  // Date validité — fond blanc, séparé
  txt("Offre valable jusqu'au", totsX + totsW / 2, ty + 2.5, {
    size: 5.5,
    color: C.gray,
    align: 'center',
  })
  txt(DATE_VALIDITE, totsX + totsW / 2, ty + 5.5, { size: 6.5, bold: true, align: 'center' })
  ty += RH + 6 // espace avant BON POUR ACCORD

  // BON POUR ACCORD — cadre border visible, plus d'espace pour signature
  const bpaH = 38
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.4)
  doc.rect(totsX, ty, totsW, bpaH)
  txt('BON POUR ACCORD ET SIGNATURE', totsX + totsW / 2, ty + 4.5, {
    size: 6.5,
    bold: true,
    align: 'center',
  })
  ty += 10
  txt('Fait à :', totsX + 3, ty, { size: 6.5, color: C.gray })
  ty += 9
  txt('Le :', totsX + 3, ty, { size: 6.5, color: C.gray })
  ty += 9
  txt('Signature :', totsX + 3, ty, { size: 6.5, color: C.gray })

  // ── Bandeau bas ───────────────────────────────────────────────────────────────
  const bannerY = Math.max(BOTTOM_Y, Math.max(ny, ty) + 6)
  fillRect(0, bannerY, PW, BANNER_H, C.header)
  txt('DÉTAILS DU DEVIS DANS LES PAGES SUIVANTES ▶', PW / 2, bannerY + 6.5, {
    size: 8,
    bold: true,
    color: C.white,
    align: 'center',
  })

  // ╔══════════════════════════════════════════╗
  // ║  PAGES SUIVANTES — DÉTAIL PAR BLOC       ║
  // ╚══════════════════════════════════════════╝
  doc.addPage()
  drawDetailHeader()
  let dy = 23

  // Styles communs colonnes numériques (compact)
  const colPad = { left: 1.5, top: 1, bottom: 1, right: 1.5 }
  const colPadProd = { left: 2, top: 1, bottom: 1, right: 2 }

  for (const cat of categories) {
    const catLines = (cat.lines || []).filter((l) => l.use_line)
    if (catLines.length === 0) continue

    const catTotal = catLines.reduce((s, l) => s + calcLine(l, taux).prixVenteHT, 0)
    const catDisplayName = getCatLabel(cat)
    const body = []

    // Note du bloc (si présente) — avant les lignes, span 6 colonnes, italique gris
    if (cat.notes && cat.notes.trim()) {
      body.push([
        {
          content: cat.notes.trim(),
          colSpan: 6,
          styles: {
            textColor: C.gray,
            fontSize: 6,
            fontStyle: 'italic',
            font: 'WS',
            fillColor: C.white,
            cellPadding: { left: 2, top: 2, bottom: 2, right: 2 },
          },
        },
      ])
    }

    // Lignes de données — 6 colonnes (NB supprimé, NB×QT fusionné dans QT si besoin)
    for (const line of catLines) {
      const c = calcLine(line, taux)
      const nb = line.nb || 1
      const qt = line.quantite || ''
      // Affiche nb×qt si nb > 1, sinon juste qt
      const qtDisp = nb > 1 && qt ? `${nb}×${qt}` : String(qt)
      const remise = line.remise_pct > 0 ? `-${line.remise_pct}%` : ''

      // Pré-texte pour la colonne produit (nom + description éventuelle sur plusieurs lignes)
      const prodName = line.produit || ''
      const descr = line.description || ''
      // On met le nom en content visible pour que autoTable calcule la hauteur minimum
      // Le dessin custom dans didDrawCell s'occupera du rendu réel
      body.push([
        {
          content: prodName + (descr ? '\n' + descr : ''),
          _produit: prodName,
          _ref: line.ref || '',
          _descr: descr,
          styles: { fontSize: 6.5, cellPadding: colPadProd, overflow: 'linebreak' },
        },
        { content: qtDisp, styles: { halign: 'right', fontSize: 6.5, cellPadding: colPad } },
        {
          content: line.unite || '',
          styles: { halign: 'center', fontSize: 6.5, cellPadding: colPad },
        },
        {
          content: line.tarif_ht ? fmtEurPdf(line.tarif_ht) : '',
          styles: { halign: 'right', fontSize: 6.5, cellPadding: colPad },
        },
        {
          content: remise,
          styles: { halign: 'center', fontSize: 6.5, textColor: C.gray, cellPadding: colPad },
        },
        {
          content: fmtEurPdf(c.prixVenteHT),
          styles: { halign: 'right', fontSize: 6.5, fontStyle: 'bold', cellPadding: colPad },
        },
      ])
    }

    // Ligne sous-total catégorie
    body.push([
      {
        content: `SOUS-TOTAL ${catDisplayName.toUpperCase()} (HT)`,
        colSpan: 5,
        styles: {
          textColor: C.gray,
          fontSize: 6,
          halign: 'right',
          font: 'WS',
          cellPadding: { left: 2, top: 2, bottom: 2, right: 3 },
        },
      },
      {
        content: fmtEurPdf(catTotal),
        styles: {
          textColor: C.black,
          fontSize: 7.5,
          fontStyle: 'bold',
          halign: 'right',
          font: 'WS',
          cellPadding: { left: 1.5, top: 2, bottom: 2, right: 1.5 },
        },
      },
    ])

    // Header unifié : nom du bloc (gauche) + labels colonnes (droite) → une seule ligne sombre
    const hdrCell = (content, align = 'right') => ({
      content,
      styles: {
        fillColor: C.header,
        textColor: C.white,
        fontSize: 6.5,
        fontStyle: 'normal',
        halign: align,
        font: 'WS',
        cellPadding: { left: 1.5, top: 2, bottom: 2, right: 1.5 },
      },
    })

    autoTable(doc, {
      startY: dy,
      head: [
        [
          {
            content: catDisplayName,
            styles: {
              fillColor: C.header,
              textColor: C.white,
              fontSize: 7,
              fontStyle: 'bold',
              halign: 'left',
              font: 'WS',
              cellPadding: colPadProd,
            },
          },
          hdrCell('QT'),
          hdrCell('UNITÉ', 'center'),
          hdrCell('Tarif HT'),
          hdrCell('%', 'center'),
          hdrCell('Montant HT'),
        ],
      ],
      body,
      theme: 'plain',
      styles: {
        font: 'WS',
        fontSize: 6.5,
        textColor: C.black,
        cellPadding: colPadProd,
        lineWidth: 0, // aucun trait de cellule — séparation par fond alterné
      },
      headStyles: {
        lineWidth: 0,
      },
      columnStyles: {
        0: { cellWidth: 'auto' }, // produit
        1: { cellWidth: 8, halign: 'right' }, // QT
        2: { cellWidth: 12, halign: 'center' }, // UNITÉ
        3: { cellWidth: 22, halign: 'right' }, // Tarif HT
        4: { cellWidth: 10, halign: 'center' }, // %
        5: { cellWidth: 22, halign: 'right' }, // Montant HT
      },
      margin: { left: M, right: M, top: 21 },

      didParseCell(data) {
        if (data.section !== 'body') return
        const isSousTotal = data.row.index === body.length - 1
        const isNote = data.row.raw?.[0]?.colSpan === 6 && data.row.index === 0 && cat.notes?.trim()
        if (isSousTotal || isNote) {
          // Sous-total et note : fond blanc pur
          data.cell.styles.fillColor = C.white
          data.cell.styles.lineWidth = 0
        } else {
          // Bandes alternées sur les lignes de données
          // Décalage si la note est présente (row 0 = note → données démarrent à row 1)
          const dataIdx = cat.notes?.trim() ? data.row.index - 1 : data.row.index
          data.cell.styles.fillColor = dataIdx % 2 === 0 ? C.light : C.white
        }
        // Col 0 : rendre le texte invisible (on dessine manuellement dans didDrawCell)
        if (data.column.index === 0 && data.cell.raw?._produit !== undefined) {
          data.cell.styles.textColor = data.cell.styles.fillColor || C.white
        }
      },

      didDrawCell(data) {
        if (data.column.index !== 0 || data.section !== 'body') return
        const raw = data.cell.raw
        if (!raw || raw._produit === undefined) return

        const { _produit, _ref, _descr } = raw
        const cx = data.cell.x + 2
        const cw = data.cell.width - 4
        const cellTop = data.cell.y + 2.5

        // REF : petit, gris, à gauche
        let nameOffsetX = 0
        if (_ref) {
          doc.setFont('WS', 'normal')
          doc.setFontSize(5)
          doc.setTextColor(...C.gray)
          doc.text(String(_ref), cx, cellTop)
          nameOffsetX = doc.getTextWidth(String(_ref)) + 1.5
        }

        // Description : réservée à droite (40% max), multi-lignes
        const descrMaxW = _descr ? Math.min(cw * 0.42, 60) : 0
        const nameMaxW = cw - nameOffsetX - (descrMaxW > 0 ? descrMaxW + 2 : 0)

        // Nom produit : bold, noir
        doc.setFont('WS', 'bold')
        doc.setFontSize(6.5)
        doc.setTextColor(...C.black)
        doc.text(_produit || '', cx + nameOffsetX, cellTop, { maxWidth: nameMaxW })

        // Description : normal, gris, alignée droite, multi-lignes
        if (_descr) {
          doc.setFont('WS', 'normal')
          doc.setFontSize(6)
          doc.setTextColor(...C.gray)
          const descrLines = doc.splitTextToSize(_descr, descrMaxW)
          const lineH = 2.8
          let dy = cellTop
          for (const line of descrLines) {
            doc.text(line, data.cell.x + data.cell.width - 2, dy, { align: 'right' })
            dy += lineH
          }
        }
      },

      didDrawPage() {
        drawDetailHeader()
      },
    })

    dy = (doc.lastAutoTable?.finalY || dy) + 6

    if (dy > PH - 48) {
      doc.addPage()
      drawDetailHeader()
      dy = 23
    }
  }

  // ── Mention légale ────────────────────────────────────────────────────────────
  // Construite dynamiquement à partir des champs `org` et de
  // `pdf_field_visibility` (toggles dans Paramètres > Organisation > Identité
  // légale). Les champs masqués / vides sont automatiquement omis.
  const vis = org?.pdf_field_visibility || {}
  const showField = (key) => vis[key] !== false  // défaut : visible si non défini
  const orgSiren = computeSiren(org?.siret)
  // Ligne 1 : raison sociale + forme + capital
  const line1Parts = []
  if (showField('legal_name') && (org?.legal_name || org?.display_name)) {
    line1Parts.push(org.legal_name || org.display_name)
  }
  if (showField('forme_juridique') && org?.forme_juridique) {
    line1Parts.push(org.forme_juridique)
  }
  if (showField('capital_social') && org?.capital_social) {
    line1Parts.push(`au capital de ${org.capital_social}`)
  }
  // Ligne 2 : SIRET, RCS+SIREN, APE, TVA
  const line2Parts = []
  if (showField('siret') && org?.siret) line2Parts.push(`N° Siret : ${org.siret}`)
  if (showField('siren') && orgSiren && org?.ville_rcs && showField('ville_rcs')) {
    line2Parts.push(`R.C.S. ${org.ville_rcs} ${orgSiren}`)
  } else if (showField('ville_rcs') && org?.ville_rcs) {
    line2Parts.push(`R.C.S. ${org.ville_rcs}`)
  } else if (showField('siren') && orgSiren) {
    line2Parts.push(`SIREN ${orgSiren}`)
  }
  if (showField('code_ape') && org?.code_ape) line2Parts.push(`Code APE : ${org.code_ape}`)
  if (showField('tva_number') && org?.tva_number) {
    line2Parts.push(`TVA intracommunautaire : ${org.tva_number}`)
  }

  let legalY = Math.max(dy + 5, PH - FOOTER_H - 15)
  if (line1Parts.length > 0) {
    txt(line1Parts.join(' - '), PW / 2, legalY, { size: 6, color: C.gray, align: 'center' })
    legalY += 3.5
  }
  if (line2Parts.length > 0) {
    txt(line2Parts.join(' - '), PW / 2, legalY, { size: 6, color: C.gray, align: 'center' })
    legalY += 3.5
  }

  // ── Footers ───────────────────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    drawFooter(i)
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  // Retourne un handle { blob, url, filename, download(), revoke() } au lieu
  // de déclencher `doc.save()` directement. Ça permet à l'appelant de choisir
  // entre prévisualiser (URL.createObjectURL → <iframe>) et télécharger.
  // Aligné avec le pattern `finishDoc` de matosBilanPdf.js.
  const sanitize = (s) => (s || '').replace(/[^a-zA-Z0-9àâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ &+\-_.]/g, '').trim()
  const ref = sanitize(project?.ref_projet) || sanitize(org?.display_name) || 'PROJET'
  const clientName = sanitize(client?.raison_sociale || client?.nom_commercial) || ''
  const projTitle = sanitize(project?.title) || ''
  const ver = devis.version_number || 1
  const parts = [ref, clientName, projTitle, 'DEVIS', `V${ver}`].filter(Boolean)
  const filename = parts.join('_') + '.pdf'
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
