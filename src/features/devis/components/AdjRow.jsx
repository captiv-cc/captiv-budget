/**
 * AdjRow — ligne d'ajustement (Marge, Assurance, Remise globale...) du tiroir
 * de synthèse. Affiche label + input numérique + montant calculé optionnel.
 *
 * Extraite de DevisEditor.jsx — chantier refacto.
 */

export default function AdjRow({ icon, label, value, onChange, suffix, computed }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 flex-1 min-w-0">
        {icon}
        <span className="text-xs truncate" style={{ color: 'var(--txt-2)' }}>{label}</span>
      </div>
      <div className="relative w-16 shrink-0">
        <input
          type="number"
          className="input text-xs text-right pr-4 py-1 h-7 w-full"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          min={0}
          max={100}
          step={0.5}
          placeholder="0"
        />
        <span
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]"
          style={{ color: 'var(--txt-3)' }}
        >
          {suffix}
        </span>
      </div>
      {value > 0 && (
        <span className="text-xs w-20 text-right shrink-0" style={{ color: 'var(--txt-3)' }}>
          {computed}
        </span>
      )}
    </div>
  )
}
