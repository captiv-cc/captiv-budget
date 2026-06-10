// ════════════════════════════════════════════════════════════════════════════
// useEquipePresence — Wrapper mince sur useProjectPresence pour la tab Équipe
// ════════════════════════════════════════════════════════════════════════════
//
// Conserve l'API historique (othersOnPage, othersEditingByRow,
// setMyEditingRowId) pour ne pas casser les composants existants
// (EquipeTab, AttributionRow, MembreDrawer, PresenceCalendarModal,
// EquipePreviewModal). L'implémentation est entièrement déléguée à
// useProjectPresence (cf. CHANTIER_PRESENCE_GLOBALE).
//
// Channel slug historique : `equipe-presence:${projectId}`.
// ════════════════════════════════════════════════════════════════════════════

import { useProjectPresence } from './useProjectPresence'

export function useEquipePresence(projectId) {
  return useProjectPresence({
    projectId,
    channelSlug: 'equipe-presence',
  })
}
