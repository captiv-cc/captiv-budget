// ════════════════════════════════════════════════════════════════════════════
// useMaterielPresence — Wrapper mince sur useProjectPresence (tab Matériel)
// ════════════════════════════════════════════════════════════════════════════
//
// Conserve l'API historique (othersOnPage, othersEditingByItem,
// setMyEditingItemId) en remappant les noms génériques row → item, pour ne
// pas casser BlockList / ItemRow / Block / MaterielHeader / MaterielTab.
//
// L'implémentation est entièrement déléguée à useProjectPresence
// (cf. CHANTIER_PRESENCE_GLOBALE). Channel slug historique conservé :
// `matos-presence:${projectId}`.
// ════════════════════════════════════════════════════════════════════════════

import { useProjectPresence } from './useProjectPresence'

export function useMaterielPresence(projectId) {
  const { othersOnPage, othersEditingByRow, setMyEditingRowId, myColor } =
    useProjectPresence({
      projectId,
      channelSlug: 'matos-presence',
    })

  return {
    othersOnPage,
    othersEditingByItem: othersEditingByRow,
    setMyEditingItemId: setMyEditingRowId,
    myColor,
  }
}
