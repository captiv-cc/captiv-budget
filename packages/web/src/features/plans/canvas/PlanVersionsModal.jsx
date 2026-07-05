// ════════════════════════════════════════════════════════════════════════════
// PlanVersionsModal — versions figées d'un plan ("Créer une version")
// ════════════════════════════════════════════════════════════════════════════
//
// L'autosave écrase en continu l'état courant ; ici on FIGE un état nommé
// dans plans_canvas_versions (snapshot visuel + commentaire), consultable et
// restaurable. La restauration remplace shapes/assets/bindings du document
// courant (propagée en collab via le bridge) — on propose de figer d'abord.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import { History, Loader2, RotateCcw, X } from 'lucide-react'
import {
  listCanvasVersions,
  createCanvasVersion,
  getCanvasVersionState,
} from '../../../lib/plansCanvas'
import { base64ToUint8 } from '../../../hooks/useYjsTldraw'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'
import { confirm } from '../../../lib/confirm'

// Types de records remplacés à la restauration (les pages/documents restent).
const RESTORE_TYPES = new Set(['shape', 'asset', 'binding'])

export default function PlanVersionsModal({
  canvas,
  editor,
  getYdocState, // () => base64 de l'état courant (encodeDocState du doc live)
  makeSnapshot, // () => Promise<dataURL JPEG> (miniature)
  onClose,
  onVersionCreated,
}) {
  const { user } = useAuth()
  const [versions, setVersions] = useState(null)
  const [commentaire, setCommentaire] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listCanvasVersions(canvas.id)
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [canvas.id])

  async function handleCreate(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const snapshot = await makeSnapshot().catch(() => null)
      const ydocState = getYdocState()
      if (!ydocState) throw new Error('document non prêt')
      const row = await createCanvasVersion({
        canvasId: canvas.id,
        version: canvas.version_current || 1,
        ydocState,
        snapshotSvg: snapshot,
        commentaire,
        userId: user?.id,
      })
      setVersions((prev) => [row, ...(prev || [])])
      setCommentaire('')
      onVersionCreated?.(row)
      notify.success(`Version ${row.version} figée`)
    } catch (err) {
      notify.error('Création de version impossible : ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(row) {
    const ok = await confirm({
      title: `Restaurer la version ${row.version}`,
      message:
        'Le contenu actuel du plan sera remplacé pour tout le monde. Fige d’abord une version si tu veux pouvoir revenir à l’état actuel.',
      confirmLabel: 'Restaurer',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const stateB64 = await getCanvasVersionState(row.id)
      if (!stateB64) throw new Error('version vide')
      const doc = new Y.Doc()
      Y.applyUpdate(doc, base64ToUint8(stateB64))
      const snapRecords = []
      doc.getMap('tldraw_records').forEach((r) => {
        if (r?.id && RESTORE_TYPES.has(r.typeName)) snapRecords.push(r)
      })
      doc.destroy()

      const currentIds = editor.store
        .allRecords()
        .filter((r) => RESTORE_TYPES.has(r.typeName))
        .map((r) => r.id)
      // Source 'user' → le bridge Yjs propage la restauration aux autres.
      editor.run(() => {
        if (currentIds.length) editor.store.remove(currentIds)
        if (snapRecords.length) editor.store.put(snapRecords)
      })
      notify.success(`Version ${row.version} restaurée`)
      onClose()
    } catch (err) {
      notify.error('Restauration impossible : ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  const fieldStyle = { background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', maxHeight: '85vh' }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--blue-bg)' }}>
            <History className="w-4.5 h-4.5" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Versions du plan
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
              Fige des états nommés ({`le plan est en V${canvas.version_current || 1}`}) —
              l’autosave continue entre deux versions.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Créer une version */}
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <input
            type="text"
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            placeholder='Commentaire — ex : "Envoyée au client", "Config validée DOP"'
            className="flex-1 min-w-0 text-xs px-3 py-2 rounded-md outline-none"
            style={fieldStyle}
          />
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-md shrink-0"
            style={{ background: 'var(--blue)', color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Figer la V{canvas.version_current || 1}
          </button>
        </form>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {versions === null ? (
            <div className="flex items-center gap-2 text-sm py-3" style={{ color: 'var(--txt-3)' }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              Chargement…
            </div>
          ) : versions.length === 0 ? (
            <div className="text-xs py-4 text-center" style={{ color: 'var(--txt-3)' }}>
              Aucune version figée pour l’instant.
            </div>
          ) : (
            versions.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-3 rounded-xl p-2.5 mb-2"
                style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}
              >
                {v.snapshot_svg?.startsWith('data:image') ? (
                  <img
                    src={v.snapshot_svg}
                    alt=""
                    className="w-20 h-14 object-contain rounded-md shrink-0"
                    style={{ background: '#fff', border: '1px solid var(--brd)' }}
                  />
                ) : (
                  <div
                    className="w-20 h-14 rounded-md shrink-0 flex items-center justify-center"
                    style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
                  >
                    <History className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold" style={{ color: 'var(--txt)' }}>
                    Version {v.version}
                    {v.commentaire && (
                      <span className="font-normal" style={{ color: 'var(--txt-2)' }}>
                        {' '}
                        — {v.commentaire}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                    {new Date(v.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {v.author?.full_name ? ` · ${v.author.full_name}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(v)}
                  disabled={busy}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-md shrink-0"
                  style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
                  title="Remplacer le contenu actuel par cette version"
                >
                  <RotateCcw className="w-3 h-3" />
                  Restaurer
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
