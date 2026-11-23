// ════════════════════════════════════════════════════════════════════════════
// pagination.js — lire une table Supabase en entier
// ════════════════════════════════════════════════════════════════════════════
//
// PostgREST s'arrête à 1 000 lignes par défaut, SANS le dire : la réponse est
// tronquée et ressemble à un résultat complet. Une liste de postes tirée de
// `minimas_convention` (près de 2 000 lignes) s'arrêtait ainsi au milieu de
// l'alphabet, et tout ce qui venait après « I » était introuvable.
//
// ⚠️ Le tri passé à la requête doit être DÉTERMINISTE, donc porter sur une
// clé unique. Trier sur une colonne à ex æquo laisse leur ordre au moteur, et
// une ligne peut passer d'une page à l'autre entre deux requêtes : elle n'est
// alors jamais servie.
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param {() => object} construireRequete - rend une requête PostgREST NEUVE
 *   à chaque appel (une requête déjà exécutée ne se rejoue pas).
 * @param {number} taillePage
 * @returns {Promise<Array>} toutes les lignes, dans l'ordre demandé
 */
export async function lireToutesLesPages(construireRequete, taillePage = 1000) {
  let tout = []
  let depuis = 0
  for (;;) {
    const { data, error } = await construireRequete().range(
      depuis,
      depuis + taillePage - 1,
    )
    if (error) throw error
    const page = data || []
    tout = tout.concat(page)
    // Une page incomplète est la dernière : c'est le seul signal que
    // PostgREST donne sur la fin d'une table.
    if (page.length < taillePage) return tout
    depuis += taillePage
  }
}
