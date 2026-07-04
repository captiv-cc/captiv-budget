// ════════════════════════════════════════════════════════════════════════════
// navigationRef — ref globale pour naviguer hors composant (deep-link push)
// ════════════════════════════════════════════════════════════════════════════

import { createNavigationContainerRef } from '@react-navigation/native'

export const navigationRef = createNavigationContainerRef()

/**
 * Extrait un creneau_id depuis le payload d'une notif (data.creneau_id ou
 * deep_link "captivdesk://creneau/<id>").
 */
export function creneauIdFromNotif(data) {
  if (!data) return null
  if (data.creneau_id) return String(data.creneau_id)
  const link = data.deep_link
  if (typeof link === 'string') {
    const m = link.match(/creneau\/([^/?#]+)/)
    if (m) return m[1]
  }
  return null
}

/** Ouvre le détail d'un créneau dans l'onglet Planning (niché dans le stack). */
export function openCreneauFromPush(creneauId) {
  if (!creneauId || !navigationRef.isReady()) return
  navigationRef.navigate('Tabs', {
    screen: 'Planning',
    params: { openCreneauId: creneauId, ts: Date.now() },
  })
}

/**
 * Extrait un devis_id depuis le payload d'une notif devis (data.devis_id ou
 * link_web "/projets/<pid>/devis/<did>").
 */
export function devisIdFromNotif(data, linkWeb) {
  if (data?.devis_id) return String(data.devis_id)
  if (typeof linkWeb === 'string') {
    const m = linkWeb.match(/devis\/([^/?#]+)/)
    if (m) return m[1]
  }
  return null
}

/** Ouvre l'éditeur natif du devis (page poussée du stack racine). */
export function openDevisFromPush(devisId) {
  if (!devisId || !navigationRef.isReady()) return
  navigationRef.navigate('DevisEditor', { devisId })
}
