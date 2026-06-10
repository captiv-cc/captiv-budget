/**
 * LotScopeSelector — sélecteur de scope multi-lot partagé.
 *
 * Affiche un bandeau "Agrégé | Lot A | Lot B | ..." avec couleur par lot.
 * Masqué automatiquement s'il y a moins de 2 lots (rien à sélectionner).
 *
 * Props :
 * - lotsWithRef : [{ id, title }]  lots ayant un devis de référence, dans l'ordre d'affichage
 * - scope       : '__all__' ou lotId
 * - onChange    : (nextScope) => void
 * - lotColor    : (lotId, lotsWithRef) => css color   — si absent, palette par défaut
 * - className   : optionnel
 */
import { Layers } from 'lucide-react'

const DEFAULT_PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#10b981',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
]
function defaultLotColor(lotId, orderedLots) {
  const idx = orderedLots.findIndex((l) => l.id === lotId)
  return idx >= 0 ? DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length] : '#94a3b8'
}

export default function LotScopeSelector({
  lotsWithRef,
  scope,
  onChange,
  lotColor = defaultLotColor,
  className = '',
}) {
  if (!lotsWithRef || lotsWithRef.length < 2) return null

  const items = [{ id: '__all__', label: 'Agrégé', color: 'var(--txt-2)' }].concat(
    lotsWithRef.map((lot) => ({
      id: lot.id,
      label: lot.title,
      color: lotColor(lot.id, lotsWithRef),
    })),
  )

  // Mobile : scroll horizontal (avec barre cachée, pattern "swipe chips") pour
  // que les lots longs (ex: "Réseaux Sociaux") ne tronquent pas et ne poussent
  // pas en flex-wrap. Desktop : on garde flex-wrap classique car l'espace
  // horizontal est suffisant.
  return (
    <div
      className={`flex items-center gap-1 rounded-xl p-1 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible ${className} captiv-no-scrollbar`}
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <span
        className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider shrink-0"
        style={{ color: 'var(--txt-3)' }}
      >
        <Layers className="w-3 h-3" />
        Scope
      </span>
      {items.map((it) => {
        const active = scope === it.id
        const isAll = it.id === '__all__'
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 whitespace-nowrap"
            style={{
              background: active ? 'var(--bg-elev)' : 'transparent',
              color: active ? 'var(--txt)' : 'var(--txt-3)',
              border: active ? `1px solid ${it.color}` : '1px solid transparent',
            }}
          >
            {!isAll && (
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: it.color }} />
            )}
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
