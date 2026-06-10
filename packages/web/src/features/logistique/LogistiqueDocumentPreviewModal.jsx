// ════════════════════════════════════════════════════════════════════════════
// LogistiqueDocumentPreviewModal — Aperçu inline d'un doc avant téléchargement
// ════════════════════════════════════════════════════════════════════════════
//
// Modal plein écran qui affiche :
//   - PDF  : iframe (visualisation native navigateur)
//   - PNG / JPG : <img> centré
//   - Boutons header : Télécharger + Fermer
//
// Pattern volontairement plus light que PlanViewer (qui gère pinch-zoom,
// multi-pages, versions historiques) — la logistique a des docs simples
// (billets, confirmations) qui ne justifient pas cette complexité en V0.
//
// Utilisation côté admin ET côté share : la signed URL est passée en prop,
// le composant ne sait pas dans quel mode il est utilisé.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, FileText, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react'
import {
  getDocumentSignedUrl,
  getDocumentDownloadUrl,
  previewKind,
  formatBytes,
} from '../../lib/logistiqueV0'
import { notify } from '../../lib/notify'

export default function LogistiqueDocumentPreviewModal({ doc, onClose }) {
  const [signedUrl, setSignedUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const kind = doc ? previewKind(doc) : null

  // Charge la signed URL au mount
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getDocumentSignedUrl(doc.storage_path)
      .then((url) => {
        if (!cancelled) setSignedUrl(url)
      })
      .catch((err) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [doc])

  // Esc pour fermer
  useEffect(() => {
    if (!doc) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, onClose])

  if (!doc) return null

  async function handleDownload() {
    try {
      const url = await getDocumentDownloadUrl(doc.storage_path, {
        filename: doc.filename,
      })
      if (url) {
        const a = document.createElement('a')
        a.href = url
        a.download = doc.filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (err) {
      notify.error(err.message || 'Téléchargement impossible')
    }
  }

  const FileIcon = kind === 'image' ? ImageIcon : FileText

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col share-fade-in"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{
          background: 'var(--bg-surf)',
          borderBottom: '1px solid var(--brd)',
        }}
      >
        <FileIcon className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-medium truncate"
            style={{ color: 'var(--txt)' }}
            title={doc.filename}
          >
            {doc.filename}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {formatBytes(doc.size_bytes)}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
          style={{
            background: 'var(--accent)',
            color: '#fff',
          }}
          title="Télécharger"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Télécharger</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: 'var(--txt-3)' }}
          title="Fermer (Esc)"
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

      {/* Body */}
      <div
        className="flex-1 flex items-center justify-center overflow-auto p-4"
        onClick={(e) => {
          // Click on body wrapper (not the content itself) fermer
          if (e.target === e.currentTarget) onClose()
        }}
      >
        {loading && (
          <Loader2
            className="w-8 h-8 animate-spin"
            style={{ color: 'var(--txt-3)' }}
          />
        )}
        {error && !loading && (
          <div className="text-center max-w-md">
            <AlertCircle
              className="w-8 h-8 mx-auto mb-2"
              style={{ color: 'var(--red)' }}
            />
            <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
              {error.message || 'Impossible de charger le document'}
            </p>
          </div>
        )}
        {!loading && !error && signedUrl && kind === 'pdf' && (
          <iframe
            src={signedUrl}
            title={doc.filename}
            className="w-full h-full rounded-md"
            style={{
              background: '#fff',
              border: '1px solid var(--brd)',
              maxWidth: 1100,
            }}
          />
        )}
        {!loading && !error && signedUrl && kind === 'image' && (
          <img
            src={signedUrl}
            alt={doc.filename}
            className="max-w-full max-h-full rounded-md object-contain"
            style={{ border: '1px solid var(--brd)' }}
          />
        )}
        {!loading && !error && !kind && (
          <div className="text-center max-w-md">
            <FileText
              className="w-8 h-8 mx-auto mb-2"
              style={{ color: 'var(--txt-3)' }}
            />
            <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
              Aperçu non disponible pour ce format. Téléchargez le fichier pour
              l&apos;ouvrir.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
