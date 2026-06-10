/**
 * TopbarKpi — KPI compact aligné dans la barre supérieure du DevisEditor.
 *
 * Affiche un label en uppercase, une valeur principale colorée, et
 * éventuellement une mention secondaire en dessous.
 *
 * Extraite de DevisEditor.jsx — chantier refacto.
 */

export default function TopbarKpi({ label, value, sub, color }) {
  return (
    <div className="flex flex-col items-center px-4">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
        {label}
      </span>
      <span className="text-sm font-bold leading-tight" style={{ color }}>
        {value}
      </span>
      {sub && (
        <span className="text-[10px] leading-tight" style={{ color: 'var(--txt-3)' }}>
          {sub}
        </span>
      )}
    </div>
  )
}
