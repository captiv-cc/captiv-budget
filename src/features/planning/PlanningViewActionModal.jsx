/**
 * PlanningViewActionModal — Modal intégré pour renommer ou supprimer une
 * vue planning. Remplace window.prompt / window.confirm pour une UI cohérente
 * avec le reste de l'app (convention de EventMoveScopeModal.jsx).
 *
 * Props :
 *   - mode       : 'rename' | 'delete'
 *   - view       : PlanningView
 *   - onConfirm  : (nextName?) => void
 *                  — mode 'rename' : reçoit le nouveau nom (string non vide,
 *                    trimé). N'est pas appelé si le nom est vide ou inchangé.
 *                  — mode 'delete' : appelé sans argument.
 *   - onCancel   : () => void
 *   - busy       : boolean (optionnel) — désactive les boutons pendant l'IO.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Pencil, Trash2 } from 'lucide-react'

export default function PlanningViewActionModal({
  mode,
  view,
  onConfirm,
  onCancel,
  busy = false,
}) {
  const isDelete = mode === 'delete'
  const [name, setName] = useState(view?.name || '')
  const inputRef = useRef(null)

  // Re-synchronise quand la vue change (ouvrir modal successivement sur des vues différentes)
  useEffect(() => {
    setName(view?.name || '')
  }, [view?.id, view?.name])

  // Auto-focus + sélection du nom en mode rename
  useEffect(() => {
    if (isDelete) return
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [isDelete])

  // Escape → annule
  const handleCancel = useCallback(() => {
    if (busy) return
    onCancel?.()
  }, [busy, onCancel])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleCancel])

  function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    if (isDelete) {
      onConfirm?.()
      return
    }
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed === view?.name) {
      // aucun changement — équivalent à annuler, évite un roundtrip inutile
      onCancel?.()
      return
    }
    onConfirm?.(trimmed)
  }

  const title = isDelete ? 'Supprimer la vue ?' : 'Renommer la vue'
  const confirmLabel = isDelete ? 'Supprimer' : 'Renommer'
  const confirmBg = isDelete ? 'var(--red)' : 'var(--blue)'
  const confirmDisabled = busy || (!isDelete && !name.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={handleCancel}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-label={title}
        className="w-full max-w-md rounded-2xl flex flex-col gap-4 p-5"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {isDelete ? (
              <Trash2 className="w-4 h-4" style={{ color: 'var(--red)' }} />
            ) : (
              <Pencil className="w-4 h-4" style={{ color: 'var(--txt-2)' }} />
            )}
            <h3 className="text-base font-semibold" style={{ color: 'var(--txt)' }}>
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Fermer"
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-elev)]"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isDelete ? (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--txt-2)' }}>
            La vue{' '}
            <strong style={{ color: 'var(--txt)' }}>« {view?.name} »</strong>{' '}
            sera supprimée définitivement. Les événements sous-jacents ne sont
            pas affectés — seule cette configuration de vue est perdue.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="planning-view-rename-input"
              className="text-[11px] uppercase tracking-wide"
              style={{ color: 'var(--txt-3)' }}
            >
              Nom de la vue
            </label>
            <input
              ref={inputRef}
              id="planning-view-rename-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mois — tournages"
              maxLength={120}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ color: 'var(--txt-3)' }}
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={confirmDisabled}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{
              background: confirmBg,
              color: '#fff',
              border: `1px solid ${confirmBg}`,
            }}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
