// ════════════════════════════════════════════════════════════════════════════
// Tooltip — Tooltip custom DESK (remplace les `title=` HTML natifs moches)
// ════════════════════════════════════════════════════════════════════════════
//
// Usage minimal :
//   <Tooltip text="Lier à un créneau">
//     <button>...</button>
//   </Tooltip>
//
// Apparition au survol après 300ms, disparition immédiate au quit. Style
// cohérent avec le thème DESK (var(--bg-surf), var(--brd), var(--txt)).
//
// Side : 'top' (défaut) | 'bottom' | 'left' | 'right'. Auto-flip si proche
// d'un bord d'écran (V2).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react'

export default function Tooltip({
  text,
  children,
  side = 'top',
  delay = 300,
  className = '',
}) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef(null)
  const wrapperRef = useRef(null)

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVisible(true), delay)
  }
  const hide = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Position du tooltip selon side
  const positionStyles = {
    top: {
      bottom: 'calc(100% + 6px)',
      left: '50%',
      transform: 'translateX(-50%)',
    },
    bottom: {
      top: 'calc(100% + 6px)',
      left: '50%',
      transform: 'translateX(-50%)',
    },
    left: {
      right: 'calc(100% + 6px)',
      top: '50%',
      transform: 'translateY(-50%)',
    },
    right: {
      left: 'calc(100% + 6px)',
      top: '50%',
      transform: 'translateY(-50%)',
    },
  }

  if (!text) return children

  return (
    <span
      ref={wrapperRef}
      className={className}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 1000,
            ...positionStyles[side],
            padding: '4px 8px',
            background: 'var(--bg-surf, #1a1a1a)',
            color: 'var(--txt, #e5e5e5)',
            border: '1px solid var(--brd, #3a3a3a)',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            animation: 'tooltip-fade-in 100ms ease-out',
          }}
        >
          {text}
        </span>
      )}
      <style>{`
        @keyframes tooltip-fade-in {
          from { opacity: 0; transform: ${
            side === 'top' || side === 'bottom'
              ? 'translateX(-50%) scale(0.96)'
              : 'translateY(-50%) scale(0.96)'
          }; }
          to { opacity: 1; transform: ${
            side === 'top' || side === 'bottom'
              ? 'translateX(-50%) scale(1)'
              : 'translateY(-50%) scale(1)'
          }; }
        }
      `}</style>
    </span>
  )
}
