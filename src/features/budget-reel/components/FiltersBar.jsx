/**
 * FiltersBar — barre de filtres (chips) pour le Budget Réel.
 * Filtres combinables : Non saisies / Non payées / Écart > 10 % / Additifs.
 * Actions à droite : tout replier / tout déplier les blocs.
 *
 * Extrait de BudgetReelTab.jsx — chantier refacto.
 */

import { X, ChevronDown, ChevronRight } from 'lucide-react'

export default function FiltersBar({ filters, counts, onToggle, onClear, anyFilter, onCollapseAll, onExpandAll, anyCollapsed }) {
  const allChips = [
    { key: 'estimees',  label: 'Non saisies',  count: counts.estimees,  color: 'var(--amber)' },
    { key: 'nonPayees', label: 'Non payées',   count: counts.nonPayees, color: 'var(--blue)'  },
    { key: 'ecart',     label: 'Écart > 10 %', count: counts.ecart,     color: 'var(--red)'   },
    { key: 'additifs',  label: 'Additifs',     count: counts.additifs,  color: 'var(--red)'   },
  ]
  // On masque les chips à 0 (sauf si déjà actifs, pour pouvoir les désactiver)
  const chips = allChips.filter(c => (c.count || 0) > 0 || filters[c.key])
  const hasFilterArea = chips.length > 0 || anyFilter

  return (
    <div className="flex items-center gap-2 flex-wrap px-1">
      {hasFilterArea && (
        <span className="text-[9px] uppercase tracking-widest font-semibold"
          style={{ color: 'var(--txt-3)' }}>Filtres</span>
      )}

      {chips.map(c => {
        const active = filters[c.key]
        return (
          <button
            key={c.key}
            onClick={() => onToggle(c.key)}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-all"
            style={{
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              background: active ? c.color : 'var(--bg-surf)',
              color: active ? 'white' : 'var(--txt)',
              border: `1px solid ${active ? c.color : 'var(--brd)'}`,
            }}
          >
            <span>{c.label}</span>
            <span className="tabular-nums rounded-full px-1.5"
              style={{
                fontSize: 9,
                background: active ? 'rgba(255,255,255,.25)' : 'var(--bg-elev)',
                color: active ? 'white' : 'var(--txt-3)',
                minWidth: 16,
                textAlign: 'center',
              }}>
              {c.count || 0}
            </span>
          </button>
        )
      })}

      {anyFilter && (
        <button
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all"
          style={{
            fontSize: 10,
            fontWeight: 600,
            background: 'transparent',
            color: 'var(--txt-3)',
            border: '1px dashed var(--brd)',
          }}
        >
          <X className="w-2.5 h-2.5" />
          Tout effacer
        </button>
      )}

      {/* Actions blocs (à droite) */}
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onCollapseAll}
          title="Replier tous les blocs"
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all"
          style={{
            fontSize: 10,
            fontWeight: 600,
            background: 'var(--bg-surf)',
            color: 'var(--txt-3)',
            border: '1px solid var(--brd)',
            cursor: 'pointer',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--txt)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
          <ChevronRight className="w-2.5 h-2.5" />
          Tout replier
        </button>
        {anyCollapsed && (
          <button
            onClick={onExpandAll}
            title="Déplier tous les blocs"
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all"
            style={{
              fontSize: 10,
              fontWeight: 600,
              background: 'var(--bg-surf)',
              color: 'var(--txt-3)',
              border: '1px solid var(--brd)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--txt)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
            <ChevronDown className="w-2.5 h-2.5" />
            Tout déplier
          </button>
        )}
      </div>
    </div>
  )
}
