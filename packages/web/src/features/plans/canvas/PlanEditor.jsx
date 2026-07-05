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
import { ArrowLeft, Download, History, Image as ImageIcon, Loader2, Ruler, Share2, Users, Wifi, WifiOff, X } from 'lucide-react'
import { getCanvas, saveCanvasState, updateCanvas } from '../../../lib/plansCanvas'
import { listComments, subscribeToComments } from '../../../lib/plansCanvasShare'
import { getPlan, listPlanCategories } from '../../../lib/plans'
import {
  makeCaptivAssetStore,
  ensureFondShape,
  FOND_SHAPE_ID,
  FOND_ASSET_ID,
} from '../../../lib/plansCanvasFond'
import FondPickerModal from './FondPickerModal'
import { useYjsTldraw, encodeDocState } from '../../../hooks/useYjsTldraw'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'
import { CameraShapeUtil } from './shapes/CameraShapeUtil'
import { ItemShapeUtil } from './shapes/ItemShapeUtil'
import { RailCamShapeUtil } from './shapes/RailCamShapeUtil'
import { SpiderCamShapeUtil } from './shapes/SpiderCamShapeUtil'
import { ZoneShapeUtil } from './shapes/ZoneShapeUtil'
import { CotationShapeUtil } from './shapes/CotationShapeUtil'
import { CAPTIV_SHAPE_TYPES } from './shapes/camUtils'
import { setPageMetersPerPx } from './shapes/scale'
import LibraryPanel, { LIB_DRAG_MIME, placeCatalogItem } from './LibraryPanel'
import PlanSidePanel from './PlanSidePanel'
import PlanShareModal from './PlanShareModal'
import PlanVersionsModal from './PlanVersionsModal'
import PlanCommentMarkers from './PlanCommentMarkers'
import { exportPlanPdf } from '../../../lib/planPdfExport'

const STATUT_BADGE = {
  brouillon: { label: 'Brouillon', color: '#a8a8a8' },
  partage_client: { label: 'Partagé', color: '#4d9fff' },
  valide: { label: 'Validé', color: '#00c875' },
}

const AUTOSAVE_MS = 2000
const CUSTOM_SHAPE_UTILS = [
  CameraShapeUtil,
  ItemShapeUtil,
  RailCamShapeUtil,
  SpiderCamShapeUtil,
  ZoneShapeUtil,
  CotationShapeUtil,
]

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
      return sel.length > 0 && sel.every((s) => CAPTIV_SHAPE_TYPES.includes(s.type))
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
      // Réplique l'échelle persistée dans la meta de page (lue par les
      // cotations/zones). Léger différé : laisse la sync Yjs initiale poser
      // une éventuelle meta déjà présente dans le doc.
      const ratio = canvasRef.current?.echelle_ratio
      if (ratio) {
        setTimeout(() => {
          try {
            const page = editor.getCurrentPage()
            if (page && !page.meta?.metersPerPx) setPageMetersPerPx(editor, Number(ratio))
          } catch {
            /* noop */
          }
        }, 600)
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

  // ── Étalonnage de l'échelle (2 clics + distance réelle) ───────────────────
  const [calibrating, setCalibrating] = useState(false)
  const [calibPoints, setCalibPoints] = useState([]) // [{page:{x,y}, screen:{x,y}}]
  const [calibMeters, setCalibMeters] = useState('')

  function startCalibration() {
    setCalibrating(true)
    setCalibPoints([])
    setCalibMeters('')
  }

  function cancelCalibration() {
    setCalibrating(false)
    setCalibPoints([])
  }

  function handleCalibClick(e) {
    const editor = editorRef.current
    if (!editor) return
    const rect = e.currentTarget.getBoundingClientRect()
    const page = editor.screenToPage({ x: e.clientX, y: e.clientY })
    const point = { page, screen: { x: e.clientX - rect.left, y: e.clientY - rect.top } }
    setCalibPoints((prev) => (prev.length >= 2 ? prev : [...prev, point]))
  }

  async function applyCalibration(e) {
    e.preventDefault()
    const meters = parseFloat(String(calibMeters).replace(',', '.'))
    if (!meters || meters <= 0 || calibPoints.length !== 2) return
    const [p1, p2] = calibPoints
    const distPx = Math.hypot(p2.page.x - p1.page.x, p2.page.y - p1.page.y)
    if (distPx < 1) {
      notify.error('Les deux points sont trop proches')
      return
    }
    const metersPerPx = meters / distPx
    try {
      setPageMetersPerPx(editorRef.current, metersPerPx)
      await updateCanvas(canvasId, { echelle_ratio: metersPerPx, updated_by: user?.id })
      setCanvas((p) => ({ ...p, echelle_ratio: metersPerPx }))
      notify.success('Échelle définie : les cotations et zones affichent des mètres')
    } catch (err) {
      notify.error('Enregistrement de l’échelle impossible : ' + (err?.message || err))
    }
    cancelCalibration()
  }

  // ── Partage client + commentaires ancrés ──────────────────────────────────
  const [shareOpen, setShareOpen] = useState(false)
  const [comments, setComments] = useState([])
  const [selectedCommentId, setSelectedCommentId] = useState(null)

  useEffect(() => {
    if (!canvas?.id) return undefined
    let alive = true
    const refresh = () =>
      listComments(canvasId)
        .then((rows) => {
          if (alive) setComments(rows)
        })
        .catch(() => {})
    refresh()
    const unsubscribe = subscribeToComments(canvasId, refresh)
    return () => {
      alive = false
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas?.id, canvasId])

  const focusComment = useCallback((comment) => {
    setSelectedCommentId(comment.id)
    const editor = editorRef.current
    if (editor && comment.anchor_x != null) {
      editor.centerOnPoint(
        { x: Number(comment.anchor_x), y: Number(comment.anchor_y) },
        { animation: { duration: 250 } },
      )
    }
  }, [])

  // ── Remplacement du fond de plan ───────────────────────────────────────────
  const [fondModalOpen, setFondModalOpen] = useState(false)

  async function replaceFond(fond) {
    const editor = editorRef.current
    if (!editor) return
    try {
      // 1. Persiste le choix sur la row.
      await updateCanvas(canvasId, { fond_id: fond?.id || null, updated_by: user?.id })
      setCanvas((p) => ({ ...p, fond_id: fond?.id || null }))

      // 2. Retire l'ancien fond du document (en mémorisant son état visuel).
      const old = editor.getShape(FOND_SHAPE_ID)
      const prevState = old ? { opacity: old.opacity, hidden: old.meta?.hidden } : null
      if (old) {
        if (old.isLocked) editor.updateShape({ id: old.id, type: old.type, isLocked: false })
        editor.deleteShapes([FOND_SHAPE_ID])
      }
      if (editor.getAsset(FOND_ASSET_ID)) editor.deleteAssets([FOND_ASSET_ID])

      // 3. Insère le nouveau (synchronisé Yjs → visible en live chez les
      //    collaborateurs), en réappliquant opacité/visibilité de couche.
      if (fond) {
        await ensureFondShape(editor, fond)
        if (prevState && (prevState.opacity != null || prevState.hidden)) {
          const created = editor.getShape(FOND_SHAPE_ID)
          if (created) {
            editor.updateShape({ id: created.id, type: created.type, isLocked: false })
            editor.updateShape({
              id: created.id,
              type: created.type,
              opacity: prevState.opacity ?? 1,
              meta: { ...created.meta, hidden: prevState.hidden || false },
              isLocked: true,
            })
          }
        }
      }
      setFondModalOpen(false)
      notify.success(fond ? 'Fond de plan remplacé' : 'Fond de plan retiré')
    } catch (err) {
      notify.error('Remplacement du fond échoué : ' + (err?.message || err))
    }
  }

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
      if (format === 'png') {
        const blob = await exportImage()
        if (!blob) return
        const nomFichier = (canvas?.titre || 'plan').replace(/[^a-zA-Z0-9À-ÿ ._-]/g, '').trim()
        triggerDownload(URL.createObjectURL(blob), `${nomFichier}.png`)
      } else {
        const catLabel = categories.find((c) => c.id === canvas?.category_id)?.label
        const ok = await exportPlanPdf(editorRef.current, {
          titre: canvas?.titre || 'Plan technique',
          sousTitre: catLabel || '',
          footer: 'Généré par Captiv DESK',
        })
        if (!ok) notify.error('Rien à exporter : le plan est vide')
      }
    } catch (err) {
      notify.error('Export échoué : ' + (err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  // ── Miniature JPEG de l'état courant (cards + versions) ──────────────────
  const makeThumbnail = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return null
    const ids = [...editor.getCurrentPageShapeIds()]
    if (!ids.length) return null
    const bounds = editor.getCurrentPageBounds()
    const scale = Math.min(1, 480 / Math.max(bounds?.width || 480, bounds?.height || 480))
    const { blob } = await editor.toImage(ids, { format: 'jpeg', background: true, scale, quality: 0.8 })
    return blobToDataURL(blob)
  }, [])

  // ── Versions figées ────────────────────────────────────────────────────────
  const [versionsOpen, setVersionsOpen] = useState(false)

  // ── Fermeture : miniature (dataURL jpeg) + flush save ─────────────────────
  async function handleClose() {
    const editor = editorRef.current
    if (!readOnly && editor) {
      try {
        const dataUrl = await makeThumbnail()
        if (dataUrl) await updateCanvas(canvasId, { snapshot_svg: dataUrl, updated_by: user?.id })
      } catch {
        // Miniature best-effort : ne bloque jamais la fermeture.
      }
    }
    onClose()
  }

  // Statut pilotable par l'équipe : valider / dévalider manuellement
  // (ex. le destinataire a validé oralement, ou le plan a changé après
  // validation et doit repasser en « Partagé »).
  async function saveStatut(statut) {
    setCanvas((p) => ({ ...p, statut }))
    try {
      await updateCanvas(canvasId, { statut, updated_by: user?.id })
    } catch (err) {
      notify.error('Changement de statut impossible : ' + (err?.message || err))
    }
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
          {canvas && STATUT_BADGE[canvas.statut] && (
            readOnly ? (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                style={{
                  background: `${STATUT_BADGE[canvas.statut].color}22`,
                  color: STATUT_BADGE[canvas.statut].color,
                  border: `1px solid ${STATUT_BADGE[canvas.statut].color}55`,
                }}
              >
                {STATUT_BADGE[canvas.statut].label}
              </span>
            ) : (
              <select
                value={canvas.statut}
                onChange={(e) => saveStatut(e.target.value)}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 outline-none cursor-pointer"
                style={{
                  background: `${STATUT_BADGE[canvas.statut].color}22`,
                  color: STATUT_BADGE[canvas.statut].color,
                  border: `1px solid ${STATUT_BADGE[canvas.statut].color}55`,
                }}
                title="Statut du plan : valider ou dévalider manuellement"
              >
                <option value="brouillon">Brouillon</option>
                <option value="partage_client">Partagé</option>
                <option value="valide">Validé</option>
              </select>
            )
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

        {/* Partage + Fond + Export */}
        <div className="flex items-center gap-1.5">
          {!readOnly && canvas && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
              style={{ background: 'var(--blue)', color: '#fff' }}
              title="Partager le plan (lien lecture seule + commentaires)"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Partager</span>
            </button>
          )}
          {!readOnly && canvas && (
            <button
              type="button"
              onClick={() => setVersionsOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
              title="Versions figées du plan (créer / restaurer)"
            >
              <History className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Versions</span>
            </button>
          )}
          {!readOnly && canvas && (
            <button
              type="button"
              onClick={calibrating ? cancelCalibration : startCalibration}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
              style={{
                background: calibrating ? 'var(--blue-bg)' : 'var(--bg)',
                border: '1px solid var(--brd)',
                color: calibrating ? 'var(--blue)' : canvas.echelle_ratio ? 'var(--green, #00c875)' : 'var(--txt-2)',
              }}
              title={
                canvas.echelle_ratio
                  ? `Échelle définie : 1 m ≈ ${Math.round(1 / Number(canvas.echelle_ratio))} px — cliquer pour ré-étalonner`
                  : 'Définir l’échelle : cliquer 2 points de distance connue sur le plan'
              }
            >
              <Ruler className="w-3.5 h-3.5" />
              {calibrating ? 'Annuler' : 'Échelle'}
            </button>
          )}
          {!readOnly && canvas && (
            <button
              type="button"
              onClick={() => setFondModalOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
              title="Remplacer ou retirer le fond de plan"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Fond
            </button>
          )}
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

        <div
          className="flex-1 relative min-w-0"
          // Drag & drop depuis la bibliothèque : posé au point exact du drop.
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(LIB_DRAG_MIME)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(e) => {
            const kind = e.dataTransfer.getData(LIB_DRAG_MIME)
            const editor = editorRef.current
            if (!kind || !editor) return
            e.preventDefault()
            e.stopPropagation()
            const point = editor.screenToPage({ x: e.clientX, y: e.clientY })
            placeCatalogItem(editor, kind, point)
          }}
        >
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
            >
              <PlanCommentMarkers
                comments={comments}
                selectedId={selectedCommentId}
                onSelect={(id) => {
                  const c = comments.find((x) => x.id === id)
                  if (c) focusComment(c)
                }}
              />
            </Tldraw>
          )}

          {/* Étalonnage : capture des 2 clics + repères visuels */}
          {calibrating && (
            <div
              className="absolute inset-0"
              style={{ zIndex: 500, cursor: 'crosshair' }}
              onClick={handleCalibClick}
            >
              <div
                className="absolute top-3 left-1/2 -translate-x-1/2 text-xs font-semibold px-3 py-2 rounded-lg pointer-events-none"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
              >
                {calibPoints.length === 0
                  ? 'Clique un premier point de distance connue (ex : un côté de la scène)'
                  : calibPoints.length === 1
                    ? 'Clique le second point'
                    : 'Indique la distance réelle'}
              </div>
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {calibPoints.length === 2 && (
                  <line
                    x1={calibPoints[0].screen.x}
                    y1={calibPoints[0].screen.y}
                    x2={calibPoints[1].screen.x}
                    y2={calibPoints[1].screen.y}
                    stroke="var(--blue)"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                  />
                )}
                {calibPoints.map((p, i) => (
                  <circle key={i} cx={p.screen.x} cy={p.screen.y} r="5" fill="var(--blue)" stroke="#fff" strokeWidth="2" />
                ))}
              </svg>
            </div>
          )}

          {/* Distance réelle entre les 2 points */}
          {calibrating && calibPoints.length === 2 && (
            <form
              onSubmit={applyCalibration}
              className="absolute left-1/2 top-16 -translate-x-1/2 flex items-center gap-2 p-3 rounded-xl"
              style={{ zIndex: 600, background: 'var(--bg-elev)', border: '1px solid var(--brd)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}
            >
              <span className="text-xs font-semibold" style={{ color: 'var(--txt)' }}>
                Distance réelle :
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={calibMeters}
                onChange={(e) => setCalibMeters(e.target.value)}
                autoFocus
                placeholder="12,5"
                className="w-20 text-sm px-2 py-1.5 rounded-md outline-none"
                style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--txt-2)' }}>
                m
              </span>
              <button
                type="submit"
                className="text-xs font-semibold px-3 py-1.5 rounded-md"
                style={{ background: 'var(--blue)', color: '#fff' }}
              >
                Définir
              </button>
              <button type="button" onClick={cancelCalibration} className="p-1" style={{ color: 'var(--txt-3)' }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          )}
        </div>

        {!readOnly && editorInstance && (
          <PlanSidePanel
            editor={editorInstance}
            canvasId={canvasId}
            comments={comments}
            selectedCommentId={selectedCommentId}
            onFocusComment={focusComment}
          />
        )}
      </div>

      {shareOpen && canvas && (
        <PlanShareModal
          canvas={canvas}
          onClose={() => setShareOpen(false)}
          onStatutChange={(statut) => setCanvas((p) => ({ ...p, statut }))}
        />
      )}

      {versionsOpen && canvas && editorInstance && (
        <PlanVersionsModal
          canvas={canvas}
          editor={editorInstance}
          getYdocState={() => (docRef.current ? encodeDocState(docRef.current) : null)}
          makeSnapshot={makeThumbnail}
          onClose={() => setVersionsOpen(false)}
          onVersionCreated={(row) =>
            setCanvas((p) => ({ ...p, version_current: row.version + 1 }))
          }
        />
      )}

      {fondModalOpen && canvas && (
        <FondPickerModal
          projectId={canvas.project_id}
          currentFondId={canvas.fond_id}
          onClose={() => setFondModalOpen(false)}
          onPick={replaceFond}
        />
      )}
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
