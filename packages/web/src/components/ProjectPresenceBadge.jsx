// ════════════════════════════════════════════════════════════════════════════
// ProjectPresenceBadge — Plug-and-play présence pour le header d'un onglet
// ════════════════════════════════════════════════════════════════════════════
//
// Un seul composant à poser dans le header d'un onglet projet pour activer
// la couche présence : crée le channel Realtime + affiche les avatars des
// autres users connectés. Pas de hook à câbler, pas de prop à dériver — tout
// est interne.
//
// Usage minimal :
//   <ProjectPresenceBadge outilKey="devis" projectId={projectId} />
//
// Si l'onglet a besoin du soft-lock per-row (Devis, Déroulé, Logistique,
// etc.), utiliser directement useProjectPresence dans le composant page et
// exposer les setters/getters aux lignes. Ce composant est SEULEMENT pour
// les avatars header (présence haute).
//
// Mapping outilKey → channelSlug :
//   - 'equipe' → 'equipe-presence' (compat historique)
//   - 'materiel' → 'matos-presence' (compat historique)
//   - tous les autres → '${outilKey}-presence'
//
// Cf. CHANTIER_PRESENCE_GLOBALE.md pour la vision et le déploiement.
// ════════════════════════════════════════════════════════════════════════════

import { useProjectPresence } from '../hooks/useProjectPresence'
import PresenceAvatars from './PresenceAvatars'

// Slugs historiques conservés pour ne pas casser les channels en place.
// Les nouveaux outils peuvent simplement utiliser leur outilKey.
const SLUG_OVERRIDES = {
  materiel: 'matos-presence',
}

function resolveChannelSlug(outilKey) {
  if (!outilKey) return null
  return SLUG_OVERRIDES[outilKey] || `${outilKey}-presence`
}

export default function ProjectPresenceBadge({
  outilKey,
  projectId,
  label,
  showLabel = true,
}) {
  const channelSlug = resolveChannelSlug(outilKey)
  const { othersOnPage } = useProjectPresence({ projectId, channelSlug })
  return (
    <PresenceAvatars
      othersOnPage={othersOnPage}
      label={label}
      showLabel={showLabel}
    />
  )
}
