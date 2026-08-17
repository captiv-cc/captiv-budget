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
import { createPortal } from 'react-dom'
import {
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { getLogistiqueDocUrl, renameLogistiqueDoc } from '../../lib/logistique'
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
 * Libellé affiché pour un document. Un nom de fichier brut
 * (« HM-ALLER-MONTPELLIER_GARE-DE-LYON.pdf ») est illisible une fois tronqué
 * dans une chip, donc :
 *   1. le libellé saisi côté desk (colonne `label`) ;
 *   2. sinon un libellé déduit du contexte (« Billet aller », « Réservation »)
 *      — seulement quand le parent ne porte qu'UN document, sinon on ne
 *      saurait plus les distinguer ;
 *   3. sinon le nom de fichier sans extension.
 *
 * @param {object} doc
 * @param {{ sens?: string, count?: number }} [ctx] sens du trajet parent,
 *        nombre de documents sur ce parent.
 */
export function docLabel(doc, ctx = {}) {
  if (doc?.label) return doc.label
  const alone = (ctx.count ?? 1) <= 1
  if (alone) {
    if (doc?.parent_type === 'trajet') {
      if (ctx.sens === 'aller') return 'Billet aller'
      if (ctx.sens === 'retour') return 'Billet retour'
      return 'Billet'
    }
    if (doc?.parent_type === 'hebergement') return 'Réservation'
  }
  const name = doc?.filename || 'Document'
  return name.replace(/\.[^.]+$/, '')
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

  // Portal sur <body> : les pages share animent leurs conteneurs avec un
  // transform persistant (share-fade-in `both`), qui ferait référencer le
  // `fixed` au conteneur au lieu du viewport — l'aperçu partirait en haut
  // de page au lieu de suivre le scroll.
  return createPortal(
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
    </div>,
    document.body,
  )
}

/* ─── Ligne document éditable (modales desk) ────────────────────────────── */

/**
 * Une ligne de document dans les modales internes : aperçu, renommage
 * inline, téléchargement, suppression. Le renommage écrit `label` et
 * remonte la row à jour via onRenamed pour que l'appelant rafraîchisse.
 */
export function DocRow({ doc, sens = null, count = 1, onPreview, onDownload, onDelete, onRenamed }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const DocIcon = docIsImage(doc) ? ImageIcon : FileText

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const updated = await renameLogistiqueDoc(doc.id, draft)
      onRenamed?.(updated)
      setEditing(false)
    } catch (err) {
      notify.error('Renommage : ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-1.5"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      <DocIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
      {editing ? (
        <input
          type="text"
          value={draft}
          autoFocus
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={save}
          placeholder={docLabel(doc, { sens, count })}
          className="flex-1 min-w-0 text-xs px-2 py-1 rounded-md outline-none"
          style={{ background: 'var(--bg)', border: '1px solid var(--blue)', color: 'var(--txt)' }}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => onPreview?.(doc)}
            className="text-xs truncate text-left hover:underline"
            style={{ color: 'var(--txt)', textUnderlineOffset: '2px' }}
            title={doc.filename}
          >
            {docLabel(doc, { sens, count })}
          </button>
          {doc.size_bytes && (
            <span className="text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>
              {(doc.size_bytes / 1024).toFixed(0)} Ko
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setDraft(doc.label || '')
              setEditing(true)
            }}
            className="ml-auto p-1 shrink-0"
            style={{ color: 'var(--txt-3)' }}
            title="Renommer (le nom du fichier reste inchangé)"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => onDownload?.(doc)}
            className="p-1 shrink-0"
            style={{ color: 'var(--txt-3)' }}
            title="Télécharger"
          >
            <Download className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => onDelete?.(doc)}
            className="p-1 shrink-0"
            style={{ color: 'var(--red, #ef4444)' }}
            title="Supprimer le document"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}
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
