// ─── TvaPicker ────────────────────────────────────────────────────────────────
// Sélecteur de taux de TVA réutilisable :
//   • 4 chips pour les taux courants (0 / 5,5 / 10 / 20 %)
//   • un input libre pour tout autre taux
// Valeur stockée : nombre (ex. 5.5). Jamais null — par défaut 0.
// Usage :
//   <TvaPicker value={form.default_tva} onChange={v => set('default_tva', v)} />

const PRESETS = [0, 5.5, 10, 20]

export default function TvaPicker({ value, onChange, label = 'TVA par défaut', compact = false }) {
  const num = Number(value ?? 0)
  const isPreset = PRESETS.includes(num)

  return (
    <div>
      {label && (
        <label className="block text-xs mb-1.5" style={{ color: 'var(--txt-3)' }}>
          {label}
        </label>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESETS.map((p) => {
          const active = num === p
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
              style={
                active
                  ? { background: 'var(--blue)', color: 'white' }
                  : {
                      background: 'var(--bg-elev)',
                      color: 'var(--txt-2)',
                      border: '1px solid var(--brd-sub)',
                    }
              }
            >
              {p}%
            </button>
          )
        })}
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={isPreset ? '' : num}
            onChange={(e) => {
              const v = e.target.value
              onChange(v === '' ? 0 : Number(v))
            }}
            placeholder="Autre"
            className={`${compact ? 'w-14' : 'w-16'} px-2 py-1 rounded-md text-xs text-center`}
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
              color: 'var(--txt)',
            }}
          />
          <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
            %
          </span>
        </div>
      </div>
    </div>
  )
}
