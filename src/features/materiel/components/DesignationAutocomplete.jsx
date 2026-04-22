// ════════════════════════════════════════════════════════════════════════════
// DesignationAutocomplete — input désignation + autocomplete materiel_bdd
// ════════════════════════════════════════════════════════════════════════════
//
// Un champ texte free-form avec un dropdown de suggestions issues du
// catalogue materiel_bdd de l'org. Quand l'utilisateur choisit une
// suggestion, on met à jour à la fois `designation` (texte) et
// `materiel_bdd_id` (clé d'agrégation pour le récap loueurs). Quand il tape
// librement sans sélectionner, materiel_bdd_id reste null (agrégation par
// texte normalisé).
//
// Comportement :
//   - onChange : appelé à chaque frappe, propage le texte courant (local)
//   - onCommit : appelé au blur ou à la sélection — sauvegarde { designation,
//                materiel_bdd_id }
//   - Escape : annule et restore la valeur initiale
//   - ArrowDown/Up : navigation dans les suggestions
//   - Enter : valide la suggestion surlignée, sinon commit le texte tel quel
//
// Props :
//   - value         : string (désignation courante)
//   - materielBddId : string | null (FK courant)
//   - materielBdd   : Array (liste complète du catalogue)
//   - onCommit({ designation, materiel_bdd_id }) : save
//   - canEdit       : boolean
//   - placeholder   : string
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Filtre le catalogue par query — tolérant : lowercase + inclusion.
function filterCatalogue(catalogue, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return catalogue.slice(0, 8)
  return catalogue
    .filter((m) => m.nom?.toLowerCase().includes(q))
    .slice(0, 8)
}

export default function DesignationAutocomplete({
  value = '',
  materielBddId = null,
  materielBdd = [],
  onCommit,
  canEdit = true,
  placeholder = 'Désignation',
}) {
  const [local, setLocal] = useState(value)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef(null)
  const inputRef = useRef(null)

  // Synchronise avec la prop quand l'item amont se met à jour.
  useEffect(() => {
    setLocal(value)
  }, [value])

  // Dropdown fermé → close on outside click.
  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const suggestions = useMemo(
    () => filterCatalogue(materielBdd, local),
    [materielBdd, local],
  )

  const doCommit = useCallback(
    (nextDesignation, nextBddId) => {
      if (!onCommit) return
      const cleaned = (nextDesignation || '').trim()
      if (!cleaned) {
        // refuse empty, revert
        setLocal(value)
        return
      }
      if (cleaned === value && nextBddId === materielBddId) return
      onCommit({ designation: cleaned, materiel_bdd_id: nextBddId ?? null })
    },
    [onCommit, value, materielBddId],
  )

  function handleChange(e) {
    const next = e.target.value
    setLocal(next)
    setOpen(true)
    setHighlight(0)
  }

  function handleBlur() {
    // Léger délai pour laisser un éventuel mousedown sur une suggestion
    // se propager (selectSuggestion ferme déjà le dropdown).
    setTimeout(() => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(document.activeElement)) {
        setOpen(false)
        // Free-form commit → on garde l'ID existant si le texte n'a pas changé,
        // sinon on le reset (l'utilisateur a tapé autre chose que le catalogue).
        const unchanged = local.trim() === (value || '').trim()
        doCommit(local, unchanged ? materielBddId : null)
      }
    }, 120)
  }

  function selectSuggestion(m) {
    setLocal(m.nom)
    setOpen(false)
    doCommit(m.nom, m.id)
    inputRef.current?.blur()
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setLocal(value)
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!open) {
      if (e.key === 'ArrowDown') {
        setOpen(true)
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        inputRef.current?.blur()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const picked = suggestions[highlight]
      if (picked) {
        selectSuggestion(picked)
      } else {
        setOpen(false)
        inputRef.current?.blur()
      }
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={local}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={() => canEdit && setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKey}
        disabled={!canEdit}
        className="w-full bg-transparent focus:outline-none"
        style={{
          color: 'var(--txt)',
          cursor: canEdit ? 'text' : 'default',
          fontWeight: 500,
        }}
      />

      {open && canEdit && suggestions.length > 0 && (
        <div
          className="absolute z-30 left-0 right-0 top-full mt-1 rounded-lg shadow-lg overflow-hidden"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            maxHeight: '240px',
            overflowY: 'auto',
            minWidth: '260px',
          }}
        >
          {suggestions.map((m, idx) => {
            const active = idx === highlight
            return (
              <button
                key={m.id}
                type="button"
                // onMouseDown (pas onClick) pour prévenir le blur avant le click.
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectSuggestion(m)
                }}
                onMouseEnter={() => setHighlight(idx)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
                style={{
                  background: active ? 'var(--bg-hov)' : 'transparent',
                  color: 'var(--txt)',
                }}
              >
                <span className="truncate font-medium">{m.nom}</span>
                {m.categorie_suggeree && (
                  <span
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: 'var(--bg-surf)',
                      color: 'var(--txt-3)',
                    }}
                  >
                    {m.categorie_suggeree}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
