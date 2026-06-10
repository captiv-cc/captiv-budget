// ════════════════════════════════════════════════════════════════════════════
// LogistiqueSubBloc — Sous-bloc transport / hébergement / repas
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche un sous-bloc d'une entry logistique :
//   - Header (titre + icône + compteur docs + bouton X masquer en admin)
//   - Textarea avec autosave debounced (500ms après dernier tap)
//   - Liste des documents (clic Eye → ouvre LogistiqueDocumentPreviewModal)
//   - Bouton "Ajouter un document" qui ouvre l'input file
//
// Mode read-only :
//   - pas de textarea éditable, pas d'uploader, pas de delete, pas de X
//   - les docs sont affichés en **grille de thumbnails** (PDF iframe / image)
//     pour un rendu visuel cohérent avec la page share Plans
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
  X,
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
import LogistiqueDocumentPreviewModal from './LogistiqueDocumentPreviewModal'

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
  onHide, // callback admin pour masquer ce sous-bloc (toggle hidden_kinds DB)
}) {
  const Icon = ICONS_BY_KIND[kind] || Paperclip
  const color = COLORS_BY_KIND[kind] || 'var(--txt-2)'
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  // Doc en cours de preview (modal) — null = fermé
  const [previewDoc, setPreviewDoc] = useState(null)

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
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Icon className="w-4 h-4 shrink-0" style={{ color }} />
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
        {/* Bouton X pour masquer le sous-bloc (admin uniquement) */}
        {!readOnly && onHide && (
          <button
            type="button"
            onClick={onHide}
            className="p-1 rounded transition-colors shrink-0"
            style={{ color: 'var(--txt-3)' }}
            title={`Masquer ${labelForKind(kind).toLowerCase()} pour cette personne`}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
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

      {/* Documents :
           - Admin (editable) : liste compacte avec actions Preview / DL / Suppr
           - Share  (readOnly) : grille de thumbnails compacts (~110px). Garde
             juste assez de signal visuel pour reconnaître le doc — le clic
             agrandit en plein écran via le preview modal. Volontairement
             plus petit que le bloc Global (180px) pour ne pas étirer la
             page : chaque personne peut avoir 2-3 docs × 3 sous-blocs et
             on a 5+ personnes — il faut rester compact. */}
      {documents.length > 0 && (
        readOnly ? (
          <div
            className="mt-2 grid gap-2"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            }}
          >
            {documents.map((doc) => (
              <DocumentThumbnail
                key={doc.id}
                doc={doc}
                onClick={() => setPreviewDoc(doc)}
              />
            ))}
          </div>
        ) : (
          <ul className="mt-2 space-y-1">
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                readOnly={readOnly}
                onPreview={() => setPreviewDoc(doc)}
                onDelete={() => handleDeleteDoc(doc)}
              />
            ))}
          </ul>
        )
      )}

      {/* Modal preview document (admin + share) */}
      {previewDoc && (
        <LogistiqueDocumentPreviewModal
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
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

// ─── Document row (mode admin, liste compacte) ─────────────────────────────
function DocumentRow({ doc, readOnly, onPreview, onDelete }) {
  const kind = previewKind(doc)
  const Icon = kind === 'image' ? ImageIcon : FileText
  const [loadingUrl, setLoadingUrl] = useState(false)

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
        onClick={onPreview}
        className="p-1 rounded transition-colors"
        style={{ color: 'var(--txt-3)' }}
        title="Aperçu"
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

// ─── Document thumbnail (mode share, grille visuelle) ──────────────────────
//
// Charge la signed URL puis affiche :
//   - Images : <img> miniature object-cover
//   - PDFs   : iframe miniature (le browser rend la première page)
//   - Autres : icône générique
//
// Click → ouvre le modal preview (callback onClick).
//
// Sandbox iframe : on n'autorise PAS d'interaction utilisateur sur le PDF
// miniature (pointer-events: none + overlay cliquable transparent) — le PDF
// est ouvert dans le modal de preview pour ça.

function DocumentThumbnail({ doc, onClick }) {
  const kind = previewKind(doc)
  const [signedUrl, setSignedUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col rounded-md overflow-hidden text-left transition-transform"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
      }}
      title={doc.filename}
    >
      {/* Zone aperçu — ratio carré 1/1 pour rester compact (les sous-blocs
          personne peuvent avoir N docs × 3 kinds, donc on tasse au max ;
          le clic agrandit en plein écran de toute façon). */}
      <div
        className="relative w-full"
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--bg-elev)',
          overflow: 'hidden',
        }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2
              className="w-4 h-4 animate-spin"
              style={{ color: 'var(--txt-3)' }}
            />
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <FileText className="w-6 h-6" style={{ color: 'var(--txt-3)' }} />
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
            {/* Overlay cliquable transparent par-dessus l'iframe pour
                capter le clic (l'iframe avale les events sinon). */}
            <span className="absolute inset-0" />
          </>
        )}
        {!loading && !error && !kind && (
          <div className="absolute inset-0 flex items-center justify-center">
            <FileText className="w-6 h-6" style={{ color: 'var(--txt-3)' }} />
          </div>
        )}
      </div>
      {/* Filename + taille (compact pour rester proportionné au 110px) */}
      <div className="px-1.5 py-1 flex flex-col gap-0">
        <div
          className="text-[10px] font-medium truncate leading-tight"
          style={{ color: 'var(--txt)' }}
          title={doc.filename}
        >
          {doc.filename}
        </div>
        <div className="text-[9px] leading-tight" style={{ color: 'var(--txt-3)' }}>
          {formatBytes(doc.size_bytes)}
        </div>
      </div>
    </button>
  )
}
