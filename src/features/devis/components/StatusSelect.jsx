/**
 * StatusSelect — sélecteur de statut du devis (brouillon/envoyé/accepté/refusé)
 * sous forme de badge cliquable + dropdown via portail.
 *
 * Extrait de DevisEditor.jsx — chantier refacto.
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'

export const STATUS_OPTIONS = [
  { key: 'brouillon', label: 'Brouillon', badgeClass: 'badge-gray' },
  { key: 'envoye', label: 'Envoyé', badgeClass: 'badge-blue' },
  { key: 'accepte', label: 'Accepté', badgeClass: 'badge-green' },
  { key: 'refuse', label: 'Refusé', badgeClass: 'badge-red' },
]

export default function StatusSelect({ status, onChange }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const portalRef = useRef(null)
  const current = STATUS_OPTIONS.find((o) => o.key === status) || STATUS_OPTIONS[0]

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target) &&
        portalRef.current &&
        !portalRef.current.contains(e.target)
      )
        setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const rect = triggerRef.current?.getBoundingClientRect()

  return (
    <div ref={triggerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((p) => !p)}
        className={`badge ${current.badgeClass}`}
        style={{
          cursor: 'pointer',
          userSelect: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        {current.label}
        <ChevronDown className="w-2.5 h-2.5" style={{ opacity: 0.6 }} />
      </button>

      {open &&
        createPortal(
          <div
            ref={portalRef}
            style={{
              position: 'fixed',
              top: rect ? rect.bottom + 6 : 0,
              left: rect ? rect.left : 0,
              zIndex: 9999,
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd)',
              borderRadius: '8px',
              padding: '4px',
              boxShadow: '0 8px 32px rgba(0,0,0,.6)',
              minWidth: '130px',
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => {
                  onChange(opt.key)
                  setOpen(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: '5px',
                  background: opt.key === status ? 'rgba(255,255,255,.06)' : 'transparent',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.08)')}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    opt.key === status ? 'rgba(255,255,255,.06)' : 'transparent')
                }
              >
                <span className={`badge ${opt.badgeClass}`} style={{ pointerEvents: 'none' }}>
                  {opt.label}
                </span>
                {opt.key === status && (
                  <Check className="w-3 h-3 ml-auto" style={{ color: 'var(--txt-3)' }} />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
