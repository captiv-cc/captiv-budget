// ════════════════════════════════════════════════════════════════════════════
// PlanViewer — Modale plein écran pour consulter un plan (image ou PDF)
// ════════════════════════════════════════════════════════════════════════════
//
// État via URL search param `?plan=<id>` (cf. PlansTab) — la modale est
// dans l'arbre React (pas une route), mais l'état est dans l'URL pour que :
//   - le bouton back natif ferme la modale (mobile + desktop)
//   - l'URL soit partageable (collègue ouvre le lien direct sur le plan)
//   - le swipe-back iOS ferme la modale
//
// Mobile-first : pinch-zoom + pan natif (via react-zoom-pan-pinch),
// double-tap pour fit/100 %, mode immersif (header se cache au tap).
//
// PDF multi-pages : toutes les pages rendues en stack vertical scrollable.
// Chaque page est dans son propre TransformWrapper indépendant pour pouvoir
// zoomer page par page sans interférer avec le scroll global. Les plans
// techniques font typiquement 1-5 pages, pas de pagination explicite.
//
// Téléchargement : bouton qui ouvre la signed URL dans un nouvel onglet
// (laisse le navigateur gérer le download natif).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Loader2, Maximize, Minus, Plus, X } from 'lucide-react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { getSignedUrl, getPlan } from '../../lib/plans'
import { notify } from '../../lib/notify'

/**
 * @param {object}   props
 * @param {string|null} props.planId  — id du plan à afficher, null = fermé
 * @param {() => void}  props.onClose
 */
export default function PlanViewer({ planId, onClose }) {
  const [plan, setPlan] = useState(null)
  const [signedUrl, setSignedUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [chromeVisible, setChromeVisible] = useState(true)

  // Charge le plan + génère la signed URL à chaque ouverture.
  useEffect(() => {
    if (!planId) {
      setPlan(null)
      setSignedUrl(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setChromeVisible(true)
    Promise.resolve()
      .then(async () => {
        const p = await getPlan(planId)
        if (cancelled) return
        setPlan(p)
        const url = await getSignedUrl(p.storage_path)
        if (cancelled) return
        setSignedUrl(url)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[PlanViewer] load error', err)
        setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [planId])

  // ESC ferme la modale + lock body scroll quand ouverte.
  useEffect(() => {
    if (!planId) return undefined
    function handleKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prevOverflow
    }
  }, [planId, onClose])

  if (!planId) return null

  const isPdf = plan?.file_type === 'pdf'

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: '#0a0a0a' }}
    >
      {/* Header — chrome flottant en haut, se cache au tap (mode immersif) */}
      <header
        className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-3 transition-opacity duration-200"
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.85), rgba(0,0,0,0))',
          opacity: chromeVisible ? 1 : 0,
          pointerEvents: chromeVisible ? 'auto' : 'none',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-md"
          style={{ color: 'white', background: 'rgba(255,255,255,0.1)' }}
          title="Fermer (Échap)"
          aria-label="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate" style={{ color: 'white' }}>
            {plan?.name || 'Chargement…'}
          </h2>
          {plan && (
            <p className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {plan.file_type?.toUpperCase()}
              {plan.current_version > 1 && ` · V${plan.current_version}`}
            </p>
          )}
        </div>
        {signedUrl && (
          <a
            href={signedUrl}
            download={plan?.name}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md"
            style={{ color: 'white', background: 'rgba(255,255,255,0.1)' }}
            title="Télécharger / ouvrir dans un nouvel onglet"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Télécharger</span>
          </a>
        )}
      </header>

      {/* Zone de contenu — clic central toggle chrome (immersif) */}
      <div
        className="flex-1 overflow-auto"
        onClick={() => setChromeVisible((v) => !v)}
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      >
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Loader2
              className="w-8 h-8 animate-spin"
              style={{ color: 'rgba(255,255,255,0.6)' }}
            />
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Chargement…
            </p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
            <p className="text-sm font-semibold" style={{ color: 'white' }}>
              Impossible de charger le plan
            </p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {error.message || String(error)}
            </p>
          </div>
        )}

        {!loading && !error && plan && signedUrl && (
          <>{isPdf ? (
            <PdfPagesViewer signedUrl={signedUrl} />
          ) : (
            <ImageViewer src={signedUrl} alt={plan.name} />
          )}</>
        )}
      </div>
    </div>
  )
}

/* ─── Image (PNG/JPG) — pinch-zoom + pan via react-zoom-pan-pinch ─────── */

function ImageViewer({ src, alt }) {
  return (
    <div className="relative w-full h-full flex items-center justify-center p-4">
      <TransformWrapper
        initialScale={1}
        minScale={0.5}
        maxScale={6}
        doubleClick={{ mode: 'toggle', step: 2 }}
        wheel={{ step: 0.2 }}
        pinch={{ step: 5 }}
        panning={{ velocityDisabled: true }}
        centerOnInit
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={src}
                alt={alt}
                className="max-w-full max-h-full object-contain select-none"
                draggable={false}
              />
            </TransformComponent>
            <ZoomControls
              onZoomIn={() => zoomIn()}
              onZoomOut={() => zoomOut()}
              onReset={() => resetTransform()}
            />
          </>
        )}
      </TransformWrapper>
    </div>
  )
}

/* ─── PDF — pages rendues en stack vertical, chaque page zoomable ──────── */

function PdfPagesViewer({ signedUrl }) {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [renderError, setRenderError] = useState(null)
  const containerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let pdfDoc = null
    setLoading(true)
    setRenderError(null)
    setPages([])

    async function loadPdf() {
      try {
        const pdfjs = await import('pdfjs-dist')
        const workerUrl = (
          await import('pdfjs-dist/build/pdf.worker.mjs?url')
        ).default
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

        const loadingTask = pdfjs.getDocument({ url: signedUrl })
        pdfDoc = await loadingTask.promise
        if (cancelled) return

        const numPages = pdfDoc.numPages
        // Render chaque page sur un canvas → toDataURL pour <img>.
        // Échelle adaptative selon la largeur du container (×2 pour la
        // densité écran / hi-dpi).
        const containerWidth = containerRef.current?.clientWidth || 800
        const targetWidth = Math.min(containerWidth - 32, 1600) // padding
        const dataUrls = []

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          if (cancelled) return
          const page = await pdfDoc.getPage(pageNum)
          const baseViewport = page.getViewport({ scale: 1 })
          const scale = (targetWidth / baseViewport.width) * 2 // ×2 pour hi-dpi
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvasContext: ctx, viewport }).promise
          if (cancelled) return
          dataUrls.push(canvas.toDataURL('image/jpeg', 0.92))
          // Update progressif : on push au fur et à mesure pour un rendu
          // perçu plus rapide sur les PDF lourds.
          setPages((prev) => [...prev, { num: pageNum, dataUrl: dataUrls.at(-1) }])
        }
        if (!cancelled) setLoading(false)
      } catch (err) {
        if (cancelled) return
        console.error('[PlanViewer] PDF render error', err)
        setRenderError(err)
        setLoading(false)
        notify.error('Impossible d\u2019afficher le PDF : ' + (err?.message || err))
      }
    }
    loadPdf()
    return () => {
      cancelled = true
      if (pdfDoc?.destroy) {
        try { pdfDoc.destroy() } catch { /* noop */ }
      }
    }
  }, [signedUrl])

  return (
    <div ref={containerRef} className="w-full pt-12 pb-4 px-4 flex flex-col items-center gap-4">
      {pages.map((page, idx) => (
        <PdfPage
          key={page.num}
          dataUrl={page.dataUrl}
          pageNum={page.num}
          totalPages={pages.length || '?'}
          isFirst={idx === 0}
        />
      ))}
      {loading && (
        <div className="flex flex-col items-center gap-2 py-4">
          <Loader2
            className="w-6 h-6 animate-spin"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          />
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Rendu des pages PDF…
          </p>
        </div>
      )}
      {renderError && pages.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <FileText className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.4)' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Impossible d&apos;afficher ce PDF
          </p>
        </div>
      )}
    </div>
  )
}

function PdfPage({ dataUrl, pageNum, totalPages }) {
  return (
    <div
      className="relative w-full max-w-[1600px] rounded overflow-hidden shadow-lg"
      style={{ background: '#fff' }}
    >
      <TransformWrapper
        initialScale={1}
        minScale={1}
        maxScale={6}
        doubleClick={{ mode: 'toggle', step: 2 }}
        wheel={{ step: 0.2 }}
        pinch={{ step: 5 }}
        panning={{ velocityDisabled: true, disabled: false }}
        centerOnInit
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <TransformComponent
              wrapperStyle={{ width: '100%' }}
              contentStyle={{ width: '100%' }}
            >
              <img
                src={dataUrl}
                alt={`Page ${pageNum}`}
                className="w-full h-auto block select-none"
                draggable={false}
              />
            </TransformComponent>
            <ZoomControls
              onZoomIn={() => zoomIn()}
              onZoomOut={() => zoomOut()}
              onReset={() => resetTransform()}
            />
          </>
        )}
      </TransformWrapper>
      {/* Badge numéro de page bottom-right */}
      <span
        className="absolute bottom-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded"
        style={{
          background: 'rgba(0,0,0,0.6)',
          color: 'white',
          backdropFilter: 'blur(4px)',
        }}
      >
        {pageNum} / {totalPages}
      </span>
    </div>
  )
}

/* ─── ZoomControls — barre flottante [+] [-] [Reset] en bas-left ───────── */

function ZoomControls({ onZoomIn, onZoomOut, onReset }) {
  // Boutons stop-propagation pour ne pas déclencher le toggle "mode immersif"
  // du parent (clic sur la zone de contenu = cache header). Le user veut
  // zoomer, pas cacher l'UI.
  function stop(e) {
    e.stopPropagation()
  }

  return (
    <div
      onClick={stop}
      className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md p-1"
      style={{
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <ZoomBtn onClick={onZoomOut} icon={Minus} title="Dézoomer" />
      <ZoomBtn onClick={onReset} icon={Maximize} title="Ajuster à l'écran" />
      <ZoomBtn onClick={onZoomIn} icon={Plus} title="Zoomer" />
    </div>
  )
}

function ZoomBtn({ onClick, icon: Icon, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded transition-colors"
      style={{ color: 'white' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
      title={title}
      aria-label={title}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}
