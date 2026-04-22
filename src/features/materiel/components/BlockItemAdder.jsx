// ════════════════════════════════════════════════════════════════════════════
// BlockItemAdder — barre de recherche inline pour ajouter un item dans un bloc
// ════════════════════════════════════════════════════════════════════════════
//
// Inspiré de BlocSearchBar (devis) : un input dormant qui, au focus, affiche
// un dropdown avec :
//   - les suggestions du catalogue materiel_bdd (match sur nom)
//   - une option "Ajouter \"xxx\" comme ligne libre" (ou juste "Ligne libre")
//
// Le dropdown est rendu via React Portal (position:fixed) pour échapper au
// overflow:auto de la table parente. Enter → ligne libre si aucun résultat
// sélectionné. Escape → ferme et reset.
//
// Une fois l'item ajouté (catalogue ou libre), l'input reste focus pour
// permettre la saisie en rafale (comme dans devis).
//
// Props :
//   - onAddFromCatalogue(mat) : ajoute avec materiel_bdd_id
//   - onAddFreeForm(text)     : ajoute texte libre (text peut être null)
//   - materielBdd             : Array<materiel_bdd>
//   - blockAffichage          : 'liste' | 'config' (juste pour le placeholder)
//   - accentColor             : couleur de l'accent visuel (var CSS)
//   - canEdit                 : boolean
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Database, Plus, Search, X } from 'lucide-react'

export default function BlockItemAdder({
  onAddFromCatalogue,
  onAddFreeForm,
  materielBdd = [],
  blockAffichage = 'liste',
  accentColor = 'var(--blue)',
  canEdit = true,
}) {
  const [dormant, setDormant] = useState(true)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState(null)
  const [highlight, setHighlight] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const wrapperRef = useRef(null)
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)

  // ─── Filtrage catalogue (instantané) ─────────────────────────────────────
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 1) return materielBdd.slice(0, 8)
    return materielBdd
      .filter(
        (m) =>
          m.nom?.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q) ||
          m.categorie_suggeree?.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [materielBdd, query])

  // Clamp highlight index quand results change.
  useEffect(() => {
    if (highlight >= results.length) setHighlight(0)
  }, [results.length, highlight])

  // ─── Positionnement du dropdown (position:fixed, portal body) ───────────
  const calcPos = useCallback(() => {
    if (wrapperRef.current) {
      const r = wrapperRef.current.getBoundingClientRect()
      setDropdownPos({ left: r.left, width: r.width, top: r.top })
    }
  }, [])

  // ─── Close on outside click ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      if (
        !wrapperRef.current?.contains(e.target) &&
        !dropdownRef.current?.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // ─── Close dropdown on window scroll (qui rend la position obsolète) ─────
  useEffect(() => {
    if (!open) return undefined
    function onScroll(e) {
      if (dropdownRef.current?.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open])

  // ─── Activation ──────────────────────────────────────────────────────────
  function activate() {
    if (!canEdit) return
    setDormant(false)
    setTimeout(() => {
      inputRef.current?.focus()
      calcPos()
      setOpen(true)
    }, 0)
  }

  function deactivate() {
    setOpen(false)
    setQuery('')
    setHighlight(0)
    setDormant(true)
  }

  // ─── Commits ─────────────────────────────────────────────────────────────
  async function commitCatalogue(m) {
    if (!onAddFromCatalogue || submitting) return
    setSubmitting(true)
    try {
      await onAddFromCatalogue(m)
      setQuery('')
      setHighlight(0)
      // Reste en mode actif pour permettre la saisie en rafale.
      calcPos()
      setOpen(true)
      inputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  async function commitFreeForm() {
    if (!onAddFreeForm || submitting) return
    const text = query.trim() || null
    setSubmitting(true)
    try {
      await onAddFreeForm(text)
      setQuery('')
      setHighlight(0)
      calcPos()
      setOpen(true)
      inputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      deactivate()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const picked = results[highlight]
      if (picked && query.trim().length > 0 && picked.nom.toLowerCase().includes(query.trim().toLowerCase())) {
        commitCatalogue(picked)
      } else {
        commitFreeForm()
      }
    }
  }

  // ─── Dormant state ───────────────────────────────────────────────────────
  if (dormant) {
    return (
      <div className="px-3 py-1" ref={wrapperRef}>
        <button
          type="button"
          onClick={activate}
          disabled={!canEdit}
          className="flex items-center gap-1.5 text-xs transition-all rounded px-2 py-0.5"
          style={{
            color: 'var(--txt-3)',
            opacity: canEdit ? 0.6 : 0.3,
            cursor: canEdit ? 'pointer' : 'default',
          }}
          onMouseEnter={(e) => {
            if (!canEdit) return
            e.currentTarget.style.opacity = '1'
            e.currentTarget.style.color = accentColor
          }}
          onMouseLeave={(e) => {
            if (!canEdit) return
            e.currentTarget.style.opacity = '0.6'
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
        >
          <Plus className="w-3 h-3" />
          <span>Ajouter un item</span>
        </button>
      </div>
    )
  }

  // ─── Dropdown (Portal) ───────────────────────────────────────────────────
  const hasResults = results.length > 0
  const dropdown =
    open && dropdownPos
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              left: dropdownPos.left,
              width: dropdownPos.width,
              bottom: window.innerHeight - dropdownPos.top + 4,
              zIndex: 9999,
              maxHeight: '340px',
              overflowY: 'auto',
              overflowX: 'hidden',
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              borderRadius: '12px',
              boxShadow: '0 12px 40px rgba(0,0,0,.6)',
            }}
          >
            {/* Section Catalogue */}
            {hasResults && (
              <>
                <div
                  className="px-3 py-1 flex items-center gap-1.5 sticky top-0"
                  style={{
                    background: 'var(--bg)',
                    borderBottom: '1px solid var(--brd-sub)',
                    zIndex: 1,
                  }}
                >
                  <Database className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    Catalogue matériel
                  </span>
                </div>
                {results.map((m, idx) => {
                  const active = idx === highlight
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        commitCatalogue(m)
                      }}
                      onMouseEnter={() => setHighlight(idx)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors"
                      style={{
                        borderBottom: idx < results.length - 1 ? '1px solid var(--brd-sub)' : 'none',
                        background: active ? 'var(--bg-elev)' : 'transparent',
                      }}
                    >
                      <div className="min-w-0">
                        <p
                          className="text-xs font-medium truncate"
                          style={{ color: 'var(--txt)' }}
                        >
                          {m.nom}
                        </p>
                        {(m.description || m.categorie_suggeree) && (
                          <p
                            className="text-[10px] truncate"
                            style={{ color: 'var(--txt-3)' }}
                          >
                            {[m.categorie_suggeree, m.description].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </>
            )}

            {/* Ligne libre — toujours en bas */}
            <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg-surf)' }}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  commitFreeForm()
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{
                  borderTop: hasResults ? '1px solid var(--brd)' : 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-elev)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Plus className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
                  {query
                    ? `Ajouter "${query.trim()}" comme ligne libre…`
                    : 'Ligne libre…'}
                </span>
              </button>
            </div>
          </div>,
          document.body,
        )
      : null

  // ─── Input actif ─────────────────────────────────────────────────────────
  return (
    <div ref={wrapperRef} className="px-3 py-1">
      <div
        className="flex items-center gap-2 rounded-lg px-2.5 py-1"
        style={{
          background: 'rgba(255,255,255,.03)',
          border: `1px solid ${accentColor}30`,
        }}
      >
        <Search
          className="w-3 h-3 shrink-0"
          style={{ color: accentColor, opacity: 0.6 }}
        />
        <input
          ref={inputRef}
          className="flex-1 text-xs bg-transparent outline-none"
          style={{ color: 'var(--txt-2)', caretColor: accentColor }}
          placeholder={
            blockAffichage === 'config'
              ? 'Rechercher un matos… ou Entrée pour ligne libre'
              : 'Rechercher un matos… ou Entrée pour ligne libre'
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            calcPos()
            setOpen(true)
            setHighlight(0)
          }}
          onFocus={() => {
            calcPos()
            setOpen(true)
          }}
          onBlur={() => {
            // Si vide, on retombe dormant. Sinon on garde l'input visible.
            if (!query) {
              setTimeout(() => {
                // protégé du blur→click sur suggestion
                if (
                  !dropdownRef.current?.contains(document.activeElement) &&
                  !wrapperRef.current?.contains(document.activeElement)
                ) {
                  deactivate()
                }
              }, 120)
            }
          }}
          onKeyDown={handleKey}
          disabled={submitting}
        />
        {query && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              setQuery('')
              setOpen(true)
              inputRef.current?.focus()
            }}
            style={{ color: 'var(--txt-3)' }}
            title="Effacer"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {dropdown}
    </div>
  )
}
