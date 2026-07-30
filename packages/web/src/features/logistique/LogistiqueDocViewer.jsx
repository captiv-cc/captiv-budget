// ════════════════════════════════════════════════════════════════════════════
// LogistiqueDocViewer — aperçu, téléchargement et drop-zone des documents
// ════════════════════════════════════════════════════════════════════════════
//
// Utilitaires partagés par TrajetModal et HebergementsModal pour les
// documents logistique (billets, résas — PDF/PNG/JPG) :
//   - DocPreviewModal : aperçu plein écran (img pour les images, iframe pour
//     les PDF) via URL signée, avec téléchargement et ouverture en onglet.
//   - downloadDoc : téléchargement direct (blob → <a download>), garde le
//     nom de fichier d'origine.
//   - DocDropZone : wrapper drag & drop — surbrillance au survol, filtre
//     les types acceptés, remonte les fichiers via onFiles(files).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Download, ExternalLink, Loader2, X } from 'lucide-react'
import { getLogistiqueDocUrl } from '../../lib/logistique'
import { notify } from '../../lib/notify'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg']
const ACCEPTED_EXTS = ['pdf', ...IMAGE_EXTS]

function fileExt(name) {
  return (name || '').split('.').pop()?.toLowerCase() || ''
}

export function docIsImage(doc) {
  if (doc?.mime_type?.startsWith('image/')) return true
  return IMAGE_EXTS.includes(fileExt(doc?.filename))
}

/**
 * Télécharge un document en conservant son nom de fichier (une simple
 * ouverture de l'URL signée afficherait le fichier au lieu de le sauver).
 */
export async function downloadDoc(doc) {
  const url = await getLogistiqueDocUrl(doc)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Téléchargement échoué (${res.status})`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = doc.filename || 'document'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

/* ─── Aperçu plein écran ────────────────────────────────────────────────── */

export function DocPreviewModal({ doc, onClose }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!doc) return undefined
    let cancelled = false
    setUrl(null)
    setError(null)
    getLogistiqueDocUrl(doc)
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch((e) => {
        if (!cancelled) setError(e)
      })
    return () => {
      cancelled = true
    }
  }, [doc])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!doc) return null
  const isImage = docIsImage(doc)

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadDoc(doc)
    } catch (err) {
      notify.error('Téléchargement : ' + (err?.message || err))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-8"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-4xl max-h-full flex flex-col rounded-xl overflow-hidden shadow-xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Barre : nom + actions */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <p className="text-sm font-semibold truncate flex-1 min-w-0" style={{ color: 'var(--txt)' }}>
            {doc.filename}
          </p>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md shrink-0"
            style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
            title="Télécharger"
          >
            {downloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Télécharger
          </button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md shrink-0"
              style={{ color: 'var(--txt-3)' }}
              title="Ouvrir dans un nouvel onglet"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md shrink-0"
            style={{ color: 'var(--txt-3)' }}
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contenu */}
        <div
          className="flex-1 min-h-0 flex items-center justify-center overflow-auto"
          style={{ background: 'var(--bg)' }}
        >
          {error ? (
            <p className="text-sm p-8" style={{ color: 'var(--red, #ef4444)' }}>
              Aperçu indisponible : {error.message || String(error)}
            </p>
          ) : !url ? (
            <Loader2 className="w-6 h-6 animate-spin my-16" style={{ color: 'var(--txt-3)' }} />
          ) : isImage ? (
            <img
              src={url}
              alt={doc.filename}
              className="max-w-full object-contain"
              style={{ maxHeight: '78vh' }}
            />
          ) : (
            <iframe
              src={url}
              title={doc.filename}
              className="w-full border-0"
              style={{ height: '78vh' }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Drop-zone ─────────────────────────────────────────────────────────── */

/**
 * Wrapper drag & drop autour d'une section documents. Surligne la zone au
 * survol d'un fichier, filtre sur PDF/PNG/JPG et remonte les fichiers
 * acceptés via onFiles(File[]).
 */
export function DocDropZone({ onFiles, disabled = false, children }) {
  const [over, setOver] = useState(false)

  function handleDrop(e) {
    e.preventDefault()
    setOver(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length === 0) return
    const accepted = files.filter((f) => ACCEPTED_EXTS.includes(fileExt(f.name)))
    const rejected = files.length - accepted.length
    if (rejected > 0) {
      notify.error(
        `${rejected} fichier${rejected > 1 ? 's' : ''} ignoré${rejected > 1 ? 's' : ''} — formats acceptés : PDF, PNG, JPG`,
      )
    }
    if (accepted.length > 0) onFiles?.(accepted)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return
        setOver(false)
      }}
      onDrop={handleDrop}
      className="relative rounded-md transition-colors"
      style={
        over
          ? {
              outline: '2px dashed var(--blue)',
              outlineOffset: '2px',
              background: 'var(--blue-bg)',
            }
          : undefined
      }
    >
      {children}
      {over && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none rounded-md"
          style={{ background: 'var(--blue-bg)' }}
        >
          <span className="text-xs font-semibold" style={{ color: 'var(--blue)' }}>
            Déposer les fichiers ici
          </span>
        </div>
      )}
    </div>
  )
}
