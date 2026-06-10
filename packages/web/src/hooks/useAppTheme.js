/**
 * useAppTheme — détection du thème courant de l'app principale
 * ──────────────────────────────────────────────────────────────
 *
 * Aujourd'hui (2026-05) : l'application principale (sidebar, projets,
 * formulaires admin…) est en **dark mode permanent**. Le lightmode
 * existe uniquement sur des routes isolées (`/check/:token`,
 * `/share/livrables/:token`) via le tag `html[data-check-theme='light']`
 * et est géré localement par ces pages.
 *
 * Ce hook retourne donc systématiquement 'dark' pour les surfaces de
 * l'app principale.
 *
 * Demain : quand on déclenchera le lightmode global (préférence user
 * + bouton de toggle dans Paramètres + OS prefers-color-scheme),
 * c'est ICI qu'on branchera la détection. Tous les composants qui
 * utilisent ce hook suivront automatiquement, y compris le choix du
 * logo entre logo_url_sombre et logo_url_clair via pickOrgLogo().
 *
 * Stratégie d'évolution future suggérée :
 *   1. Lire un setting user (table profiles.theme_preference: 'auto' |
 *      'light' | 'dark') chargé au login
 *   2. Si 'auto', écouter window.matchMedia('(prefers-color-scheme:
 *      light)') et retourner dynamiquement
 *   3. Sinon retourner la valeur explicite
 *   4. Persister le choix dans profiles via un updateProfile()
 *
 * @returns {'dark'|'light'} le thème courant de l'app principale
 */
export function useAppTheme() {
  // Hardcodé tant que l'app interne n'a pas de lightmode global.
  // À refactor le jour où on l'introduira (un seul endroit à toucher).
  return 'dark'
}
