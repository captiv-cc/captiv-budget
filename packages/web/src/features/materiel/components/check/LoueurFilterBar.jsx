/**
 * LoueurFilterBar — bandeau de filtres loueurs en haut de /check/:token (MAT-10O).
 *
 * Affiche une rangée horizontale scrollable de "chips" cliquables permettant
 * de focaliser la checklist sur un loueur donné. L'UX est pensée pour le
 * workflow terrain : on passe chez un loueur, on tape son chip pour n'afficher
 * QUE les items concernés, on coche, puis on repasse en "Tous" ou on switche
 * au loueur suivant.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Filtrer :  [ Tous ] [ TSF ] [ Panavision ] [ RVZ ] [ Additifs]│
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Sémantique du filtre (décidée avec Hugo le 2026-04-22) :
 *   - "Tous" : aucun filtre, on voit tout (y compris items sans loueur).
 *   - "LoueurX" : on voit les items ayant X attaché, PLUS les items sans
 *     aucun loueur (souvent des défauts / additifs), PLUS les additifs
 *     ajoutés pendant les essais.
 *
 * Ce mode "inclusif" évite qu'un item mal tagué disparaisse complètement à la
 * vue de l'équipe quand ils sont sur le terrain chez le loueur. Mieux vaut
 * voir un item en trop que d'en perdre un critique.
 *
 * La bande de filtre ne s'affiche pas s'il n'y a qu'un seul loueur (ou zéro) —
 * auquel cas elle n'apporte rien et gaspille de l'espace vertical.
 *
 * Props :
 *   - loueurs: Array<{ id, nom, couleur }>
 *   - activeLoueurId: string | null   (null = "Tous")
 *   - onChange: (id: string | null) => void
 *   - counts?: Map<string | 'all', number>  (optionnel : affiche un badge
 *     compteur à côté de chaque chip — pratique pour prioriser)
 */

import { CircleDot } from 'lucide-react'

function alpha(hex, a = '22') {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#64748b22'
  return hex + a
}

export default function LoueurFilterBar({
  loueurs = [],
  activeLoueurId = null,
  onChange,
  counts = null,
}) {
  // Pas de filtre utile si 0 ou 1 loueur — on n'encombre pas le header.
  if (loueurs.length < 2) return null

  const allCount = counts?.get('all')
  const activeIsAll = activeLoueurId === null

  return (
    <div className="mb-4">
      {/* Libellé discret à gauche + chips qui scrollent horizontalement sur mobile */}
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--txt-3)' }}
        >
          Filtrer
        </span>
        <div
          className="flex-1 flex items-center gap-2 overflow-x-auto pb-1 -mb-1"
          // `-mb-1 pb-1` assure que le scrollbar horizontal (quand il apparaît)
          // ne mange pas les chips sous le texte du bouton.
          style={{ scrollbarWidth: 'thin' }}
        >
          {/* Chip "Tous" — toujours en premier */}
          <FilterChip
            label="Tous"
            count={allCount}
            active={activeIsAll}
            onClick={() => onChange?.(null)}
            // Couleur neutre (pas un loueur réel) : on reprend --blue pour la
            // couleur active par défaut, cohérent avec le reste du design.
            activeColor="var(--blue)"
            activeBg="var(--blue)"
            activeFg="#fff"
            idleFg="var(--txt-2)"
            idleBg="var(--bg-surf)"
            idleBorder="var(--brd)"
          />

          {/* Un chip par loueur */}
          {loueurs.map((l) => {
            const couleur = l?.couleur || '#64748b'
            const nom = l?.nom || 'Loueur'
            const isActive = l.id === activeLoueurId
            const count = counts?.get(l.id)
            return (
              <FilterChip
                key={l.id}
                label={nom}
                count={count}
                icon={<CircleDot className="w-3 h-3" />}
                active={isActive}
                onClick={() => onChange?.(l.id)}
                // Actif : fond plein de la couleur loueur, texte blanc.
                activeColor={couleur}
                activeBg={couleur}
                activeFg="#fff"
                // Inactif : on garde la teinte loueur pour que le chip soit
                // reconnaissable au premier coup d'œil, mais en version pastel.
                idleFg={couleur}
                idleBg={alpha(couleur, '18')}
                idleBorder={alpha(couleur, '55')}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Chip élémentaire du filter bar. Séparé pour permettre au composant parent
 * de déclarer la palette (fond actif / inactif) par chip : "Tous" utilise le
 * bleu accent, chaque loueur utilise sa propre couleur.
 */
function FilterChip({
  label,
  count,
  icon = null,
  active,
  onClick,
  activeColor,
  activeBg,
  activeFg,
  idleFg,
  idleBg,
  idleBorder,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
      style={{
        background: active ? activeBg : idleBg,
        color: active ? activeFg : idleFg,
        border: `1px solid ${active ? activeColor : idleBorder}`,
        whiteSpace: 'nowrap',
      }}
      aria-pressed={active}
    >
      {icon}
      <span className="truncate max-w-[140px]">{label}</span>
      {typeof count === 'number' && (
        <span
          className="tabular-nums text-[10px] px-1.5 rounded-full"
          style={{
            background: active ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.08)',
            color: active ? activeFg : idleFg,
            opacity: 0.85,
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}
