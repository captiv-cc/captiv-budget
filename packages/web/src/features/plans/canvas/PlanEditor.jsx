// ════════════════════════════════════════════════════════════════════════════
// PlanEditor — éditeur canvas d'un plan technique (tldraw + Yjs collab)
// ════════════════════════════════════════════════════════════════════════════
//
// V0 POC : monte tldraw en overlay plein écran, collab temps réel via
// useYjsTldraw (channel plan-canvas:<id>), autosave debounce 2s de l'état
// Yjs dans plans_canvas.ydoc_state, restauration au mount.
//
// Ouvert depuis PlansTab via URL state ?canvas=<id> (même pattern que le
// viewer de fonds ?plan=<id>). Phases suivantes : fond de plan en background,
// bibliothèque Captiv, shapes custom, export PDF — cf. docs/CHANTIER_PLANS.md.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tldraw, DefaultStylePanel, useEditor, useValue } from 'tldraw'
import 'tldraw/tldraw.css'
import { ArrowLeft, Download, Loader2, Users, Wifi, WifiOff } from 'lucide-react'
import { getCanvas, saveCanvasState, updateCanvas } from '../../../lib/plansCanvas'
import { getPlan, listPlanCategories } from '../../../lib/plans'
import { makeCaptivAssetStore, ensureFondShape } from '../../../lib/plansCanvasFond'
import { useYjsTldraw, encodeDocState } from '../../../hooks/useYjsTldraw'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'
import { CameraShapeUtil } from './shapes/CameraShapeUtil'
import { ItemShapeUtil } from './shapes/ItemShapeUtil'
import LibraryPanel from './LibraryPanel'
import PlanSidePanel from './PlanSidePanel'

const AUTOSAVE_MS = 2000
const CUSTOM_SHAPE_UTILS = [CameraShapeUtil, ItemShapeUtil]

// Visibilité par couche : meta.hidden posé par le panneau Layers.
function getShapeVisibility(shape) {
  return shape.meta?.hidden ? 'hidden' : 'inherit'
}

// StylePanel contextuel : pour une sélection 100% Captiv (caméras/items),
// le panneau natif se réduirait à un slider d'opacité orphelin → on le
// masque (nos Propriétés font le travail). Il reste pour le dessin libre.
function CaptivStylePanel(props) {
  const editor = useEditor()
  const onlyCaptiv = useValue(
    'selection-only-captiv',
    () => {
      const sel = editor.getSelectedShapes()
      return (
        sel.length > 0 &&
        sel.every((s) => s.type === CameraShapeUtil.type || s.type === ItemShapeUtil.type)
      )
    },
    [editor],
  )
  if (onlyCaptiv) return null
  return <DefaultStylePanel {...props} />
}

// UI native élaguée : le menu principal fait doublon avec notre top bar
// (export, etc.). On garde la toolbar, le zoom, les pages (multi-configs
// J1/J2), les quick actions (undo/redo) et le StylePanel (couleurs du dessin
// libre — plus de collision depuis que nos panneaux sont hors canvas).
const TLDRAW_COMPONENTS = {
  MainMenu: null,
  HelpMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  StylePanel: CaptivStylePanel,
}

export default function PlanEditor({ canvasId, onClose, readOnly = false }) {
  const { user, org } = useAuth()
  const [canvas, setCanvas] = useState(null)
  const [categories, setCategories] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [saveState, setSaveState] = useState('idle') // idle | dirty | saving | saved
  const [editingTitle, setEditingTitle] = useState(false)

  // ── Chargement de la row (titre + ydoc_state persisté) ────────────────────
  useEffect(() => {
    let alive = true
    setCanvas(null)
    setLoadError(null)
    getCanvas(canvasId)
      .then((row) => {
        if (alive) setCanvas(row)
      })
      .catch((err) => {
        if (alive) setLoadError(err?.message || String(err))
      })
    return () => {
      alive = false
    }
  }, [canvasId])

  useEffect(() => {
    if (org?.id) listPlanCategories(org.id).then(setCategories).catch(() => {})
  }, [org?.id])

  // ── Asset store : fonds + images collées, résolus par chemin storage ──────
  const canvasRef = useRef(null)
  canvasRef.current = canvas
  const assetStore = useMemo(
    () =>
      makeCaptivAssetStore(() => ({
        projectId: canvasRef.current?.project_id,
        canvasId,
      })),
    [canvasId],
  )

  // ── Autosave debounce ──────────────────────────────────────────────────────
  const saveTimer = useRef(null)
  const docRef = useRef(null)
  const pendingRef = useRef(false)

  const flushSave = useCallback(async () => {
    if (!docRef.current) return
    pendingRef.current = false
    setSaveState('saving')
    try {
      await saveCanvasState(canvasId, encodeDocState(docRef.current), { userId: user?.id })
      // Si de nouvelles modifs sont arrivées pendant l'écriture, on reste dirty.
      setSaveState(pendingRef.current ? 'dirty' : 'saved')
    } catch (err) {
      setSaveState('dirty')
      notify.error('Sauvegarde du plan échouée : ' + (err?.message || err))
    }
  }, [canvasId, user?.id])

  const onDirty = useCallback(() => {
    pendingRef.current = true
    setSaveState('dirty')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSave, AUTOSAVE_MS)
  }, [flushSave])

  // Flush au démontage (fermeture de l'éditeur) si des modifs attendent.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (pendingRef.current) flushSave()
    },
    [flushSave],
  )

  // ── Collab : store tldraw synchronisé Yjs ──────────────────────────────────
  const { store, doc, status, peers } = useYjsTldraw({
    canvasId,
    initialStateB64: canvas?.ydoc_state || null,
    onDirty,
    assetStore,
    extraShapeUtils: CUSTOM_SHAPE_UTILS,
    // On attend d'avoir chargé la row pour ne pas rater la restauration.
    enabled: Boolean(canvas),
  })
  docRef.current = doc

  // ── Montage tldraw : lecture seule + insertion du fond ────────────────────
  const editorRef = useRef(null)
  const [editorInstance, setEditorInstance] = useState(null)
  const handleMount = useCallback(
    (editor) => {
      editorRef.current = editor
      setEditorInstance(editor)
      if (readOnly) {
        editor.updateInstanceState({ isReadonly: true })
        return
      }
      const fondId = canvasRef.current?.fond_id
      if (!fondId) return
      // Fire and forget : le fond apparaît dès que le fichier est téléchargé.
      getPlan(fondId)
        .then((fond) => ensureFondShape(editor, fond))
        .catch((err) => {
          notify.error('Fond de plan indisponible : ' + (err?.message || err))
        })
    },
    [readOnly],
  )

  // ── Export PNG / PDF ───────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)

  async function exportImage() {
    const editor = editorRef.current
    const ids = editor ? [...editor.getCurrentPageShapeIds()] : []
    if (!ids.length) {
      notify.error('Rien à exporter : le plan est vide')
      return null
    }
    const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: 2, padding: 24 })
    return blob
  }

  async function handleExport(format) {
    if (exporting) return
    setExporting(true)
    try {
      const blob = await exportImage()
      if (!blob) return
      const nomFichier = (canvas?.titre || 'plan').replace(/[^a-zA-Z0-9À-ÿ ._-]/g, '').trim()
      if (format === 'png') {
        triggerDownload(URL.createObjectURL(blob), `${nomFichier}.png`)
      } else {
        const { jsPDF } = await import('jspdf')
        const dataUrl = await blobToDataURL(blob)
        const img = await loadImg(dataUrl)
        const landscape = img.width >= img.height
        const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
        const pw = pdf.internal.pageSize.getWidth()
        const ph = pdf.internal.pageSize.getHeight()
        const margin = 8
        const ratio = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height)
        const w = img.width * ratio
        const h = img.height * ratio
        pdf.addImage(dataUrl, 'PNG', (pw - w) / 2, (ph - h) / 2, w, h)
        pdf.save(`${nomFichier}.pdf`)
      }
    } catch (err) {
      notify.error('Export échoué : ' + (err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  // ── Fermeture : miniature (dataURL jpeg) + flush save ─────────────────────
  async function handleClose() {
    const editor = editorRef.current
    if (!readOnly && editor) {
      try {
        const ids = [...editor.getCurrentPageShapeIds()]
        if (ids.length) {
          const bounds = editor.getCurrentPageBounds()
          const scale = Math.min(1, 480 / Math.max(bounds?.width || 480, bounds?.height || 480))
          const { blob } = await editor.toImage(ids, { format: 'jpeg', background: true, scale, quality: 0.8 })
          const dataUrl = await blobToDataURL(blob)
          await updateCanvas(canvasId, { snapshot_svg: dataUrl, updated_by: user?.id })
        }
      } catch {
        // Miniature best-effort : ne bloque jamais la fermeture.
      }
    }
    onClose()
  }

  // ── Renommage + catégorie (top bar) ────────────────────────────────────────
  async function saveTitle(next) {
    setEditingTitle(false)
    const titre = next.trim()
    if (!titre || titre === canvas?.titre) return
    setCanvas((p) => ({ ...p, titre }))
    try {
      await updateCanvas(canvasId, { titre, updated_by: user?.id })
    } catch (err) {
      notify.error('Renommage impossible : ' + (err?.message || err))
    }
  }

  async function saveCategory(categoryId) {
    setCanvas((p) => ({ ...p, category_id: categoryId || null }))
    try {
      await updateCanvas(canvasId, { category_id: categoryId || null, updated_by: user?.id })
    } catch (err) {
      notify.error('Changement de catégorie impossible : ' + (err?.message || err))
    }
  }

  const body = (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-3 sm:px-4 h-12 shrink-0"
        style={{ borderBottom: '1px solid var(--brd)', background: 'var(--bg-elev)' }}
      >
        <button
          type="button"
          onClick={handleClose}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors"
          style={{ color: 'var(--txt-2)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hov)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {editingTitle && !readOnly ? (
            <input
              type="text"
              defaultValue={canvas?.titre || ''}
              autoFocus
              onBlur={(e) => saveTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle(e.currentTarget.value)
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              className="text-sm font-bold px-2 py-1 rounded-md outline-none min-w-0"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
            />
          ) : (
            <button
              type="button"
              onClick={() => !readOnly && setEditingTitle(true)}
              className="text-sm font-bold truncate text-left px-1 py-0.5 rounded-md"
              style={{ color: 'var(--txt)', cursor: readOnly ? 'default' : 'text' }}
              title={readOnly ? undefined : 'Renommer'}
            >
              {canvas?.titre || 'Plan'}
            </button>
          )}
          {!readOnly && canvas && (
            <select
              value={canvas.category_id || ''}
              onChange={(e) => saveCategory(e.target.value)}
              className="text-[11px] font-semibold px-1.5 py-1 rounded-md outline-none shrink-0"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
              title="Catégorie du plan"
            >
              <option value="">Sans catégorie</option>
              {categories
                .filter((c) => !c.is_archived || c.id === canvas.category_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </select>
          )}
        </div>

        {/* Export */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleExport('png')}
            disabled={exporting}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
            style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)', opacity: exporting ? 0.6 : 1 }}
            title="Exporter en PNG"
          >
            <Download className="w-3.5 h-3.5" />
            PNG
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={exporting}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
            style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)', opacity: exporting ? 0.6 : 1 }}
            title="Exporter en PDF"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>

        {/* Présence */}
        {peers.length > 0 && (
          <div
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md"
            style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
            title={peers.map((p) => p.name).join(', ')}
          >
            <Users className="w-3.5 h-3.5" />
            <div className="flex items-center -space-x-1.5">
              {peers.slice(0, 4).map((p) => (
                <span
                  key={p.clientId}
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                  style={{ background: p.color, border: '2px solid var(--bg-elev)' }}
                >
                  {(p.name || '?').slice(0, 1).toUpperCase()}
                </span>
              ))}
            </div>
            {peers.length > 4 && <span>+{peers.length - 4}</span>}
          </div>
        )}

        {/* Statut connexion + sauvegarde */}
        <div
          className="flex items-center gap-2 text-[11px]"
          style={{ color: 'var(--txt-3)' }}
          title={status === 'connected' ? 'Collaboration temps réel active' : 'Collaboration hors ligne'}
        >
          {status === 'connected' ? (
            <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--green)' }} />
          ) : (
            <WifiOff className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">
            {saveState === 'saving' ? 'Enregistrement…'
              : saveState === 'dirty' ? 'Modifications en attente'
              : saveState === 'saved' ? 'Enregistré'
              : ''}
          </span>
        </div>
      </div>

      {/* Corps : bibliothèque | canvas | layers-propriétés */}
      <div className="flex-1 flex min-h-0">
        {!readOnly && editorInstance && <LibraryPanel editor={editorInstance} />}

        <div className="flex-1 relative min-w-0">
          {loadError ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-sm" style={{ color: 'var(--red)' }}>
                Impossible de charger le plan : {loadError}
              </div>
            </div>
          ) : !canvas ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--txt-3)' }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              Chargement du plan…
            </div>
          ) : (
            <Tldraw
              store={store}
              shapeUtils={CUSTOM_SHAPE_UTILS}
              getShapeVisibility={getShapeVisibility}
              components={TLDRAW_COMPONENTS}
              inferDarkMode
              onMount={handleMount}
            />
          )}
        </div>

        {!readOnly && editorInstance && <PlanSidePanel editor={editorInstance} />}
      </div>
    </div>
  )

  return createPortal(body, document.body)
}

/* ─── Helpers export ─────────────────────────────────────────────────────── */

function triggerDownload(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
