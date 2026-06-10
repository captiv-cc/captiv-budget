// ════════════════════════════════════════════════════════════════════════════
// PlansExportProgress — Modale de progression pendant l'export ZIP des plans
// ════════════════════════════════════════════════════════════════════════════
//
// Affichée pendant que exportPlansAsZip télécharge chaque plan + génère
// le ZIP. Trois phases :
//   - 'fetching'   : on télécharge les fichiers, progress bar X/N + nom courant
//   - 'finalizing' : tous fetch terminés, jszip génère le blob (peut prendre
//                    quelques secondes pour des dizaines de Mo)
//   - 'done'       : terminé. Bouton de fermeture + résumé erreurs partielles.
//
// Pas de bouton "Annuler" en V1 — l'export complet d'un projet de plans
// prend rarement plus de 10-20 secondes en pratique.
// ════════════════════════════════════════════════════════════════════════════

import { CheckCircle2, AlertCircle, Loader2, Package } from 'lucide-react'

export default function PlansExportProgress({
  open,
  phase, // 'fetching' | 'finalizing' | 'done'
  current = 0,
  total = 0,
  currentName = '',
  errors = [],
  onClose,
}) {
  if (!open) return null

  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  const isDone = phase === 'done'
  const hasErrors = errors.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (isDone && e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="w-full max-w-md rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            {isDone && !hasErrors ? (
              <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--green)' }} />
            ) : isDone && hasErrors ? (
              <AlertCircle className="w-4 h-4" style={{ color: 'var(--amber)' }} />
            ) : (
              <Package className="w-4 h-4" style={{ color: 'var(--blue)' }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              {isDone ? 'Export terminé' : 'Export ZIP en cours…'}
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {phase === 'fetching' && `${current} / ${total} plan${total > 1 ? 's' : ''} récupéré${current > 1 ? 's' : ''}`}
              {phase === 'finalizing' && 'Création du fichier ZIP…'}
              {isDone && hasErrors && `${total - errors.length} / ${total} OK · ${errors.length} erreur${errors.length > 1 ? 's' : ''}`}
              {isDone && !hasErrors && `${total} plan${total > 1 ? 's' : ''} archivé${total > 1 ? 's' : ''}`}
            </p>
          </div>
        </header>

        {/* Body */}
        <div className="px-5 py-4">
          {/* Progress bar */}
          {!isDone && (
            <div className="mb-3">
              <div
                className="w-full h-2 rounded-full overflow-hidden"
                style={{ background: 'var(--bg-elev)' }}
              >
                <div
                  className="h-full transition-all duration-150"
                  style={{
                    width: phase === 'finalizing' ? '100%' : `${pct}%`,
                    background: 'var(--blue)',
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
                  {phase === 'fetching' && currentName ? `· ${currentName}` : ''}
                  {phase === 'finalizing' && 'Compression…'}
                </span>
                <span className="text-[11px] tabular-nums" style={{ color: 'var(--txt-3)' }}>
                  {phase === 'finalizing' ? '100%' : `${pct}%`}
                </span>
              </div>
            </div>
          )}

          {/* Loader pendant finalizing */}
          {phase === 'finalizing' && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt-3)' }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Compression des fichiers, ne ferme pas cet onglet…
            </div>
          )}

          {/* Erreurs partielles (en done) */}
          {isDone && hasErrors && (
            <div
              className="rounded-md p-2.5 mt-2"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              <p
                className="text-[10px] uppercase tracking-widest font-bold mb-1.5"
                style={{ color: 'var(--amber)' }}
              >
                Plans non inclus
              </p>
              <ul className="space-y-1">
                {errors.map((e, i) => (
                  <li
                    key={i}
                    className="text-[11px]"
                    style={{ color: 'var(--txt-2)' }}
                  >
                    <span className="font-semibold">{e.plan?.name || '—'}</span>
                    <span style={{ color: 'var(--txt-3)' }}>
                      {' · '}
                      {e.error?.message || String(e.error)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          {isDone ? (
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold px-3 py-1.5 rounded-md"
              style={{
                background: 'var(--blue)',
                color: 'white',
              }}
            >
              Fermer
            </button>
          ) : (
            <span className="text-[11px] italic" style={{ color: 'var(--txt-3)' }}>
              Ne ferme pas cet onglet pendant l&apos;export…
            </span>
          )}
        </footer>
      </div>
    </div>
  )
}
