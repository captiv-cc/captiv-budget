// ════════════════════════════════════════════════════════════════════════════
// PresenceAvatars — Avatars des admins actuellement sur la page Équipe
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche une rangée compacte d'avatars (initiales colorées) pour les autres
// admins connectés sur le projet en temps réel. Tooltip = nom complet au hover.
// Si plus de 3 personnes, on affiche les 3 premières + un badge "+N".
//
// Données : `othersOnPage` exposé par useEquipePresence (autres users, dédup
// par user_id, triés alpha). Si vide → rendu null (rien à afficher).
//
// Pas de lien interactif sur les avatars : c'est purement informationnel pour
// l'instant. Évolution possible : clic → ouvrir un mini panel "qui édite quoi".
// ════════════════════════════════════════════════════════════════════════════

import MonteurAvatar from '../../livrables/components/MonteurAvatar'

const MAX_VISIBLE = 3

export default function PresenceAvatars({ othersOnPage = [] }) {
  if (!othersOnPage.length) return null
  const visible = othersOnPage.slice(0, MAX_VISIBLE)
  const overflow = othersOnPage.length - visible.length

  return (
    <div
      className="flex items-center gap-1.5"
      title={
        othersOnPage.length === 1
          ? `${othersOnPage[0].full_name} est aussi sur cette page`
          : `${othersOnPage.length} autres personnes sur cette page`
      }
    >
      <span
        className="text-[10px] uppercase tracking-wider font-semibold"
        style={{ color: 'var(--txt-3)' }}
      >
        En ligne
      </span>
      <div className="flex items-center -space-x-1.5">
        {visible.map((u) => (
          <span
            key={u.user_id}
            className="rounded-full ring-2 inline-flex"
            style={{
              ['--tw-ring-color']: 'var(--bg)',
              boxShadow: '0 0 0 2px var(--bg)',
            }}
            title={u.full_name + (u.email ? ` · ${u.email}` : '')}
          >
            <MonteurAvatar name={u.full_name} size="md" />
          </span>
        ))}
        {overflow > 0 && (
          <span
            className="inline-flex items-center justify-center rounded-full text-[10px] font-bold"
            style={{
              width: 24,
              height: 24,
              background: 'var(--bg-elev)',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
              boxShadow: '0 0 0 2px var(--bg)',
            }}
            title={`+${overflow} autres`}
          >
            +{overflow}
          </span>
        )}
      </div>
    </div>
  )
}
