/**
 * Helpers de branding multi-tenant
 * ─────────────────────────────────
 * Centralise la logique de choix d'asset visuel selon le thème courant
 * et l'organisation. Pensé pour rester valable le jour où l'app aura un
 * vrai lightmode (aujourd'hui elle est en dark permanent).
 *
 * Si tu veux changer la stratégie (ex: forcer light pour les PDFs blancs,
 * ou suivre la préférence OS), c'est ICI que ça se passe — pas dans les
 * dizaines de composants qui consomment ces helpers.
 */

// Logo CAPTIV de fallback : version unique servant pour clair/sombre tant
// qu'aucun logo personnalisé n'est uploadé par l'organisation.
const FALLBACK_LOGO = '/captiv-logo.png'

/**
 * Retourne l'URL du logo le plus approprié pour l'org dans le contexte donné.
 *
 * @param {Object|null} org - L'objet organisation (peut contenir
 *   logo_url_clair / logo_url_sombre / logo_banner_url).
 * @param {'light'|'dark'|'banner'} [mode='dark'] - Variante voulue :
 *   - 'dark'   : fond sombre (UI darkmode, hero immersif)
 *   - 'light'  : fond clair (UI lightmode, PDF blanc)
 *   - 'banner' : version horizontale lockup (en-têtes PDF)
 * @returns {string} URL exploitable par <img src> ou jsPDF.addImage.
 */
export function pickOrgLogo(org, mode = 'dark') {
  if (!org) return FALLBACK_LOGO

  if (mode === 'banner') {
    // Pour les en-têtes PDF, on préfère la version horizontale.
    // Si pas de banner uploadé, on retombe sur le logo clair (PDFs sont
    // typiquement sur fond blanc) puis sur le sombre, puis fallback.
    return (
      org.logo_banner_url ||
      org.logo_url_clair ||
      org.logo_url_sombre ||
      FALLBACK_LOGO
    )
  }

  if (mode === 'light') {
    // Fond clair : on préfère logo_url_clair, fallback sur sombre puis défaut
    return org.logo_url_clair || org.logo_url_sombre || FALLBACK_LOGO
  }

  // Mode 'dark' (par défaut) : on préfère logo_url_sombre, fallback sur clair
  return org.logo_url_sombre || org.logo_url_clair || FALLBACK_LOGO
}

/**
 * Variante synchrone du logo de fallback pour les cas où on a besoin d'une
 * URL même sans org chargée (ex: page Login avant authentification).
 */
export function defaultLogo() {
  return FALLBACK_LOGO
}
