/**
 * Autocomplete sur la BDD produits
 * Utilisé dans DevisEditor pour la colonne "Produit / Poste"
 */
import { useState, useRef, useEffect } from 'react'
import { Database } from 'lucide-react'

export default function ProduitAutocomplete({ value, bdd, onChange, onSelect, placeholder }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value || '')
  const ref = useRef(null)

  // Sync si value change depuis l'extérieur
  useEffect(() => {
    setQuery(value || '')
  }, [value])

  // Fermer en cliquant ailleurs
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered =
    query.length >= 1
      ? bdd
          .filter(
            (p) =>
              p.produit?.toLowerCase().includes(query.toLowerCase()) ||
              p.categorie?.toLowerCase().includes(query.toLowerCase()) ||
              p.description?.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 10)
      : []

  function handleInput(e) {
    const v = e.target.value
    setQuery(v)
    onChange(v)
    setOpen(true)
  }

  function handleSelect(produit) {
    setQuery(produit.produit)
    setOpen(false)
    onSelect(produit)
  }

  return (
    <div ref={ref} className="relative w-full">
      <input
        className="input-cell w-full font-medium"
        value={query}
        onChange={handleInput}
        onFocus={() => query.length >= 1 && setOpen(true)}
        placeholder={placeholder || 'Intitulé poste…'}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-72 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
          <div className="px-2 py-1 bg-gray-50 border-b border-gray-100 flex items-center gap-1">
            <Database className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-400">Base de données</span>
          </div>
          {filtered.map((p) => (
            <button
              key={p.id}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(p)
              }}
              className="w-full flex items-start justify-between px-3 py-2 hover:bg-blue-50 text-left group transition-colors"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">{p.produit}</p>
                <p className="text-xs text-gray-400 truncate">
                  {p.categorie} · {p.regime}
                </p>
              </div>
              <div className="ml-2 shrink-0 text-right">
                {p.tarif_defaut && (
                  <p className="text-xs font-medium text-blue-600">
                    {Number(p.tarif_defaut).toLocaleString('fr-FR', { minimumFractionDigits: 0 })} €
                    <span className="text-gray-400">/{p.unite || 'F'}</span>
                  </p>
                )}
                {p.grille_cc_j && (
                  <p className="text-xs text-green-600">
                    CC:{' '}
                    {Number(p.grille_cc_j).toLocaleString('fr-FR', { minimumFractionDigits: 0 })}{' '}
                    €/J
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
