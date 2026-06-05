// ════════════════════════════════════════════════════════════════════════════
// ImportDerouleModal (FEST-4.2) — Modal d'upload pour l'import IA
// ════════════════════════════════════════════════════════════════════════════
//
// 3 modes d'upload :
//   - Drag & drop sur la zone centrale
//   - Click → file picker
//   - Paste (Cmd+V) d'une capture d'écran
//
// Une fois un fichier sélectionné :
//   - Affiche un preview (image ou icône fichier PDF)
//   - Bouton "Analyser avec IA"
//   - Pendant l'appel : spinner + message dynamique
//   - À la fin : appelle onResult(extracted) → le parent ouvre la preview
//
// Suit les règles CHANTIER_UI_KIT.md :
//   - Modal centré z=60 avec backdrop noir 50%
//   - Click backdrop ferme (sauf pendant importing)
//   - Esc ferme (sauf pendant importing)
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  X,
  Upload,
  FileText,
  Image as ImageIcon,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { useImportDeroule } from '../../hooks/useImportDeroule'
import { notify } from '../../lib/notify'

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]

const MAX_FILE_MB = 20

export default function ImportDerouleModal({ open, onClose, onResult }) {
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const containerRef = useRef(null)
  const { extract, importing, error, reset } = useImportDeroule()

  // ─── Lifecycle : reset quand on (ré-)ouvre la modal ─────────────────────
  useEffect(() => {
    if (open) {
      setFile(null)
      setPreviewUrl(null)
      setDragOver(false)
      reset()
    }
  }, [open, reset])

  // ─── Genère / révoque la preview URL pour les images ────────────────────
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return undefined
    }
    if (file.type && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreviewUrl(null)
    return undefined
  }, [file])

  // ─── Esc ferme ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape' && !importing) {
        e.stopPropagation()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, importing, onClose])

  // ─── Paste handler (Cmd+V capture) ──────────────────────────────────────
  // Utilise un ref pour pointer sur la dernière version de handleSelectFile
  // (qui dépend de l'état actuel) sans relancer l'effet à chaque render.
  const handleSelectFileRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    function onPaste(e) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file') {
          const f = item.getAsFile()
          if (f) {
            handleSelectFileRef.current?.(f)
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  if (!open) return null

  // ─── Sélection / validation fichier ─────────────────────────────────────
  function handleSelectFile(f) {
    if (!f) return
    const type = (f.type || '').toLowerCase()
    if (!ACCEPTED_TYPES.includes(type)) {
      notify.error(
        `Type non supporté : ${f.type || 'inconnu'}. Formats acceptés : PDF, PNG, JPG, GIF, WebP.`,
      )
      return
    }
    const sizeMb = f.size / (1024 * 1024)
    if (sizeMb > MAX_FILE_MB) {
      notify.error(
        `Fichier trop volumineux : ${sizeMb.toFixed(1)}MB (max ${MAX_FILE_MB}MB)`,
      )
      return
    }
    setFile(f)
    reset()
  }
  // Tient le ref à jour pour le paste handler
  handleSelectFileRef.current = handleSelectFile

  // ─── Drop handlers ───────────────────────────────────────────────────────
  function onDragOver(e) {
    e.preventDefault()
    setDragOver(true)
  }
  function onDragLeave() {
    setDragOver(false)
  }
  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleSelectFile(f)
  }

  // ─── Click → file picker ────────────────────────────────────────────────
  function openPicker() {
    fileInputRef.current?.click()
  }
  function onPick(e) {
    const f = e.target.files?.[0]
    if (f) handleSelectFile(f)
    e.target.value = '' // permet de re-sélectionner le même fichier
  }

  // ─── Analyse ─────────────────────────────────────────────────────────────
  async function handleAnalyse() {
    if (!file) return
    try {
      const r = await extract(file)
      const shows = Array.isArray(r.shows) ? r.shows : []
      if (shows.length === 0) {
        notify.error(
          "Aucun show détecté. Le document est peut-être illisible ou n'est pas une programmation festival.",
        )
        return
      }
      notify.success(
        `${shows.length} show${shows.length > 1 ? 's' : ''} détecté${shows.length > 1 ? 's' : ''} en ${((r.meta?.duration_ms || 0) / 1000).toFixed(1)}s`,
      )
      onResult?.(r, file)
    } catch (e) {
      // Erreur déjà notifiée via le state du hook + on affiche le message
      notify.error('Échec de l\'analyse : ' + (e?.message || e))
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  const isImage = file?.type?.startsWith('image/')
  const isPdf = file?.type === 'application/pdf'

  return (
    <div
      onClick={() => !importing && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'import-fade-in 120ms ease-out',
      }}
    >
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} style={{ color: 'var(--blue, #3B82F6)' }} />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--txt)',
              }}
            >
              Importer une programmation
            </span>
          </div>
          <button
            type="button"
            onClick={() => !importing && onClose?.()}
            disabled={importing}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: importing ? 'not-allowed' : 'pointer',
              borderRadius: 4,
            }}
            title="Fermer (Échap)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflow: 'auto',
          }}
        >
          {/* Zone de drop / preview fichier */}
          {!file ? (
            <button
              type="button"
              onClick={openPicker}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                padding: '40px 24px',
                background: dragOver ? 'var(--bg-elev)' : 'var(--bg)',
                border: `2px dashed ${dragOver ? 'var(--blue, #3B82F6)' : 'var(--brd)'}`,
                borderRadius: 8,
                color: 'var(--txt-2)',
                cursor: 'pointer',
                transition: 'background 120ms, border-color 120ms',
              }}
            >
              <Upload
                size={28}
                style={{
                  color: dragOver ? 'var(--blue, #3B82F6)' : 'var(--txt-3)',
                }}
              />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  Glisse un fichier ici ou clique
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--txt-3)',
                    marginTop: 4,
                  }}
                >
                  PDF, PNG, JPG, GIF, WebP — max {MAX_FILE_MB}MB
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--txt-3)',
                    marginTop: 6,
                  }}
                >
                  Tu peux aussi coller une capture (⌘V)
                </div>
              </div>
            </button>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                borderRadius: 8,
              }}
            >
              {/* Thumbnail */}
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 6,
                  background: 'var(--bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                {isImage && previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={file.name}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                ) : isPdf ? (
                  <FileText size={24} style={{ color: 'var(--txt-3)' }} />
                ) : (
                  <ImageIcon size={24} style={{ color: 'var(--txt-3)' }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--txt)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.name || (isPdf ? 'document.pdf' : 'capture')}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--txt-3)',
                    marginTop: 2,
                  }}
                >
                  {(file.size / 1024).toFixed(0)} KB · {file.type || 'inconnu'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => !importing && setFile(null)}
                disabled={importing}
                title="Changer de fichier"
                style={{
                  padding: 6,
                  background: 'transparent',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 4,
                  color: 'var(--txt-3)',
                  cursor: importing ? 'not-allowed' : 'pointer',
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            onChange={onPick}
            style={{ display: 'none' }}
          />

          {/* Hint pendant l'import */}
          {importing && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                background: 'var(--bg-elev)',
                borderRadius: 6,
                border: '1px solid var(--brd-sub)',
              }}
            >
              <Loader2
                size={16}
                style={{
                  color: 'var(--blue, #3B82F6)',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                Claude Vision analyse le document… ça prend 3 à 6 secondes
                selon la taille.
              </div>
            </div>
          )}

          {/* Erreur */}
          {error && !importing && (
            <div
              style={{
                padding: '10px 12px',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 6,
                fontSize: 12,
                color: '#EF4444',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '10px 16px',
            borderTop: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <button
            type="button"
            onClick={() => !importing && onClose?.()}
            disabled={importing}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--brd-sub)',
              borderRadius: 5,
              color: 'var(--txt-2)',
              fontSize: 12,
              cursor: importing ? 'not-allowed' : 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleAnalyse}
            disabled={!file || importing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              background:
                !file || importing ? 'var(--brd)' : 'var(--blue, #3B82F6)',
              color: 'white',
              border: 'none',
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 500,
              cursor: !file || importing ? 'not-allowed' : 'pointer',
            }}
          >
            {importing ? (
              <>
                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                Analyse…
              </>
            ) : (
              <>
                <Sparkles size={12} />
                Analyser avec IA
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes import-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
