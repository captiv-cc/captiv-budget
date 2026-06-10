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
import { normalizeSearch } from '../../../lib/searchUtils'

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

  // ─── Filtrage catalogue (instantané, accent-insensitive) ────────────────
  const results = useMemo(() => {
    const q = normalizeSearch(query)
    if (q.length < 1) return materielBdd.slice(0, 8)
    return materielBdd
      .filter(
        (m) =>
          normalizeSearch(m.nom).includes(q) ||
          normalizeSearch(m.description).includes(q) ||
          normalizeSearch(m.categorie_suggeree).includes(q),
      )
      .slice(0, 8)
  }, [materielBdd, query])

  // Clamp highlight index quand results change.
  useEffect(() => {
    if (highlight >= results.length) setHighlight(0)
  }, [results.length, highlight])

  // ─── Positionnement du dropdown (position:fixed, portal body) ───────────
  // On capture rect + bottom pour pouvoir ouvrir VERS LE BAS du wrapper
  // (sous l'input) avec fallback automatique vers le HAUT si pas assez de
  // place en dessous (= cas où l'input est près du bas du viewport).
  const calcPos = useCallback(() => {
    if (wrapperRef.current) {
      const r = wrapperRef.current.getBoundingClientRect()
      setDropdownPos({
        left: r.left,
        width: r.width,
        top: r.top,
        bottom: r.bottom,
      })
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
  // Après commit, on FERME le dropdown (setOpen=false). L'input reste
  // focused et vide ; si l'user veut ajouter un autre item, taper une
  // lettre rouvre le dropdown automatiquement (via onChange → setOpen(true)).
  // Avant : on gardait open=true pour la "saisie en rafale", mais ça
  // affichait les 8 items par défaut au-dessus de la barre — confus
  // (cf. retour Hugo : "obligé de cliquer à côté pour fermer le menu").
  async function commitCatalogue(m) {
    if (!onAddFromCatalogue || submitting) return
    setSubmitting(true)
    try {
      await onAddFromCatalogue(m)
      setQuery('')
      setHighlight(0)
      setOpen(false)
      inputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  // commitFreeForm accepte un override pour le texte. Utile dans le
  // handler Enter qui lit la valeur DOM live (pas l'état React, qui
  // peut être stale pendant une frappe rapide).
  async function commitFreeForm(textOverride) {
    if (!onAddFreeForm || submitting) return
    const raw = textOverride !== undefined ? textOverride : query
    const text = (raw || '').trim() || null
    setSubmitting(true)
    try {
      await onAddFreeForm(text)
      setQuery('')
      setHighlight(0)
      setOpen(false)
      inputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  function handleKey(e) {
    // Garde IME / dead-keys / composition : sur certains navigateurs (et
    // claviers FR avec touches mortes pour les accents), le keydown Enter
    // fire pendant une composition en cours et doit être ignoré — sinon
    // on commit avec une valeur partielle.
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return

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

      // ─────────────────────────────────────────────────────────────────
      // Race condition observée : sur certains navigateurs, le keydown
      // Enter fire AVANT que React ait traité l'événement `input` du
      // dernier caractère tapé. Résultat : `query` state est stale (ex.
      // "cano" alors que le DOM a "canon"), `results` aussi, et la
      // logique tombe à côté → premier Enter sans effet, deuxième OK
      // une fois que React a rattrapé le retard.
      //
      // Fix : on lit la valeur DOM live et on recalcule les résultats à
      // partir de cette valeur — robust même quand l'état React est en
      // retard d'une frappe.
      // ─────────────────────────────────────────────────────────────────
      const liveQuery = (inputRef.current?.value ?? query).trim()
      if (liveQuery.length === 0) {
        commitFreeForm('')
        return
      }
      const q = normalizeSearch(liveQuery)
      const liveResults = materielBdd
        .filter(
          (m) =>
            normalizeSearch(m.nom).includes(q) ||
            normalizeSearch(m.description).includes(q) ||
            normalizeSearch(m.categorie_suggeree).includes(q),
        )
        .slice(0, 8)
      const picked = liveResults[highlight] ?? liveResults[0]
      if (picked) {
        commitCatalogue(picked)
      } else {
        // Aucun match → ligne libre avec le texte tapé (forçé en
        // override pour ne pas dépendre de l'état React qui peut être
        // stale).
        commitFreeForm(liveQuery)
      }
    }
  }

  // ─── Scroll-into-view au clavier ─────────────────────────────────────────
  // Quand l'user navigue avec les flèches, on s'assure que l'item highlighted
  // reste visible dans le dropdown scrollable.
  useEffect(() => {
    if (!open || !dropdownRef.current) return
    const el = dropdownRef.current.querySelector(`[data-result-idx="${highlight}"]`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [highlight, open])

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
  // Stratégie de positionnement adaptative : on ouvre vers le BAS du
  // wrapper par défaut (plus naturel pour un autocomplete) ; si l'espace
  // disponible en dessous est insuffisant, on bascule automatiquement
  // vers le HAUT. Évite que le dropdown soit masqué par les blocs
  // suivants dans la liste matériel (cas constaté chez Hugo).
  const hasResults = results.length > 0
  const DROPDOWN_MAX_HEIGHT = 340
  const DROPDOWN_GAP = 4
  let dropdownStyle = null
  if (open && dropdownPos) {
    const spaceBelow = window.innerHeight - dropdownPos.bottom
    const spaceAbove = dropdownPos.top
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow
    if (openUp) {
      dropdownStyle = {
        position: 'fixed',
        left: dropdownPos.left,
        width: dropdownPos.width,
        bottom: window.innerHeight - dropdownPos.top + DROPDOWN_GAP,
        maxHeight: Math.min(DROPDOWN_MAX_HEIGHT, spaceAbove - DROPDOWN_GAP - 8),
      }
    } else {
      dropdownStyle = {
        position: 'fixed',
        left: dropdownPos.left,
        width: dropdownPos.width,
        top: dropdownPos.bottom + DROPDOWN_GAP,
        maxHeight: Math.min(DROPDOWN_MAX_HEIGHT, spaceBelow - DROPDOWN_GAP - 8),
      }
    }
  }
  const dropdown =
    open && dropdownStyle
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              ...dropdownStyle,
              zIndex: 9999,
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
                      data-result-idx={idx}
                      // onMouseDown ne fait QUE préserver le focus de
                      // l'input (sinon onBlur pourrait fermer le
                      // dropdown). L'action elle-même est sur onClick,
                      // qui exige mousedown ET mouseup sur la même
                      // cible — plus fiable que onMouseDown seul (qui
                      // peut être manqué si la souris bouge).
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => commitCatalogue(m)}
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
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commitFreeForm()}
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
