// ════════════════════════════════════════════════════════════════════════════
// PeriodesRecapWidget — récap visuel des périodes projet (PROJ-PERIODES)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche en lecture seule les 5 périodes saisies dans ProjetTab :
// prépa, tournage, envoi V1, livraison master, deadline.
//
// Pour chaque période non vide :
//   - Label avec icône colorée
//   - Pills d'intervalles formatés FR (`12-14/05`, `17/05`)
//   - Total jours
//
// Si toutes les périodes sont vides → renvoie null (pas de bloc affiché).
//
// Source : `extractPeriodes(project.metadata)` (PROJ-PERIODES). Pas de
// fallback texte : les chaînes legacy sont déjà parsées par le helper.
//
// Props :
//   - periodes : retour de extractPeriodes() — { prepa, tournage, ... }
// ════════════════════════════════════════════════════════════════════════════

import { Calendar } from 'lucide-react'
import {
  PERIODE_KEYS,
  PERIODE_META,
  countDays,
  formatRangeFr,
  hasAnyRange,
} from '../../../lib/projectPeriodes'

export default function PeriodesRecapWidget({ periodes }) {
  if (!periodes) return null

  // Garde uniquement les périodes qui ont au moins un range valide.
  const filledKeys = PERIODE_KEYS.filter((k) => hasAnyRange(periodes[k]))
  if (filledKeys.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Calendar className="w-3 h-3 text-gray-500" />
        <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
          Planning
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filledKeys.map((key) => (
          <PeriodeRow
            key={key}
            label={PERIODE_META[key].label}
            color={PERIODE_META[key].color}
            bg={PERIODE_META[key].bg}
            periode={periodes[key]}
          />
        ))}
      </div>
    </div>
  )
}

function PeriodeRow({ label, color, bg, periode }) {
  const ranges = (periode?.ranges || [])
    .filter((r) => r?.start && r?.end)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
  const days = countDays(periode)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span
          className="text-[11px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--txt-3)' }}
        >
          {label}
        </span>
        <span
          className="text-[10px]"
          style={{ color: 'var(--txt-3)', opacity: 0.7 }}
        >
          · {days} jour{days > 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {ranges.map((range, idx) => (
          <span
            key={`${range.start}-${range.end}-${idx}`}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{
              background: bg,
              color,
              border: `1px solid ${color}`,
            }}
          >
            <Calendar className="w-3 h-3" />
            {formatRangeFr(range)}
          </span>
        ))}
      </div>
    </div>
  )
}
