// ════════════════════════════════════════════════════════════════════════════
// LivrablesFilterBar — barre horizontale de filtres (LIV-15)
// ════════════════════════════════════════════════════════════════════════════
//
// Barre horizontale sous le header projet. 6 filtres :
//   - Statut    (multi, popover) — 6 statuts
//   - Monteur   (multi, popover) — depuis `listMonteurs(livrables, profilesById)`
//   - Format    (multi, popover) — `LIVRABLE_FORMATS` + "Aucun"
//   - Bloc      (multi, popover) — blocs du projet
//   - En retard (toggle) — bouton on/off
//   - Mes livrables (toggle) — bouton on/off (gris si pas connecté)
//
// État `filters` est un objet immutable géré par le parent (`LivrablesTab`).
// La barre émet des deltas via `onFiltersChange(newFilters)`.
//
// Visuel :
//   - chip neutre si filtre vide
//   - chip teinté bleu + compteur si actif (ex `Statut · 2`)
//   - bouton "Effacer" rouge texte à droite si au moins un filtre actif
//
// Props :
//   - filters        : { statuts: Set, monteurs: Set, formats: Set,
//                       blockIds: Set, enRetard: bool, mesLivrables: bool }
//   - onFiltersChange: (newFilters) => void
//   - blocks         : Array<{id, nom, prefixe, couleur}>
//   - monteurs       : Array<{key, label}> (depuis listMonteurs)
//   - canFilterMes   : booléen — false si pas de userId (cache le toggle "Mes")
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Film, Tag, User, X } from 'lucide-react'
import {
  LIVRABLE_FORMATS,
  LIVRABLE_STATUTS,
  hasActiveFilter,
} from '../../../lib/livrablesHelpers'
import PopoverFloat from './PopoverFloat'
import Checkbox from './Checkbox'

const STATUT_ORDER = ['brief', 'en_cours', 'a_valider', 'valide', 'livre', 'archive']

export default function LivrablesFilterBar({
  filters,
  onFiltersChange,
  blocks = [],
  monteurs = [],
  canFilterMes = true,
}) {
  // Helpers pour patcher les Sets immutablement.
  const toggleSetItem = useCallback(
    (setName, item) => {
      const current = filters[setName] || new Set()
      const next = new Set(current)
      if (next.has(item)) next.delete(item)
      else next.add(item)
      onFiltersChange({ ...filters, [setName]: next })
    },
    [filters, onFiltersChange],
  )

  const setSetValues = useCallback(
    (setName, values) => {
      onFiltersChange({ ...filters, [setName]: new Set(values) })
    },
    [filters, onFiltersChange],
  )

  const toggleBool = useCallback(
    (key) => {
      onFiltersChange({ ...filters, [key]: !filters[key] })
    },
    [filters, onFiltersChange],
  )

  const handleClear = useCallback(() => {
    onFiltersChange({
      statuts: new Set(),
      monteurs: new Set(),
      formats: new Set(),
      blockIds: new Set(),
      enRetard: false,
      mesLivrables: false,
    })
  }, [onFiltersChange])

  const active = hasActiveFilter(filters)

  return (
    <div
      className="flex items-center gap-2 px-4 sm:px-6 py-2 overflow-x-auto scroll-fade-r"
      style={{
        borderBottom: '1px solid var(--brd-sub)',
      }}
    >
      <span
        className="hidden sm:inline text-[10px] uppercase tracking-wider shrink-0 mr-1"
        style={{ color: 'var(--txt-3)' }}
      >
        Filtres
      </span>

      {/* Statut */}
      <MultiSelectChip
        label="Statut"
        icon={Tag}
        selected={filters.statuts}
        options={STATUT_ORDER.map((k) => ({
          key: k,
          label: LIVRABLE_STATUTS[k]?.label || k,
          color: LIVRABLE_STATUTS[k]?.color,
          bg: LIVRABLE_STATUTS[k]?.bg,
        }))}
        onToggle={(k) => toggleSetItem('statuts', k)}
        onClear={() => setSetValues('statuts', [])}
        renderOption={(o, isSelected) => (
          <span className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: o.bg, color: o.color }}
            >
              {o.label}
            </span>
            {isSelected && (
              <Check className="w-3 h-3 ml-auto" style={{ color: 'var(--txt-3)' }} />
            )}
          </span>
        )}
      />

      {/* Monteur */}
      <MultiSelectChip
        label="Monteur"
        icon={User}
        selected={filters.monteurs}
        options={[
          ...monteurs.map((m) => ({ key: m.key, label: m.label })),
          { key: '__none__', label: '— Sans monteur —', italic: true },
        ]}
        onToggle={(k) => toggleSetItem('monteurs', k)}
        onClear={() => setSetValues('monteurs', [])}
        emptyMessage="Aucun monteur sur ce projet."
      />

      {/* Format */}
      <MultiSelectChip
        label="Format"
        icon={Film}
        selected={filters.formats}
        options={[
          ...LIVRABLE_FORMATS.map((f) => ({ key: f, label: f })),
          { key: '__none__', label: '— Sans format —', italic: true },
        ]}
        onToggle={(k) => toggleSetItem('formats', k)}
        onClear={() => setSetValues('formats', [])}
      />

      {/* Bloc */}
      <MultiSelectChip
        label="Bloc"
        selected={filters.blockIds}
        options={blocks.map((b) => ({
          key: b.id,
          label: b.nom || 'Sans nom',
          colorDot: b.couleur,
          suffix: b.prefixe,
        }))}
        onToggle={(k) => toggleSetItem('blockIds', k)}
        onClear={() => setSetValues('blockIds', [])}
        emptyMessage="Aucun bloc."
      />

      {/* En retard (toggle) */}
      <ToggleChip
        label="En retard"
        icon={AlertTriangle}
        active={Boolean(filters.enRetard)}
        onClick={() => toggleBool('enRetard')}
        activeColor="var(--red)"
        activeBg="var(--red-bg)"
      />

      {/* Mes livrables (toggle) — caché si pas de user */}
      {canFilterMes && (
        <ToggleChip
          label="Mes livrables"
          icon={User}
          active={Boolean(filters.mesLivrables)}
          onClick={() => toggleBool('mesLivrables')}
        />
      )}

      {/* Bouton Effacer (visible si actif) */}
      {active && (
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg shrink-0 ml-auto"
          style={{ color: 'var(--red)' }}
          title="Effacer tous les filtres"
        >
          <X className="w-3 h-3" />
          Effacer
        </button>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MultiSelectChip — chip + popover multi-select avec checkboxes
// ════════════════════════════════════════════════════════════════════════════

function MultiSelectChip({
  label,
  icon: Icon,
  selected,
  options,
  onToggle,
  onClear,
  emptyMessage = 'Aucune option.',
  renderOption,
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const count = selected?.size || 0
  const isActive = count > 0

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg shrink-0 transition-colors"
        style={{
          background: isActive ? 'var(--blue-bg)' : 'transparent',
          color: isActive ? 'var(--blue)' : 'var(--txt-2)',
          border: `1px solid ${isActive ? 'var(--blue)' : 'var(--brd-sub)'}`,
        }}
      >
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span>{label}</span>
        {count > 0 && (
          <span
            className="text-[10px] px-1 rounded-full font-semibold tabular-nums"
            style={{
              background: 'var(--blue)',
              color: '#fff',
              minWidth: 16,
              textAlign: 'center',
            }}
          >
            {count}
          </span>
        )}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      <PopoverFloat
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        align="left"
      >
        <div
          className="rounded-lg shadow-lg overflow-hidden"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            minWidth: 220,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {options.length === 0 ? (
            <div
              className="px-3 py-3 text-xs italic text-center"
              style={{ color: 'var(--txt-3)' }}
            >
              {emptyMessage}
            </div>
          ) : (
            <>
              {options.map((opt) => {
                const checked = selected?.has(opt.key) || false
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onToggle(opt.key)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
                    style={{
                      background: checked ? 'var(--bg-hov)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!checked) e.currentTarget.style.background = 'var(--bg-hov)'
                    }}
                    onMouseLeave={(e) => {
                      if (!checked) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <Checkbox checked={checked} size="sm" onClick={() => {}} ariaLabel={opt.label} />
                    {renderOption ? (
                      renderOption(opt, checked)
                    ) : (
                      <span className="flex items-center gap-2 flex-1 min-w-0">
                        {opt.colorDot && (
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: opt.colorDot }}
                          />
                        )}
                        <span
                          className={`truncate ${opt.italic ? 'italic' : ''}`}
                          style={{ color: opt.italic ? 'var(--txt-3)' : 'var(--txt)' }}
                        >
                          {opt.label}
                        </span>
                        {opt.suffix && (
                          <span
                            className="text-[10px] font-mono px-1 rounded"
                            style={{ background: 'var(--bg-2)', color: 'var(--txt-3)' }}
                          >
                            {opt.suffix}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                )
              })}
              {selected && selected.size > 0 && (
                <div style={{ borderTop: '1px solid var(--brd-sub)' }}>
                  <button
                    type="button"
                    onClick={() => {
                      onClear?.()
                      setOpen(false)
                    }}
                    className="w-full px-3 py-2 text-left text-[11px]"
                    style={{ color: 'var(--txt-3)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-hov)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    Effacer la sélection
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </PopoverFloat>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ToggleChip — chip on/off (En retard, Mes livrables)
// ════════════════════════════════════════════════════════════════════════════

function ToggleChip({
  label,
  icon: Icon,
  active,
  onClick,
  activeColor = 'var(--blue)',
  activeBg = 'var(--blue-bg)',
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg shrink-0 transition-colors"
      style={{
        background: active ? activeBg : 'transparent',
        color: active ? activeColor : 'var(--txt-2)',
        border: `1px solid ${active ? activeColor : 'var(--brd-sub)'}`,
      }}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </button>
  )
}

