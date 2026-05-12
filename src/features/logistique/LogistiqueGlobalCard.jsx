// ════════════════════════════════════════════════════════════════════════════
// LogistiqueGlobalCard — Carte "Infos générales" (bloc Global du projet)
// ════════════════════════════════════════════════════════════════════════════
//
// Carte unique par projet, affichée en HAUT de la tab Logistique (avant la
// liste des cards personnes). Contient :
//   - Header : icône + titre "Infos générales"
//   - Textarea autosave (cas pratique : infos stationnement / contacts régie)
//   - Grille de documents en GRAND format (200x200 environ) — clic pour
//     preview plein écran
//
// Mode readOnly (page share) :
//   - textarea figée (mode lecture)
//   - pas d'uploader, pas de bouton supprimer
//   - thumbnails en grille pleine taille pour bonne visibilité
//
// La card n'est rendue côté SHARE que si le bloc a du contenu (texte ou docs).
// Côté ADMIN, la card est toujours visible pour permettre la saisie initiale.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  Info,
  Upload,
  Loader2,
  FileText,
  Image as ImageIcon,
  Download,
  Trash2,
  Eye,
} from 'lucide-react'
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  formatBytes,
  getDocumentSignedUrl,
  getDocumentDownloadUrl,
  previewKind,
} from '../../lib/logistiqueV0'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'
import LogistiqueDocumentPreviewModal from './LogistiqueDocumentPreviewModal'

const AUTOSAVE_DEBOUNCE_MS = 500
const ACCENT = 'var(--accent)'

export default function LogistiqueGlobalCard({
  text,
  documents = [],
  readOnly = false,
  onUpdateText,
  onUploadDocument,
  onDeleteDocument,
}) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [previewDoc, setPreviewDoc] = useState(null)

  // ─── Textarea autosave ─────────────────────────────────────────────────
  const [localText, setLocalText] = useState(text ?? '')
  const [saveState, setSaveState] = useState('idle')
  const debounceRef = useRef(null)
  const lastSavedRef = useRef(text ?? '')

  useEffect(() => {
    if (text !== lastSavedRef.current) {
      setLocalText(text ?? '')
      lastSavedRef.current = text ?? ''
    }
  }, [text])

  function handleTextChange(e) {
    const value = e.target.value
    setLocalText(value)
    if (readOnly || !onUpdateText) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSaveState('saving')
      try {
        await onUpdateText(value)
        lastSavedRef.current = value
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 1500)
      } catch (err) {
        notify.error(err.message || 'Erreur de sauvegarde')
        setSaveState('idle')
      }
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // ─── Upload ────────────────────────────────────────────────────────────
  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      await onUploadDocument({ file })
      notify.success(`${file.name} ajouté`)
    } catch (err) {
      notify.error(err.message || 'Erreur upload')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteDoc(doc) {
    const ok = await confirm({
      title: 'Supprimer le document',
      message: `Supprimer "${doc.filename}" ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    try {
      await onDeleteDocument(doc.id)
      notify.success('Document supprimé')
    } catch (err) {
      notify.error(err.message || 'Erreur suppression')
    }
  }

  // En mode share, on ne rend rien si le bloc est complètement vide (texte
  // vide + 0 docs) — pas d'intérêt à afficher une card vide au destinataire.
  const isEmpty = !localText && documents.length === 0
  if (readOnly && isEmpty) return null

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--bg-surf)',
        border: `1px solid ${ACCENT}33`,
        // Petite mise en valeur visuelle : bordure accentée + fond légèrement
        // teinté pour bien différencier de la liste des cards personnes en
        // dessous.
        boxShadow: `inset 0 1px 0 ${ACCENT}11`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accent-bg)' }}
        >
          <Info className="w-4 h-4" style={{ color: ACCENT }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className="text-base font-semibold leading-tight"
            style={{ color: 'var(--txt)' }}
          >
            Infos générales
          </h3>
          <p className="text-[11px] leading-tight" style={{ color: 'var(--txt-3)' }}>
            Pour toute l&apos;équipe (stationnement, plans d&apos;accès, contacts régie…)
          </p>
        </div>
        {!readOnly && saveState !== 'idle' && (
          <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {saveState === 'saving' ? 'Enregistrement…' : 'Enregistré ✓'}
          </span>
        )}
      </div>

      {/* Textarea (ou texte figé en share) */}
      {readOnly ? (
        localText ? (
          <div
            className="text-sm whitespace-pre-wrap leading-relaxed"
            style={{ color: 'var(--txt)' }}
          >
            {localText}
          </div>
        ) : null
      ) : (
        <textarea
          value={localText}
          onChange={handleTextChange}
          placeholder="Notes générales (stationnement, accès, contacts régie, etc.)…"
          rows={4}
          className="w-full text-sm rounded-md px-2.5 py-2 resize-y"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd-sub)',
            color: 'var(--txt)',
            fontFamily: 'inherit',
            minHeight: 80,
          }}
        />
      )}

      {/* Grille de documents (thumbnails 200x200) */}
      {documents.length > 0 && (
        <div
          className={`grid gap-3 ${localText || !readOnly ? 'mt-3' : ''}`}
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          }}
        >
          {documents.map((doc) => (
            <GlobalDocumentTile
              key={doc.id}
              doc={doc}
              readOnly={readOnly}
              onPreview={() => setPreviewDoc(doc)}
              onDelete={() => handleDeleteDoc(doc)}
            />
          ))}
        </div>
      )}

      {/* Bouton upload */}
      {!readOnly && (
        <div className="mt-3 flex justify-end items-center gap-2">
          <p
            className="text-[10px] flex-1 truncate"
            style={{ color: 'var(--txt-3)' }}
          >
            Formats : {ACCEPTED_EXTENSIONS.join(', ')} ·{' '}
            {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} Mo max
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors disabled:opacity-50"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
              color: 'var(--txt-2)',
            }}
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Envoi…
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                Ajouter un document
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept={ACCEPTED_MIME_TYPES.join(',')}
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* Modal preview */}
      {previewDoc && (
        <LogistiqueDocumentPreviewModal
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  )
}

// ─── Document tile (grand format ~200x200) ─────────────────────────────────
function GlobalDocumentTile({ doc, readOnly, onPreview, onDelete }) {
  const kind = previewKind(doc)
  const [signedUrl, setSignedUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getDocumentSignedUrl(doc.storage_path)
      .then((url) => {
        if (!cancelled) setSignedUrl(url)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [doc.storage_path])

  async function handleDownload(e) {
    e.stopPropagation()
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

  function handleDelete(e) {
    e.stopPropagation()
    onDelete?.()
  }

  return (
    <div
      className="relative rounded-md overflow-hidden cursor-pointer"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
      }}
      onClick={onPreview}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={doc.filename}
    >
      {/* Zone aperçu ~200x200 */}
      <div
        className="relative w-full"
        style={{ aspectRatio: '1 / 1', overflow: 'hidden' }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--txt-3)' }} />
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <FileText className="w-8 h-8" style={{ color: 'var(--txt-3)' }} />
          </div>
        )}
        {!loading && !error && signedUrl && kind === 'image' && (
          <img
            src={signedUrl}
            alt={doc.filename}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {!loading && !error && signedUrl && kind === 'pdf' && (
          <>
            <iframe
              src={`${signedUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
              title={doc.filename}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ background: '#fff', border: 'none' }}
              tabIndex={-1}
              aria-hidden="true"
            />
            <span className="absolute inset-0" />
          </>
        )}
        {!loading && !error && !kind && (
          <div className="absolute inset-0 flex items-center justify-center">
            <FileText className="w-8 h-8" style={{ color: 'var(--txt-3)' }} />
          </div>
        )}

        {/* Overlay actions au hover (Eye + Download + Delete) */}
        {hover && !loading && (
          <div
            className="absolute inset-0 flex items-center justify-center gap-2"
            style={{ background: 'rgba(0,0,0,0.4)' }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onPreview?.()
              }}
              className="p-2 rounded-full"
              style={{ background: 'rgba(255,255,255,0.95)', color: '#000' }}
              title="Aperçu"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="p-2 rounded-full"
              style={{ background: 'rgba(255,255,255,0.95)', color: '#000' }}
              title="Télécharger"
            >
              <Download className="w-4 h-4" />
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={handleDelete}
                className="p-2 rounded-full"
                style={{ background: 'rgba(220,38,38,0.95)', color: '#fff' }}
                title="Supprimer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Icône type en bas à gauche */}
        <div
          className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
          style={{
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
          }}
        >
          {kind === 'image' ? (
            <ImageIcon className="w-2.5 h-2.5" />
          ) : (
            <FileText className="w-2.5 h-2.5" />
          )}
          {kind === 'image' ? 'IMG' : kind === 'pdf' ? 'PDF' : 'FILE'}
        </div>
      </div>

      {/* Filename + taille */}
      <div className="px-2 py-1.5">
        <div
          className="text-[11px] font-medium truncate"
          style={{ color: 'var(--txt)' }}
        >
          {doc.filename}
        </div>
        <div className="text-[9px]" style={{ color: 'var(--txt-3)' }}>
          {formatBytes(doc.size_bytes)}
        </div>
      </div>
    </div>
  )
}
