// ════════════════════════════════════════════════════════════════════════════
// QuickCreateMenu — Menu contextuel de création rapide (FEST-3.2)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiché au clic dans une zone vide d'une lane (sans drag). Propose des
// actions de création pré-remplies + liste des créneaux concurrents dans
// les autres lanes (à lier via source_creneau_id pour propagation auto).
//
// Universel : ne dépend pas du type de projet. Les actions sont neutres
// (Tournage / Brief / Service) et fonctionnent pour festival, fiction, doc,
// pub, captation live, corporate, etc.
//
// Props :
//   - anchorRect : DOMRect du point cliqué (pour positionner)
//   - laneType : 'global' | 'equipe' | 'lieu' | 'personne'
//   - heureCible : minutes (debut du créneau cliqué — pour preview)
//   - heureFin : minutes (fin du créneau cliqué — défaut +30min)
//   - overlappingCreneaux : Array<creneau> qui chevauchent l'heure cliquée
//     (filtrés par DerouleTimelineView, exclus de la même lane)
//   - onChoose({ draftOverride }) : appelé au choix d'une action.
//     draftOverride peut contenir : { titre, type, source_creneau_id,
//     source_anchor }
//   - onClose
// ════════════════════════════════════════════════════════════════════════════

import { useRef, useEffect, useLayoutEffect, useState } from 'react'
import {
  Plus,
  Video,
  Wrench,
  ClipboardList,
  UtensilsCrossed,
  Coffee,
  Car,
  Link as LinkIcon,
  Moon,
} from 'lucide-react'
import { formatMinHHMM } from '../../lib/deroule'

// Actions rapides — neutres tous types de projet.
// Chaque action : { kind, label, icon, draftOverride }
// `draftOverride` est mergé avec les heures + lane par le caller.
const RAPID_ACTIONS = [
  {
    kind: 'libre',
    label: 'Créneau libre',
    icon: Plus,
    draftOverride: { type: 'autre', titre: '' },
    section: 'top',
  },
  {
    kind: 'tournage',
    label: 'Tournage',
    icon: Video,
    draftOverride: { type: 'prise', titre: '' },
    section: 'main',
  },
  {
    kind: 'setup',
    label: 'Setup matos',
    icon: Wrench,
    draftOverride: { type: 'install', titre: 'Setup matos' },
    section: 'main',
  },
  {
    kind: 'brief',
    label: 'Briefing',
    icon: ClipboardList,
    draftOverride: { type: 'brief', titre: 'Briefing équipe' },
    section: 'main',
  },
  {
    kind: 'repas',
    label: 'Repas',
    icon: UtensilsCrossed,
    draftOverride: { type: 'repas', titre: 'Repas' },
    section: 'service',
  },
  {
    kind: 'pause',
    label: 'Pause',
    icon: Coffee,
    draftOverride: { type: 'pause', titre: 'Pause' },
    section: 'service',
  },
  {
    kind: 'transit',
    label: 'Transit',
    icon: Car,
    draftOverride: { type: 'transport', titre: 'Transit' },
    section: 'service',
  },
]

export default function QuickCreateMenu({
  anchorRect,
  heureCible,
  heureFin,
  overlappingCreneaux = [],
  // FEST-5.2 : type de la lane cliquée — utilisé pour afficher l'option
  // "Indispo / Sommeil" seulement sur les lanes cadreur (type='personne').
  laneType = null,
  onChoose,
  onClose,
}) {
  const menuRef = useRef(null)

  // Click outside to close
  useEffect(() => {
    function onDocMouseDown(e) {
      if (menuRef.current?.contains(e.target)) return
      onClose?.()
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    // Délai pour ne pas se fermer au mousedown initial qui ouvre le menu
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

  // Positionnement : à droite du point cliqué, ou à gauche si pas la place.
  // Auto-flip vertical : si le menu dépasse en bas, on l'ancre au top du
  // bloc (flip up). Mesure de la vraie hauteur via useLayoutEffect pour
  // éviter le flash visuel.
  const MENU_WIDTH = 260
  const PADDING = 8
  const left = (() => {
    if (!anchorRect) return PADDING
    const spaceRight = window.innerWidth - anchorRect.right
    if (spaceRight >= MENU_WIDTH + PADDING) {
      return anchorRect.right + 4
    }
    return Math.max(PADDING, anchorRect.left - MENU_WIDTH - 4)
  })()
  const [top, setTop] = useState(() =>
    anchorRect ? Math.max(PADDING, anchorRect.top) : PADDING,
  )
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    if (!menuRef.current || !anchorRect) {
      setReady(true)
      return
    }
    const menuHeight = menuRef.current.offsetHeight
    const vh = window.innerHeight
    let proposedTop = anchorRect.top
    if (proposedTop + menuHeight > vh - PADDING) {
      // flip au-dessus : le menu finit pile au top du bloc cliqué
      proposedTop = anchorRect.bottom - menuHeight
    }
    proposedTop = Math.max(
      PADDING,
      Math.min(proposedTop, vh - menuHeight - PADDING),
    )
    setTop(proposedTop)
    setReady(true)
  }, [anchorRect])

  const topAction = RAPID_ACTIONS.find((a) => a.section === 'top')
  const mainActions = RAPID_ACTIONS.filter((a) => a.section === 'main')
  const serviceActions = RAPID_ACTIONS.filter((a) => a.section === 'service')

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
        animation: ready ? 'quick-create-menu-fade-in 100ms ease-out' : undefined,
      }}
    >
      {/* Header : heure cliquée */}
      <div
        style={{
          padding: '4px 8px 8px',
          fontSize: 11,
          color: 'var(--txt-3)',
          borderBottom: '1px solid var(--brd-sub)',
          marginBottom: 4,
        }}
      >
        Nouveau créneau à{' '}
        <strong style={{ color: 'var(--txt-2)' }}>
          {formatMinHHMM(heureCible)}
        </strong>
        {heureFin && (
          <>
            {' '}—{' '}
            <span style={{ color: 'var(--txt-3)' }}>
              {formatMinHHMM(heureFin)}
            </span>
          </>
        )}
      </div>

      {/* Item primary : créneau libre */}
      {topAction && (
        <MenuItem
          icon={topAction.icon}
          label={topAction.label}
          onClick={() => onChoose?.({ draftOverride: topAction.draftOverride })}
          primary
        />
      )}

      <Divider />

      {/* Section main : Tournage / Setup / Brief */}
      {mainActions.map((a) => (
        <MenuItem
          key={a.kind}
          icon={a.icon}
          label={a.label}
          onClick={() => onChoose?.({ draftOverride: a.draftOverride })}
        />
      ))}

      <Divider />

      {/* Section service : Repas / Pause / Transit */}
      {serviceActions.map((a) => (
        <MenuItem
          key={a.kind}
          icon={a.icon}
          label={a.label}
          onClick={() => onChoose?.({ draftOverride: a.draftOverride })}
        />
      ))}

      {/* FEST-5.2 : Indispo / Sommeil — visible uniquement sur lanes cadreur.
          Crée un créneau type='indispo' (rendu hachuré gris, bloque le drop
          d'autres créneaux dessus). */}
      {laneType === 'personne' && (
        <>
          <Divider />
          <MenuItem
            icon={Moon}
            label="Indispo"
            onClick={() =>
              onChoose?.({
                draftOverride: { type: 'indispo', titre: 'Indispo' },
              })
            }
          />
        </>
      )}

      {/* Section "Lié à ce moment" — créneaux qui chevauchent l'heure cliquée
          dans d'autres lanes (festival : artistes en cours ; doc : ITW
          programmée ; etc.). Click → crée un Tournage lié via
          source_creneau_id. */}
      {overlappingCreneaux.length > 0 && (
        <>
          <Divider />
          <SectionHeader label="Lié à ce moment" />
          {overlappingCreneaux.slice(0, 6).map((c) => (
            <MenuItem
              key={c.id}
              icon={LinkIcon}
              label={c.titre || '(sans titre)'}
              secondary={`${formatMinHHMM(c.heure_debut_min)}–${formatMinHHMM(c.heure_fin_min)}`}
              onClick={() =>
                onChoose?.({
                  draftOverride: {
                    type: 'prise',
                    titre: c.titre || '',
                    heure_debut_min: c.heure_debut_min,
                    heure_fin_min: c.heure_fin_min,
                    // FEST-3.2 raffinement Hugo : lieu hérité de la lane
                    // source (si type='lieu'). Ex: tournage lié à Macklemore
                    // qui joue sur "Scène Médiator" → lieu_text =
                    // "Scène Médiator" automatiquement.
                    lieu_text: c._lieuInferred || c.lieu_text || null,
                    // FEST-3.2 raffinement Hugo : copie aussi les notes du
                    // show à la création (le briefing technique du show est
                    // utile au cadreur).
                    notes: c.notes || null,
                    source_creneau_id: c.id,
                    source_anchor: {
                      // FEST-3.2 raffinements :
                      // - heure_debut_min : enfant suit l'heure (avec offset)
                      // - notes ajoutées (le briefing show est cascadable)
                      // - duree_min EXCLUE (durée locale préservée)
                      fields: [
                        'titre',
                        'lieu_text',
                        'heure_debut_min',
                        'notes',
                      ],
                    },
                  },
                })
              }
            />
          ))}
        </>
      )}

      <style>{`
        @keyframes quick-create-menu-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

function MenuItem({ icon: Icon, label, secondary, onClick, primary = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '7px 10px',
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        textAlign: 'left',
        color: 'var(--txt)',
        fontSize: 13,
        fontWeight: primary ? 500 : 400,
        transition: 'background 0.08s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {Icon && (
        <Icon
          size={15}
          style={{ color: 'var(--txt-3)', flexShrink: 0 }}
        />
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {secondary && (
        <span style={{ fontSize: 10, color: 'var(--txt-3)', flexShrink: 0 }}>
          {secondary}
        </span>
      )}
    </button>
  )
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: 'var(--brd-sub)',
        margin: '4px 0',
      }}
    />
  )
}

function SectionHeader({ label }) {
  return (
    <div
      style={{
        padding: '4px 10px',
        fontSize: 10,
        color: 'var(--txt-3)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.05,
      }}
    >
      {label}
    </div>
  )
}
