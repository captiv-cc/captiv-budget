/**
 * KpiCard — carte d'indicateur colorée avec icône, label, valeur et sous-valeur.
 *
 * Couleurs disponibles : blue, green, red, amber, purple.
 *
 * Extraite de DevisEditor.jsx — chantier refacto.
 */

const BG_MAP = {
  blue: 'rgba(77,159,255,.1)',
  green: 'rgba(0,200,117,.1)',
  red: 'rgba(255,71,87,.1)',
  amber: 'rgba(255,206,0,.1)',
  purple: 'rgba(156,95,253,.1)',
}

const BORDER_MAP = {
  blue: 'rgba(77,159,255,.25)',
  green: 'rgba(0,200,117,.25)',
  red: 'rgba(255,71,87,.25)',
  amber: 'rgba(255,206,0,.25)',
  purple: 'rgba(156,95,253,.25)',
}

export default function KpiCard({ icon, label, value, sub, color }) {
  return (
    <div
      className="rounded-lg border p-2"
      style={{
        background: BG_MAP[color] || BG_MAP.blue,
        borderColor: BORDER_MAP[color] || BORDER_MAP.blue,
      }}
    >
      <div className="flex items-center gap-1 mb-0.5">
        {icon}
        <span className="text-[10px] font-medium" style={{ color: 'var(--txt-3)' }}>
          {label}
        </span>
      </div>
      <p className="text-xs font-bold truncate" style={{ color: 'var(--txt)' }}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
          {sub}
        </p>
      )}
    </div>
  )
}
