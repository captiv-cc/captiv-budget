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
// PDF multi-pages : pagination explicite (pattern Adobe Reader / Preview macOS).
// Une seule page rendue à la fois en plein écran, dans son propre
// TransformWrapper (pinch-zoom indépendant). Footer flottant [‹ N/M ›] +
// raccourcis ← / → au clavier. Ce pattern évite que le TransformWrapper
// intercepte le scroll/touch et empêche le défilement entre pages.
//
// Téléchargement : bouton qui ouvre la signed URL dans un nouvel onglet
// (laisse le navigateur gérer le download natif).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Maximize,
  Minus,
  Plus,
  X,
} from 'lucide-react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { getSignedUrl, getPlan } from '../../lib/plans'
import { notify } from '../../lib/notify'

/**
 * Deux modes de fonctionnement :
 *
 *   - **Mode auth** (PlansTab admin) : on passe `planId` et le viewer fetch
 *     le plan + génère la signed URL via getPlan/getSignedUrl. Nécessite
 *     une session authentifiée (RLS).
 *
 *   - **Mode preloaded** (page share publique /share/plans/:token) : on
 *     passe directement `plan` (objet déjà résolu via le payload de la
 *     RPC share_plans_fetch) et `signedUrl` (déjà généré côté lib en
 *     mode anon). Le viewer skip le fetch et affiche immédiatement.
 *
 * @param {object}   props
 * @param {string|null} props.planId    — id du plan, null = fermé
 * @param {object|null} [props.plan]    — plan préchargé (mode share). Si
 *                                       fourni, skip getPlan().
 * @param {string|null} [props.signedUrl] — signed URL préchargée (mode
 *                                         share). Si fourni, skip
 *                                         getSignedUrl().
 * @param {() => void}  props.onClose
 */
export default function PlanViewer({
  planId,
  plan: planFromProps = null,
  signedUrl: signedUrlFromProps = null,
  onClose,
}) {
  const preloaded = Boolean(planFromProps && signedUrlFromProps)
  const [planFromFetch, setPlanFromFetch] = useState(null)
  const [signedUrlFromFetch, setSignedUrlFromFetch] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [chromeVisible, setChromeVisible] = useState(true)

  // Source effective : si preloaded, on prend les props ; sinon le fetch.
  const plan = preloaded ? planFromProps : planFromFetch
  const signedUrl = preloaded ? signedUrlFromProps : signedUrlFromFetch

  // Charge le plan + génère la signed URL à chaque ouverture (mode auth
  // uniquement — en mode preloaded on les a déjà via les props).
  useEffect(() => {
    if (!planId) {
      setPlanFromFetch(null)
      setSignedUrlFromFetch(null)
      setError(null)
      return
    }
    setChromeVisible(true)
    if (preloaded) {
      // Mode preloaded : rien à fetch, juste reset l'erreur.
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.resolve()
      .then(async () => {
        const p = await getPlan(planId)
        if (cancelled) return
        setPlanFromFetch(p)
        const url = await getSignedUrl(p.storage_path)
        if (cancelled) return
        setSignedUrlFromFetch(url)
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
  }, [planId, preloaded])

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
            <PdfPagesViewer signedUrl={signedUrl} chromeVisible={chromeVisible} />
          ) : (
            <ImageViewer src={signedUrl} alt={plan.name} chromeVisible={chromeVisible} />
          )}</>
        )}
      </div>
    </div>
  )
}

/* ─── Image (PNG/JPG) — pinch-zoom + pan via react-zoom-pan-pinch ─────── */

function ImageViewer({ src, alt, chromeVisible }) {
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
              visible={chromeVisible}
            />
          </>
        )}
      </TransformWrapper>
    </div>
  )
}

/* ─── PDF — pagination explicite (1 page à la fois + boutons nav) ──────── */

function PdfPagesViewer({ signedUrl, chromeVisible }) {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [renderError, setRenderError] = useState(null)
  const [currentIdx, setCurrentIdx] = useState(0)
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
        // targetWidth = largeur cible du rendu logique (avant scale hi-dpi).
        // On cap à 2400px pour permettre au rendu d'être net même au zoom
        // max ×6 sans trop exploser la mémoire (PDF rendu à environ
        // 2400 × renderScaleFactor pixels sur le canvas source).
        const containerWidth = containerRef.current?.clientWidth || 800
        const targetWidth = Math.min(containerWidth - 16, 2400)
        const dataUrls = []

        // Échelle de rendu : on prend en compte le device pixel ratio
        // pour rester net même sur écrans Retina / Pro Motion. Multiplié
        // par 2 supplémentaires pour anticiper le zoom utilisateur (max
        // ×6 dans le viewer). Cap à ×6 absolu pour ne pas exploser la
        // mémoire sur PDF déjà très grands.
        const dpr = window.devicePixelRatio || 1
        const renderScaleFactor = Math.min(Math.max(dpr * 2, 3), 6)

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          if (cancelled) return
          const page = await pdfDoc.getPage(pageNum)
          const baseViewport = page.getViewport({ scale: 1 })
          const scale = (targetWidth / baseViewport.width) * renderScaleFactor
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

  // Clamp currentIdx si pages disparaît (cas reload ou erreur).
  const safeIdx = Math.max(0, Math.min(currentIdx, pages.length - 1))
  const currentPage = pages[safeIdx]
  const totalPages = pages.length

  // Navigation clavier ← / → entre pages (desktop uniquement, mais pas
  // de check device — flèches sur mobile = pas de clavier physique de
  // toute façon).
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'ArrowLeft' && safeIdx > 0) {
        setCurrentIdx(safeIdx - 1)
      } else if (e.key === 'ArrowRight' && safeIdx < totalPages - 1) {
        setCurrentIdx(safeIdx + 1)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [safeIdx, totalPages])

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Page courante (full-screen). key={num} pour forcer remount + reset
          zoom à chaque changement de page (sinon le TransformWrapper garde
          le scale précédent, qui peut désorienter). */}
      {currentPage && (
        <PdfPage
          key={currentPage.num}
          dataUrl={currentPage.dataUrl}
          pageNum={currentPage.num}
          chromeVisible={chromeVisible}
        />
      )}

      {/* Loading overlay tant qu'aucune page n'est encore prête */}
      {loading && pages.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Loader2
            className="w-8 h-8 animate-spin"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          />
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Chargement du PDF…
          </p>
        </div>
      )}

      {renderError && pages.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <FileText className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.4)' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Impossible d&apos;afficher ce PDF
          </p>
        </div>
      )}

      {/* Footer pagination — visible si > 1 page. Floating en bas-center.
          Suit le mode immersif (cf. chromeVisible) : tap = cache toute l'UI,
          précieux en paysage mobile où l'espace vertical est compté. */}
      {totalPages > 1 && (
        <PageNav
          current={safeIdx + 1}
          total={totalPages}
          onPrev={() => setCurrentIdx(Math.max(0, safeIdx - 1))}
          onNext={() => setCurrentIdx(Math.min(totalPages - 1, safeIdx + 1))}
          visible={chromeVisible}
        />
      )}
    </div>
  )
}

/* ─── PageNav — footer flottant [‹] [N/M] [›] pour PDF multi-pages ──── */

function PageNav({ current, total, onPrev, onNext, visible = true }) {
  const atFirst = current <= 1
  const atLast = current >= total
  // Stop propagation pour ne pas trigger le toggle "mode immersif" du
  // PlanViewer parent quand l'user clique dans la zone des boutons.
  function stop(e) {
    e.stopPropagation()
  }
  return (
    <div
      onClick={stop}
      className="absolute left-1/2 bottom-2 z-10 flex items-center gap-0.5 rounded-full px-1 py-0.5 -translate-x-1/2 transition-opacity duration-200"
      style={{
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <NavBtn
        onClick={onPrev}
        disabled={atFirst}
        icon={ChevronLeft}
        title="Page précédente (←)"
      />
      <span
        className="text-[11px] font-semibold tabular-nums px-1.5 select-none"
        style={{ color: 'white', minWidth: 44, textAlign: 'center' }}
      >
        {current} / {total}
      </span>
      <NavBtn
        onClick={onNext}
        disabled={atLast}
        icon={ChevronRight}
        title="Page suivante (→)"
      />
    </div>
  )
}

function NavBtn({ onClick, disabled, icon: Icon, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 flex items-center justify-center rounded-full transition-colors"
      style={{
        color: 'white',
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
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

function PdfPage({ dataUrl, pageNum, chromeVisible }) {
  // Sizing : pattern "lecteur image classique" (Apple Photos, Adobe Reader
  // mobile). Chaque page = plein écran (100% de la zone de contenu, qui
  // remplit elle-même 100vh puisque le header est position:absolute et ne
  // consomme pas d'espace dans le layout). L'image flotte en object-contain
  // au centre. Au zoom, le wrapper laisse librement déborder dans tout
  // l'espace écran — pas de "box" qui borne l'image (cf. retour Hugo).
  //
  // Pas de fond blanc sur le wrapper : le fond noir #0a0a0a du parent
  // PlanViewer ressort autour de l'image PDF (qui est déjà blanche dans
  // le rendu canvas). Effet "lightbox" immersif. Le header flotte par-dessus
  // avec son gradient transparent quand visible.
  //
  // L'indicateur de page (N/M) est centralisé dans <PageNav>, pas de badge
  // ici — pour ne pas dupliquer l'info.
  return (
    <div className="relative w-full h-full">
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
                src={dataUrl}
                alt={`Page ${pageNum}`}
                className="block select-none"
                draggable={false}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                }}
              />
            </TransformComponent>
            <ZoomControls
              onZoomIn={() => zoomIn()}
              onZoomOut={() => zoomOut()}
              onReset={() => resetTransform()}
              visible={chromeVisible}
            />
          </>
        )}
      </TransformWrapper>
    </div>
  )
}

/* ─── ZoomControls — barre flottante [+] [-] [Reset] en bas-left ───────── */

function ZoomControls({ onZoomIn, onZoomOut, onReset, visible = true }) {
  // Boutons stop-propagation pour ne pas déclencher le toggle "mode immersif"
  // du parent (clic sur la zone de contenu = cache header). Le user veut
  // zoomer, pas cacher l'UI.
  function stop(e) {
    e.stopPropagation()
  }

  return (
    <div
      onClick={stop}
      className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md p-1 transition-opacity duration-200"
      style={{
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
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
