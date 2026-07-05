// ════════════════════════════════════════════════════════════════════════════
// PlanClientView — page publique /plans/share/:token (lecture seule)
// ════════════════════════════════════════════════════════════════════════════
//
// Servie par l'edge function plans-public (token, pas d'auth Supabase).
// Layout maquette : top bar compacte (org + titre + actions PDF/Valider),
// canvas plein écran à gauche, sidebar droite Légende (dérivée des shapes) +
// Commentaires (threads, + Ajouter → clic sur le plan).
//
// Le canvas vit dans une chaîne flex à hauteur DÉFINIE (h-screen) : tldraw
// (height:100%) a besoin d'un parent à hauteur résolue, pas d'un min-height.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as Y from 'yjs'
import {
  Tldraw,
  createTLStore,
  defaultShapeUtils,
  defaultBindingUtils,
} from 'tldraw'
import 'tldraw/tldraw.css'
import {
  BadgeCheck,
  Check,
  Download,
  Loader2,
  MessageCirclePlus,
  Send,
  X,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { mediaFromBlob } from '../../../lib/planMedia'
import { base64ToUint8 } from '../../../hooks/useYjsTldraw'
import PlanCommentMarkers from './PlanCommentMarkers'
import { CameraShapeUtil } from './shapes/CameraShapeUtil'
import { ItemShapeUtil } from './shapes/ItemShapeUtil'
import { RailCamShapeUtil } from './shapes/RailCamShapeUtil'
import { SpiderCamShapeUtil } from './shapes/SpiderCamShapeUtil'
import { CAM_SHAPE_TYPES } from './shapes/camUtils'

const CUSTOM_SHAPE_UTILS = [CameraShapeUtil, ItemShapeUtil, RailCamShapeUtil, SpiderCamShapeUtil]

// UI tldraw minimale : navigation/zoom uniquement.
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

const CLIENT_NAME_KEY = 'plans-client-name'

const ERROR_LABELS = {
  not_found: 'Ce lien de plan n’existe pas ou a été supprimé.',
  revoked: 'Ce lien de partage a été désactivé.',
  expired: 'Ce lien de partage a expiré.',
}

/* ─── Légende dérivée des shapes du doc ─────────────────────────────────── */

function buildLegend(records) {
  const entries = []
  const camGroups = new Map() // support → { color, count }
  const itemGroups = new Map() // label → { color, count }
  records.forEach((r) => {
    if (r.typeName !== 'shape') return
    if (CAM_SHAPE_TYPES.includes(r.type)) {
      const key = r.props?.support || 'Caméra'
      const g = camGroups.get(key) || { color: r.props?.couleur || '#4d9fff', count: 0 }
      g.count += 1
      camGroups.set(key, g)
    } else if (r.type === 'captiv-item') {
      const key = r.props?.label || 'Élément'
      const g = itemGroups.get(key) || { color: r.props?.couleur || '#a8a8a8', count: 0 }
      g.count += 1
      itemGroups.set(key, g)
    }
  })
  camGroups.forEach((g, key) => entries.push({ label: `${key} (${g.count})`, color: g.color, kind: 'cam' }))
  itemGroups.forEach((g, key) =>
    entries.push({ label: g.count > 1 ? `${key} (${g.count})` : key, color: g.color, kind: 'item' }),
  )
  return entries.slice(0, 12)
}

export default function PlanClientView() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [comments, setComments] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [commentMode, setCommentMode] = useState(false)
  const [draft, setDraft] = useState(null) // { x, y } en coords page
  const [validating, setValidating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const editorRef = useRef(null)
  const loadedRef = useRef(null)

  // ── Chargement ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || loadedRef.current === token) return
    loadedRef.current = token
    supabase.functions
      .invoke('plans-public', { body: { token, action: 'get' } })
      .then(({ data: res, error: err }) => {
        if (err || res?.error) {
          setError(res?.error || 'unreachable')
          return
        }
        setData(res)
        setComments(res.comments || [])
      })
      .catch(() => setError('unreachable'))
  }, [token])

  // ── Assets : URLs signées + rasterisation locale ────────────────────────
  const mediaCache = useRef(new Map())
  const urlMapRef = useRef(Promise.resolve({}))
  const assetStore = useMemo(
    () => ({
      async upload() {
        throw new Error('Lecture seule')
      },
      async resolve(asset) {
        const path = asset.meta?.captivStoragePath
        if (!path) return asset.props.src ?? null
        const kind = asset.meta?.captivKind || 'image'
        const key = `${kind}:${path}`
        if (!mediaCache.current.has(key)) {
          mediaCache.current.set(
            key,
            (async () => {
              const urls = await urlMapRef.current
              const url = urls?.[path]
              if (!url) throw new Error('asset introuvable')
              const blob = await fetch(url).then((r) => r.blob())
              return mediaFromBlob(blob, kind)
            })().catch((e) => {
              mediaCache.current.delete(key)
              throw e
            }),
          )
        }
        return (await mediaCache.current.get(key)).url
      },
    }),
    [],
  )

  // ── Store tldraw reconstruit depuis l'état Yjs persisté ─────────────────
  const { store, legend } = useMemo(() => {
    if (!data?.ydocState) return { store: null, legend: [] }
    const s = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...CUSTOM_SHAPE_UTILS],
      bindingUtils: [...defaultBindingUtils],
      assets: assetStore,
    })
    let entries = []
    try {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, base64ToUint8(data.ydocState))
      const records = []
      doc.getMap('tldraw_records').forEach((r) => {
        if (r?.id) records.push(r)
      })
      doc.destroy()
      s.mergeRemoteChanges(() => {
        s.put(records)
      })
      entries = buildLegend(records)
      // Signe en une fois tous les fichiers référencés par le doc.
      const paths = records
        .filter((r) => r.typeName === 'asset' && r.meta?.captivStoragePath)
        .map((r) => r.meta.captivStoragePath)
      urlMapRef.current = paths.length
        ? supabase.functions
            .invoke('plans-public', { body: { token, action: 'sign-assets', paths } })
            .then(({ data: res }) => res?.urls || {})
        : Promise.resolve({})
    } catch (e) {
      console.warn('[PlanClientView] reconstruction du doc échouée', e)
    }
    return { store: s, legend: entries }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.ydocState])

  const handleMount = useCallback((editor) => {
    editorRef.current = editor
    editor.updateInstanceState({ isReadonly: true })
    editor.zoomToFit()
  }, [])

  // ── Actions ─────────────────────────────────────────────────────────────
  const canComment = data?.permissions === 'comment'

  function handleCanvasClick(e) {
    if (!commentMode || !editorRef.current) return
    const point = editorRef.current.screenToPage({ x: e.clientX, y: e.clientY })
    setDraft({ x: point.x, y: point.y })
  }

  async function submitComment({ body, clientName, parentId = null, anchor = null }) {
    const { data: res, error: err } = await supabase.functions.invoke('plans-public', {
      body: {
        token,
        action: 'comment',
        body,
        clientName,
        parentId,
        anchorX: anchor?.x,
        anchorY: anchor?.y,
      },
    })
    if (err || res?.error) throw new Error(res?.error || 'envoi impossible')
    try {
      localStorage.setItem(CLIENT_NAME_KEY, clientName)
    } catch {
      /* noop */
    }
    setComments((prev) => [...prev, res.comment])
    return res.comment
  }

  async function handleValidate() {
    if (validating) return
    // eslint-disable-next-line no-alert
    if (!window.confirm('Valider ce plan ? Votre validation sera visible par l’équipe.')) return
    setValidating(true)
    try {
      const { data: res, error: err } = await supabase.functions.invoke('plans-public', {
        body: { token, action: 'validate' },
      })
      if (err || res?.error) throw new Error(res?.error || 'validation impossible')
      setData((p) => ({ ...p, plan: { ...p.plan, statut: 'valide' } }))
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert('Validation impossible : ' + e.message)
    } finally {
      setValidating(false)
    }
  }

  async function exportImage() {
    const editor = editorRef.current
    if (!editor) return null
    const ids = [...editor.getCurrentPageShapeIds()]
    if (!ids.length) return null
    const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: 2, padding: 24 })
    return blob
  }

  async function handleExport(format) {
    if (exporting) return
    setExporting(true)
    try {
      const blob = await exportImage()
      if (!blob) return
      const nom = (data?.plan?.titre || 'plan').replace(/[^a-zA-Z0-9À-ÿ ._-]/g, '').trim()
      if (format === 'png') {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${nom}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
      } else {
        const { jsPDF } = await import('jspdf')
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        const img = await new Promise((resolve, reject) => {
          const el = new Image()
          el.onload = () => resolve(el)
          el.onerror = reject
          el.src = dataUrl
        })
        const landscape = img.width >= img.height
        const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
        const pw = pdf.internal.pageSize.getWidth()
        const ph = pdf.internal.pageSize.getHeight()
        const ratio = Math.min((pw - 16) / img.width, (ph - 16) / img.height)
        pdf.addImage(dataUrl, 'PNG', (pw - img.width * ratio) / 2, (ph - img.height * ratio) / 2, img.width * ratio, img.height * ratio)
        pdf.save(`${nom}.pdf`)
      }
    } finally {
      setExporting(false)
    }
  }

  function focusComment(comment) {
    setSelectedId(comment.id)
    const editor = editorRef.current
    if (editor && comment.anchor_x != null) {
      editor.centerOnPoint(
        { x: Number(comment.anchor_x), y: Number(comment.anchor_y) },
        { animation: { duration: 250 } },
      )
    }
  }

  // ── États d'erreur / chargement ─────────────────────────────────────────
  if (error) {
    return (
      <div className="h-screen flex items-center justify-center px-6" style={{ background: '#0b0d10' }}>
        <div className="text-center max-w-sm">
          <div className="text-base font-bold text-white mb-2">Plan indisponible</div>
          <div className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {ERROR_LABELS[error] || 'Une erreur est survenue. Réessaie plus tard.'}
          </div>
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="h-screen flex items-center justify-center gap-2 text-sm" style={{ background: '#0b0d10', color: 'rgba(255,255,255,0.6)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Chargement du plan…
      </div>
    )
  }

  const { plan, project, org } = data
  const isValide = plan.statut === 'valide'
  const selectedComment = comments.find((c) => c.id === selectedId) || null
  const orgName = org?.display_name || org?.legal_name || 'Captiv'
  const logo = org?.logo_url_sombre || org?.logo_url_clair || null
  const rootComments = comments.filter((c) => !c.parent_id)

  return (
    <div className="h-screen flex flex-col" style={{ background: '#0b0d10' }}>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 sm:px-5 h-14 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', background: '#101216' }}
      >
        {logo ? (
          <img src={logo} alt={orgName} className="h-6 max-w-[110px] object-contain" />
        ) : (
          <span className="text-sm font-bold text-white">{orgName}</span>
        )}
        <span className="hidden sm:block w-px h-5" style={{ background: 'rgba(255,255,255,0.15)' }} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold tracking-widest" style={{ color: 'rgba(255,255,255,0.45)' }}>
            PLAN TECHNIQUE{project?.title ? ` · ${project.title.toUpperCase()}` : ''}
          </div>
          <div className="text-sm font-bold text-white truncate leading-tight">{plan.titre}</div>
        </div>
        <button
          type="button"
          onClick={() => handleExport('pdf')}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white"
          style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)', opacity: exporting ? 0.6 : 1 }}
          title="Télécharger en PDF"
        >
          <Download className="w-3.5 h-3.5" />
          PDF
        </button>
        <button
          type="button"
          onClick={() => handleExport('png')}
          disabled={exporting}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white"
          style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)', opacity: exporting ? 0.6 : 1 }}
          title="Télécharger en PNG"
        >
          <Download className="w-3.5 h-3.5" />
          PNG
        </button>
        {!isValide ? (
          <button
            type="button"
            onClick={handleValidate}
            disabled={validating}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold"
            style={{ background: '#00c875', color: '#04140c', opacity: validating ? 0.6 : 1 }}
          >
            {validating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Valider
          </button>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
            style={{ background: 'rgba(0,200,117,0.15)', color: '#00c875', border: '1px solid rgba(0,200,117,0.4)' }}
          >
            <BadgeCheck className="w-4 h-4" />
            Validé
          </span>
        )}
      </div>

      {/* ── Corps : canvas + sidebar ────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 relative min-w-0" style={{ cursor: commentMode ? 'crosshair' : undefined }}>
          {store && (
            <Tldraw
              store={store}
              shapeUtils={CUSTOM_SHAPE_UTILS}
              getShapeVisibility={getShapeVisibility}
              components={READONLY_COMPONENTS}
              inferDarkMode
              onMount={handleMount}
            >
              <PlanCommentMarkers
                comments={comments}
                selectedId={selectedId}
                onSelect={(id) => {
                  const c = comments.find((x) => x.id === id)
                  if (c) focusComment(c)
                }}
              />
            </Tldraw>
          )}
          {commentMode && !draft && (
            <div className="absolute inset-0" style={{ zIndex: 500, cursor: 'crosshair' }} onClick={handleCanvasClick} />
          )}
          {draft && (
            <CommentDraftBubble
              editorRef={editorRef}
              draft={draft}
              onCancel={() => setDraft(null)}
              onSubmit={async ({ body, clientName }) => {
                await submitComment({ body, clientName, anchor: draft })
                setDraft(null)
                setCommentMode(false)
              }}
            />
          )}
        </div>

        {/* Sidebar droite : légende + commentaires */}
        <div
          className="w-72 shrink-0 flex-col hidden md:flex"
          style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', background: '#101216' }}
        >
          {legend.length > 0 && (
            <div className="p-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="text-[10px] font-bold tracking-widest mb-2.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                LÉGENDE
              </div>
              <div className="flex flex-col gap-1.5">
                {legend.map((entry) => (
                  <div key={entry.label} className="flex items-center gap-2">
                    {entry.kind === 'cam' ? (
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: entry.color }} />
                    ) : (
                      <span className="w-3 h-3 rounded-[3px] shrink-0" style={{ border: `2px solid ${entry.color}` }} />
                    )}
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>
                      {entry.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <span className="flex-1 text-[10px] font-bold tracking-widest" style={{ color: 'rgba(255,255,255,0.45)' }}>
                COMMENTAIRES · {rootComments.length}
              </span>
              {canComment && (
                <button
                  type="button"
                  onClick={() => {
                    setCommentMode((v) => !v)
                    setDraft(null)
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold"
                  style={{
                    background: commentMode ? '#facc15' : 'rgba(250,204,21,0.14)',
                    color: commentMode ? '#1c1917' : '#facc15',
                    border: '1px solid rgba(250,204,21,0.4)',
                  }}
                >
                  <MessageCirclePlus className="w-3 h-3" />
                  {commentMode ? 'Cliquez le plan…' : 'Ajouter'}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3">
              {rootComments.length === 0 && (
                <div className="text-xs px-1 py-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Aucun commentaire pour l’instant.
                  {canComment && ' Cliquez sur « Ajouter » puis sur le plan pour annoter une zone.'}
                </div>
              )}
              {rootComments.map((c, i) => (
                <SidebarComment
                  key={c.id}
                  comment={c}
                  index={c.anchor_x != null && !c.resolved ? i : null}
                  replies={comments.filter((r) => r.parent_id === c.id)}
                  isSelected={c.id === selectedId}
                  canComment={canComment}
                  onFocus={() => focusComment(c)}
                  onReply={async ({ body, clientName }) =>
                    submitComment({ body, clientName, parentId: c.id })
                  }
                />
              ))}
            </div>
          </div>

          <div className="px-4 py-2.5 text-[10px] text-center" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>
            Généré par {orgName} · lecture seule sécurisée
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Commentaire de la sidebar (thread + réponse) ──────────────────────── */

function SidebarComment({ comment, index, replies, isSelected, canComment, onFocus, onReply }) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const name = (() => {
    try {
      return localStorage.getItem(CLIENT_NAME_KEY) || ''
    } catch {
      return ''
    }
  })()

  async function handleReply(e) {
    e.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    try {
      await onReply({ body: body.trim(), clientName: name || 'Client' })
      setBody('')
      setReplyOpen(false)
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert('Envoi impossible : ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded-xl p-3 mb-2 cursor-pointer"
      style={{
        background: 'rgba(250,204,21,0.06)',
        border: isSelected ? '1px solid rgba(250,204,21,0.7)' : '1px solid rgba(250,204,21,0.18)',
      }}
      onClick={onFocus}
    >
      <div className="flex items-center gap-2 mb-1">
        {index != null && (
          <span
            className="w-5 h-5 rounded-full rounded-bl-none flex items-center justify-center text-[10px] font-bold shrink-0"
            style={{ background: '#facc15', color: '#1c1917' }}
          >
            {index + 1}
          </span>
        )}
        <span className="flex-1 text-xs font-bold text-white truncate">
          {comment.author_type === 'client'
            ? comment.author_client_name || 'Client'
            : comment.author?.full_name || 'Équipe'}
        </span>
        <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {new Date(comment.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
        </span>
      </div>
      <div className="text-xs whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.85)' }}>
        {comment.body}
      </div>
      {replies.map((r) => (
        <div key={r.id} className="mt-2 pl-2.5" style={{ borderLeft: '2px solid rgba(255,255,255,0.15)' }}>
          <div className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {r.author_type === 'client' ? r.author_client_name || 'Client' : r.author?.full_name || 'Équipe'}
          </div>
          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
            {r.body}
          </div>
        </div>
      ))}
      {canComment &&
        (replyOpen ? (
          <form className="flex items-center gap-1.5 mt-2" onClick={(e) => e.stopPropagation()} onSubmit={handleReply}>
            <input
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              autoFocus
              placeholder="Répondre…"
              className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-md outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
            />
            <button type="submit" disabled={!body.trim() || busy} className="p-1.5" style={{ color: '#facc15' }}>
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setReplyOpen(true)
            }}
            className="mt-1.5 text-[10px] font-bold"
            style={{ color: '#facc15' }}
          >
            Répondre
          </button>
        ))}
    </div>
  )
}

/* ─── Bulle de création de commentaire (sur le canvas) ──────────────────── */

function CommentDraftBubble({ editorRef, draft, onCancel, onSubmit }) {
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(CLIENT_NAME_KEY) || ''
    } catch {
      return ''
    }
  })
  const [body, setBody] = useState('')

  // Position écran de l'ancre (fixe au moment du clic, suffisant pour V1).
  const screen = editorRef.current
    ? (() => {
        const cam = editorRef.current.getCamera()
        return { x: (draft.x + cam.x) * cam.z, y: (draft.y + cam.y) * cam.z }
      })()
    : { x: 40, y: 40 }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit({ body: body.trim(), clientName: name.trim() || 'Client' })
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert('Envoi impossible : ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute w-64 p-3 rounded-xl flex flex-col gap-2"
      style={{
        zIndex: 600,
        left: Math.max(8, Math.min(screen.x, window.innerWidth - 380)),
        top: Math.max(60, screen.y + 10),
        background: '#16181d',
        border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-white">Nouveau commentaire</span>
        <button type="button" onClick={onCancel} style={{ color: 'rgba(255,255,255,0.5)' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Votre nom"
        className="text-xs px-2.5 py-2 rounded-md outline-none"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Votre remarque sur cette zone…"
        rows={3}
        autoFocus
        className="text-xs px-2.5 py-2 rounded-md outline-none resize-none"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
      />
      <button
        type="submit"
        disabled={!body.trim() || busy}
        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
        style={{ background: '#facc15', color: '#1c1917', opacity: !body.trim() || busy ? 0.6 : 1 }}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        Envoyer
      </button>
    </form>
  )
}
