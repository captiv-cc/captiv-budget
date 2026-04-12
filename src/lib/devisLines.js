/**
 * Helpers de pré-traitement des lignes d'un devis avant calcul.
 *
 * /!\ IMPORTANT — pourquoi ce fichier existe :
 * --------------------------------------------------------------------
 * Avant l'extraction de cette fonction, deux endroits du code calculaient
 * la synthèse d'un devis :
 *   - DevisEditor.jsx (footer) : appliquait la transformation `dans_marge`
 *     hérité de la catégorie (cat hors marge → toutes ses lignes hors marge)
 *   - ProjetLayout.jsx (header BUDGET) : passait les lignes brutes telles
 *     que stockées en base.
 *
 * Résultat : si une catégorie était passée "Hors marge" APRÈS que ses
 * lignes aient été créées avec dans_marge=true, les deux calculs
 * divergeaient — typiquement de "marge_globale_pct × CA de la catégorie".
 *
 * → Cette transformation DOIT être appliquée par tout code qui appelle
 *   calcSynthese(). C'est le seul moyen d'éviter ce genre de drift.
 */

/**
 * Retourne les lignes du devis avec leur `dans_marge` recalculé en
 * fonction de leur catégorie : si la catégorie est marquée "Hors marge"
 * (`dans_marge === false`), toutes ses lignes sont forcées à
 * `dans_marge = false`. Sinon on garde la valeur stockée sur la ligne.
 *
 * @param {Array<{id, devis_id, category_id, dans_marge, ...}>} lines
 * @param {Array<{id, dans_marge, ...}>} categories
 * @returns {Array} lignes prêtes à être passées à calcSynthese()
 */
export function applyCategoryDansMarge(lines, categories) {
  if (!lines?.length) return []
  // Index catégorie par id pour un lookup O(1)
  const catById = new Map((categories || []).map(c => [c.id, c]))
  return lines.map(l => {
    const cat = catById.get(l.category_id)
    const catDansMarge = cat ? cat.dans_marge !== false : true
    return {
      ...l,
      dans_marge: catDansMarge ? l.dans_marge : false,
    }
  })
}
