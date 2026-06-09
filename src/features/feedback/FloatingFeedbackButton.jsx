// ════════════════════════════════════════════════════════════════════════════
// FloatingFeedbackButton — FAB persistant pour signaler un bug/idée
// ════════════════════════════════════════════════════════════════════════════
//
// Bouton flottant style Intercom/Crisp en bas à droite, visible sur toutes
// les pages (sauf /feedback elle-même — redondant).
//
// Clic → ouvre directement la CreateFeedbackModal avec auto-fill de la
// page courante. 2 clics jusqu'à l'envoi du ticket : "Signaler" puis
// "Envoyer". Friction quasi nulle.
//
// Position : fixed bottom-right (offset 20px desktop, 16px mobile).
// Z-index : 60 (au-dessus du contenu, en dessous des modales 75-80).
//
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import CreateFeedbackModal from './CreateFeedbackModal'

export default function FloatingFeedbackButton() {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const location = useLocation()

  // Skip si on est déjà sur /feedback (bouton "+ Nouveau" déjà dispo en haut)
  if (location.pathname?.startsWith('/feedback')) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Signaler un bug ou proposer une idée"
        title="Signaler un bug ou proposer une idée"
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'var(--blue, #3B82F6)',
          color: 'white',
          border: 'none',
          boxShadow: hovered
            ? '0 6px 24px rgba(59,130,246,0.45)'
            : '0 4px 16px rgba(0,0,0,0.3)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 60,
          transition: 'transform 150ms ease, box-shadow 150ms ease',
          transform: hovered ? 'scale(1.08)' : 'scale(1)',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <MessageSquare size={20} />
        {/* Mini label au hover (style Intercom) */}
        {hovered && (
          <span
            style={{
              position: 'absolute',
              right: 'calc(100% + 10px)',
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '6px 10px',
              background: 'var(--bg-surf)',
              color: 'var(--txt)',
              border: '1px solid var(--brd)',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              pointerEvents: 'none',
            }}
          >
            Signaler un bug / une idée
          </span>
        )}
      </button>

      <CreateFeedbackModal
        open={open}
        initialPage={location.pathname || ''}
        onClose={() => setOpen(false)}
        onCreated={() => setOpen(false)}
      />
    </>
  )
}
