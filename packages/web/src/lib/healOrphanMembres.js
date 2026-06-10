/**
 * healOrphanMembres.js — Auto-heal des projet_membres orphelins.
 *
 * Contexte : quand un devis est révisé (dupliqué en Vn+1) puis la nouvelle
 * version est acceptée, `pickRefDevis` sélectionne la dernière version, mais
 * les `projet_membres.devis_line_id` continuent de pointer vers les lignes
 * de l'ancienne version. Résultat : le Budget réel (et RecapPaiements)
 * ne retrouve plus aucune personne staffée → 0 humain dans le récap.
 *
 * Cette fonction détecte les membres orphelins et les rebind vers la ligne
 * équivalente du refDevis courant (match par produit + nom de catégorie,
 * dans le même lot). Elle est appelée :
 *   • au chargement de BudgetReelTab (Option 1 — répare les données cassées)
 *   • quand un devis passe en statut "accepté" (Option 3 — prévient le bug)
 *
 * Idempotent : si tous les membres matchent déjà, retourne { rebound: 0 }
 * sans faire d'écriture en base.
 */

import { supabase } from './supabase'
import { pickRefDevis, groupDevisByLot } from './lots'
import { normalizeSearch } from './searchUtils'

// Alias local : on utilise `normalizeSearch` (NFD + diacritiques + lowercase)
// pour rester accent-insensitive — un devis source nommé "Régie" et un
// nouveau devis nommé "Regie" doivent matcher.
const norm = normalizeSearch

/**
 * Rebind les projet_membres orphelins d'un projet vers les lignes équivalentes
 * des refDevis actuels.
 *
 * @param {string} projectId
 * @returns {Promise<{ rebound: number, unmatched: Array, skipped: number }>}
 */
export async function healOrphanMembres(projectId) {
  if (!projectId) return { rebound: 0, unmatched: [], skipped: 0 }

  // 1) Charger les données de structure : lots + devis + membres
  const [lotsR, devisR, membresR] = await Promise.all([
    supabase.from('devis_lots').select('*').eq('project_id', projectId),
    supabase.from('devis').select('*').eq('project_id', projectId),
    supabase.from('projet_membres').select('*').eq('project_id', projectId),
  ])

  const lots = lotsR.data || []
  const devisList = devisR.data || []
  const membres = membresR.data || []
  if (lots.length === 0 || devisList.length === 0) {
    return { rebound: 0, unmatched: [], skipped: 0 }
  }

  // 2) Calculer les refDevis courants par lot
  const devisByLot = groupDevisByLot(lots, devisList)
  const refDevisByLot = {} // lotId → devis
  for (const lot of lots) {
    const ref = pickRefDevis(devisByLot[lot.id])
    if (ref) refDevisByLot[lot.id] = ref
  }
  const refDevisIds = Object.values(refDevisByLot).map((d) => d.id)
  if (refDevisIds.length === 0) return { rebound: 0, unmatched: [], skipped: 0 }

  // 3) Charger les lignes + cats des refDevis (cible du rebind)
  const [refLinesR, refCatsR] = await Promise.all([
    supabase.from('devis_lines').select('*').in('devis_id', refDevisIds),
    supabase.from('devis_categories').select('*').in('devis_id', refDevisIds),
  ])
  const refLines = refLinesR.data || []
  const refCats = refCatsR.data || []
  const refLineIds = new Set(refLines.map((l) => l.id))
  const refCatById = Object.fromEntries(refCats.map((c) => [c.id, c]))
  // devisId → lotId pour savoir à quel lot appartient une ligne cible
  const lotIdByDevisId = {}
  for (const lot of lots) {
    if (refDevisByLot[lot.id]) lotIdByDevisId[refDevisByLot[lot.id].id] = lot.id
  }

  // 4) Détecter les orphelins : devis_line_id défini mais pas dans refLineIds
  const orphans = membres.filter((m) => m.devis_line_id && !refLineIds.has(m.devis_line_id))
  if (orphans.length === 0) return { rebound: 0, unmatched: [], skipped: 0 }

  // 5) Charger les anciennes lignes pointées par les orphelins + leurs cats
  //    pour connaître (ancien produit, ancien bloc, ancien lot via devis.lot_id)
  const orphanLineIds = [...new Set(orphans.map((m) => m.devis_line_id))]
  const { data: orphanLinesData } = await supabase
    .from('devis_lines')
    .select('id, devis_id, category_id, produit')
    .in('id', orphanLineIds)
  const orphanLines = orphanLinesData || []

  const orphanCatIds = [...new Set(orphanLines.map((l) => l.category_id).filter(Boolean))]
  const orphanDevisIds = [...new Set(orphanLines.map((l) => l.devis_id))]
  const [orphanCatsR, orphanDevisR, srcAllLinesR] = await Promise.all([
    orphanCatIds.length
      ? supabase.from('devis_categories').select('id, name').in('id', orphanCatIds)
      : Promise.resolve({ data: [] }),
    orphanDevisIds.length
      ? supabase.from('devis').select('id, lot_id').in('id', orphanDevisIds)
      : Promise.resolve({ data: [] }),
    // Charge TOUTES les lignes des devis sources (pas seulement les orphelines)
    // pour pouvoir calculer l'index relatif d'une ligne dans la séquence des
    // produits identiques. Utilisé en fallback quand plusieurs candidats ont
    // le même produit dans le refDevis cible.
    orphanDevisIds.length
      ? supabase
          .from('devis_lines')
          .select('id, devis_id, category_id, produit, sort_order')
          .in('devis_id', orphanDevisIds)
      : Promise.resolve({ data: [] }),
  ])
  const orphanCatNameById = Object.fromEntries(
    (orphanCatsR.data || []).map((c) => [c.id, c.name]),
  )
  const orphanLotByDevisId = Object.fromEntries(
    (orphanDevisR.data || []).map((d) => [d.id, d.lot_id]),
  )
  const orphanLineById = Object.fromEntries(orphanLines.map((l) => [l.id, l]))
  const srcAllLines = srcAllLinesR.data || []

  // 6) Pour chaque orphelin, chercher la ligne équivalente dans le refDevis du même lot
  //    Match : même produit (trim + lowercase) + même nom de catégorie
  const updates = [] // { id, devis_line_id }
  const unmatched = [] // pour le log / debug

  for (const m of orphans) {
    const oldLine = orphanLineById[m.devis_line_id]
    if (!oldLine) {
      unmatched.push({ membre: m, reason: 'ancienne ligne introuvable (supprimée ?)' })
      continue
    }
    const originalLotId = orphanLotByDevisId[oldLine.devis_id]
    if (!originalLotId) {
      unmatched.push({ membre: m, reason: 'lot d\'origine introuvable' })
      continue
    }
    const targetDevis = refDevisByLot[originalLotId]
    if (!targetDevis) {
      unmatched.push({ membre: m, reason: 'aucun refDevis pour ce lot' })
      continue
    }
    const oldCatName = orphanCatNameById[oldLine.category_id]

    // Candidats = refLines du bon devis, avec même produit (+ même nom de bloc si possible)
    const candidates = refLines.filter(
      (l) =>
        l.devis_id === targetDevis.id &&
        norm(l.produit) === norm(oldLine.produit) &&
        (oldCatName ? norm(refCatById[l.category_id]?.name) === norm(oldCatName) : true),
    )

    if (candidates.length === 1) {
      updates.push({ id: m.id, devis_line_id: candidates[0].id })
    } else if (candidates.length > 1) {
      // Ambiguïté : 3 stratégies de fallback en cascade.
      //
      // 1) Match strict par sort_order — fonctionne si la duplication a
      //    préservé l'ordre exact (cas le plus courant).
      const strict = candidates.find((c) => c.sort_order === oldLine.sort_order)
      if (strict) {
        updates.push({ id: m.id, devis_line_id: strict.id })
        continue
      }

      // 2) Match par index relatif — robuste face à un décalage de
      //    sort_order (ex: insertion d'une ligne entre la duplication et
      //    le rebind). Si oldLine est la N-ème ligne avec ce produit dans
      //    le devis source (par sort_order), on cible la N-ème ligne avec
      //    le même produit dans le refDevis cible. Cas typique : 3 lignes
      //    "Cadreur" en V2 + 3 en V3 → la "2ème Cadreur" V2 mappe la
      //    "2ème Cadreur" V3.
      const oldSiblings = srcAllLines
        .filter(
          (l) =>
            l.devis_id === oldLine.devis_id &&
            norm(l.produit) === norm(oldLine.produit),
        )
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      const oldIndex = oldSiblings.findIndex((l) => l.id === oldLine.id)
      if (oldIndex >= 0) {
        const sortedCandidates = [...candidates].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
        )
        const matchedByIndex = sortedCandidates[oldIndex]
        if (matchedByIndex) {
          updates.push({ id: m.id, devis_line_id: matchedByIndex.id })
          continue
        }
      }

      // 3) Abandon — on laisse le membre orphelin pour ne pas l'attribuer
      //    à tort. Il sera signalé par le bandeau d'avertissement dans
      //    EquipeTab.
      unmatched.push({
        membre: m,
        reason: `${candidates.length} candidats ambigus pour "${oldLine.produit}"`,
      })
    } else {
      unmatched.push({ membre: m, reason: `aucun match pour "${oldLine.produit}"` })
    }
  }

  // 7) Écriture en base (1 update par membre — petits volumes, pas besoin de batch)
  for (const u of updates) {
    const { error } = await supabase
      .from('projet_membres')
      .update({ devis_line_id: u.devis_line_id })
      .eq('id', u.id)
    if (error) {
      console.error('[healOrphanMembres] update failed', u, error)
    }
  }

  if (import.meta.env.DEV && (updates.length > 0 || unmatched.length > 0)) {
    console.warn(
      `[healOrphanMembres] projet ${projectId} : ${updates.length} membre(s) rebind, ${unmatched.length} non match\u00e9(s)`,
      unmatched.length > 0
        ? unmatched.map((u) => ({ prenom: u.membre.prenom, nom: u.membre.nom, reason: u.reason }))
        : '',
    )
  }

  return { rebound: updates.length, unmatched, skipped: 0 }
}
