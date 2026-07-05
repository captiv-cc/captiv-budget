// ════════════════════════════════════════════════════════════════════════════
// FondPickerModal — remplacer (ou retirer) le fond de plan d'un canvas
// ════════════════════════════════════════════════════════════════════════════
//
// Liste les fichiers de la bibliothèque « Fonds importés » du projet.
// onPick(fondRow | null) : null = canvas sans fond.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { listPlans } from '../../../lib/plans'

export default function FondPickerModal({ projectId, currentFondId, onClose, onPick }) {
  const [fonds, setFonds] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listPlans({ projectId })
      .then((rows) => setFonds(rows.filter((p) => !p.is_archived)))
      .catch(() => setFonds([]))
  }, [projectId])

  async function pick(fond) {
    if (busy) return
    setBusy(true)
    try {
      await onPick(fond)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl p-5 flex flex-col"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', maxHeight: '80vh' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Fond de plan
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {fonds === null ? (
          <div className="flex items-center gap-2 text-sm py-6" style={{ color: 'var(--txt-3)' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Chargement…
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            <button
              type="button"
              onClick={() => pick(null)}
              disabled={busy}
              className="w-full flex items-center gap-2.5 p-2.5 rounded-lg mb-1 text-left"
              style={{
                border: '1px solid var(--brd)',
                background: !currentFondId ? 'var(--blue-bg)' : 'var(--bg)',
                color: 'var(--txt-2)',
              }}
            >
              <X className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">Aucun fond (canvas vierge)</span>
            </button>
            {fonds.map((f) => {
              const isCurrent = f.id === currentFondId
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => pick(f)}
                  disabled={busy}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg mb-1 text-left"
                  style={{
                    border: isCurrent ? '1px solid var(--blue)' : '1px solid var(--brd)',
                    background: isCurrent ? 'var(--blue-bg)' : 'var(--bg)',
                  }}
                >
                  {f.file_type === 'pdf' ? (
                    <FileText className="w-4 h-4 shrink-0" style={{ color: 'var(--red)' }} />
                  ) : (
                    <ImageIcon className="w-4 h-4 shrink-0" style={{ color: 'var(--blue)' }} />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold truncate" style={{ color: 'var(--txt)' }}>
                      {f.name}
                    </span>
                    <span className="block text-[10px]" style={{ color: 'var(--txt-3)' }}>
                      {f.file_type.toUpperCase()}
                      {f.current_version > 1 ? ` · v${f.current_version}` : ''}
                    </span>
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] font-bold shrink-0" style={{ color: 'var(--blue)' }}>
                      Actuel
                    </span>
                  )}
                </button>
              )
            })}
            {fonds.length === 0 && (
              <div className="text-xs py-4 text-center" style={{ color: 'var(--txt-3)' }}>
                Aucun fichier dans « Fonds importés ». Importe d'abord ton plan
                (PDF/PNG/JPG) dans cet onglet.
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] mt-3" style={{ color: 'var(--txt-3)' }}>
          Le fond est remplacé pour tout le monde, les éléments dessinés restent
          en place. Astuce : si le fichier a été mis à jour dans la bibliothèque
          (nouvelle version), re-sélectionne-le ici pour recharger la dernière
          version.
        </div>
      </div>
    </div>,
    document.body,
  )
}
