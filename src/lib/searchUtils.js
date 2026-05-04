/**
 * searchUtils.js — Helpers transverses pour la recherche texte user-facing.
 *
 * Convention Captiv : tous les filtres de recherche déclenchés par un input
 * utilisateur doivent passer par `normalizeSearch` pour rester
 * **accent-insensitive** et lowercase-insensitive.
 *
 * Pourquoi : un user qui tape "camera" doit trouver un plan "Caméra", une
 * personne "Élise" doit être trouvée par "elise", un loueur "Régie Sud"
 * par "regie", etc. Sans normalisation, ces cas naturels échouent
 * silencieusement et frustrent l'utilisateur.
 *
 * Pattern attendu :
 *
 *   import { normalizeSearch } from '@/lib/searchUtils'
 *
 *   const q = normalizeSearch(searchInput)
 *   list.filter((item) => normalizeSearch(item.name).includes(q))
 *
 * Pour les nouveaux outils de recherche : utilise toujours ce helper.
 * Pour les anciens : voir `git log --grep="search-normalize"` pour les
 * migrations passées.
 */

/**
 * Normalise une chaîne pour la recherche : lowercase + retrait des accents
 * (NFD + suppression des diacritiques).
 *
 * Robuste aux entrées non-string (number, null, undefined) — retourne
 * une chaîne vide pour ces cas.
 *
 * @param {string|number|null|undefined} s
 * @returns {string}
 */
export function normalizeSearch(s) {
  if (s == null) return ''
  return s
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
