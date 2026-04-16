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

function norm(s) {
  return (s || '').trim().toLowerCase()
}

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
  const [orphanCatsR, orphanDevisR] = await Promise.all([
    orphanCatIds.length
      ? supabase.from('devis_categories').select('id, name').in('id', orphanCatIds)
      : Promise.resolve({ data: [] }),
    orphanDevisIds.length
      ? supabase.from('devis').select('id, lot_id').in('id', orphanDevisIds)
      : Promise.resolve({ data: [] }),
  ])
  const orphanCatNameById = Object.fromEntries(
    (orphanCatsR.data || []).map((c) => [c.id, c.name]),
  )
  const orphanLotByDevisId = Object.fromEntries(
    (orphanDevisR.data || []).map((d) => [d.id, d.lot_id]),
  )
  const orphanLineById = Object.fromEntries(orphanLines.map((l) => [l.id, l]))

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
      // Ambiguïté : on tente un match plus strict (même sort_order) puis abandon
      const strict = candidates.find((c) => c.sort_order === oldLine.sort_order)
      if (strict) {
        updates.push({ id: m.id, devis_line_id: strict.id })
      } else {
        unmatched.push({
          membre: m,
          reason: `${candidates.length} candidats ambigus pour "${oldLine.produit}"`,
        })
      }
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
