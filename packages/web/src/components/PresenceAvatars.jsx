// ════════════════════════════════════════════════════════════════════════════
// PresenceAvatars — Avatars empilés des autres users connectés à la page
// ════════════════════════════════════════════════════════════════════════════
//
// Composant générique réutilisable cross-onglet. Affiche une rangée compacte
// d'avatars (initiales colorées) pour les autres admins connectés en temps
// réel sur la même page. Tooltip = nom complet au hover. Au-delà de 3
// personnes, badge "+N" pour le reflux.
//
// Données : `othersOnPage` exposé par useProjectPresence (autres users,
// dédupliqués par user_id, triés alpha, chacun avec sa couleur déterministe).
// Si vide → rendu null (rien à afficher → pas de gaspillage d'espace).
//
// Pas de lien interactif sur les avatars pour l'instant. Évolution prévue
// (cf. CHANTIER_PRESENCE_GLOBALE PRES-3) : clic → mini panel "qui édite
// quoi" + navigation vers le même onglet/projet pour la vue cross-projet.
// ════════════════════════════════════════════════════════════════════════════

import MonteurAvatar from '../features/livrables/components/MonteurAvatar'

const MAX_VISIBLE = 3

export default function PresenceAvatars({
  othersOnPage = [],
  label = 'En ligne',
  showLabel = true,
}) {
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
      {showLabel && (
        <span
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--txt-3)' }}
        >
          {label}
        </span>
      )}
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
