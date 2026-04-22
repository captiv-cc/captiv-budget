// ════════════════════════════════════════════════════════════════════════════
// PdfPreviewModal — modale de prévisualisation d'un PDF généré
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche un PDF (via son Blob URL) dans une iframe plein écran, avec un
// header d'actions minimal : titre + bouton Télécharger + bouton Fermer.
//
// Le viewer PDF natif du navigateur (Chrome PDFium / Firefox pdf.js / Safari
// Preview) s'occupe du zoom, du scroll, de la recherche, de l'impression.
//
// Props :
//   - open : boolean
//   - onClose : handler (révoque aussi l'URL Blob côté parent)
//   - title : string (ex. "Liste globale")
//   - url : string (le blob URL renvoyé par les exports)
//   - filename : string (nom du fichier à télécharger)
//   - onDownload : () => void — appelé par le bouton Télécharger.
//                  Le parent fait exporter.download() puis close si besoin.
//   - isZip : boolean — si true, pas d'iframe (ZIP non prévisualisable),
//             juste un message + bouton Télécharger.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect } from 'react'
import { Download, FileArchive, X } from 'lucide-react'

export default function PdfPreviewModal({
  open,
  onClose,
  title = 'Prévisualisation PDF',
  url = null,
  filename = 'document.pdf',
  onDownload,
  isZip = false,
}) {
  // Escape pour fermer
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Container */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden rounded-xl"
        style={{
          top: '4vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(1100px, 94vw)',
          height: '92vh',
          background: 'var(--bg-base)',
          border: '1px solid var(--brd)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
        role="dialog"
        aria-label={title}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div className="min-w-0 flex-1">
            <h2
              className="text-sm font-bold truncate"
              style={{ color: 'var(--txt)' }}
              title={title}
            >
              {title}
            </h2>
            <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
              {filename}
            </p>
          </div>

          <button
            type="button"
            onClick={onDownload}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all"
            style={{
              background: 'var(--blue)',
              color: 'white',
              border: '1px solid var(--blue)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            title="Télécharger le fichier"
          >
            <Download className="w-3.5 h-3.5" />
            Télécharger
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer (Échap)"
            className="p-1.5 rounded-md transition-all"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Viewer */}
        <div
          className="flex-1 min-h-0"
          style={{ background: 'var(--bg-surf)' }}
        >
          {isZip ? (
            <ZipInfo filename={filename} />
          ) : url ? (
            <iframe
              src={url}
              title={title}
              style={{
                width: '100%',
                height: '100%',
                border: 0,
                display: 'block',
              }}
            />
          ) : (
            <div
              className="flex items-center justify-center h-full"
              style={{ color: 'var(--txt-3)' }}
            >
              <div
                className="w-6 h-6 border-2 rounded-full animate-spin"
                style={{
                  borderColor: 'var(--blue)',
                  borderTopColor: 'transparent',
                }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// Fallback pour les ZIP : pas d'aperçu possible, juste un visuel + téléchargement
function ZipInfo({ filename }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-10 gap-3">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--blue-bg)' }}
      >
        <FileArchive className="w-6 h-6" style={{ color: 'var(--blue)' }} />
      </div>
      <h3 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
        Archive ZIP prête
      </h3>
      <p
        className="text-sm text-center max-w-md"
        style={{ color: 'var(--txt-3)' }}
      >
        Les archives ZIP ne peuvent pas être prévisualisées dans le navigateur.
        Clique sur <span style={{ color: 'var(--txt-2)' }}>Télécharger</span>{' '}
        pour récupérer <span style={{ color: 'var(--txt-2)' }}>{filename}</span>.
      </p>
    </div>
  )
}
