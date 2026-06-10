// ════════════════════════════════════════════════════════════════════════════
// AttachmentPreviewModal — prévisualisation inline d'un doc loueur (MAT-10J)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche un attachment (PDF, image, ou fallback) dans une modale plein-écran
// avec un bouton "Télécharger" séparé. Utilisée à la fois :
//   - côté admin dans `LoueurDocsPanel`
//   - côté terrain anonyme dans `CheckDocsViewer` (/check/:token)
//
// Comportement par format :
//   - PDF    → <iframe> (viewer natif du navigateur : zoom, search, print)
//   - Image  → <img> centré, scroll si plus grand que le viewport
//   - Autre  → écran d'info "format non prévisualisable" + bouton Télécharger
//
// On génère deux signed URLs :
//   - `url`         : sans disposition → inline preview
//   - `downloadUrl` : avec Content-Disposition: attachment → force le DL
// Les deux sont valides 1h, régénérées à chaque ouverture de la modale.
//
// Inspiré de `PdfPreviewModal` (export flow), mais conçu pour n'importe quel
// type de pièce jointe — on ne peut pas réutiliser directement PdfPreviewModal
// car celui-ci travaille sur un Blob URL local (résultat d'un export), alors
// qu'ici on bosse avec une signed URL Supabase et on peut afficher autre chose
// qu'un PDF.
//
// Props :
//   - open           : boolean
//   - onClose        : () => void
//   - attachment     : { id, title, filename, storage_path, mime_type, size_bytes }
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Download, Loader2, X } from 'lucide-react'
import {
  displayLabel,
  formatBytes,
  getAttachmentDownloadUrl,
  getAttachmentUrl,
  previewKind,
} from '../../../lib/matosAttachments'

export default function AttachmentPreviewModal({ open, onClose, attachment }) {
  const [url, setUrl] = useState(null)
  const [downloadUrl, setDownloadUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Suivi d'une demande en cours pour ignorer les résultats obsolètes si
  // l'utilisateur ferme et rouvre vite la modale (ou switche d'attachment).
  const requestIdRef = useRef(0)

  // ─── Chargement des URLs à l'ouverture ────────────────────────────────────
  useEffect(() => {
    if (!open || !attachment?.storage_path) {
      setUrl(null)
      setDownloadUrl(null)
      setError(null)
      return undefined
    }

    const reqId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    setUrl(null)
    setDownloadUrl(null)

    ;(async () => {
      try {
        const [u, d] = await Promise.all([
          getAttachmentUrl(attachment.storage_path),
          getAttachmentDownloadUrl(attachment.storage_path, {
            filename: attachment.filename || null,
          }),
        ])
        if (reqId !== requestIdRef.current) return
        setUrl(u)
        setDownloadUrl(d)
      } catch (err) {
        if (reqId !== requestIdRef.current) return
        setError(err?.message || String(err))
      } finally {
        if (reqId === requestIdRef.current) setLoading(false)
      }
    })()

    return () => {
      // La prochaine ouverture incrémentera reqId → les réponses en vol seront
      // ignorées. Pas besoin d'AbortController ici.
    }
  }, [open, attachment?.storage_path, attachment?.filename])

  // ─── Escape pour fermer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !attachment) return null

  const kind = previewKind(attachment)
  const label = displayLabel(attachment)
  const subtitle = [
    attachment.filename && attachment.filename !== label ? attachment.filename : null,
    formatBytes(attachment.size_bytes),
  ]
    .filter(Boolean)
    .join(' · ')

  // Bouton Télécharger : si on a la signed URL "download", on utilise <a download>
  // pour déclencher le DL (natif, aucun JS à écrire). Sinon on désactive.
  const canDownload = Boolean(downloadUrl)

  const modal = (
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
          background: 'var(--bg-base, var(--bg))',
          border: '1px solid var(--brd)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
        role="dialog"
        aria-label={label}
        aria-modal="true"
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub, var(--brd))' }}
        >
          <div className="min-w-0 flex-1">
            <h2
              className="text-sm font-bold truncate"
              style={{ color: 'var(--txt)' }}
              title={label}
            >
              {label}
            </h2>
            {subtitle && (
              <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
                {subtitle}
              </p>
            )}
          </div>

          {canDownload ? (
            <a
              href={downloadUrl}
              download={attachment.filename || label}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md"
              style={{
                background: 'var(--blue)',
                color: 'white',
                border: '1px solid var(--blue)',
                textDecoration: 'none',
              }}
              title="Télécharger le fichier"
            >
              <Download className="w-3.5 h-3.5" />
              Télécharger
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md opacity-50 cursor-not-allowed"
              style={{
                background: 'var(--blue)',
                color: 'white',
                border: '1px solid var(--blue)',
              }}
              title="Téléchargement indisponible"
            >
              <Download className="w-3.5 h-3.5" />
              Télécharger
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer (Échap)"
            className="p-1.5 rounded-md"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Viewer */}
        <div
          className="flex-1 min-h-0 overflow-auto"
          style={{ background: 'var(--bg-surf)' }}
        >
          {loading && <CenteredLoader />}
          {!loading && error && <ErrorState message={error} />}
          {!loading && !error && url && (
            <>
              {kind === 'pdf' && (
                <iframe
                  src={url}
                  title={label}
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 0,
                    display: 'block',
                  }}
                />
              )}
              {kind === 'image' && (
                <div className="w-full h-full flex items-center justify-center p-4">
                  <img
                    src={url}
                    alt={label}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      display: 'block',
                    }}
                  />
                </div>
              )}
              {!kind && (
                <UnpreviewableState attachment={attachment} downloadUrl={downloadUrl} />
              )}
            </>
          )}
        </div>
      </div>
    </>
  )

  // Portal dans le body pour échapper à tous les contextes d'empilement /
  // overflow-hidden parents (notamment la section LoueurDocsPanel).
  return createPortal(modal, document.body)
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function CenteredLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--blue)' }} />
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-10 gap-3 text-center">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--red-bg, rgba(239,68,68,0.1))' }}
      >
        <AlertCircle className="w-6 h-6" style={{ color: 'var(--red, #ef4444)' }} />
      </div>
      <h3 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
        Impossible de charger ce document
      </h3>
      <p className="text-sm max-w-md" style={{ color: 'var(--txt-3)' }}>
        {message || 'Une erreur est survenue.'}
      </p>
    </div>
  )
}

function UnpreviewableState({ attachment, downloadUrl }) {
  const label = displayLabel(attachment)
  return (
    <div className="flex flex-col items-center justify-center h-full p-10 gap-3 text-center">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--blue-bg)' }}
      >
        <Download className="w-6 h-6" style={{ color: 'var(--blue)' }} />
      </div>
      <h3 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
        Aperçu indisponible
      </h3>
      <p className="text-sm max-w-md" style={{ color: 'var(--txt-3)' }}>
        Ce format ne peut pas être prévisualisé dans le navigateur. Clique sur{' '}
        <span style={{ color: 'var(--txt-2)' }}>Télécharger</span> pour
        l&apos;ouvrir depuis ton appareil.
      </p>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={attachment.filename || label}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md mt-2"
          style={{
            background: 'var(--blue)',
            color: 'white',
            textDecoration: 'none',
          }}
        >
          <Download className="w-3.5 h-3.5" />
          Télécharger {attachment.filename || label}
        </a>
      )}
    </div>
  )
}
