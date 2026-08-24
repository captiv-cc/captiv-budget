// ════════════════════════════════════════════════════════════════════════════
// SearchSelect — liste déroulante cherchable, création à la volée optionnelle
// ════════════════════════════════════════════════════════════════════════════
//
// Remplace le <select> et le <datalist> natifs dès qu'une liste dépasse la
// dizaine d'entrées : le premier n'offre aucune recherche et déborde de
// l'écran, le second est illisible sur le thème sombre.
//
// Le menu est rendu en portal (les conteneurs à overflow et les transforms
// des pages publiques clippent tout menu positionné en absolu), avec une
// recherche dès que la liste s'allonge et, si `onCreate` est fourni, la
// création de la valeur saisie quand elle n'existe pas encore.
//
// Options : une liste de chaînes, ou d'objets { value, label, group }.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react'

export default function SearchSelect({
  value,
  options = [],
  placeholder = 'Choisir',
  canEdit = true,
  allowCreate = true,
  onChange, // (valeur|null) => void
  onCreate, // (valeur) => Promise — persiste la nouvelle entrée
  // En cellule de tableau : croix et chevron seulement au survol. Affichées
  // en permanence, elles formaient un mur de symboles sur 40 lignes.
  compact = false,
  className = '',
  style = null,
}) {
  const [menu, setMenu] = useState(null) // { left, top, width, up } | null
  const [query, setQuery] = useState('')
  const btnRef = useRef(null)

  // Les appelants passent soit des chaînes, soit des objets { value, label }
  // — un libellé de livrable ne peut pas servir d'identifiant.
  const items = useMemo(
    () =>
      (options || []).map((o) =>
        typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label },
      ),
    [options],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((o) => o.label.toLowerCase().includes(q))
  }, [items, query])

  const exact = useMemo(
    () => items.some((o) => o.label.toLowerCase() === query.trim().toLowerCase()),
    [items, query],
  )

  const currentLabel = useMemo(
    () => items.find((o) => o.value === value)?.label ?? (value || null),
    [items, value],
  )

  useEffect(() => {
    if (!menu) setQuery('')
  }, [menu])

  function open() {
    if (!canEdit) return
    const r = btnRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const up = spaceBelow < 260 && r.top > spaceBelow
    setMenu({
      left: r.left,
      top: up ? r.top - 6 : r.bottom + 6,
      width: Math.max(r.width, 200),
      up,
    })
  }

  async function pick(v) {
    setMenu(null)
    onChange(v)
  }

  async function create() {
    const v = query.trim()
    if (!v) return
    setMenu(null)
    await onCreate?.(v)
    onChange(v)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (menu ? setMenu(null) : open())}
        className={`group flex items-center gap-2 text-xs px-2.5 py-2 rounded-lg text-left ${className}`}
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--brd)',
          color: value ? 'var(--txt)' : 'var(--txt-3)',
          cursor: canEdit ? 'pointer' : 'default',
          ...style,
        }}
      >
        <span className="flex-1 min-w-0 truncate">{currentLabel || placeholder}</span>
        {value && canEdit && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onChange(null)
            }}
            className={`shrink-0 transition-opacity ${
              compact ? 'opacity-0 group-hover:opacity-60' : 'opacity-50 hover:opacity-100'
            }`}
            title="Vider"
          >
            <X className="w-3 h-3" />
          </span>
        )}
        {canEdit && (
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 transition-opacity ${
              compact && value ? 'opacity-0 group-hover:opacity-60' : ''
            }`}
            style={{ color: 'var(--txt-3)' }}
          />
        )}
      </button>

      {menu &&
        createPortal(
          <>
            <span className="fixed inset-0 z-[80]" onClick={() => setMenu(null)} />
            <div
              className="fixed z-[81] rounded-lg shadow-xl overflow-hidden flex flex-col"
              style={{
                left: menu.left,
                top: menu.top,
                width: menu.width,
                transform: menu.up ? 'translateY(-100%)' : undefined,
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
                maxHeight: 280,
              }}
            >
              {(options.length > 6 || allowCreate) && (
                <div
                  className="relative shrink-0"
                  style={{ borderBottom: '1px solid var(--brd-sub)' }}
                >
                  <Search
                    className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--txt-3)' }}
                  />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (filtered.length === 1) pick(filtered[0].value)
                        else if (allowCreate && query.trim() && !exact) create()
                      }
                      if (e.key === 'Escape') setMenu(null)
                    }}
                    placeholder={allowCreate ? 'Chercher ou créer…' : 'Chercher…'}
                    className="w-full text-xs pl-8 pr-2.5 py-2 outline-none"
                    style={{ background: 'transparent', color: 'var(--txt)' }}
                  />
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-y-auto py-1">
                {filtered.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => pick(o.value)}
                    className="flex items-center gap-2 w-full text-left text-xs px-2.5 py-1.5"
                    style={{ color: 'var(--txt)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span className="flex-1 min-w-0 truncate">{o.label}</span>
                    {o.value === value && (
                      <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--blue)' }} />
                    )}
                  </button>
                ))}
                {filtered.length === 0 && !query.trim() && (
                  <p className="text-[11px] italic px-2.5 py-2" style={{ color: 'var(--txt-3)' }}>
                    Liste vide — saisis une valeur pour la créer.
                  </p>
                )}
              </div>

              {allowCreate && query.trim() && !exact && (
                <button
                  type="button"
                  onClick={create}
                  className="flex items-center gap-2 w-full text-left text-xs font-semibold px-2.5 py-2 shrink-0"
                  style={{ color: 'var(--blue)', borderTop: '1px solid var(--brd-sub)' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Créer « {query.trim()} »
                </button>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
