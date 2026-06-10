/**
 * plansThumbnail.js — Génération de vignettes pour les plans (PNG/JPG/PDF).
 *
 * Module isolé du reste de la lib plans pour le code-splitting : pdfjs-dist
 * fait ~200 KB et n'est chargé qu'à l'upload (lazy import via getPdfJs).
 *
 * API publique :
 *   - generateThumbnail(file): Promise<Blob | null>
 *     Renvoie un JPG ~400×300 max (compressé qualité 0.82). Null si format
 *     non supporté ou erreur.
 *
 * Stratégies par type :
 *   - image/png, image/jpeg : canvas pur (resize + compression).
 *   - application/pdf       : pdfjs-dist (lazy import) → page 1 → canvas.
 *
 * Erreurs : on ne throw jamais — la vignette est best-effort, l'absence ne
 * doit pas bloquer la création du plan. Le caller (createPlan) ignore null.
 */

const TARGET_MAX_WIDTH = 400
const TARGET_MAX_HEIGHT = 600
const JPEG_QUALITY = 0.82

/* ─── PDF.js : import dynamique + worker setup ─────────────────────────── */

let pdfjsLibPromise = null

async function getPdfJs() {
  if (pdfjsLibPromise) return pdfjsLibPromise
  pdfjsLibPromise = (async () => {
    try {
      const pdfjs = await import('pdfjs-dist')
      // Vite : import du worker comme URL résolue par le bundler.
      const workerUrl = (
        await import('pdfjs-dist/build/pdf.worker.mjs?url')
      ).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    } catch (err) {
      console.warn('[plansThumbnail] PDF.js indisponible, vignette PDF skip', err)
      return null
    }
  })()
  return pdfjsLibPromise
}

/* ─── API publique ──────────────────────────────────────────────────────── */

/**
 * Génère une vignette JPG pour le fichier donné.
 * @param {File} file
 * @returns {Promise<Blob | null>}
 */
export async function generateThumbnail(file) {
  if (!file) return null
  const mime = (file.type || '').toLowerCase()
  try {
    if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') {
      return await thumbnailFromImage(file)
    }
    if (mime === 'application/pdf') {
      return await thumbnailFromPdf(file)
    }
  } catch (err) {
    console.warn('[plansThumbnail] échec génération vignette', err)
  }
  return null
}

/* ─── Image (PNG/JPG) → JPG compressé ──────────────────────────────────── */

async function thumbnailFromImage(file) {
  const dataUrl = await readAsDataUrl(file)
  const img = await loadImage(dataUrl)
  const { width, height } = computeFitDims(img.width, img.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff' // fond blanc pour PNG transparents
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return await canvasToBlob(canvas)
}

/* ─── PDF (page 1) → JPG via pdfjs-dist ───────────────────────────────── */

async function thumbnailFromPdf(file) {
  const pdfjs = await getPdfJs()
  if (!pdfjs) return null
  const arrayBuf = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: arrayBuf })
  const pdf = await loadingTask.promise
  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    // Choix d'échelle : on borne par largeur + hauteur cible.
    const scale = Math.min(
      TARGET_MAX_WIDTH / baseViewport.width,
      TARGET_MAX_HEIGHT / baseViewport.height,
    )
    // Cap minimum à 1 (ne pas grossir un petit PDF) et max raisonnable.
    const safeScale = Math.max(0.2, Math.min(scale, 2))
    const viewport = page.getViewport({ scale: safeScale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return await canvasToBlob(canvas)
  } finally {
    // Libérer la mémoire pdfjs (le PDF original peut être lourd).
    if (typeof pdf?.destroy === 'function') {
      try {
        pdf.destroy()
      } catch {
        /* noop */
      }
    }
  }
}

/* ─── Helpers internes ─────────────────────────────────────────────────── */

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function computeFitDims(srcW, srcH) {
  const ratio = Math.min(
    TARGET_MAX_WIDTH / srcW,
    TARGET_MAX_HEIGHT / srcH,
    1, // ne grossit jamais
  )
  return {
    width: Math.max(1, Math.round(srcW * ratio)),
    height: Math.max(1, Math.round(srcH * ratio)),
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}
