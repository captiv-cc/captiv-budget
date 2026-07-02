// ════════════════════════════════════════════════════════════════════════════
// devisDuplicate — duplication d'un devis en nouvelle version (par lot)
// ════════════════════════════════════════════════════════════════════════════
//
// Logique portée de DevisTab.duplicateDevis pour être partagée avec
// DevisEditor (bouton topbar, bandeau verrou, modale). Points clés :
//   - la nouvelle version = MAX(version_number) du LOT + 1 (pas du projet) ;
//   - lot_id doit être recopié (NOT NULL depuis le passage aux lots) ;
//   - recopie catégories + lignes, puis les liens devis_ligne_membres, puis
//     rebind projet_membres.devis_line_id vers les nouvelles lignes (sinon
//     l'attribution équipe disparaît quand la nouvelle version devient la
//     référence).
//
// Lit tout depuis la DB (pas depuis l'état local) : duplique donc la dernière
// version PERSISTÉE. Les appelants doivent sauvegarder avant si besoin.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

export async function duplicateDevisVersion(devisId, { createdBy = null } = {}) {
  const { data: src, error: srcErr } = await supabase
    .from('devis')
    .select('*')
    .eq('id', devisId)
    .single()
  if (srcErr || !src) throw new Error('Devis source introuvable')

  // Version suivante dans le lot (fallback projet pour les données legacy sans lot)
  let versQuery = supabase.from('devis').select('version_number')
  versQuery = src.lot_id
    ? versQuery.eq('lot_id', src.lot_id)
    : versQuery.eq('project_id', src.project_id)
  const { data: versions } = await versQuery
  const nextVer = (versions || []).reduce((m, d) => Math.max(m, d.version_number || 0), 0) + 1

  const { data: newDevis, error: devisErr } = await supabase
    .from('devis')
    .insert({
      project_id: src.project_id,
      lot_id: src.lot_id,
      version_number: nextVer,
      title: src.title,
      status: 'brouillon',
      created_by: createdBy,
      tva_rate: src.tva_rate,
      acompte_pct: src.acompte_pct,
      notes: src.notes,
      marge_globale_pct: src.marge_globale_pct,
      assurance_pct: src.assurance_pct,
      remise_globale_pct: src.remise_globale_pct,
      remise_globale_montant: src.remise_globale_montant,
    })
    .select()
    .single()
  if (devisErr || !newDevis) throw new Error(devisErr?.message || 'Insertion du devis échouée')

  const { data: srcCats } = await supabase
    .from('devis_categories')
    .select('*')
    .eq('devis_id', devisId)
    .order('sort_order')

  const lineIdMap = new Map()

  for (const srcCat of srcCats || []) {
    const { data: newCat } = await supabase
      .from('devis_categories')
      .insert({
        devis_id: newDevis.id,
        name: srcCat.name,
        sort_order: srcCat.sort_order,
        dans_marge: srcCat.dans_marge,
        notes: srcCat.notes,
      })
      .select()
      .single()
    if (!newCat) continue

    const { data: srcLines } = await supabase
      .from('devis_lines')
      .select('*')
      .eq('category_id', srcCat.id)
      .order('sort_order')

    for (const l of srcLines || []) {
      const { data: newLine } = await supabase
        .from('devis_lines')
        .insert({
          devis_id: newDevis.id,
          category_id: newCat.id,
          ref: l.ref,
          produit: l.produit,
          description: l.description,
          regime: l.regime,
          use_line: l.use_line,
          interne: l.interne,
          cout_egal_vente: l.cout_egal_vente,
          dans_marge: l.dans_marge,
          nb: l.nb,
          quantite: l.quantite,
          unite: l.unite,
          tarif_ht: l.tarif_ht,
          cout_ht: l.cout_ht,
          remise_pct: l.remise_pct,
          sort_order: l.sort_order,
          is_crew: l.is_crew,
        })
        .select()
        .single()
      if (newLine) lineIdMap.set(l.id, newLine.id)
    }
  }

  if (lineIdMap.size > 0) {
    // 1. Duplique les liens devis_ligne_membres (table de jointure)
    const { data: srcMembres } = await supabase
      .from('devis_ligne_membres')
      .select('devis_line_id, projet_membre_id, notes')
      .in('devis_line_id', Array.from(lineIdMap.keys()))
    if (srcMembres?.length) {
      await supabase.from('devis_ligne_membres').insert(
        srcMembres
          .map((m) => ({
            devis_line_id: lineIdMap.get(m.devis_line_id),
            projet_membre_id: m.projet_membre_id,
            notes: m.notes,
          }))
          .filter((m) => m.devis_line_id),
      )
    }

    // 2. Rebind projet_membres.devis_line_id vers les nouvelles lignes
    const { data: orphanCandidates } = await supabase
      .from('projet_membres')
      .select('id, devis_line_id')
      .in('devis_line_id', Array.from(lineIdMap.keys()))
    if (orphanCandidates?.length) {
      await Promise.all(
        orphanCandidates.map((m) =>
          supabase
            .from('projet_membres')
            .update({ devis_line_id: lineIdMap.get(m.devis_line_id) })
            .eq('id', m.id),
        ),
      )
    }
  }

  return newDevis
}
