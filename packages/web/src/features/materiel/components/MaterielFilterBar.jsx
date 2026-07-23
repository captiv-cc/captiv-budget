// ════════════════════════════════════════════════════════════════════════════
// MaterielFilterBar — recherche + filtres de la liste matériel ouverte
// ════════════════════════════════════════════════════════════════════════════
//
// MAT-OUTILS : sur une grosse liste (VNB = 79 items), retrouver un item sans
// scroller. Filtres combinables : texte (désignation/label/remarques),
// loueur (y compris « sans loueur »), flag. Le filtrage est appliqué par
// MaterielTab (client-side) avant de passer itemsByBlock à BlockList ; les
// blocs sans résultat sont masqués tant qu'un filtre est actif.
// ════════════════════════════════════════════════════════════════════════════

import { CheckSquare, Search, Upload, X } from 'lucide-react'

export const EMPTY_MATOS_FILTERS = Object.freeze({ q: '', loueurId: '', flag: '' })

export function hasActiveFilters(filters) {
  return Boolean(filters.q.trim() || filters.loueurId || filters.flag)
}

/** Applique les filtres à un item (pur, testable). */
export function itemMatchesFilters(item, filters, loueursOfItem = []) {
  if (filters.q.trim()) {
    const q = filters.q
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
    const hay = `${item.designation || ''} ${item.label || ''} ${item.remarques || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
    if (!hay.includes(q)) return false
  }
  if (filters.loueurId) {
    if (filters.loueurId === '__none__') {
      if (loueursOfItem.length > 0) return false
    } else if (!loueursOfItem.some((il) => il.loueur_id === filters.loueurId)) {
      return false
    }
  }
  if (filters.flag && item.flag !== filters.flag) return false
  return true
}

const FLAG_OPTIONS = [
  ['', 'Tous les flags'],
  ['ok', 'OK'],
  ['attention', 'Attention'],
  ['probleme', 'Problème'],
]

export default function MaterielFilterBar({
  filters,
  onChange,
  loueurs = [],
  resultCount = null,
  // MAT-OUTILS : mode sélection multiple (checkbox à la place du grip).
  selectionEnabled = false,
  selectionMode = false,
  onToggleSelectionMode = null,
  // MAT-OUTILS ④ : import CSV/Excel dans la liste ouverte (canEdit).
  onImport = null,
}) {
  const active = hasActiveFilters(filters)
  const inputStyle = {
    background: 'var(--bg-elev)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
  }

  return (
    <div className="flex items-center gap-2 flex-wrap px-4 sm:px-6 pb-2">
      <div
        className="flex items-center gap-1.5 px-2 rounded-md flex-1 min-w-[180px] max-w-sm"
        style={inputStyle}
      >
        <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
        <input
          type="text"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Rechercher un item…"
          className="w-full min-w-0 text-xs py-1.5 outline-none bg-transparent"
          style={{ color: 'var(--txt)' }}
        />
        {filters.q && (
          <button type="button" onClick={() => onChange({ ...filters, q: '' })} style={{ color: 'var(--txt-3)' }}>
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <select
        value={filters.loueurId}
        onChange={(e) => onChange({ ...filters, loueurId: e.target.value })}
        className="text-xs px-2 py-1.5 rounded-md outline-none"
        style={inputStyle}
        title="Filtrer par loueur"
      >
        <option value="">Tous les loueurs</option>
        <option value="__none__">Sans loueur</option>
        {loueurs.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nom}
          </option>
        ))}
      </select>

      <select
        value={filters.flag}
        onChange={(e) => onChange({ ...filters, flag: e.target.value })}
        className="text-xs px-2 py-1.5 rounded-md outline-none"
        style={inputStyle}
        title="Filtrer par flag"
      >
        {FLAG_OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>

      {active && (
        <>
          <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {resultCount} résultat{resultCount > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_MATOS_FILTERS })}
            className="text-[11px] font-semibold px-2 py-1 rounded-md"
            style={{ color: 'var(--blue)' }}
          >
            Réinitialiser
          </button>
        </>
      )}

      {onImport && (
        <button
          type="button"
          onClick={onImport}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md ml-auto"
          style={{
            background: 'var(--bg-elev)',
            color: 'var(--txt-2)',
            border: '1px solid var(--brd)',
          }}
          title="Importer des items depuis un fichier CSV ou Excel"
        >
          <Upload className="w-3.5 h-3.5" />
          Importer
        </button>
      )}

      {selectionEnabled && (
        <button
          type="button"
          onClick={onToggleSelectionMode}
          className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md ${onImport ? '' : 'ml-auto'}`}
          style={{
            background: selectionMode ? 'var(--blue-bg)' : 'var(--bg-elev)',
            color: selectionMode ? 'var(--blue)' : 'var(--txt-2)',
            border: '1px solid var(--brd)',
          }}
          title="Sélectionner plusieurs items (loueur, bloc, flag, suppression en masse)"
        >
          <CheckSquare className="w-3.5 h-3.5" />
          {selectionMode ? 'Terminer' : 'Sélectionner'}
        </button>
      )}
    </div>
  )
}
