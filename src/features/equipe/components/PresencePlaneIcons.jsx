// ════════════════════════════════════════════════════════════════════════════
// PresencePlaneIcons — overlay icônes plane sur une cellule de présence
// ════════════════════════════════════════════════════════════════════════════
//
// Composant ultra-mince qui rend, en absolute, deux petites icônes plane
// violettes dans les coins :
//   - haut-gauche : PlaneLanding (= jour d'arrivée du membre sur le projet)
//   - haut-droite : PlaneTakeoff (= jour de retour du membre)
//
// Doit être enfant d'un parent en `position: relative`. Pattern aligné sur
// PresenceCalendarModal pour la cohérence visuelle. La taille des badges
// est volontairement petite (10x10) pour ne pas écraser le X de présence
// au centre de la cellule.
//
// Props :
//   - persona : { arrival_date?, departure_date? } — l'objet membre
//   - iso : string YYYY-MM-DD — le jour rendu par la cellule
//
// Si ni l'un ni l'autre ne match, le composant ne rend rien (return null).
// ════════════════════════════════════════════════════════════════════════════

import { PlaneLanding, PlaneTakeoff } from 'lucide-react'
import { isArrivalDay, isDepartureDay } from '../../../lib/crew'

export default function PresencePlaneIcons({ persona, iso }) {
  const arrival = isArrivalDay(persona, iso)
  const departure = isDepartureDay(persona, iso)
  if (!arrival && !departure) return null

  const badgeStyle = {
    position: 'absolute',
    width: 10,
    height: 10,
    background: 'var(--purple)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  }
  const iconStyle = { width: 7, height: 7 }

  return (
    <>
      {arrival && (
        <span
          style={{
            ...badgeStyle,
            top: 0,
            left: 0,
            borderTopLeftRadius: 3,
            borderBottomRightRadius: 3,
          }}
          aria-label="Arrivée"
          title={`Arrivée le ${formatIso(iso)}`}
        >
          <PlaneLanding style={iconStyle} />
        </span>
      )}
      {departure && (
        <span
          style={{
            ...badgeStyle,
            top: 0,
            right: 0,
            borderTopRightRadius: 3,
            borderBottomLeftRadius: 3,
          }}
          aria-label="Retour"
          title={`Retour le ${formatIso(iso)}`}
        >
          <PlaneTakeoff style={iconStyle} />
        </span>
      )}
    </>
  )
}

function formatIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`
}
