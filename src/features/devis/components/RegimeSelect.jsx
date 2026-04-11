/**
 * RegimeSelect — sélecteur de régime (Intermittent, Externe, Frais...) groupé
 * par type. Affiche un dropdown via portail positionné par rapport au trigger.
 *
 * Extrait de DevisEditor.jsx — chantier refacto.
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import { CATS } from '../../../lib/cotisations'
import { REGIME_META, REGIME_TYPES } from '../constants'

export default function RegimeSelect({ value, onChange: onChangeProp }) {
  const [open, setOpen]   = useState(false)
  const [pos,  setPos]    = useState(null)
  const triggerRef        = useRef(null)
  const dropdownRef       = useRef(null)

  const meta     = REGIME_META[value] || { abbr: value, type: 'frais' }
  const typeMeta = REGIME_TYPES[meta.type] || REGIME_TYPES.frais
  const { Icon } = typeMeta

  function openDropdown() {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left })
    setOpen(true)
  }

  // Fermeture au clic extérieur
  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (triggerRef.current?.contains(e.target)) return
      if (dropdownRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Fermeture si le tableau scrolle
  useEffect(() => {
    if (!open) return
    function handleScroll() { setOpen(false) }
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [open])

  return (
    <>
      {/* ── Trigger — compact ──────────────────────────────────────────────── */}
      <button
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openDropdown()}
        className="flex items-center gap-1 w-full px-1 py-0.5 rounded transition-all"
        style={{ background: 'transparent', color: 'var(--txt-2)' }}
      >
        <Icon className="w-3 h-3 shrink-0" style={{ color: 'var(--txt-3)' }} />
        <span className="text-[11px] truncate flex-1 text-left">{meta.abbr}</span>
        <ChevronDown className="w-2.5 h-2.5 shrink-0 opacity-30" />
      </button>

      {/* ── Dropdown via portal ─────────────────────────────────────────────── */}
      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top:       pos.top,
            left:      pos.left,
            zIndex:    9999,
            minWidth:  '210px',
            background: 'var(--bg-elev)',
            border:    '1px solid var(--brd)',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,.8)',
            overflow:  'hidden',
          }}
        >
          {Object.entries(REGIME_TYPES).map(([typeKey, tm]) => {
            const GroupIcon = tm.Icon
            const options = CATS.filter(r => (REGIME_META[r]?.type ?? 'frais') === typeKey)
            if (!options.length) return null
            return (
              <div key={typeKey}>
                {/* En-tête de groupe */}
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5"
                  style={{ borderBottom: '1px solid var(--brd-sub)', background: 'rgba(255,255,255,.03)' }}
                >
                  <GroupIcon className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--txt-3)' }}>
                    {tm.label}
                  </span>
                </div>
                {/* Options */}
                {options.map(r => {
                  const isSelected = r === value
                  return (
                    <button
                      key={r}
                      className="w-full text-left flex items-center gap-2 px-4 py-1.5 text-xs transition-colors"
                      style={{ color: isSelected ? 'var(--txt)' : 'var(--txt-2)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      onClick={() => { onChangeProp(r); setOpen(false) }}
                    >
                      <span className="w-3 h-3 flex items-center justify-center shrink-0">
                        {isSelected && <Check className="w-2.5 h-2.5" style={{ color: 'var(--green)' }} />}
                      </span>
                      {r}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}
