// ════════════════════════════════════════════════════════════════════════════
// planMedia — blob (image/PDF) → média affichable dans le canvas tldraw
// ════════════════════════════════════════════════════════════════════════════
//
// Partagé entre l'éditeur desk (plansCanvasFond, download storage authentifié)
// et la page client publique (PlanClientView, URLs signées). Les PDF sont
// rasterisés page 1 via pdfjs-dist (lazy import).
// ════════════════════════════════════════════════════════════════════════════

const PDF_MAX_DIM = 2500

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

/**
 * @param {Blob} blob
 * @param {'image'|'pdf'} kind
 * @returns {Promise<{url: string, w: number, h: number, mime: string}>}
 */
export async function mediaFromBlob(blob, kind) {
  if (kind === 'pdf') {
    const pdfjs = await getPdfJs()
    const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise
    try {
      const page = await pdf.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.max(0.5, Math.min(2, PDF_MAX_DIM / Math.max(base.width, base.height)))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      return { url: URL.createObjectURL(png), w: canvas.width, h: canvas.height, mime: 'image/png' }
    } finally {
      try {
        pdf.destroy()
      } catch {
        /* noop */
      }
    }
  }

  const url = URL.createObjectURL(blob)
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = url
  })
  return { url, w: img.naturalWidth, h: img.naturalHeight, mime: blob.type || 'image/png' }
}
