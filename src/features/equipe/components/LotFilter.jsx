// ════════════════════════════════════════════════════════════════════════════
// LotFilter — Filtre par lot partagé entre les 3 vues Équipe (P3)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche une rangée de chips compacts permettant de restreindre l'affichage
// des 3 vues Équipe (Tech list / Attribution / Finances) à un lot donné, ou
// à tous les lots ("Tous").
//
// Visible uniquement quand le projet a ≥ 2 lots avec devis de référence
// (sinon le filtre n'a aucune utilité). Le caller fait la garde.
//
// Filtrage strict (Option A) :
//   - selectedLotId = null → toutes les lignes / personnes / postes (y compris
//     les attributions ad-hoc sans devis_line_id)
//   - selectedLotId = lotX → uniquement les lignes du lot X. Les attributions
//     ad-hoc sont masquées (visibles seulement en mode "Tous").
//
// Persistance : géré par le caller (EquipeTab) via localStorage par projet.
//
// Props :
//   - lots          : Array<{ id, title }> — les lotsWithRef (≥ 2)
//   - lotColorMap   : { [lotId]: color } — couleurs partagées (LOT_PALETTE)
//   - counters      : { __all__: N, [lotId]: N } — totaux affichés sur chips
//   - selectedLotId : string | null — null = "Tous"
//   - onChange      : (lotId | null) => void
// ════════════════════════════════════════════════════════════════════════════

export default function LotFilter({
  lots = [],
  lotColorMap = {},
  counters = {},
  selectedLotId = null,
  onChange,
}) {
  if (!lots.length) return null

  const totalCount = counters.__all__ ?? 0

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className="text-[10px] uppercase tracking-wide font-semibold shrink-0"
        style={{ color: 'var(--txt-3)' }}
      >
        Filtrer par lot
      </span>

      {/* Chip "Tous" — neutre, actif par défaut */}
      <Chip
        active={selectedLotId === null}
        onClick={() => onChange?.(null)}
        activeColor="var(--blue)"
      >
        <span>Tous</span>
        <span style={{ opacity: 0.7 }}>· {totalCount}</span>
      </Chip>

      {lots.map((lot) => {
        const color = lotColorMap[lot.id] || 'var(--txt-3)'
        const count = counters[lot.id] ?? 0
        const active = selectedLotId === lot.id
        return (
          <Chip
            key={lot.id}
            active={active}
            activeColor={color}
            onClick={() => onChange?.(lot.id)}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: color }}
            />
            <span className="truncate max-w-[140px]">{lot.title}</span>
            <span style={{ opacity: 0.7 }}>· {count}</span>
          </Chip>
        )
      })}
    </div>
  )
}

// ─── Chip ───────────────────────────────────────────────────────────────────
// Bouton compact unifié pour le filtre. La couleur active est déterminée par
// le caller — pour "Tous" c'est var(--blue), pour les lots c'est la couleur
// dérivée de LOT_PALETTE.
function Chip({ active, activeColor, onClick, children }) {
  // Quand activeColor est une CSS variable (var(--blue)), on ne peut pas
  // utiliser ${activeColor}1a. On expose donc la même couleur en background
  // via rgba() / opacity. Pour rester simple, on applique un fond légèrement
  // teinté en CSS — pour les hex on utilise le suffixe d'opacité, pour les
  // var(--…) on tombe sur un fallback neutre.
  const isHex = typeof activeColor === 'string' && activeColor.startsWith('#')
  const activeBg = isHex ? `${activeColor}1a` : 'var(--bg-elev)'
  const activeBorder = isHex ? `${activeColor}55` : activeColor

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 font-medium transition-colors shrink-0"
      style={
        active
          ? {
              background: activeBg,
              color: activeColor,
              border: `1px solid ${activeBorder}`,
            }
          : {
              background: 'transparent',
              color: 'var(--txt-3)',
              border: '1px solid var(--brd)',
            }
      }
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'var(--bg-hov)'
          e.currentTarget.style.color = 'var(--txt-2)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--txt-3)'
        }
      }}
    >
      {children}
    </button>
  )
}
