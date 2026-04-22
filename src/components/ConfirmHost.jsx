// ════════════════════════════════════════════════════════════════════════════
// ConfirmHost — monté une seule fois dans App.jsx, rend Confirm / Prompt dialogs
// ════════════════════════════════════════════════════════════════════════════
//
// Écoute l'émetteur `subscribeConfirm` de src/lib/confirm.js et rend le dialog
// quand une demande arrive. Plusieurs demandes successives sont empilées
// (LIFO — la dernière s'affiche devant).
//
// Deux types de dialogs :
//   - type: 'confirm' → question oui/non, résout avec boolean
//   - type: 'prompt'  → champ texte, résout avec string (ou null si cancel)
//
// L'API impérative est dans src/lib/confirm.js (`await confirm({...})` et
// `await prompt({...})`). Ce composant est purement le rendu visuel + la
// plomberie résolveur.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { subscribeConfirm } from '../lib/confirm'

export default function ConfirmHost() {
  const [queue, setQueue] = useState([]) // pile de demandes actives

  useEffect(() => {
    return subscribeConfirm((req) => {
      setQueue((q) => [...q, req])
    })
  }, [])

  const top = queue[queue.length - 1] || null

  // Cancel : selon le type, renvoie false (confirm) ou null (prompt).
  const handleCancel = useCallback(() => {
    if (!top) return
    top.resolve(top.type === 'prompt' ? null : false)
    setQueue((q) => q.filter((r) => r.id !== top.id))
  }, [top])

  // Confirm : selon le type, renvoie true (confirm) ou la string saisie (prompt).
  const handleConfirm = useCallback(
    (value) => {
      if (!top) return
      if (top.type === 'prompt') {
        top.resolve(typeof value === 'string' ? value : '')
      } else {
        top.resolve(true)
      }
      setQueue((q) => q.filter((r) => r.id !== top.id))
    },
    [top],
  )

  if (!top) return null

  return createPortal(
    <Dialog
      key={top.id}
      request={top}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />,
    document.body,
  )
}

// ─── Dialog (confirm + prompt unifié) ────────────────────────────────────────

function Dialog({ request, onConfirm, onCancel }) {
  const {
    type = 'confirm',
    title,
    message,
    confirmLabel,
    cancelLabel,
    danger,
    placeholder,
    initialValue = '',
    required = false,
    multiline = false,
  } = request

  const confirmBtnRef = useRef(null)
  const inputRef = useRef(null)
  const [value, setValue] = useState(initialValue)

  const isPrompt = type === 'prompt'
  const submitDisabled = isPrompt && required && !value.trim()

  // Focus auto : input si prompt (sinon bouton OK). Gestion Escape/Enter.
  useEffect(() => {
    if (isPrompt) {
      inputRef.current?.focus()
      // Sélectionne la valeur initiale si présente, pour un remplacement rapide.
      if (initialValue) inputRef.current?.select?.()
    } else {
      confirmBtnRef.current?.focus()
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key === 'Enter') {
        const tag = (document.activeElement?.tagName || '').toLowerCase()
        // Dans une textarea multiline, Entrée = saut de ligne. Shift+Entrée
        // soumet (UX type Slack inversée — ici on veut permettre les sauts
        // de ligne dans une raison longue).
        if (isPrompt && multiline && tag === 'textarea' && !e.shiftKey) return
        // Autrement, Entrée soumet (sauf dans une textarea sans shift).
        if (!submitDisabled) {
          e.preventDefault()
          onConfirm(isPrompt ? value : true)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isPrompt, multiline, onCancel, onConfirm, submitDisabled, value, initialValue])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          {danger && (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'var(--red-bg)' }}
            >
              <AlertTriangle className="w-5 h-5" style={{ color: 'var(--red)' }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {title && (
              <h3
                className="text-sm font-bold mb-1"
                style={{ color: 'var(--txt)' }}
              >
                {title}
              </h3>
            )}
            {message && (
              <p
                className="text-xs"
                style={{ color: 'var(--txt-2)', lineHeight: 1.55, whiteSpace: 'pre-line' }}
              >
                {message}
              </p>
            )}
          </div>
        </div>

        {/* Champ input (uniquement pour le type prompt) */}
        {isPrompt && (
          <div className="px-5 pb-4">
            {multiline ? (
              <textarea
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                rows={3}
                className="w-full px-3 py-2 rounded-md text-sm resize-none"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                className="w-full px-3 py-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            )}
          </div>
        )}

        {/* Footer boutons */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{
            background: 'var(--bg-elev)',
            borderTop: '1px solid var(--brd-sub)',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-2)'
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => onConfirm(isPrompt ? value : true)}
            disabled={submitDisabled}
            className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: danger ? 'var(--red)' : 'var(--blue)',
              color: '#fff',
              border: '1px solid transparent',
            }}
            onMouseEnter={(e) => {
              if (submitDisabled) return
              e.currentTarget.style.filter = 'brightness(1.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'none'
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
