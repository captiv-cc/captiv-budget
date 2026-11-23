// ════════════════════════════════════════════════════════════════════════════
// ui.jsx — briques de formulaire communes au module Embauches
// ════════════════════════════════════════════════════════════════════════════
//
// Les trois modales (dossier, embauche, règles de calcul) rendaient chacune
// son propre `Champ`, son propre `Txt` et son propre style d'input : trois
// hauteurs, trois tailles de police, trois gris. Tout vit ici désormais, et
// un ajustement se fait une fois.
//
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { inputStyle } from './styles'

/** Bloc de formulaire : un titre, une aide, une action à droite. */
export function Bloc({ icon: Icon, titre, aide, action, children, className = '' }) {
  return (
    <section
      className={`rounded-xl p-4 ${className}`}
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {(titre || action) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && <Icon className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />}
            <div className="min-w-0">
              {titre && (
                <h3 className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                  {titre}
                </h3>
              )}
              {aide && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                  {aide}
                </p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Champ({ label, aide, action = null, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="flex items-center gap-1.5 mb-1">
        <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
          {label}
        </span>
        {action}
      </span>
      {children}
      {aide && (
        <span className="block text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
          {aide}
        </span>
      )}
    </label>
  )
}

export function Txt({ value, onChange, placeholder, type = 'text', ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none disabled:opacity-50"
      style={inputStyle}
      {...rest}
    />
  )
}

export function Nombre({ value, onChange, step = '0.5', min = '0', ...rest }) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="w-full px-2 py-1.5 rounded-lg text-sm text-right outline-none tabular-nums disabled:opacity-50"
      style={inputStyle}
      {...rest}
    />
  )
}

/** Saisie d'un pourcentage stocké en fraction (0.25 ↔ 25 %). */
export function Pourcent({ value, onChange, ...rest }) {
  return (
    <div className="relative">
      <input
        type="number"
        step="1"
        min="0"
        value={value == null ? '' : Math.round(Number(value) * 100)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value) / 100)}
        className="w-full pl-2 pr-7 py-1.5 rounded-lg text-sm text-right outline-none tabular-nums"
        style={inputStyle}
        {...rest}
      />
      <span
        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
        style={{ color: 'var(--txt-3)' }}
      >
        %
      </span>
    </div>
  )
}

/** Case à cocher en forme de pastille : un jalon de contrat, une option. */
export function Jalon({ actif, onToggle, label, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
      style={{
        background: actif ? 'rgba(0,200,117,.12)' : 'var(--bg-elev)',
        color: actif ? 'var(--green)' : 'var(--txt-3)',
        border: `1px solid ${actif ? 'rgba(0,200,117,.3)' : 'var(--brd)'}`,
      }}
    >
      <span
        className="w-3.5 h-3.5 rounded flex items-center justify-center text-[9px]"
        style={{
          background: actif ? 'var(--green)' : 'transparent',
          border: actif ? 'none' : '1px solid var(--brd)',
          color: '#fff',
        }}
      >
        {actif ? '✓' : ''}
      </span>
      {label}
    </button>
  )
}

/**
 * Section repliable : un titre, un résumé à droite, le détail au clic.
 * Les frais et les heures majorées restent vides neuf fois sur dix — pliées,
 * elles tiennent sur une ligne au lieu d'allonger la fiche d'un écran.
 */
export function Repli({ titre, resume, defautOuvert = false, plat = false, children }) {
  const [ouvert, setOuvert] = useState(defautOuvert)
  return (
    <section
      className={plat ? '' : 'rounded-xl'}
      style={
        plat
          ? { borderTop: '1px solid var(--brd-sub)', marginTop: 12 }
          : { background: 'var(--bg-surf)', border: '1px solid var(--brd)' }
      }
    >
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className={`w-full flex items-center gap-2 text-left ${plat ? 'py-2' : 'px-4 py-2.5'}`}
      >
        <ChevronRight
          className="w-3.5 h-3.5 shrink-0"
          style={{
            color: 'var(--txt-3)',
            transform: ouvert ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms ease-out',
          }}
        />
        <span
          className={plat ? 'text-[11px] font-semibold' : 'text-sm font-semibold'}
          style={{ color: plat ? 'var(--txt-2)' : 'var(--txt)' }}
        >
          {titre}
        </span>
        {resume && (
          <span className="text-[11px] ml-auto truncate" style={{ color: 'var(--txt-3)' }}>
            {resume}
          </span>
        )}
      </button>
      {ouvert && <div className={plat ? 'pb-1' : 'px-4 pb-4'}>{children}</div>}
    </section>
  )
}
