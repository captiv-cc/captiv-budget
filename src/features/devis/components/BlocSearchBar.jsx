/**
 * BlocSearchBar — barre de recherche inline en bas d'un bloc de catégorie.
 *
 * Permet de chercher dans le catalogue produits + dans la convention collective
 * CCPA (minimas_convention) puis :
 *   - sélection catalogue → ajout direct via onAddDirect
 *   - sélection minima CCPA → onOpenIntermittent (ouvre AddLineModal pré-rempli)
 *   - texte libre / Entrée → onAddFreeForm
 *
 * Le dropdown est rendu via un Portal dans document.body (position: fixed)
 * pour échapper au overflow:auto du conteneur parent de la table.
 *
 * Extrait de DevisEditor.jsx — chantier refacto.
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Search, X, Users, Database } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { normalizeRegime } from '../constants'

export default function BlocSearchBar({
  bdd,
  defaultRegime,
  accentColor,
  onAddDirect,
  onOpenIntermittent,
  onAddFreeForm,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [minimasList, setMinimasList] = useState([])
  const [dropdownPos, setDropdownPos] = useState(null)
  const wrapperRef = useRef(null)
  const dropdownRef = useRef(null)

  // Résultats catalogue (filtre local, instantané)
  const catalogueResults =
    query.length >= 2
      ? bdd
          .filter(
            (p) =>
              p.produit?.toLowerCase().includes(query.toLowerCase()) ||
              p.description?.toLowerCase().includes(query.toLowerCase()) ||
              p.categorie?.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 8)
      : []

  // Résultats minimas_convention (async, dédupliqués par poste)
  useEffect(() => {
    if (query.length < 2) {
      setMinimasList([])
      return
    }
    let cancelled = false
    supabase
      .from('minimas_convention')
      .select('poste, filiere, is_specialise')
      .ilike('poste', `%${query}%`)
      .eq('unite', 'jour_7h')
      .order('poste')
      .limit(30)
      .then(({ data }) => {
        if (cancelled) return
        const seen = new Set()
        const unique = []
        for (const r of data || []) {
          const k = r.poste + (r.is_specialise ? '_spec' : '')
          if (!seen.has(k)) {
            seen.add(k)
            unique.push(r)
          }
        }
        setMinimasList(unique.slice(0, 8))
      })
    return () => {
      cancelled = true
    }
  }, [query])

  // Calcule la position du dropdown depuis le wrapper
  function calcPos() {
    if (wrapperRef.current) {
      const r = wrapperRef.current.getBoundingClientRect()
      setDropdownPos({ left: r.left, width: r.width, top: r.top })
    }
  }

  // Fermeture au clic extérieur (wrapper + portal dropdown)
  useEffect(() => {
    const handler = (e) => {
      if (!wrapperRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fermeture au scroll (le dropdown fixe ne suit pas le scroll de la table)
  useEffect(() => {
    if (!open) return
    const handler = () => setOpen(false)
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [open])

  function handleOpen() {
    calcPos()
    setOpen(true)
  }

  function handleCatalogueSelect(p) {
    setQuery('')
    setOpen(false)
    onAddDirect({
      produit: p.produit,
      description: p.description || '',
      regime: normalizeRegime(p.regime) || defaultRegime,
      unite: p.unite || 'F',
      tarif_ht: Number(p.tarif_defaut) || 0,
      cout_ht: 0,
      quantite: 1,
    })
  }

  function handleIntermittentSelect(item) {
    setQuery('')
    setOpen(false)
    onOpenIntermittent(item)
  }

  function handleFreeForm() {
    const q = query
    setQuery('')
    setOpen(false)
    onAddFreeForm(q || null)
  }

  const hasResults = catalogueResults.length > 0 || minimasList.length > 0

  // Dropdown rendu dans document.body via Portal
  const dropdown =
    open && (hasResults || query.length >= 1) && dropdownPos
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              left: dropdownPos.left,
              width: dropdownPos.width,
              bottom: window.innerHeight - dropdownPos.top + 4,
              zIndex: 9999,
              maxHeight: '400px',
              overflowY: 'auto',
              overflowX: 'hidden',
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              borderRadius: '12px',
              boxShadow: '0 12px 40px rgba(0,0,0,.75)',
            }}
          >
            {/* Section Convention collective CCPA */}
            {minimasList.length > 0 && (
              <>
                <div
                  className="px-3 py-1 flex items-center gap-1.5 sticky top-0"
                  style={{
                    background: 'var(--bg)',
                    borderBottom: '1px solid var(--brd-sub)',
                    zIndex: 1,
                  }}
                >
                  <Users className="w-3 h-3" style={{ color: 'var(--purple)' }} />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--purple)' }}
                  >
                    Convention collective CCPA
                  </span>
                </div>
                {minimasList.map((p, i) => (
                  <button
                    key={`${p.poste}_${p.is_specialise}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleIntermittentSelect(p)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-elev)]"
                    style={{
                      borderBottom:
                        i < minimasList.length - 1 ? '1px solid var(--brd-sub)' : 'none',
                    }}
                  >
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
                      style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}
                    >
                      CC
                    </span>
                    <span className="text-xs flex-1 truncate" style={{ color: 'var(--txt)' }}>
                      {p.poste}
                    </span>
                    {p.is_specialise && (
                      <span
                        className="text-[10px] px-1 py-0.5 rounded shrink-0"
                        style={{ background: 'rgba(156,95,253,.08)', color: 'var(--purple)' }} /* opacity variant kept */
                      >
                        spécialisé
                      </span>
                    )}
                    {p.filiere && (
                      <span className="text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>
                        {p.filiere}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}

            {/* Section Catalogue */}
            {catalogueResults.length > 0 && (
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
                    Catalogue
                  </span>
                </div>
                {catalogueResults.map((p) => (
                  <button
                    key={p.id}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleCatalogueSelect(p)
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-elev)]"
                    style={{ borderBottom: '1px solid var(--brd-sub)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--txt)' }}>
                        {p.produit}
                      </p>
                      {(p.description || p.categorie) && (
                        <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
                          {[p.categorie, p.description].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    {p.tarif_defaut && (
                      <span
                        className="text-xs font-semibold ml-2 shrink-0"
                        style={{ color: 'var(--blue)' }}
                      >
                        {Number(p.tarif_defaut).toLocaleString('fr-FR')} €/{p.unite || 'F'}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}

            {/* Ligne libre — toujours disponible, collée en bas */}
            <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg-surf)' }}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleFreeForm()
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elev)]"
                style={{ borderTop: hasResults ? '1px solid var(--brd)' : 'none' }}
              >
                <Plus className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
                  {query ? `Ajouter "${query}" comme ligne libre…` : 'Ligne libre…'}
                </span>
              </button>
            </div>
          </div>,
          document.body,
        )
      : null

  const [dormant, setDormant] = useState(true)
  const inputRef = useRef(null)

  function activate() {
    setDormant(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleBlur() {
    if (!query) {
      setOpen(false)
      setDormant(true)
    }
  }

  if (dormant) {
    return (
      <div ref={wrapperRef} className="px-3 py-1">
        <button
          onClick={activate}
          className="flex items-center gap-1.5 text-xs transition-all rounded px-2 py-0.5"
          style={{ color: 'var(--txt-3)', opacity: 0.5 }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1'
            e.currentTarget.style.color = accentColor
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.5'
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
        >
          <Plus className="w-3 h-3" />
          <span>Ajouter une ligne</span>
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="px-3 py-1">
      <div
        className="flex items-center gap-2 rounded-lg px-2.5 py-1"
        style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${accentColor}30` }}
      >
        <Search className="w-3 h-3 shrink-0" style={{ color: accentColor, opacity: 0.6 }} />
        <input
          ref={inputRef}
          className="flex-1 text-xs bg-transparent outline-none"
          style={{ color: 'var(--txt-2)', caretColor: accentColor }}
          placeholder="Rechercher un poste… ou Entrée pour ligne libre"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            calcPos()
            setOpen(true)
          }}
          onFocus={handleOpen}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              setQuery('')
              setDormant(true)
            }
            if (e.key === 'Enter' && !hasResults) handleFreeForm()
          }}
        />
        {query && (
          <button
            onMouseDown={(e) => {
              e.preventDefault()
              setQuery('')
              setOpen(false)
            }}
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {dropdown}
    </div>
  )
}
