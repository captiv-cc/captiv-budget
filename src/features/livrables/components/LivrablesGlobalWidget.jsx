// ════════════════════════════════════════════════════════════════════════════
// LivrablesGlobalWidget — index global des deadlines (LIV-18)
// ════════════════════════════════════════════════════════════════════════════
//
// Widget pour la HomePage : agrège les livrables non terminés tous projets
// confondus, dont la `date_livraison` est dans une fenêtre de 14 jours
// (configurable). Inclut les EN RETARD (date passée + statut actif), mis en
// avant en rouge.
//
// RLS gère l'accessibilité — l'utilisateur ne voit que les projets auxquels
// il a accès. La requête joint `projects` pour afficher le titre du projet
// à côté de chaque livrable.
//
// Click sur un item → navigation vers la tab Livrables du projet concerné.
//
// Props :
//   - orgId      : string (obligatoire)
//   - daysAhead  : number (défaut 14)
//   - limit      : number (défaut 8)
//   - className  : string optionnel
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Calendar, Clock } from 'lucide-react'
import { listUpcomingLivrables } from '../../../lib/livrables'
import { isLivrableEnRetard } from '../../../lib/livrablesHelpers'
import MonteurAvatar from './MonteurAvatar'

// Format date local : "Aujourd'hui", "Demain", sinon JJ/MM.
// On reste compact dans la sidebar (pas la place pour AAAA), si même année.
function formatDeadlineShort(dateISO, now = new Date()) {
  if (!dateISO) return ''
  const due = new Date(dateISO + 'T00:00:00')
  if (Number.isNaN(due.getTime())) return ''
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diffDays === 0) return "Auj."
  if (diffDays === 1) return 'Demain'
  if (diffDays === -1) return 'Hier'
  if (diffDays > 1 && diffDays <= 6) return `J+${diffDays}`
  if (diffDays < -1 && diffDays >= -6) return `J${diffDays}`
  const dd = String(due.getDate()).padStart(2, '0')
  const mm = String(due.getMonth() + 1).padStart(2, '0')
  if (due.getFullYear() !== now.getFullYear()) {
    return `${dd}/${mm}/${String(due.getFullYear()).slice(-2)}`
  }
  return `${dd}/${mm}`
}

export default function LivrablesGlobalWidget({
  orgId,
  daysAhead = 14,
  limit = 8,
  className = '',
}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!orgId) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    listUpcomingLivrables({ orgId, daysAhead, limit })
      .then((data) => {
        if (!cancelled) {
          setItems(data || [])
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [orgId, daysAhead, limit])

  return (
    <div
      className={`rounded-xl overflow-hidden ${className}`}
      style={{ border: '1px solid var(--brd)' }}
    >
      {loading ? (
        <div className="p-6 text-center text-xs" style={{ color: 'var(--txt-3)' }}>
          Chargement…
        </div>
      ) : error ? (
        <div className="p-6 text-center text-xs" style={{ color: 'var(--red)' }}>
          Erreur de chargement.
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <Calendar className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--txt-3)' }} />
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            Aucune deadline dans les {daysAhead} jours.
          </p>
        </div>
      ) : (
        items.map((item, i) => (
          <DeadlineRow key={item.id} item={item} first={i === 0} />
        ))
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// DeadlineRow — une ligne de deadline (livrable + projet + date)
// ════════════════════════════════════════════════════════════════════════════

function DeadlineRow({ item, first }) {
  const enRetard = isLivrableEnRetard(item)
  const numero = (item.numero || '').toString().trim()
  const nom = (item.nom || '').toString().trim() || 'Sans nom'
  const projectTitle = item.project_title || '—'
  const dateLabel = formatDeadlineShort(item.date_livraison)
  const monteurName = item.assignee_external?.trim() || null
  // Click → tab Livrables du projet concerné. (Plus tard : scroll-to ce
  // livrable précis, mais cross-tab → trop complexe pour V1.)
  const to = `/projets/${item.project_id}/livrables`

  return (
    <Link
      to={to}
      className="flex items-start gap-3 px-4 py-3 transition-colors"
      style={{
        borderTop: first ? 'none' : '1px solid var(--brd-sub)',
        background: enRetard ? 'rgba(255,71,87,.05)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = enRetard
          ? 'rgba(255,71,87,.10)'
          : 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = enRetard
          ? 'rgba(255,71,87,.05)'
          : 'transparent'
      }}
    >
      <div className="mt-0.5 shrink-0">
        {enRetard ? (
          <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--red)' }} />
        ) : (
          <Clock className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="text-xs font-medium truncate"
          style={{ color: 'var(--txt)' }}
        >
          {numero && (
            <span
              className="font-mono mr-1"
              style={{ color: 'var(--txt-3)' }}
            >
              {numero}
            </span>
          )}
          {nom}
        </p>
        <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
          {projectTitle}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span
          className="text-[11px] font-medium tabular-nums"
          style={{ color: enRetard ? 'var(--red)' : 'var(--txt-3)' }}
        >
          {dateLabel}
        </span>
        {monteurName && <MonteurAvatar name={monteurName} size="sm" />}
      </div>
    </Link>
  )
}
