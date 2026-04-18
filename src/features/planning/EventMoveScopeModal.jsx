/**
 * EventMoveScopeModal — Demande le scope d'une action sur une occurrence de série.
 *
 * Utilisé quand l'utilisateur drag/resize une occurrence d'un événement récurrent :
 * on lui demande si la modification s'applique à cette seule occurrence, ou à
 * toute la série.
 *
 * Props :
 *   - title       : string (ex. "Déplacer l'événement")
 *   - description : string explicatif
 *   - onThis      : fn() — applique à cette occurrence seulement
 *   - onAll       : fn() — applique à toute la série
 *   - onCancel    : fn() — annule
 */
import { X } from 'lucide-react'

export default function EventMoveScopeModal({
  title = 'Série récurrente',
  description = "Cet événement fait partie d'une série récurrente. Appliquer la modification :",
  onThis,
  onAll,
  onCancel,
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl flex flex-col gap-4 p-5"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--txt)' }}>
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer"
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs" style={{ color: 'var(--txt-2)' }}>
          {description}
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onThis}
            className="px-3 py-2 rounded-lg text-sm font-medium text-left transition"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt)',
              border: '1px solid var(--brd)',
            }}
          >
            <span className="block">Cette occurrence seulement</span>
            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
              L&apos;occurrence sera détachée de la série.
            </span>
          </button>
          <button
            type="button"
            onClick={onAll}
            className="px-3 py-2 rounded-lg text-sm font-medium text-left transition"
            style={{
              background: 'var(--blue)',
              color: '#fff',
              border: '1px solid var(--blue)',
            }}
          >
            <span className="block">Toute la série</span>
            <span className="block text-[11px] mt-0.5 opacity-80">
              La modification s&apos;applique à toutes les occurrences.
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
