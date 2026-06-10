// ════════════════════════════════════════════════════════════════════════════
// AssignCadreurMenu — Menu contextuel "Attribuer à un cadreur" (FEST-3.3)
// ════════════════════════════════════════════════════════════════════════════
//
// Apparait au right-click sur un bloc de show (lane type 'lieu'). Liste les
// cadreurs (lanes type 'personne') avec leur état de dispo à l'horaire du
// show. Click sur un cadreur → crée automatiquement un tournage lié dans
// sa lane (avec source_creneau_id + member_ids préremplis).
//
// Suit les règles CHANTIER_UI_KIT.md :
// - Popover anchored (pas de backdrop)
// - Click outside / Esc ferment
// - Fade-in 100ms
// - Auto-flip top/bottom selon viewport
// ════════════════════════════════════════════════════════════════════════════

import { useRef, useEffect, useLayoutEffect, useState } from 'react'
import { Camera, CircleAlert, Check } from 'lucide-react'
import { formatMinHHMM } from '../../lib/deroule'

export default function AssignCadreurMenu({
  sourceCreneau,
  cadreurs,
  onChoose,
  onClose,
}) {
  const menuRef = useRef(null)
  const [top, setTop] = useState(0)
  const [left, setLeft] = useState(0)
  const [ready, setReady] = useState(false)

  // Click outside + Esc
  useEffect(() => {
    function onDocMouseDown(e) {
      if (menuRef.current?.contains(e.target)) return
      onClose?.()
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onDocMouseDown)
    }, 50)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Positionnement auto-flip
  const MENU_WIDTH = 260
  const PADDING = 8
  const anchorX = sourceCreneau?._mouseX || PADDING
  const anchorY = sourceCreneau?._mouseY || PADDING

  useLayoutEffect(() => {
    if (!menuRef.current) {
      setReady(true)
      return
    }
    const menuHeight = menuRef.current.offsetHeight
    const vh = window.innerHeight
    const vw = window.innerWidth
    let proposedLeft = anchorX
    let proposedTop = anchorY
    // flip horizontal si dépasse droite
    if (proposedLeft + MENU_WIDTH > vw - PADDING) {
      proposedLeft = vw - MENU_WIDTH - PADDING
    }
    // flip vertical si dépasse bas → ancrer au top
    if (proposedTop + menuHeight > vh - PADDING) {
      proposedTop = anchorY - menuHeight
    }
    setLeft(Math.max(PADDING, proposedLeft))
    setTop(Math.max(PADDING, Math.min(proposedTop, vh - menuHeight - PADDING)))
    setReady(true)
  }, [anchorX, anchorY])

  if (!sourceCreneau) return null

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 100,
        width: MENU_WIDTH,
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
        padding: 6,
        opacity: ready ? 1 : 0,
        transition: 'opacity 80ms ease',
        animation: ready
          ? 'assign-cadreur-fade-in 100ms ease-out'
          : undefined,
      }}
    >
      <div
        style={{
          padding: '6px 10px 8px',
          fontSize: 11,
          color: 'var(--txt-3)',
          borderBottom: '1px solid var(--brd-sub)',
          marginBottom: 4,
        }}
      >
        Attribuer{' '}
        <strong style={{ color: 'var(--txt-2)' }}>
          {sourceCreneau.titre || '(sans titre)'}
        </strong>{' '}
        <span style={{ color: 'var(--txt-3)' }}>
          {formatMinHHMM(sourceCreneau.heure_debut_min)} –{' '}
          {formatMinHHMM(sourceCreneau.heure_fin_min)}
        </span>
      </div>

      {cadreurs.length === 0 ? (
        <div style={{ padding: '10px', fontSize: 12, color: 'var(--txt-3)' }}>
          Aucun cadreur configuré dans le déroulé.
        </div>
      ) : (
        cadreurs.map((c) => (
          <CadreurItem
            key={c.lane.id}
            cadreur={c}
            onClick={() => {
              if (c.busyCreneau) return // bloqué si occupé
              onChoose?.({
                laneId: c.lane.id,
                membreId: c.lane.membre_id,
              })
            }}
          />
        ))
      )}

      <style>{`
        @keyframes assign-cadreur-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

function CadreurItem({ cadreur, onClick }) {
  const { lane, busyCreneau, alreadyAssigned } = cadreur
  const disabled = Boolean(busyCreneau) || alreadyAssigned
  const subtitle = alreadyAssigned
    ? 'Déjà attribué'
    : busyCreneau
    ? `Occupé ${formatMinHHMM(busyCreneau.heure_debut_min)}–${formatMinHHMM(busyCreneau.heure_fin_min)}${busyCreneau.titre ? ` · ${busyCreneau.titre}` : ''}`
    : 'Disponible'

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 10px',
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        color: 'var(--txt)',
        fontSize: 13,
        opacity: disabled ? 0.55 : 1,
        transition: 'background 0.08s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--bg-elev)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: lane.couleur || '#888',
          color: 'white',
          fontSize: 9,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Camera size={12} />
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--txt)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {lane.libelle || '(sans nom)'}
        </span>
        <span
          style={{
            fontSize: 10,
            color: alreadyAssigned
              ? 'var(--blue, #3B82F6)'
              : busyCreneau
              ? 'var(--txt-3)'
              : '#22C55E',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {subtitle}
        </span>
      </span>
      {alreadyAssigned && (
        <Check size={14} style={{ color: 'var(--blue, #3B82F6)' }} />
      )}
      {busyCreneau && !alreadyAssigned && (
        <CircleAlert size={14} style={{ color: 'var(--txt-3)' }} />
      )}
    </button>
  )
}
