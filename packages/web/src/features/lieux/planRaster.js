// ════════════════════════════════════════════════════════════════════════════
// planRaster.js — produit une image rasterisée d'un plan pour l'overlay carte
// ════════════════════════════════════════════════════════════════════════════
//
// MapLibre image source ne lit pas le PDF : on rasterise la page 1 en PNG haute
// déf (via pdfjs-dist, lazy import partagé avec plansThumbnail). Les images
// PNG/JPG sont utilisées telles quelles (la signed URL suffit), on récupère
// juste leurs dimensions naturelles pour initialiser le ratio de l'overlay.
//
// Retour : { objectUrl, width, height, revoke }
//   - objectUrl : URL utilisable par une image source MapLibre
//   - width/height : dimensions naturelles (pour le ratio d'init)
//   - revoke : true si objectUrl est un blob: à révoquer (URL.revokeObjectURL)
// ════════════════════════════════════════════════════════════════════════════

const PDF_TARGET_WIDTH = 2400 // px — assez net pour zoomer sans pixeliser

let pdfjsLibPromise = null
async function getPdfJs() {
  if (pdfjsLibPromise) return pdfjsLibPromise
  pdfjsLibPromise = (async () => {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return pdfjs
  })()
  return pdfjsLibPromise
}

export async function loadPlanRaster({ url, fileType }) {
  if (!url) throw new Error('loadPlanRaster : url requise')
  if (fileType === 'png' || fileType === 'jpg') {
    const { width, height } = await imageDims(url)
    return { objectUrl: url, width, height, revoke: false }
  }
  if (fileType === 'pdf') {
    return await rasterizePdf(url)
  }
  throw new Error(`loadPlanRaster : type non supporté (${fileType})`)
}

async function rasterizePdf(url) {
  const pdfjs = await getPdfJs()
  const pdf = await pdfjs.getDocument({ url }).promise
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(Math.max(PDF_TARGET_WIDTH / base.width, 1), 4)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    return {
      objectUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
      revoke: true,
    }
  } finally {
    if (typeof pdf?.destroy === 'function') {
      try { pdf.destroy() } catch { /* noop */ }
    }
  }
}

function imageDims(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = url
  })
}
