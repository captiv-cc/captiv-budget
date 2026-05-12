// ════════════════════════════════════════════════════════════════════════════
// LogistiqueSubBloc — Sous-bloc transport / hébergement / repas
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche un sous-bloc d'une entry logistique :
//   - Header (titre + icône + compteur docs)
//   - Textarea avec autosave debounced (500ms après dernier tap)
//   - Liste des documents uploadés (avec preview / download / delete)
//   - Bouton "Ajouter un document" qui ouvre l'input file
//
// Mode read-only : pas de textarea éditable, pas d'uploader, pas de delete.
// Utilisé tel quel dans la page share (en réinjectant readOnly=true).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  Plane,
  BedDouble,
  UtensilsCrossed,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Download,
  Trash2,
  Eye,
  Upload,
  Loader2,
} from 'lucide-react'
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  formatBytes,
  getDocumentSignedUrl,
  getDocumentDownloadUrl,
  labelForKind,
  previewKind,
} from '../../lib/logistiqueV0'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

const ICONS_BY_KIND = {
  transport: Plane,
  hebergement: BedDouble,
  repas: UtensilsCrossed,
}

const COLORS_BY_KIND = {
  transport: 'var(--blue)',
  hebergement: 'var(--purple)',
  repas: 'var(--orange)',
}

// Textarea autosave delay — délai après le dernier tap clavier avant push DB.
// 500ms = compromis entre fluidité (pas de re-render toutes les frappes) et
// "feels saved" (le user n'attend pas longtemps après avoir tapé).
const AUTOSAVE_DEBOUNCE_MS = 500

export default function LogistiqueSubBloc({
  kind,
  text,
  documents = [],
  readOnly = false,
  onUpdateText,
  onUploadDocument,
  onDeleteDocument,
}) {
  const Icon = ICONS_BY_KIND[kind] || Paperclip
  const color = COLORS_BY_KIND[kind] || 'var(--txt-2)'
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  // ─── Textarea avec autosave debounced ─────────────────────────────────
  const [localText, setLocalText] = useState(text ?? '')
  const [saveState, setSaveState] = useState('idle') // 'idle' | 'saving' | 'saved'
  const debounceRef = useRef(null)
  const lastSavedRef = useRef(text ?? '')

  // Sync depuis prop (cas reload, undo, edition concurrente)
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
        await onUpdateText(kind, value)
        lastSavedRef.current = value
        setSaveState('saved')
        // Auto-reset l'indicateur "saved" après 1.5s
        setTimeout(() => setSaveState('idle'), 1500)
      } catch (err) {
        notify.error(err.message || 'Erreur de sauvegarde')
        setSaveState('idle')
      }
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  // Flush le debounce au démontage (évite les saves perdus si on close
  // l'onglet pendant la fenêtre 500ms).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // ─── Upload document ──────────────────────────────────────────────────
  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset l'input pour permettre de re-uploader le même fichier après
    e.target.value = ''

    setUploading(true)
    try {
      await onUploadDocument({ kind, file })
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

  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
      }}
    >
      {/* Header sous-bloc */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Icon className="w-4 h-4" style={{ color }} />
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color }}
          >
            {labelForKind(kind)}
          </span>
          {documents.length > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--bg-surf)', color: 'var(--txt-3)' }}
            >
              {documents.length} doc{documents.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {/* Indicateur autosave */}
        {!readOnly && saveState !== 'idle' && (
          <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {saveState === 'saving' ? 'Enregistrement…' : 'Enregistré ✓'}
          </span>
        )}
      </div>

      {/* Textarea */}
      {readOnly ? (
        <div
          className="text-sm whitespace-pre-wrap leading-relaxed min-h-[40px]"
          style={{ color: localText ? 'var(--txt)' : 'var(--txt-3)' }}
        >
          {localText || <em style={{ color: 'var(--txt-3)' }}>(vide)</em>}
        </div>
      ) : (
        <textarea
          value={localText}
          onChange={handleTextChange}
          placeholder={`Notes ${labelForKind(kind).toLowerCase()}…`}
          rows={3}
          className="w-full text-sm rounded-md px-2.5 py-2 resize-y"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd-sub)',
            color: 'var(--txt)',
            fontFamily: 'inherit',
            minHeight: 60,
          }}
        />
      )}

      {/* Liste des documents */}
      {documents.length > 0 && (
        <ul className="mt-2 space-y-1">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              readOnly={readOnly}
              onDelete={() => handleDeleteDoc(doc)}
            />
          ))}
        </ul>
      )}

      {/* Bouton upload */}
      {!readOnly && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-[11px] inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors disabled:opacity-50"
            style={{
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd-sub)',
              color: 'var(--txt-2)',
            }}
          >
            {uploading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Envoi…
              </>
            ) : (
              <>
                <Upload className="w-3 h-3" />
                Ajouter un document (PDF / PNG / JPG)
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

      {/* Indication du format autorisé (texte d'aide) */}
      {!readOnly && documents.length === 0 && !uploading && (
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--txt-3)' }}>
          Formats : {ACCEPTED_EXTENSIONS.join(', ')} · {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} Mo max
        </p>
      )}
    </div>
  )
}

// ─── Document row ───────────────────────────────────────────────────────────
function DocumentRow({ doc, readOnly, onDelete }) {
  const kind = previewKind(doc)
  const Icon = kind === 'image' ? ImageIcon : FileText
  const [loadingUrl, setLoadingUrl] = useState(false)

  async function handleView() {
    setLoadingUrl(true)
    try {
      const url = await getDocumentSignedUrl(doc.storage_path)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      notify.error(err.message || 'Impossible d\'ouvrir le document')
    } finally {
      setLoadingUrl(false)
    }
  }

  async function handleDownload() {
    setLoadingUrl(true)
    try {
      const url = await getDocumentDownloadUrl(doc.storage_path, {
        filename: doc.filename,
      })
      if (url) {
        // Crée un lien invisible pour déclencher le download
        const a = document.createElement('a')
        a.href = url
        a.download = doc.filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (err) {
      notify.error(err.message || 'Téléchargement impossible')
    } finally {
      setLoadingUrl(false)
    }
  }

  return (
    <li
      className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      <Icon
        className="w-3.5 h-3.5 shrink-0"
        style={{ color: 'var(--txt-3)' }}
      />
      <span
        className="flex-1 truncate"
        style={{ color: 'var(--txt)' }}
        title={doc.filename}
      >
        {doc.filename}
      </span>
      <span className="text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>
        {formatBytes(doc.size_bytes)}
      </span>
      <button
        type="button"
        onClick={handleView}
        disabled={loadingUrl}
        className="p-1 rounded transition-colors disabled:opacity-50"
        style={{ color: 'var(--txt-3)' }}
        title="Ouvrir"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
          e.currentTarget.style.color = 'var(--txt)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--txt-3)'
        }}
      >
        <Eye className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={handleDownload}
        disabled={loadingUrl}
        className="p-1 rounded transition-colors disabled:opacity-50"
        style={{ color: 'var(--txt-3)' }}
        title="Télécharger"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
          e.currentTarget.style.color = 'var(--txt)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--txt-3)'
        }}
      >
        <Download className="w-3.5 h-3.5" />
      </button>
      {!readOnly && (
        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded transition-colors"
          style={{ color: 'var(--txt-3)' }}
          title="Supprimer"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--red-bg)'
            e.currentTarget.style.color = 'var(--red)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  )
}
