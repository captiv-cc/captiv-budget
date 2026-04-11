/**
 * BarMetric — métrique compacte de la barre de synthèse SynthBar.
 *
 *   prominent : titre principal (Total HT, ...)
 *   muted     : valeur secondaire en plus petit
 *   subvalue  : seconde ligne discrète à côté
 *
 * Extraite de DevisEditor.jsx — chantier refacto.
 */

export default function BarMetric({ label, value, subvalue, prominent = false, muted = false, color }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[9px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--txt-3)' }}
      >
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span
          className="tabular-nums font-bold"
          style={{
            fontSize: prominent ? '15px' : muted ? '12px' : '13px',
            color: color || (prominent ? 'var(--txt)' : muted ? 'var(--txt-3)' : 'var(--txt-2)'),
          }}
        >
          {value}
        </span>
        {subvalue && (
          <span
            className="tabular-nums"
            style={{ fontSize: '10px', color: color || 'var(--txt-3)', opacity: 0.7 }}
          >
            {subvalue}
          </span>
        )}
      </span>
    </div>
  )
}
