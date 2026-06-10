// ════════════════════════════════════════════════════════════════════════════
// ActionSheet — menu d'actions responsive (bottom sheet mobile / popover desktop)
// ════════════════════════════════════════════════════════════════════════════
// MAT-23C. Composant UI générique qui remplace les multiples boutons empilés
// (MessageCircle + Camera + ⋯) par un seul trigger qui ouvre un menu contextuel.
//
// Deux rendus automatiques suivant le breakpoint :
//   - Mobile (<640px) : bottom sheet qui remonte du bas, backdrop, tap hors =
//     close. Densité tactile (56px min par action). Utile sur le plateau où
//     la main pouce doit atteindre les cibles sans gymnastique.
//   - Desktop/Tablet (≥640px) : popover classique ancré sous le trigger,
//     aligné à droite par défaut. Portal vers document.body pour s'échapper
//     des overflow-hidden des cartes parentes.
//
// ─── API ─────────────────────────────────────────────────────────────────────
//
//   <ActionSheet
//     title="Options item"
//     align="right"                // 'left' | 'right' (popover desktop)
//     trigger={({ ref, toggle, open }) => (
//       <button ref={ref} onClick={toggle}>⋯</button>
//     )}
//     actions={[
//       { id: 'signal', icon: AlertTriangle, label: 'Signaler', onClick,
//         variant: 'warning', badge: 2 },
//       { id: 'sep',    type: 'separator' },
//       { id: 'delete', icon: Trash2, label: 'Supprimer', onClick,
//         variant: 'danger', disabled: false },
//     ]}
//     open={open} onOpenChange={setOpen}  // optionnel (mode contrôlé)
//   />
//
// Variants : 'default' (txt) | 'primary' (blue) | 'warning' (orange) |
//            'danger' (red) | 'success' (green).
//
// Le `trigger` est une render-prop qui reçoit `{ ref, toggle, open }`. Le
// parent reste libre du bouton (icône, style, a11y) — ActionSheet gère juste
// l'ouverture/fermeture et le positionnement.
//
// Mode contrôlé OPTIONNEL : si `open` est fourni, le state devient externe
// (utile pour brancher une ouverture programmatique, ex. "ouvrir via un
// raccourci clavier" ou "ouvrir depuis un autre composant"). Sinon, le state
// est interne et pilote par `toggle()`.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBreakpoint } from '../hooks/useBreakpoint'

// Couleurs par variant. On réutilise les tokens globaux du thème pour rester
// aligné avec les autres composants (toast d'erreur rouge, flag orange, etc.).
const VARIANT_COLORS = {
  default: 'var(--txt)',
  primary: 'var(--blue)',
  warning: 'var(--orange)',
  danger: 'var(--red)',
  success: 'var(--green)',
}

export default function ActionSheet({
  title = null,
  actions = [],
  open: controlledOpen,
  onOpenChange,
  trigger,
  align = 'right',
}) {
  // Mode contrôlé vs non-contrôlé (cf. pattern Radix/shadcn).
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const setOpen = useCallback(
    (value) => {
      // On lit `open` via ref pour ne pas capturer la valeur stale dans le
      // closure (évite les bugs du type "double-toggle = pas de changement").
      const next =
        typeof value === 'function' ? value(isControlled ? controlledOpen : uncontrolledOpen) : value
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, controlledOpen, uncontrolledOpen, onOpenChange],
  )

  const toggle = useCallback(() => setOpen((v) => !v), [setOpen])
  const close = useCallback(() => setOpen(false), [setOpen])

  const triggerRef = useRef(null)
  const bp = useBreakpoint()
  const useBottomSheet = bp.isMobile

  // Render-prop : le parent décide du bouton, on passe juste le ref + toggle.
  // Si `trigger` est un simple noeud (pas une fonction), on le rend tel quel —
  // utile quand l'ouverture est contrôlée et qu'on n'a pas besoin de ref.
  const triggerNode =
    typeof trigger === 'function'
      ? trigger({ ref: triggerRef, toggle, open })
      : trigger

  return (
    <>
      {triggerNode}
      {open &&
        (useBottomSheet ? (
          <BottomSheet title={title} actions={actions} onClose={close} />
        ) : (
          <Popover
            triggerRef={triggerRef}
            title={title}
            actions={actions}
            onClose={close}
            align={align}
          />
        ))}
    </>
  )
}

// ─── Bottom sheet (mobile) ──────────────────────────────────────────────────

function BottomSheet({ title, actions, onClose }) {
  // Animation d'entrée : on monte le composant avec `visible=false`, puis on
  // bascule en `true` au prochain frame pour déclencher la transition CSS.
  // La fermeture fait l'inverse : `visible=false`, puis onClose() après l'anim
  // pour laisser le temps à l'exit de se jouer.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const handleClose = useCallback(() => {
    setVisible(false)
    // 220ms = durée de l'anim de sortie (cf. transition ci-dessous)
    setTimeout(onClose, 220)
  }, [onClose])

  // Scroll lock + Escape key. Le scroll lock est important sinon la page
  // derrière le backdrop peut scroller quand on swipe sur la sheet.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [handleClose])

  // Swipe-to-dismiss : on suit le doigt sur la drag handle + le header. Si le
  // drag dépasse 80px vers le bas, on ferme ; sinon on snap back à 0.
  const [dragY, setDragY] = useState(0)
  const dragStartY = useRef(null)
  const sheetRef = useRef(null)

  function onTouchStart(e) {
    dragStartY.current = e.touches[0].clientY
  }
  function onTouchMove(e) {
    if (dragStartY.current === null) return
    const dy = e.touches[0].clientY - dragStartY.current
    // On n'autorise que le drag vers le bas (dy > 0). Vers le haut = 0.
    setDragY(Math.max(0, dy))
  }
  function onTouchEnd() {
    if (dragStartY.current === null) return
    dragStartY.current = null
    if (dragY > 80) {
      handleClose()
    } else {
      setDragY(0)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col justify-end"
      style={{
        background: visible ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0)',
        transition: 'background-color 200ms',
      }}
      onClick={handleClose}
      role="presentation"
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || "Menu d'actions"}
        className="rounded-t-2xl overflow-hidden"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          borderBottom: 'none',
          maxHeight: '80vh',
          transform: visible
            ? `translateY(${dragY}px)`
            : 'translateY(100%)',
          transition: dragStartY.current !== null
            ? 'none'
            : 'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: 'env(safe-area-inset-bottom, 0)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Zone de drag — drag handle + (optionnel) header avec titre */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex justify-center py-2.5">
            <span
              className="block w-10 h-1 rounded-full"
              style={{ background: 'var(--brd)' }}
              aria-hidden="true"
            />
          </div>
          {title && (
            <div
              className="flex items-center justify-between px-4 pb-2 pt-1 border-b"
              style={{ borderColor: 'var(--brd-sub)' }}
            >
              <h3
                className="text-sm font-semibold truncate"
                style={{ color: 'var(--txt)' }}
              >
                {title}
              </h3>
              <button
                type="button"
                onClick={handleClose}
                className="p-1 -mr-1 rounded"
                aria-label="Fermer"
                style={{ color: 'var(--txt-3)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        <div
          className="overflow-auto"
          // maxHeight calé sur 80vh - (drag handle 24 + header env. 40) pour
          // laisser de la place aux actions sans déborder de la sheet.
          style={{ maxHeight: 'calc(80vh - 72px)' }}
        >
          <ActionsList actions={actions} onClose={handleClose} density="mobile" />
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Popover (desktop / tablet) ─────────────────────────────────────────────

function Popover({ triggerRef, title, actions, onClose, align }) {
  const menuRef = useRef(null)
  const [coords, setCoords] = useState(null)

  // Positionnement : on lit le bounding rect du trigger et on place le menu
  // juste en dessous, aligné à gauche ou à droite. Recalcul sur resize/scroll
  // pour suivre si le trigger bouge (cas fréquent si le menu est dans une
  // ligne scrollable — cf. CheckItemRow).
  useLayoutEffect(() => {
    function recompute() {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const next = { top: rect.bottom + 4 } // 4px de gap visuel
      if (align === 'left') {
        next.left = rect.left
      } else {
        next.right = window.innerWidth - rect.right
      }
      setCoords(next)
    }
    recompute()
    window.addEventListener('resize', recompute)
    // capture=true pour intercepter le scroll des conteneurs parents, pas
    // seulement window (important : les cartes chantier scrollent souvent).
    window.addEventListener('scroll', recompute, true)
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
  }, [triggerRef, align])

  // Fermeture sur clic extérieur + Escape. On ignore les clics sur le trigger
  // (pour ne pas re-fermer instantanément) et dans le menu (pour laisser les
  // onClick des actions passer).
  useEffect(() => {
    function onDocMouseDown(e) {
      if (triggerRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      onClose()
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, triggerRef])

  if (!coords) return null

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={title || "Menu d'actions"}
      className="fixed z-[9998] min-w-[240px] max-w-[320px] rounded-lg shadow-2xl overflow-hidden"
      style={{
        ...coords,
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
      }}
    >
      {title && (
        <div
          className="px-3 py-2 text-xs font-medium uppercase tracking-wide border-b"
          style={{ borderColor: 'var(--brd-sub)', color: 'var(--txt-3)' }}
        >
          {title}
        </div>
      )}
      <ActionsList actions={actions} onClose={onClose} density="desktop" />
    </div>,
    document.body,
  )
}

// ─── Liste d'actions (partagée mobile/desktop) ──────────────────────────────

/**
 * Rend la liste des actions. `density` contrôle le padding vertical :
 *   - 'mobile'  : 56px min par ligne (norme tactile Material / iOS)
 *   - 'desktop' : plus compact, adapté au pointeur souris
 *
 * Les séparateurs ({ type: 'separator' }) tracent une ligne horizontale
 * pour grouper les actions (ex. isoler les actions destructives en bas).
 *
 * Le onClick ferme le menu AVANT d'appeler l'handler — l'handler peut ouvrir
 * un dialog modal (confirm/prompt) qui ne doit pas être recouvert par le menu.
 * Les erreurs sont avalées ici (l'handler est responsable de ses toasts).
 */
function ActionsList({ actions, onClose, density }) {
  const padding = density === 'mobile' ? 'px-4 py-4' : 'px-3 py-2.5'
  const iconSize = density === 'mobile' ? 'w-5 h-5' : 'w-4 h-4'

  return (
    <div role="group">
      {actions.map((action, idx) => {
        if (action.type === 'separator') {
          return (
            <div
              key={action.id || `sep-${idx}`}
              role="separator"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            />
          )
        }

        const Icon = action.icon
        const color = VARIANT_COLORS[action.variant] || VARIANT_COLORS.default
        const disabled = Boolean(action.disabled)

        return (
          <button
            key={action.id || idx}
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={async () => {
              // Ferme le menu avant d'exécuter l'action, pour que d'éventuels
              // dialogs (confirm/prompt) ne soient pas recouverts.
              onClose()
              try {
                await action.onClick?.()
              } catch (err) {
                // Les handlers sont responsables de leurs toasts — on log juste
                // ici pour ne pas casser le cycle close() → onClick().
                console.error('[ActionSheet] action failed', err)
              }
            }}
            className={`w-full text-left ${padding} text-sm flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
            style={{ color, background: 'transparent' }}
            onMouseEnter={(e) => {
              if (!disabled) e.currentTarget.style.background = 'var(--bg-hov)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {Icon && <Icon className={`${iconSize} shrink-0`} strokeWidth={2} />}
            <span className="flex-1 min-w-0 truncate">{action.label}</span>
            {action.badge !== undefined && action.badge !== null && (
              <span
                className="text-xs px-1.5 py-0.5 rounded tabular-nums shrink-0"
                style={{
                  background: 'var(--bg-surf)',
                  color: 'var(--txt-2)',
                  border: '1px solid var(--brd-sub)',
                }}
              >
                {action.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
