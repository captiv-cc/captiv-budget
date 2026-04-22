// ════════════════════════════════════════════════════════════════════════════
// LoueurDocsPanel — Documents loueur dans l'onglet Matériel (MAT-10J)
// ════════════════════════════════════════════════════════════════════════════
//
// Panel en bas de MaterielTab qui regroupe tous les documents attachés à la
// version active (devis loueur PDF, BL, fiches optiques, photos…). Les mêmes
// fichiers sont ensuite consultables par les équipes terrain via `/check/:token`.
//
// Layout :
//
//   ┌──────────────────────────────────────────────────────┐
//   │ 📎 Documents loueur · 3 fichiers · 12 Mo             │
//   ├──────────────────────────────────────────────────────┤
//   │ Ajouter un document                                  │
//   │  Titre : [Devis VDEF LoueurA_______________________] │
//   │  Fichier : [Parcourir… devis.pdf]      [Envoyer]     │
//   ├──────────────────────────────────────────────────────┤
//   │ ┌─ Devis VDEF LoueurA ─────── PDF · 2.1 Mo · ⋯ ┐     │
//   │ │ devis-vdef-loueurA.pdf · uploadé il y a 2j   │     │
//   │ │ [Ouvrir]                                     │     │
//   │ └──────────────────────────────────────────────┘     │
//   │ ┌─ Devis VDEF LoueurB ──────────────────────── ┐     │
//   │ └──────────────────────────────────────────────┘     │
//   └──────────────────────────────────────────────────────┘
//
// Props :
//   - versionId : string | null — active version, null = disabled
//   - canEdit   : boolean       — gate upload/delete/rename
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download,
  FileText,
  FileImage,
  FileSpreadsheet,
  File as FileIcon,
  Loader2,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  deleteAttachment,
  displayLabel,
  formatBytes,
  listAttachments,
  MAX_UPLOAD_BYTES,
  renameAttachment,
  uploadAttachment,
} from '../../../lib/matosAttachments'
import { confirm, prompt } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'
import AttachmentPreviewModal from './AttachmentPreviewModal'

export default function LoueurDocsPanel({ versionId, canEdit = false }) {
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [title, setTitle] = useState('')
  const [fileName, setFileName] = useState('')
  const fileInputRef = useRef(null)

  // ─── Preview modale ─────────────────────────────────────────────────────
  // On stocke l'attachment en cours de preview (null = modale fermée). La
  // modale AttachmentPreviewModal s'occupe de générer les signed URLs à
  // l'ouverture — on n'a donc rien à précharger côté panel.
  const [previewAttachment, setPreviewAttachment] = useState(null)

  // ─── Chargement initial + à chaque changement de version ────────────────
  const reload = useCallback(async () => {
    if (!versionId) {
      setAttachments([])
      return
    }
    setLoading(true)
    try {
      const data = await listAttachments(versionId)
      setAttachments(data)
    } catch (err) {
      notify.error('Erreur chargement documents : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [versionId])

  useEffect(() => {
    reload()
  }, [reload])

  // ─── Upload ──────────────────────────────────────────────────────────────
  async function handleUpload(e) {
    e.preventDefault()
    if (!canEdit || !versionId || uploading) return
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      notify.error('Sélectionne un fichier à uploader.')
      return
    }
    setUploading(true)
    try {
      const att = await uploadAttachment({
        versionId,
        file,
        title: title.trim() || null,
      })
      setAttachments((prev) => [...prev, att])
      setTitle('')
      setFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      notify.success('Document uploadé')
    } catch (err) {
      notify.error('Erreur upload : ' + (err?.message || err))
    } finally {
      setUploading(false)
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    setFileName(file?.name || '')
  }

  // ─── Rename ──────────────────────────────────────────────────────────────
  async function handleRename(att) {
    if (!canEdit) return
    const next = await prompt({
      title: 'Renommer le document',
      message: 'Nouveau libellé (laisse vide pour revenir au nom du fichier) :',
      placeholder: 'Ex. Devis VDEF LoueurA',
      initialValue: att.title || '',
    })
    if (next === null) return
    try {
      const updated = await renameAttachment(att.id, next)
      setAttachments((prev) => prev.map((a) => (a.id === att.id ? updated : a)))
      notify.success('Libellé mis à jour')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  // ─── Delete ──────────────────────────────────────────────────────────────
  async function handleDelete(att) {
    if (!canEdit) return
    const ok = await confirm({
      title: 'Supprimer le document',
      message: `Le fichier « ${displayLabel(att)} » sera supprimé définitivement (base + storage). Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteAttachment(att)
      setAttachments((prev) => prev.filter((a) => a.id !== att.id))
      notify.success('Document supprimé')
    } catch (err) {
      notify.error('Erreur suppression : ' + (err?.message || err))
    }
  }

  // ─── Open (preview modale) ───────────────────────────────────────────────
  // Ouvre la modale AttachmentPreviewModal — elle génère les signed URLs
  // inline + download et affiche un iframe (PDF), un <img> (images), ou un
  // écran "Télécharger" pour les autres formats.
  function handleOpen(att) {
    setPreviewAttachment(att)
  }

  function handleClosePreview() {
    setPreviewAttachment(null)
  }

  // ─── Stats header ────────────────────────────────────────────────────────
  const totalBytes = attachments.reduce((s, a) => s + (a.size_bytes || 0), 0)

  if (!versionId) {
    return null
  }

  return (
    // NB : pas d'`overflow-hidden` ici car le dropdown ⋯ de chaque ligne est
    // absolument positionné et serait clippé par les coins arrondis. Les
    // enfants (header, form, ul) respectent les bords grâce à leurs propres
    // bordures top/bottom.
    <section
      className="mt-6 rounded-xl border"
      style={{ background: 'var(--bg-surf)', borderColor: 'var(--brd)' }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="px-4 py-3 flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--brd)' }}
      >
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: 'var(--blue-bg)' }}
        >
          <Paperclip className="w-3.5 h-3.5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
            Documents loueur
          </h3>
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            {attachments.length === 0 && !loading
              ? 'Aucun document pour cette version'
              : `${attachments.length} fichier${attachments.length > 1 ? 's' : ''} · ${formatBytes(totalBytes)}`}
            {loading && attachments.length === 0 ? ' (chargement…)' : ''}
          </p>
        </div>
      </header>

      {/* ── Upload form ─────────────────────────────────────────────────── */}
      {canEdit && (
        <form
          onSubmit={handleUpload}
          className="px-4 py-3 border-b flex flex-wrap items-center gap-2"
          style={{
            borderColor: 'var(--brd)',
            background: 'var(--bg)',
          }}
        >
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre (ex. Devis VDEF LoueurA)"
            disabled={uploading}
            className="flex-1 min-w-[180px] px-3 py-1.5 rounded-md text-xs"
            style={{
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
          />
          <label
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs cursor-pointer"
            style={{
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              color: 'var(--txt-2)',
            }}
          >
            <Upload className="w-3 h-3" />
            <span className="truncate max-w-[180px]">
              {fileName || 'Choisir un fichier…'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <button
            type="submit"
            disabled={uploading || !fileName}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold disabled:opacity-40"
            style={{
              background: 'var(--blue)',
              color: 'white',
            }}
          >
            {uploading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Plus className="w-3 h-3" />
            )}
            {uploading ? 'Envoi…' : 'Envoyer'}
          </button>
          <p
            className="w-full text-[11px] mt-1"
            style={{ color: 'var(--txt-3)' }}
          >
            Max {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} Mo · PDF, images,
            Office. Le titre est optionnel (fallback sur le nom du fichier).
          </p>
        </form>
      )}

      {/* ── List ────────────────────────────────────────────────────────── */}
      {attachments.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            {canEdit
              ? 'Ajoute un premier document (devis, BL, fiche pack…) pour qu\'il soit disponible sur la checklist terrain.'
              : 'Aucun document attaché à cette version.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--brd)' }}>
          {attachments.map((att) => (
            <AttachmentRow
              key={att.id}
              attachment={att}
              canEdit={canEdit}
              onOpen={() => handleOpen(att)}
              onRename={() => handleRename(att)}
              onDelete={() => handleDelete(att)}
            />
          ))}
        </ul>
      )}

      {/* ── Preview modale (portal) ──────────────────────────────────────── */}
      <AttachmentPreviewModal
        open={Boolean(previewAttachment)}
        onClose={handleClosePreview}
        attachment={previewAttachment}
      />
    </section>
  )
}

// ─── Attachment row ─────────────────────────────────────────────────────────

function AttachmentRow({ attachment, canEdit, onOpen, onRename, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Click outside pour fermer le dropdown.
  useEffect(() => {
    if (!menuOpen) return undefined
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  const Icon = iconForMime(attachment.mime_type, attachment.filename)
  const label = displayLabel(attachment)
  const hasTitle = Boolean((attachment.title || '').trim())
  const uploadedAgo = formatRelative(attachment.created_at)

  return (
    <li
      className="px-4 py-3 flex items-center gap-3"
      style={{ borderColor: 'var(--brd)' }}
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
          {hasTitle && attachment.filename ? `${attachment.filename} · ` : ''}
          {formatBytes(attachment.size_bytes)}
          {uploadedAgo ? ` · ${uploadedAgo}` : ''}
          {attachment.uploaded_by_name ? ` · ${attachment.uploaded_by_name}` : ''}
        </p>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--brd)',
          color: 'var(--txt-2)',
        }}
        title="Ouvrir / télécharger"
      >
        <Download className="w-3 h-3" />
        Ouvrir
      </button>

      {canEdit && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1.5 rounded-md"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--brd)',
              color: 'var(--txt-3)',
            }}
            aria-label="Plus d'actions"
          >
            <MoreVertical className="w-3 h-3" />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 min-w-[160px] rounded-md shadow-lg z-20 py-1"
              style={{
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  onRename()
                }}
                className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:opacity-80"
                style={{ color: 'var(--txt)' }}
              >
                <Pencil className="w-3 h-3" />
                Renommer
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  onDelete()
                }}
                className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:opacity-80"
                style={{ color: 'var(--red, #ef4444)' }}
              >
                <Trash2 className="w-3 h-3" />
                Supprimer
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

// ─── Helpers d'affichage ─────────────────────────────────────────────────────

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

// Intl.RelativeTimeFormat partagé — aligné avec ShareChecklistModal.
const RELATIVE_FMT = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
function formatRelative(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 60) return RELATIVE_FMT.format(diffSec, 'second')
  if (abs < 3600) return RELATIVE_FMT.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return RELATIVE_FMT.format(Math.round(diffSec / 3600), 'hour')
  if (abs < 86400 * 30) return RELATIVE_FMT.format(Math.round(diffSec / 86400), 'day')
  if (abs < 86400 * 365) return RELATIVE_FMT.format(Math.round(diffSec / 86400 / 30), 'month')
  return RELATIVE_FMT.format(Math.round(diffSec / 86400 / 365), 'year')
}
