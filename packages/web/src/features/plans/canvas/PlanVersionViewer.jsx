// ════════════════════════════════════════════════════════════════════════════
// PlanVersionViewer — consultation d'une version figée (lecture seule)
// ════════════════════════════════════════════════════════════════════════════
//
// Registre de révisions : ouvre une version telle qu'elle a été figée
// (reconstruite depuis son ydoc_state, même mécanique que la page publique
// mais avec la résolution d'assets authentifiée du desk). Sorties :
// Restaurer comme état courant · Dupliquer en nouveau plan · Exporter PDF.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import { Tldraw, createTLStore, defaultShapeUtils, defaultBindingUtils, useEditor, useValue } from 'tldraw'
import { Copy, Download, Layers, RotateCcw, X } from 'lucide-react'
import { base64ToUint8 } from '../../../hooks/useYjsTldraw'
import { makeCaptivAssetStore } from '../../../lib/plansCanvasFond'
import { exportPlanPdf } from '../../../lib/planPdfExport'
import { resolveCartoucheLogos } from '../../../lib/plansCanvasCartouche'
import { pageMetersPerPx } from './shapes/scale'
import { notify } from '../../../lib/notify'
import { CameraShapeUtil } from './shapes/CameraShapeUtil'
import { ItemShapeUtil } from './shapes/ItemShapeUtil'
import { RailCamShapeUtil } from './shapes/RailCamShapeUtil'
import { SpiderCamShapeUtil } from './shapes/SpiderCamShapeUtil'
import { ZoneShapeUtil } from './shapes/ZoneShapeUtil'
import { CotationShapeUtil } from './shapes/CotationShapeUtil'
import { CableShapeUtil, CableBindingUtil } from './shapes/CableShapeUtil'

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

// Calque « état actuel » superposé au canvas de la version : image PNG
// transparente positionnée en coordonnées PAGE, suit pan/zoom via la caméra
// (même mécanique que les marqueurs de commentaires).
function CompareOverlay({ image, opacity }) {
  const editor = useEditor()
  const camera = useValue('camera', () => editor.getCamera(), [editor])
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 300 }}>
      <img
        src={image.url}
        alt="État actuel du plan"
        className="absolute"
        style={{
          left: (image.bounds.x + camera.x) * camera.z,
          top: (image.bounds.y + camera.y) * camera.z,
          width: image.bounds.w * camera.z,
          height: image.bounds.h * camera.z,
          maxWidth: 'none',
          opacity,
        }}
      />
    </div>
  )
}

export default function PlanVersionViewer({
  canvas,
  version,
  ydocState,
  onClose,
  onRestore,
  onDuplicate,
  makeCompareImage,
}) {
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)

  // ── Comparaison : état actuel en calque au-dessus de la version ──────────
  const [compare, setCompare] = useState(null) // { url, bounds:{x,y,w,h} }
  const [compareOpacity, setCompareOpacity] = useState(0.55)

  useEffect(
    () => () => {
      if (compare?.url) URL.revokeObjectURL(compare.url)
    },
    [compare],
  )

  async function toggleCompare() {
    if (compare) {
      setCompare(null)
      return
    }
    if (!makeCompareImage || busy) return
    setBusy(true)
    try {
      const image = await makeCompareImage()
      if (!image) {
        notify.error('Le plan actuel est vide : rien à comparer')
        return
      }
      setCompare(image)
    } catch (err) {
      notify.error('Comparaison impossible : ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  const store = useMemo(() => {
    const s = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...CUSTOM_SHAPE_UTILS],
      bindingUtils: [...defaultBindingUtils, CableBindingUtil],
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
      const logoImages = canvas.cartouche ? await resolveCartoucheLogos(canvas.cartouche) : []
      const handle = await exportPlanPdf(editor, {
        titre: `${canvas.titre} — V${version.version}`,
        sousTitre: version.commentaire || '',
        footer: 'Généré par DESK.',
        cartouche: canvas.cartouche || null,
        logoImages,
        version: version.version,
        // L'échelle vit dans la meta de page du doc de la version.
        metersPerPx: pageMetersPerPx(editor),
      })
      if (handle) {
        handle.download()
        handle.revoke()
      }
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
        {makeCompareImage && (
          <button
            type="button"
            onClick={toggleCompare}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
            style={{
              background: compare ? 'var(--blue)' : 'var(--bg)',
              border: '1px solid var(--brd)',
              color: compare ? '#fff' : 'var(--txt-2)',
              opacity: busy ? 0.6 : 1,
            }}
            title="Superpose l’état actuel du plan à cette version"
          >
            <Layers className="w-3.5 h-3.5" />
            Comparer
          </button>
        )}
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
        >
          {compare && <CompareOverlay image={compare} opacity={compareOpacity} />}
        </Tldraw>

        {/* Réglage du calque de comparaison */}
        {compare && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-3.5 py-2 rounded-xl"
            style={{ zIndex: 400, background: 'var(--bg-elev)', border: '1px solid var(--brd)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
          >
            <span className="text-[11px] font-bold shrink-0" style={{ color: 'var(--txt-3)' }}>
              V{version.version}
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(compareOpacity * 100)}
              onChange={(e) => setCompareOpacity(Number(e.target.value) / 100)}
              className="w-36"
              style={{ accentColor: 'var(--blue)' }}
              title="Opacité du calque « état actuel »"
            />
            <span className="text-[11px] font-bold shrink-0" style={{ color: 'var(--txt)' }}>
              En cours
            </span>
            <button type="button" onClick={() => setCompare(null)} className="p-0.5" style={{ color: 'var(--txt-3)' }} title="Fermer la comparaison">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
