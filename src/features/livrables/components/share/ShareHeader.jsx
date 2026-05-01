// ════════════════════════════════════════════════════════════════════════════
// ShareHeader — En-tête de la page de partage public livrables (LIV-24C)
// ════════════════════════════════════════════════════════════════════════════
//
// Image projet (cover_url) + titre + ref + date de mise à jour.
// Design sobre et professionnel pour un client externe.
// ════════════════════════════════════════════════════════════════════════════

import { Film } from 'lucide-react'
import { ThemeToggle } from '../../../../pages/LivrableShareSession'

export default function ShareHeader({ project, share, generatedAt, theme, onToggleTheme }) {
  const title = project?.title || 'Projet'
  const ref = project?.ref_projet
  const cover = project?.cover_url
  const shareLabel = share?.label

  const generatedFr = formatDateTimeFR(generatedAt)

  return (
    <header
      className="rounded-2xl shadow-sm p-5 sm:p-6 flex items-start gap-4 sm:gap-5"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {/* Vignette projet (carré). */}
      {cover ? (
        <img
          src={cover}
          alt={title}
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover shrink-0"
          style={{ border: '1px solid var(--brd)' }}
        />
      ) : (
        <div
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, #334155, #0f172a)' }}
        >
          <Film className="w-8 h-8 text-white/40" />
        </div>
      )}

      {/* Bloc texte */}
      <div className="flex-1 min-w-0">
        <p
          className="text-[11px] uppercase tracking-wider font-semibold mb-1"
          style={{ color: 'var(--txt-3)' }}
        >
          Avancement des livrables
        </p>
        <h1
          className="text-xl sm:text-2xl font-bold leading-tight truncate"
          style={{ color: 'var(--txt)' }}
        >
          {title}
        </h1>
        <div
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
          style={{ color: 'var(--txt-3)' }}
        >
          {ref && <span className="font-mono">{ref}</span>}
          {ref && shareLabel && <span aria-hidden="true">·</span>}
          {shareLabel && <span>{shareLabel}</span>}
          {generatedFr && (
            <>
              <span aria-hidden="true" className="ml-auto">·</span>
              <span>Mis à jour {generatedFr}</span>
            </>
          )}
        </div>
      </div>

      {/* Toggle dark/light en haut à droite */}
      {onToggleTheme && <ThemeToggle theme={theme} onToggle={onToggleTheme} />}
    </header>
  )
}

function formatDateTimeFR(isoOrDate) {
  if (!isoOrDate) return null
  const d = new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return null
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `le ${dd}/${mm}/${yyyy} à ${hh}:${min}`
}
