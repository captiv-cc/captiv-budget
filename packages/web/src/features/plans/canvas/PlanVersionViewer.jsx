// ════════════════════════════════════════════════════════════════════════════
// PlanVersionViewer — consultation d'une version figée (lecture seule)
// ════════════════════════════════════════════════════════════════════════════
//
// Registre de révisions : ouvre une version telle qu'elle a été figée
// (reconstruite depuis son ydoc_state, même mécanique que la page publique
// mais avec la résolution d'assets authentifiée du desk). Sorties :
// Restaurer comme état courant · Dupliquer en nouveau plan · Exporter PDF.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import { Tldraw, createTLStore, defaultShapeUtils, defaultBindingUtils } from 'tldraw'
import { Copy, Download, Loader2, RotateCcw, X } from 'lucide-react'
import { base64ToUint8 } from '../../../hooks/useYjsTldraw'
import { makeCaptivAssetStore } from '../../../lib/plansCanvasFond'
import { exportPlanPdf } from '../../../lib/planPdfExport'
import { notify } from '../../../lib/notify'
import { CameraShapeUtil } from './shapes/CameraShapeUtil'
import { ItemShapeUtil } from './shapes/ItemShapeUtil'
import { RailCamShapeUtil } from './shapes/RailCamShapeUtil'
import { SpiderCamShapeUtil } from './shapes/SpiderCamShapeUtil'
import { ZoneShapeUtil } from './shapes/ZoneShapeUtil'
import { CotationShapeUtil } from './shapes/CotationShapeUtil'
import { CableShapeUtil } from './shapes/CableShapeUtil'

const CUSTOM_SHAPE_UTILS = [
  CameraShapeUtil,
  ItemShapeUtil,
  RailCamShapeUtil,
  SpiderCamShapeUtil,
  ZoneShapeUtil,
  CotationShapeUtil,
  CableShapeUtil,
]

const READONLY_COMPONENTS = {
  Toolbar: null,
  StylePanel: null,
  MainMenu: null,
  PageMenu: null,
  QuickActions: null,
  ActionsMenu: null,
  HelpMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  ContextMenu: null,
  KeyboardShortcutsDialog: null,
}

function getShapeVisibility(shape) {
  return shape.meta?.hidden ? 'hidden' : 'inherit'
}

export default function PlanVersionViewer({ canvas, version, ydocState, onClose, onRestore, onDuplicate }) {
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)

  const store = useMemo(() => {
    const s = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...CUSTOM_SHAPE_UTILS],
      bindingUtils: [...defaultBindingUtils],
      // Résolution authentifiée desk (le contexte ne sert qu'à l'upload,
      // impossible ici : lecture seule).
      assets: makeCaptivAssetStore(() => ({})),
    })
    try {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, base64ToUint8(ydocState))
      const records = []
      doc.getMap('tldraw_records').forEach((r) => {
        if (r?.id) records.push(r)
      })
      doc.destroy()
      s.mergeRemoteChanges(() => {
        s.put(records)
      })
    } catch (e) {
      console.warn('[PlanVersionViewer] reconstruction échouée', e)
    }
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydocState])

  const handleMount = useCallback((ed) => {
    setEditor(ed)
    ed.updateInstanceState({ isReadonly: true })
    ed.zoomToFit()
  }, [])

  async function handlePdf() {
    if (!editor || busy) return
    setBusy(true)
    try {
      await exportPlanPdf(editor, {
        titre: `${canvas.titre} — V${version.version}`,
        sousTitre: version.commentaire || '',
        footer: 'Généré par Captiv DESK',
      })
    } catch (err) {
      notify.error('Export échoué : ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-3 sm:px-4 h-12 shrink-0"
        style={{ borderBottom: '1px solid var(--brd)', background: 'var(--bg-elev)' }}
      >
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
          style={{ background: 'var(--blue-bg)', color: 'var(--blue)', border: '1px solid var(--brd)' }}
        >
          V{version.version} figée
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate" style={{ color: 'var(--txt)' }}>
            {canvas.titre}
            {version.commentaire && (
              <span className="font-normal text-xs" style={{ color: 'var(--txt-3)' }}>
                {' '}
                — {version.commentaire}
              </span>
            )}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            Figée le {new Date(version.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
            {version.author?.full_name ? ` par ${version.author.full_name}` : ''} · lecture seule
          </div>
        </div>
        <button
          type="button"
          onClick={handlePdf}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
          style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)', opacity: busy ? 0.6 : 1 }}
        >
          <Download className="w-3.5 h-3.5" />
          PDF
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(version)}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
          style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
          title="Créer un nouveau plan à partir de cette version"
        >
          <Copy className="w-3.5 h-3.5" />
          Dupliquer en nouveau plan
        </button>
        <button
          type="button"
          onClick={() => onRestore(version)}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
          style={{ background: 'var(--blue)', color: '#fff' }}
          title="Remplacer le contenu actuel du plan par cette version"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Restaurer
        </button>
        <button type="button" onClick={onClose} className="p-1.5 rounded-md" style={{ color: 'var(--txt-3)' }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Canvas lecture seule */}
      <div className="flex-1 relative min-h-0">
        <Tldraw
          store={store}
          shapeUtils={CUSTOM_SHAPE_UTILS}
          getShapeVisibility={getShapeVisibility}
          components={READONLY_COMPONENTS}
          inferDarkMode
          onMount={handleMount}
        />
      </div>
    </div>,
    document.body,
  )
}
