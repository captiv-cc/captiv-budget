// ════════════════════════════════════════════════════════════════════════════
// PlanClientView — page publique /plans/share/:token (lecture seule client)
// ════════════════════════════════════════════════════════════════════════════
//
// Servie par l'edge function plans-public (token, pas d'auth Supabase) :
//   - canvas tldraw en lecture seule (doc reconstruit depuis ydoc_state) ;
//   - assets résolus via URLs signées (action sign-assets, chemins du projet
//     uniquement), PDF rasterisés côté client (planMedia) ;
//   - commentaires ancrés : marqueurs numérotés, threads, mode « Commenter »
//     (clic sur le plan) si le lien le permet ;
//   - bouton « Valider le plan » (statut → valide) ;
//   - téléchargement PNG.
//
// Design aligné sur les pages client devis (liquid glass, SharePageHeader).
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
import SharePageHeader from '../../../components/share/SharePageHeader'
import PlanCommentMarkers from './PlanCommentMarkers'
import { CameraShapeUtil } from './shapes/CameraShapeUtil'
import { ItemShapeUtil } from './shapes/ItemShapeUtil'
import { RailCamShapeUtil } from './shapes/RailCamShapeUtil'
import { SpiderCamShapeUtil } from './shapes/SpiderCamShapeUtil'

const CUSTOM_SHAPE_UTILS = [CameraShapeUtil, ItemShapeUtil, RailCamShapeUtil, SpiderCamShapeUtil]

// UI tldraw minimale pour la consultation.
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
  const store = useMemo(() => {
    if (!data?.ydocState) return null
    const s = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...CUSTOM_SHAPE_UTILS],
      bindingUtils: [...defaultBindingUtils],
      assets: assetStore,
    })
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
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.ydocState])

  const handleMount = useCallback((editor) => {
    editorRef.current = editor
    editor.updateInstanceState({ isReadonly: true })
    editor.zoomToFit()
  }, [])

  // ── Actions client ──────────────────────────────────────────────────────
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

  async function handleExportPng() {
    const editor = editorRef.current
    if (!editor || exporting) return
    setExporting(true)
    try {
      const ids = [...editor.getCurrentPageShapeIds()]
      if (!ids.length) return
      const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: 2, padding: 24 })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${(data?.plan?.titre || 'plan').replace(/[^a-zA-Z0-9À-ÿ ._-]/g, '')}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setExporting(false)
    }
  }

  // ── Rendus d'état ───────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0b0d10' }}>
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
      <div className="min-h-screen flex items-center justify-center gap-2 text-sm" style={{ background: '#0b0d10', color: 'rgba(255,255,255,0.6)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Chargement du plan…
      </div>
    )
  }

  const { plan, project, org } = data
  const isValide = plan.statut === 'valide'
  const selectedComment = comments.find((c) => c.id === selectedId) || null

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0b0d10' }}>
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-4 flex-1">
        <SharePageHeader
          kicker="Plan technique"
          pageTitle={plan.titre}
          project={{ title: project?.title, ref_projet: project?.ref_projet, cover_url: project?.cover_url }}
          org={org}
          metaItems={[
            { type: 'label', value: `Mis à jour le ${new Date(plan.updated_at).toLocaleDateString('fr-FR')}` },
            isValide && { type: 'label', value: '✓ Validé' },
          ].filter(Boolean)}
        />

        {/* Barre d'actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {canComment && (
            <button
              type="button"
              onClick={() => {
                setCommentMode((v) => !v)
                setDraft(null)
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
              style={{
                background: commentMode ? '#facc15' : 'rgba(255,255,255,0.12)',
                color: commentMode ? '#1c1917' : '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <MessageCirclePlus className="w-3.5 h-3.5" />
              {commentMode ? 'Cliquez sur le plan…' : 'Commenter'}
            </button>
          )}
          <button
            type="button"
            onClick={handleExportPng}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white"
            style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', opacity: exporting ? 0.6 : 1 }}
          >
            <Download className="w-3.5 h-3.5" />
            Télécharger PNG
          </button>
          <div className="flex-1" />
          {!isValide ? (
            <button
              type="button"
              onClick={handleValidate}
              disabled={validating}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold"
              style={{ background: '#00c875', color: '#04140c', opacity: validating ? 0.6 : 1 }}
            >
              {validating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Valider le plan
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold" style={{ background: 'rgba(0,200,117,0.15)', color: '#00c875', border: '1px solid rgba(0,200,117,0.4)' }}>
              <BadgeCheck className="w-4 h-4" />
              Plan validé
            </span>
          )}
        </div>

        {/* Canvas */}
        <div
          className="relative flex-1 rounded-xl overflow-hidden"
          style={{ minHeight: '65vh', border: '1px solid rgba(255,255,255,0.12)', cursor: commentMode ? 'crosshair' : undefined }}
        >
          {store && (
            <Tldraw
              store={store}
              shapeUtils={CUSTOM_SHAPE_UTILS}
              getShapeVisibility={getShapeVisibility}
              components={READONLY_COMPONENTS}
              onMount={handleMount}
            >
              <PlanCommentMarkers comments={comments} selectedId={selectedId} onSelect={setSelectedId} />
            </Tldraw>
          )}
          {/* Capture du clic en mode commentaire (au-dessus du canvas) */}
          {commentMode && !draft && (
            <div className="absolute inset-0" style={{ zIndex: 500, cursor: 'crosshair' }} onClick={handleCanvasClick} />
          )}
          {/* Bulle nouveau commentaire */}
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
          {/* Thread du commentaire sélectionné */}
          {selectedComment && !draft && (
            <CommentThreadPanel
              comment={selectedComment}
              replies={comments.filter((c) => c.parent_id === selectedComment.id)}
              canComment={canComment}
              onClose={() => setSelectedId(null)}
              onReply={async ({ body, clientName }) =>
                submitComment({ body, clientName, parentId: selectedComment.id })
              }
            />
          )}
        </div>

        <div className="text-[11px] text-center pb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Plan partagé en lecture seule
          {canComment ? ' — cliquez sur « Commenter » pour annoter une zone.' : '.'}
        </div>
      </div>
    </div>
  )
}

/* ─── Bulle de création de commentaire ──────────────────────────────────── */

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
        left: Math.max(8, Math.min(screen.x, window.innerWidth - 280)),
        top: screen.y + 10,
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

/* ─── Thread d'un commentaire sélectionné ───────────────────────────────── */

function CommentThreadPanel({ comment, replies, canComment, onClose, onReply }) {
  const [busy, setBusy] = useState(false)
  const [body, setBody] = useState('')
  const [name] = useState(() => {
    try {
      return localStorage.getItem(CLIENT_NAME_KEY) || ''
    } catch {
      return ''
    }
  })

  async function handleReply(e) {
    e.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    try {
      await onReply({ body: body.trim(), clientName: name || 'Client' })
      setBody('')
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert('Envoi impossible : ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="absolute top-3 right-3 w-72 max-h-[70%] overflow-y-auto p-3 rounded-xl flex flex-col gap-2"
      style={{
        zIndex: 600,
        background: '#16181d',
        border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-white">
          {comment.author_client_name || comment.author?.full_name || 'Commentaire'}
        </span>
        <button type="button" onClick={onClose} style={{ color: 'rgba(255,255,255,0.5)' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="text-xs whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.8)' }}>
        {comment.body}
      </div>
      {replies.map((r) => (
        <div key={r.id} className="pl-2 py-1" style={{ borderLeft: '2px solid rgba(255,255,255,0.15)' }}>
          <div className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {r.author_type === 'client' ? r.author_client_name || 'Client' : r.author?.full_name || 'Équipe'}
          </div>
          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
            {r.body}
          </div>
        </div>
      ))}
      {canComment && (
        <form onSubmit={handleReply} className="flex items-center gap-1.5">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Répondre…"
            className="flex-1 min-w-0 text-xs px-2.5 py-2 rounded-md outline-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
          />
          <button type="submit" disabled={!body.trim() || busy} className="p-2 rounded-md" style={{ color: '#facc15' }}>
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  )
}
