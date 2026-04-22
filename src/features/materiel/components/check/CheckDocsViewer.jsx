// ════════════════════════════════════════════════════════════════════════════
// CheckDocsViewer — Viewer des docs loueur sur /check/:token (MAT-10J)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche la liste des documents attachés à la version en cours d'essais, en
// read-only : l'utilisateur anon peut uniquement les consulter (génération
// d'une signed URL au clic, ouverture dans un nouvel onglet).
//
// Le panneau est repliable — il est surtout utile en début/fin de session
// (comparer la liste essayée avec le devis VDEF, retrouver une fiche technique
// sur un accessoire particulier). Par défaut fermé pour ne pas encombrer
// l'UI tactile des blocs de matériel.
//
// Props :
//   - attachments : Array<{ id, title, filename, storage_path, size_bytes, mime_type, created_at, uploaded_by_name }>
//
// Comportement : si la liste est vide, on n'affiche rien (pas de section
// "0 document" disgracieuse).
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Eye,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
} from 'lucide-react'
import {
  displayLabel,
  formatBytes,
} from '../../../../lib/matosAttachments'
import AttachmentPreviewModal from '../AttachmentPreviewModal'

export default function CheckDocsViewer({ attachments = [] }) {
  const [open, setOpen] = useState(false)
  // Attachment actuellement ouvert dans la modale de preview (null = fermée).
  // La modale elle-même génère les signed URLs à son ouverture.
  const [previewAttachment, setPreviewAttachment] = useState(null)

  if (!attachments.length) return null

  function handleOpen(att) {
    setPreviewAttachment(att)
  }

  function handleClosePreview() {
    setPreviewAttachment(null)
  }

  return (
    <>
    <section
      className="mb-4 rounded-2xl overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
        aria-expanded={open}
      >
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: 'var(--blue-bg)' }}
        >
          <Paperclip className="w-3.5 h-3.5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
            Documents loueur
          </p>
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            {attachments.length} fichier{attachments.length > 1 ? 's' : ''} · devis, BL,
            fiches techniques
          </p>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
        ) : (
          <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
        )}
      </button>

      {open && (
        <ul className="divide-y" style={{ borderColor: 'var(--brd)' }}>
          {attachments.map((att) => {
            const Icon = iconForMime(att.mime_type, att.filename)
            const label = displayLabel(att)
            const hasTitle = Boolean((att.title || '').trim())
            return (
              <li
                key={att.id}
                className="px-4 py-3 flex items-center gap-3"
                style={{ borderTopColor: 'var(--brd)' }}
              >
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: 'var(--bg)' }}
                >
                  <Icon className="w-4 h-4" style={{ color: 'var(--txt-2)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
                    {label}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
                    {hasTitle && att.filename ? `${att.filename} · ` : ''}
                    {formatBytes(att.size_bytes)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpen(att)}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-medium"
                  style={{
                    background: 'var(--blue)',
                    color: 'white',
                  }}
                >
                  <Eye className="w-3 h-3" />
                  Ouvrir
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>

    {/* ── Preview modale (portal) ────────────────────────────────────────
         Affiche PDF dans un iframe, images dans <img>, et bouton Télécharger
         séparé pour ceux qui veulent récupérer le fichier sans passer par
         l'aperçu. La modale se monte en portal sur document.body → aucun
         souci de clipping avec `overflow-hidden` sur la section ci-dessus. */}
    <AttachmentPreviewModal
      open={Boolean(previewAttachment)}
      onClose={handleClosePreview}
      attachment={previewAttachment}
    />
    </>
  )
}

// ─── Icône selon mime/ext ────────────────────────────────────────────────────

function iconForMime(mime, filename) {
  const ext = (filename || '').toLowerCase().split('.').pop() || ''
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) {
    return FileImage
  }
  if (m === 'application/pdf' || ext === 'pdf') {
    return FileText
  }
  if (
    m.includes('spreadsheet') ||
    m.includes('excel') ||
    ['xls', 'xlsx', 'csv', 'numbers'].includes(ext)
  ) {
    return FileSpreadsheet
  }
  if (m.includes('word') || ['doc', 'docx', 'odt', 'pages'].includes(ext)) {
    return FileText
  }
  return FileIcon
}
