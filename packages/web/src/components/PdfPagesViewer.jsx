// ════════════════════════════════════════════════════════════════════════════
// PdfPagesViewer — rendu d'un PDF en pages empilées (canvas pdf.js)
// ════════════════════════════════════════════════════════════════════════════
//
// Remplace l'<iframe> PDF sur les pages publiques : sur iOS Safari l'iframe
// n'affiche que la première page sans défilement. Ici chaque page est rendue
// dans un <canvas> à la largeur du conteneur (x devicePixelRatio, plafonné),
// empilées verticalement → défilement naturel partout, y compris mobile.
//
// pdfjs-dist est chargé en lazy import (même pattern que planRaster /
// plansThumbnail : le worker part dans un chunk séparé déjà présent au build).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'

let pdfjsLibPromise = null
function getPdfJs() {
  if (pdfjsLibPromise) return pdfjsLibPromise
  pdfjsLibPromise = (async () => {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return pdfjs
  })()
  return pdfjsLibPromise
}

export default function PdfPagesViewer({ url, maxHeight = null }) {
  const containerRef = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | error

  useEffect(() => {
    if (!url) return undefined
    let cancelled = false
    let pdfDoc = null

    async function render() {
      try {
        setStatus('loading')
        const pdfjs = await getPdfJs()
        pdfDoc = await pdfjs.getDocument({ url }).promise
        if (cancelled) return
        const container = containerRef.current
        if (!container) return
        container.innerHTML = ''

        const width = container.clientWidth || 800
        // Netteté : rend à la résolution écran, plafonné à 2x pour la mémoire.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        for (let i = 1; i <= pdfDoc.numPages; i += 1) {
          const page = await pdfDoc.getPage(i)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const scale = (width / base.width) * dpr
          const viewport = page.getViewport({ scale })

          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.width = '100%'
          canvas.style.display = 'block'
          canvas.style.background = '#fff'
          if (i > 1) canvas.style.marginTop = '10px'
          canvas.style.borderRadius = '4px'
          canvas.style.boxShadow = '0 2px 12px rgba(0,0,0,0.35)'
          container.appendChild(canvas)

          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        }
        if (!cancelled) setStatus('ready')
      } catch (err) {
        console.error('[PdfPagesViewer]', err)
        if (!cancelled) setStatus('error')
      }
    }

    render()
    return () => {
      cancelled = true
      if (pdfDoc) pdfDoc.destroy().catch(() => {})
    }
  }, [url])

  return (
    <div
      style={{
        maxHeight: maxHeight || undefined,
        overflowY: maxHeight ? 'auto' : undefined,
        WebkitOverflowScrolling: 'touch',
        padding: '12px',
      }}
    >
      {status === 'loading' && (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {status === 'error' && (
        <p className="text-center text-sm py-10" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Impossible d&apos;afficher le document ici. Utilisez le bouton Télécharger.
        </p>
      )}
      <div ref={containerRef} />
    </div>
  )
}
