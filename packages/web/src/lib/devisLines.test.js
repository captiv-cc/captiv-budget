/**
 * Tests unitaires de applyCategoryDansMarge.
 *
 * Ce helper existe pour empêcher un bug bien identifié : si une catégorie est
 * marquée "Hors marge" (cat.dans_marge=false) APRÈS que ses lignes aient été
 * créées avec dans_marge=true, alors le DevisEditor (qui transformait les
 * lignes localement) et le ProjetLayout (qui passait les lignes brutes en DB)
 * divergeaient. Symptôme observé en prod : footer = 3 581,41 € HT,
 * header = 3 640,21 € HT — un écart de exactement marge_globale_pct ×
 * (CA des lignes incohérentes).
 *
 * Les tests ci-dessous verrouillent ce comportement.
 */
import { describe, it, expect } from 'vitest'
import { applyCategoryDansMarge } from './devisLines.js'
import { calcSynthese, TAUX_DEFAUT } from './cotisations.js'

describe('applyCategoryDansMarge', () => {
  it('retourne [] si aucune ligne', () => {
    expect(applyCategoryDansMarge([], [])).toEqual([])
    expect(applyCategoryDansMarge(null, [])).toEqual([])
    expect(applyCategoryDansMarge(undefined, undefined)).toEqual([])
  })

  it('garde dans_marge=true quand la catégorie est dans la marge', () => {
    const cats = [{ id: 'cat1', dans_marge: true }]
    const lines = [{ id: 'l1', category_id: 'cat1', dans_marge: true }]
    const out = applyCategoryDansMarge(lines, cats)
    expect(out[0].dans_marge).toBe(true)
  })

  it('force dans_marge=false quand la catégorie est hors marge', () => {
    const cats = [{ id: 'cat1', dans_marge: false }]
    const lines = [{ id: 'l1', category_id: 'cat1', dans_marge: true }]
    const out = applyCategoryDansMarge(lines, cats)
    expect(out[0].dans_marge).toBe(false)
  })

  it('garde dans_marge=false quand la ligne est explicitement hors marge', () => {
    const cats = [{ id: 'cat1', dans_marge: true }]
    const lines = [{ id: 'l1', category_id: 'cat1', dans_marge: false }]
    const out = applyCategoryDansMarge(lines, cats)
    expect(out[0].dans_marge).toBe(false)
  })

  it('gère plusieurs catégories et lignes', () => {
    const cats = [
      { id: 'cat-prod', dans_marge: true },
      { id: 'cat-hm', dans_marge: false },
    ]
    const lines = [
      { id: 'l1', category_id: 'cat-prod', dans_marge: true },
      { id: 'l2', category_id: 'cat-hm', dans_marge: true },
      { id: 'l3', category_id: 'cat-hm', dans_marge: false },
    ]
    const out = applyCategoryDansMarge(lines, cats)
    expect(out.map((l) => l.dans_marge)).toEqual([true, false, false])
  })

  it('considère dans_marge=true par défaut si la catégorie est introuvable', () => {
    // Cas pathologique : ligne orpheline (category_id pointe nulle part).
    // On préfère la traiter comme "dans la marge" pour ne pas perdre de CA.
    const lines = [{ id: 'l1', category_id: 'unknown', dans_marge: true }]
    const out = applyCategoryDansMarge(lines, [])
    expect(out[0].dans_marge).toBe(true)
  })

  it("ne mute pas les lignes d'origine", () => {
    const cats = [{ id: 'cat1', dans_marge: false }]
    const lines = [{ id: 'l1', category_id: 'cat1', dans_marge: true }]
    applyCategoryDansMarge(lines, cats)
    expect(lines[0].dans_marge).toBe(true) // intacte
  })
})

describe('applyCategoryDansMarge — régression DevisEditor vs ProjetLayout', () => {
  // Ce test reproduit exactement le bug observé en prod.
  // Sans le helper, le calcul du header (lignes brutes) et celui de l'éditeur
  // (lignes transformées) divergent du montant marge_globale × CA hors marge.
  //
  // Setup minimal :
  // - une catégorie "Pré-prod" hors marge contenant 1 ligne à 600 €
  //   dont dans_marge est resté à true (la cat a été flippée après création)
  // - une catégorie "Prod" dans la marge contenant 1 ligne à 1500 €
  // - marge_globale_pct = 9.8 %
  //
  // Attendu (correct) :
  //   sousTotalMarge = 1500 (la pré-prod doit être exclue)
  //   montantMargeGlobale = 1500 × 9.8% = 147 €
  //   totalHTFinal = 600 + 1500 + 147 = 2247 €
  //
  // Sans helper (bug) côté ProjetLayout :
  //   sousTotalMarge = 1500 + 600 = 2100 (la pré-prod est inclus à tort)
  //   montantMargeGlobale = 2100 × 9.8% = 205.80 €
  //   totalHTFinal = 600 + 1500 + 205.80 = 2305.80 €
  //   → écart = 58.80 € (= 600 × 9.8%) ← exactement le bug observé
  it('produit le même totalHTFinal que le calcul brut + transformation', () => {
    const cats = [
      { id: 'cat-preprod', dans_marge: false },
      { id: 'cat-prod', dans_marge: true },
    ]
    const rawLines = [
      {
        id: 'dirprod',
        category_id: 'cat-preprod',
        use_line: true,
        nb: 1,
        quantite: 1,
        tarif_ht: 600,
        regime: 'Frais',
        dans_marge: true, // ← incohérent avec sa cat
      },
      {
        id: 'cadreur',
        category_id: 'cat-prod',
        use_line: true,
        nb: 1,
        quantite: 1,
        tarif_ht: 1500,
        regime: 'Frais',
        dans_marge: true,
      },
    ]

    const global = { marge_globale_pct: 9.8 }
    const opts = [TAUX_DEFAUT, global]

    // Calcul "buggé" : on passe les lignes brutes
    const buggy = calcSynthese(rawLines, 20, 30, ...opts)
    // Calcul corrigé : on passe par le helper
    const correct = calcSynthese(applyCategoryDansMarge(rawLines, cats), 20, 30, ...opts)

    // Le helper doit faire converger les deux vers la valeur "correcte"
    expect(correct.totalHTFinal).toBeCloseTo(2247, 2)
    expect(buggy.totalHTFinal).toBeCloseTo(2305.8, 2)
    expect(buggy.totalHTFinal - correct.totalHTFinal).toBeCloseTo(58.8, 2)
  })
})
