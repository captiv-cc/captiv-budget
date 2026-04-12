/**
 * FournisseurSelect — sélecteur fournisseur avec autocomplétion et création
 * rapide. Sauvegarde via devis_lines.fournisseur_id (fiable, indépendant de
 * budget_reel). Optionnellement applique le choix à toutes les lignes vides
 * du bloc (mode bulk).
 *
 * Extrait de BudgetReelTab.jsx — chantier refacto.
 */

import { useState, useEffect, useRef } from 'react'

export default function FournisseurSelect({
  fournisseurId,
  fournisseurs,
  otherEmptyInBloc = 0,
  onSelect,
  onApplyToBloc,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [bulk, setBulk] = useState(false)
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  const current = fournisseurs.find((f) => f.id === fournisseurId)
  const filtered = fournisseurs.filter((f) => f.nom.toLowerCase().includes(query.toLowerCase()))
  const hasExact = fournisseurs.some((f) => f.nom.toLowerCase() === query.trim().toLowerCase())

  useEffect(() => {
    if (open) {
      setQuery('')
      setBulk(false)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(f) {
    setOpen(false)
    if (bulk && otherEmptyInBloc > 0) onApplyToBloc?.(f.id, null)
    else onSelect(f.id, null)
  }

  function createAndPick() {
    const nom = query.trim()
    if (!nom) return
    setOpen(false)
    if (bulk && otherEmptyInBloc > 0) onApplyToBloc?.(null, nom)
    else onSelect(null, nom)
  }

  function clear(e) {
    e.stopPropagation()
    onSelect(null, null)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left',
          width: '100%',
          fontSize: 12,
          color: current ? 'var(--txt)' : 'var(--txt-3)',
          fontWeight: current ? 500 : 400,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {current ? current.nom : <span style={{ opacity: 0.45 }}>Fournisseur…</span>}
        </span>
        {current && (
          <span
            onClick={clear}
            title="Retirer"
            style={{ fontSize: 10, color: 'var(--txt-3)', lineHeight: 1, flexShrink: 0 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
          >
            ×
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: -8,
            zIndex: 200,
            width: 220,
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            borderRadius: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,.18)',
            overflow: 'hidden',
          }}
        >
          {/* Recherche */}
          <div style={{ padding: '7px 8px', borderBottom: '1px solid var(--brd-sub)' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher ou créer…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (!hasExact && query.trim()) createAndPick()
                  else if (filtered[0]) pick(filtered[0])
                }
                if (e.key === 'Escape') setOpen(false)
              }}
              style={{
                width: '100%',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                borderRadius: 6,
                color: 'var(--txt)',
                fontSize: 11,
                padding: '4px 8px',
                outline: 'none',
              }}
            />
          </div>

          {/* Toggle bulk — AU-DESSUS de la liste pour rester visible */}
          {otherEmptyInBloc > 0 && (
            <label
              onClick={(e) => {
                e.stopPropagation()
                setBulk((b) => !b)
                inputRef.current?.focus()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--brd-sub)',
                background: bulk ? 'rgba(0,122,255,.12)' : 'var(--bg-elev)',
                fontSize: 11,
                color: bulk ? 'var(--blue)' : 'var(--txt-3)',
                fontWeight: bulk ? 600 : 500,
                userSelect: 'none',
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  flexShrink: 0,
                  border: `1.5px solid ${bulk ? 'var(--blue)' : 'var(--txt-3)'}`,
                  background: bulk ? 'var(--blue)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 800,
                  lineHeight: 1,
                }}
              >
                {bulk && '✓'}
              </span>
              <span>
                Appliquer aux{' '}
                <strong>
                  {otherEmptyInBloc}{' '}
                  {otherEmptyInBloc === 1 ? 'autre ligne vide' : 'autres lignes vides'}
                </strong>{' '}
                du bloc
              </span>
            </label>
          )}

          {/* Liste */}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 && !query && (
              <p
                style={{
                  fontSize: 10,
                  color: 'var(--txt-3)',
                  padding: '10px',
                  textAlign: 'center',
                }}
              >
                Aucun fournisseur — saisissez un nom
              </p>
            )}
            {filtered.map((f) => (
              <button
                key={f.id}
                onClick={() => pick(f)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  background: f.id === fournisseurId ? 'rgba(0,122,255,.08)' : 'transparent',
                  color: f.id === fournisseurId ? 'var(--blue)' : 'var(--txt)',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (f.id !== fournisseurId) e.currentTarget.style.background = 'var(--bg-elev)'
                }}
                onMouseLeave={(e) => {
                  if (f.id !== fournisseurId) e.currentTarget.style.background = 'transparent'
                }}
              >
                {f.nom}
                {f.type && (
                  <span style={{ fontSize: 9, color: 'var(--txt-3)', marginLeft: 6 }}>
                    {f.type}
                  </span>
                )}
              </button>
            ))}
            {query.trim() && !hasExact && (
              <button
                onClick={createAndPick}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'transparent',
                  color: 'var(--blue)',
                  border: 'none',
                  cursor: 'pointer',
                  borderTop: filtered.length > 0 ? '1px solid var(--brd-sub)' : 'none',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,122,255,.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                + Créer « {query.trim()} »
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
