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

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { ArrowLeft, Loader2, Users, Wifi, WifiOff } from 'lucide-react'
import { getCanvas, saveCanvasState } from '../../../lib/plansCanvas'
import { useYjsTldraw, encodeDocState } from '../../../hooks/useYjsTldraw'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'

const AUTOSAVE_MS = 2000

export default function PlanEditor({ canvasId, onClose }) {
  const { user } = useAuth()
  const [canvas, setCanvas] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveState, setSaveState] = useState('idle') // idle | dirty | saving | saved

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
    // On attend d'avoir chargé la row pour ne pas rater la restauration.
    enabled: Boolean(canvas),
  })
  docRef.current = doc

  const body = (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-3 sm:px-4 h-12 shrink-0"
        style={{ borderBottom: '1px solid var(--brd)', background: 'var(--bg-elev)' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors"
          style={{ color: 'var(--txt-2)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hov)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate" style={{ color: 'var(--txt)' }}>
            {canvas?.titre || 'Plan'}
          </div>
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

      {/* Canvas */}
      <div className="flex-1 relative">
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
          <Tldraw store={store} inferDarkMode />
        )}
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
