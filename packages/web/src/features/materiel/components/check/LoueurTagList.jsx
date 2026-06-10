/**
 * LoueurTagList — pastilles loueurs read-only sur la checklist terrain (MAT-10O).
 *
 * Variante dépouillée de `LoueurPillsEditor` : pas de popover d'édition, pas de
 * bouton "+", juste l'affichage. Sert à identifier rapidement à quel loueur un
 * item appartient, pour que l'équipe technique sache quel matériel est chez
 * quel fournisseur pendant les essais ("la cam B est chez Panavision, on va
 * la checker ensemble").
 *
 * Chaque loueur est rendu comme une pastille textuelle avec sa couleur :
 *   ┌────────────┐
 *   │ • TSF      │   ← background alpha(couleur, '22'), border alpha(couleur, '55')
 *   └────────────┘
 *
 * Le `numero_reference` (ex. "2/3/6") est volontairement omis : côté terrain,
 * on n'en a pas besoin pour se repérer, et ça encombre la ligne. Seul le nom
 * du loueur compte à cet endroit.
 *
 * Props :
 *   - loueurs: Array<{ id, nom, couleur }>
 *
 * Rend `null` si la liste est vide — on évite d'ajouter une ligne fantôme
 * quand l'item n'a aucun loueur attaché.
 */

import { CircleDot } from 'lucide-react'

/** Ajoute un alpha (valeur hex 00-ff) à une couleur hex #RRGGBB. */
function alpha(hex, a = '22') {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#64748b22'
  return hex + a
}

export default function LoueurTagList({ loueurs = [] }) {
  if (!loueurs.length) return null
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {loueurs.map((l) => {
        const couleur = l?.couleur || '#64748b'
        const nom = l?.nom || 'Loueur'
        return (
          <span
            key={l.id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
            style={{
              background: alpha(couleur, '22'),
              color: couleur,
              border: `1px solid ${alpha(couleur, '55')}`,
              lineHeight: 1.2,
            }}
            title={nom}
          >
            <CircleDot className="w-2.5 h-2.5" />
            <span className="truncate max-w-[120px]">{nom}</span>
          </span>
        )
      })}
    </span>
  )
}
