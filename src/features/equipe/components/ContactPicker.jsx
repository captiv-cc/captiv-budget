// ════════════════════════════════════════════════════════════════════════════
// ContactPicker — Autocomplete sur l'annuaire org + création rapide
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche un input qui filtre les contacts de l'org (passés en prop). Quand
// l'utilisateur tape un nom qui n'existe pas, propose un bouton "Créer
// {prenom} {nom}" qui appellera `onCreate({ prenom, nom })` (parsing best-
// effort sur le texte saisi).
//
// Usage :
//   <ContactPicker
//     contacts={contacts}            // depuis useCrew
//     value={selectedContact}        // contact ou null
//     onChange={setSelectedContact}  // (contact|null) => void
//     onCreate={addContact}          // async ({prenom, nom}) => contact
//     placeholder="Nom du contact…"
//   />
//
// Notes :
//  - On affiche les 8 premiers résultats (perf + UX).
//  - Highlight de la 1ère row par défaut, navigation clavier ↑↓ + Enter.
//  - Esc ferme le dropdown.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, UserPlus, X, Check } from 'lucide-react'

const MAX_RESULTS = 8

export default function ContactPicker({
  contacts = [],
  value = null,
  onChange,
  onCreate,
  placeholder = 'Rechercher un contact…',
  autoFocus = false,
  disabled = false,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  // Init du query depuis le contact sélectionné
  useEffect(() => {
    if (value) {
      setQuery(`${value.prenom || ''} ${value.nom || ''}`.trim())
    }
  }, [value])

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus])

  // Click outside → close
  useEffect(() => {
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Filtre + tri (préfixe nom > préfixe prénom > contient)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts.slice(0, MAX_RESULTS)
    const scored = []
    for (const c of contacts) {
      const fullname = `${c.prenom || ''} ${c.nom || ''}`.toLowerCase().trim()
      const reverse = `${c.nom || ''} ${c.prenom || ''}`.toLowerCase().trim()
      let score = 0
      if (fullname.startsWith(q) || reverse.startsWith(q)) score = 3
      else if ((c.nom || '').toLowerCase().startsWith(q)) score = 2
      else if ((c.prenom || '').toLowerCase().startsWith(q)) score = 2
      else if (fullname.includes(q) || (c.email || '').toLowerCase().includes(q)) score = 1
      if (score > 0) scored.push({ c, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, MAX_RESULTS).map((s) => s.c)
  }, [query, contacts])

  // Détection : le query correspond-il EXACTEMENT à un contact existant ?
  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return contacts.find(
      (c) =>
        `${c.prenom || ''} ${c.nom || ''}`.toLowerCase().trim() === q ||
        `${c.nom || ''} ${c.prenom || ''}`.toLowerCase().trim() === q,
    )
  }, [query, contacts])

  const canCreate = Boolean(onCreate) && query.trim().length >= 2 && !exactMatch

  function handlePick(contact) {
    onChange?.(contact)
    setQuery(`${contact.prenom || ''} ${contact.nom || ''}`.trim())
    setOpen(false)
  }

  function handleClear() {
    onChange?.(null)
    setQuery('')
    setOpen(true)
    inputRef.current?.focus()
  }

  async function handleCreate() {
    if (!canCreate || creating) return
    // Parsing best-effort : "Hugo Martin" → { prenom: 'Hugo', nom: 'Martin' }
    const parts = query.trim().split(/\s+/)
    const prenom = parts[0] || ''
    const nom = parts.slice(1).join(' ') || ''
    setCreating(true)
    try {
      const created = await onCreate({ prenom, nom })
      if (created) {
        onChange?.(created)
        setQuery(`${created.prenom || ''} ${created.nom || ''}`.trim())
        setOpen(false)
      }
    } finally {
      setCreating(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(h + 1, matches.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const m = matches[highlight]
      if (m) {
        handlePick(m)
      } else if (canCreate) {
        handleCreate()
      }
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlight(0)
            // Reset le contact sélectionné dès qu'on retape
            if (value) onChange?.(null)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-sm"
          style={{ color: 'var(--txt)' }}
        />
        {Boolean(query) && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="p-0.5 rounded transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--txt)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
            title="Effacer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-md shadow-lg"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
          }}
        >
          {matches.length === 0 && !canCreate && (
            <div className="px-3 py-2 text-xs" style={{ color: 'var(--txt-3)' }}>
              {query.trim() ? 'Aucun contact trouvé' : 'Tapez pour rechercher'}
            </div>
          )}
          {matches.map((c, i) => {
            const isHighlighted = i === highlight
            const isSelected = value?.id === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => handlePick(c)}
                onMouseEnter={() => setHighlight(i)}
                className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors"
                style={{
                  background: isHighlighted ? 'var(--bg-hov)' : 'transparent',
                  color: 'var(--txt)',
                }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
                >
                  {((c.prenom?.[0] || '') + (c.nom?.[0] || '')).toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">
                    {`${c.prenom || ''} ${c.nom || ''}`.trim() || '—'}
                  </div>
                  {c.specialite && (
                    <div className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
                      {c.specialite}
                      {c.ville ? ` · ${c.ville}` : ''}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--green)' }} />
                )}
              </button>
            )
          })}

          {canCreate && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors border-t"
              style={{
                background: 'transparent',
                color: 'var(--blue)',
                borderColor: 'var(--brd-sub)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              <span className="text-sm">
                {creating ? 'Création…' : `Créer "${query.trim()}"`}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
