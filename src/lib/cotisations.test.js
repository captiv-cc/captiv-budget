/**
 * Tests unitaires du moteur de calcul CAPTIV
 * -----------------------------------------------------------------------------
 * Ce fichier vérouille le comportement de src/lib/cotisations.js : calcul d'une
 * ligne (calcLine) et synthèse complète d'un devis (calcSynthese).
 *
 * Ces tests sont le filet de sécurité de la logique métier la plus sensible :
 * si un jour on touche aux cotisations, à la TVA, à la marge ou aux ajustements
 * globaux, la CI doit nous rattraper avant que ça n'atteigne un devis client.
 *
 * Lancer :
 *   npm run test           → une exécution
 *   npm run test -- --watch → mode watch pendant le dev
 *
 * Convention de ce fichier :
 *   - une describe par fonction
 *   - chaque it() vérifie UN comportement précis
 *   - les valeurs attendues sont calculées à la main dans le commentaire quand
 *     ce n'est pas trivial, pour faciliter la relecture humaine
 */
import { describe, it, expect } from 'vitest'
import {
  calcLine,
  calcSynthese,
  TAUX_DEFAUT,
  CATS,
  CATS_HUMAINS,
  REGIMES_SALARIES,
  fmtEur,
  fmtPct,
  fmtNum,
} from './cotisations.js'

// ── Helpers de construction de lignes pour les tests ─────────────────────────
/** Fabrique une ligne active avec des valeurs par défaut raisonnables. */
function line(overrides = {}) {
  return {
    use_line: true,
    nb: 1,
    quantite: 1,
    tarif_ht: 0,
    remise_pct: 0,
    regime: 'Frais',
    dans_marge: true,
    cout_ht: null,
    ...overrides,
  }
}

// Tolérance pour les comparaisons flottantes (arrondis de cotisations, TVA…)
const EPS = 1e-9

// =============================================================================
// constantes exportées
// =============================================================================
describe('Constantes et configuration', () => {
  it('TAUX_DEFAUT — intermittents à 67 %', () => {
    expect(TAUX_DEFAUT['Intermittent Technicien']).toBe(0.67)
    expect(TAUX_DEFAUT['Intermittent Artiste']).toBe(0.67)
    expect(TAUX_DEFAUT['Ext. Intermittent']).toBe(0.67)
  })

  it('TAUX_DEFAUT — régimes non cotisants à 0 %', () => {
    expect(TAUX_DEFAUT['Interne']).toBe(0)
    expect(TAUX_DEFAUT['Externe']).toBe(0)
    expect(TAUX_DEFAUT['Technique']).toBe(0)
    expect(TAUX_DEFAUT['Frais']).toBe(0)
  })

  it('CATS expose toutes les catégories de TAUX_DEFAUT', () => {
    expect(CATS).toEqual(Object.keys(TAUX_DEFAUT))
    expect(CATS).toHaveLength(7)
  })

  it('REGIMES_SALARIES ne contient QUE les intermittents purs', () => {
    expect(REGIMES_SALARIES).toEqual([
      'Intermittent Technicien',
      'Intermittent Artiste',
    ])
    // Ext. Intermittent est facturé en externe → PAS dans les salariés
    expect(REGIMES_SALARIES).not.toContain('Ext. Intermittent')
  })

  it('CATS_HUMAINS — 5 régimes affectables à une personne', () => {
    expect(CATS_HUMAINS).toEqual([
      'Intermittent Technicien',
      'Intermittent Artiste',
      'Ext. Intermittent',
      'Interne',
      'Externe',
    ])
    expect(CATS_HUMAINS).not.toContain('Technique')
    expect(CATS_HUMAINS).not.toContain('Frais')
  })
})

// =============================================================================
// calcLine — désactivation
// =============================================================================
describe('calcLine — ligne inactive (use_line=false)', () => {
  it('retourne tous les montants à zéro, quel que soit le régime', () => {
    const r = calcLine(line({
      use_line: false,
      regime: 'Intermittent Technicien',
      quantite: 5,
      tarif_ht: 500,
    }))
    expect(r.prixVenteHT).toBe(0)
    expect(r.margeHT).toBe(0)
    expect(r.pctMarge).toBe(0)
    expect(r.chargesPat).toBe(0)
    expect(r.chargesFacturees).toBe(0)
  })
})

// =============================================================================
// calcLine — régime Frais (cas le plus simple)
// =============================================================================
describe('calcLine — régime Frais (0 % charges, cout par défaut = prix)', () => {
  it('prix de vente = quantité × tarif', () => {
    const r = calcLine(line({ regime: 'Frais', quantite: 3, tarif_ht: 100 }))
    expect(r.prixVenteHT).toBe(300)
    expect(r.chargesPat).toBe(0)
  })

  it('sans cout_ht explicite → coût = prix de vente → marge nulle', () => {
    const r = calcLine(line({ regime: 'Frais', quantite: 3, tarif_ht: 100 }))
    expect(r.coutReelHT).toBe(300)
    expect(r.margeHT).toBe(0)
    expect(r.pctMarge).toBe(0)
  })

  it('remise en % réduit UNIQUEMENT le prix de vente', () => {
    // 10 × 200 = 2000 avec 10 % → prix 1800, coût défaut 1800
    const r = calcLine(line({ quantite: 10, tarif_ht: 200, remise_pct: 10 }))
    expect(r.prixVenteHT).toBe(1800)
    expect(r.coutReelHT).toBe(1800)
  })

  it('nb × quantite : multiplicateur double', () => {
    // 2 × 3 × 150 = 900
    const r = calcLine(line({ nb: 2, quantite: 3, tarif_ht: 150 }))
    expect(r.prixVenteHT).toBe(900)
  })

  it('nb absent → vaut 1 (rétrocompatibilité)', () => {
    const r = calcLine({
      use_line: true, quantite: 4, tarif_ht: 50, regime: 'Frais', remise_pct: 0,
    })
    expect(r.prixVenteHT).toBe(200)
  })
})

// =============================================================================
// calcLine — régime Technique (marge via cout_ht)
// =============================================================================
describe('calcLine — régime Technique (coût explicite)', () => {
  it('cout_ht > 0 → marge classique', () => {
    // 1 × 1000 de vente, coût 600 → marge 400 soit 40 %
    const r = calcLine(line({
      regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 600,
    }))
    expect(r.prixVenteHT).toBe(1000)
    expect(r.coutReelHT).toBe(600)
    expect(r.margeHT).toBe(400)
    expect(r.pctMarge).toBeCloseTo(0.4, 9)
  })

  it('cout_ht = 0 → marge 100 % (produit gratuit en coût)', () => {
    const r = calcLine(line({
      regime: 'Technique', quantite: 2, tarif_ht: 300, cout_ht: 0,
    }))
    expect(r.prixVenteHT).toBe(600)
    expect(r.coutReelHT).toBe(0)
    expect(r.margeHT).toBe(600)
    expect(r.pctMarge).toBe(1)
  })

  it('cout_ht null → coût = prix de vente → marge 0 %', () => {
    const r = calcLine(line({
      regime: 'Technique', quantite: 2, tarif_ht: 300, cout_ht: null,
    }))
    expect(r.coutReelHT).toBe(600)
    expect(r.margeHT).toBe(0)
  })

  it("cout_ht chaîne vide '' traitée comme non renseigné", () => {
    const r = calcLine(line({
      regime: 'Technique', quantite: 2, tarif_ht: 300, cout_ht: '',
    }))
    expect(r.coutReelHT).toBe(600)
    expect(r.margeHT).toBe(0)
  })

  it('cout_ht est multiplié par la quantité (coût unitaire)', () => {
    // 5 × 100 vente, cout_ht 40 unitaire → coût total 5 × 40 = 200
    const r = calcLine(line({
      regime: 'Technique', quantite: 5, tarif_ht: 100, cout_ht: 40,
    }))
    expect(r.prixVenteHT).toBe(500)
    expect(r.coutReelHT).toBe(200)
    expect(r.margeHT).toBe(300)
  })

  it('remise + cout_ht : seul le prix de vente baisse', () => {
    // 10 × 100 = 1000, remise 20 % → prix 800, cout 10 × 60 = 600, marge 200
    const r = calcLine(line({
      regime: 'Technique', quantite: 10, tarif_ht: 100, remise_pct: 20, cout_ht: 60,
    }))
    expect(r.prixVenteHT).toBe(800)
    expect(r.coutReelHT).toBe(600)
    expect(r.margeHT).toBe(200)
    expect(r.pctMarge).toBeCloseTo(0.25, 9)
  })
})

// =============================================================================
// calcLine — Intermittents purs (salariés, charges facturées au client)
// =============================================================================
describe('calcLine — Intermittent Technicien / Artiste (salariés)', () => {
  it('coût réel = salaire brut (qt × tarif)', () => {
    // 5 jours × 400 € brut = 2000 coût
    const r = calcLine(line({
      regime: 'Intermittent Technicien', quantite: 5, tarif_ht: 400,
    }))
    expect(r.prixVenteHT).toBe(2000)
    expect(r.coutReelHT).toBe(2000)
  })

  it('charges patronales = 67 % du brut', () => {
    const r = calcLine(line({
      regime: 'Intermittent Technicien', quantite: 5, tarif_ht: 400,
    }))
    expect(r.chargesPat).toBeCloseTo(1340, 9) // 2000 × 0.67
    expect(r.coutCharge).toBeCloseTo(3340, 9) // 2000 + 1340
  })

  it('chargesFacturees = chargesPat → le client paie brut + charges', () => {
    const r = calcLine(line({
      regime: 'Intermittent Technicien', quantite: 5, tarif_ht: 400,
    }))
    expect(r.chargesFacturees).toBeCloseTo(1340, 9)
  })

  it('marge calculée sur coutReelHT (brut), PAS sur coût chargé', () => {
    // Prix 2000, coût brut 2000 → marge 0 (les charges partent en facturation)
    const r = calcLine(line({
      regime: 'Intermittent Technicien', quantite: 5, tarif_ht: 400,
    }))
    expect(r.margeHT).toBe(0)
  })

  it('ignore cout_ht — salarié = coût imposé = brut', () => {
    // On renseigne 999 mais il est IGNORÉ côté intermittent
    const r = calcLine(line({
      regime: 'Intermittent Technicien', quantite: 2, tarif_ht: 500, cout_ht: 999,
    }))
    expect(r.coutReelHT).toBe(1000) // 2 × 500, pas 999
  })

  it('Intermittent Artiste — même logique que technicien', () => {
    const r = calcLine(line({
      regime: 'Intermittent Artiste', quantite: 3, tarif_ht: 250,
    }))
    expect(r.prixVenteHT).toBe(750)
    expect(r.coutReelHT).toBe(750)
    expect(r.chargesPat).toBeCloseTo(502.5, 9)
    expect(r.chargesFacturees).toBeCloseTo(502.5, 9)
  })
})

// =============================================================================
// calcLine — Ext. Intermittent (cas le plus subtil)
// =============================================================================
describe('calcLine — Ext. Intermittent (charges = coût interne)', () => {
  it('charges calculées mais PAS facturées au client', () => {
    // Vente 3000, brut 2000, charges 1340 → client paie seulement 3000
    const r = calcLine(line({
      regime: 'Ext. Intermittent', quantite: 5, tarif_ht: 600, cout_ht: 400,
    }))
    expect(r.prixVenteHT).toBe(3000)
    expect(r.coutReelHT).toBe(2000) // 5 × 400
    expect(r.chargesPat).toBeCloseTo(1340, 9) // 2000 × 0.67
    expect(r.chargesFacturees).toBe(0) // ⚠ pas facturées
  })

  it('marge calculée sur le coût CHARGÉ (brut + cotisations)', () => {
    // Vente 3000, coût chargé 3340 → marge NÉGATIVE -340
    const r = calcLine(line({
      regime: 'Ext. Intermittent', quantite: 5, tarif_ht: 600, cout_ht: 400,
    }))
    expect(r.coutCharge).toBeCloseTo(3340, 9)
    expect(r.margeHT).toBeCloseTo(-340, 9)
    expect(r.pctMarge).toBeCloseTo(-340 / 3000, 9)
  })

  it('sans cout_ht → coût par défaut = prix de vente → marge négative garantie', () => {
    // Coût par défaut = prix vente 1000, charges 670 → coût chargé 1670
    const r = calcLine(line({
      regime: 'Ext. Intermittent', quantite: 2, tarif_ht: 500,
    }))
    expect(r.prixVenteHT).toBe(1000)
    expect(r.coutReelHT).toBe(1000)
    expect(r.coutCharge).toBeCloseTo(1670, 9)
    expect(r.margeHT).toBeCloseTo(-670, 9)
  })

  it('Ext. Intermittent bien facturé avec vraie marge positive', () => {
    // Vente 10000, brut 3000 → charges 2010 → coût chargé 5010 → marge 4990
    const r = calcLine(line({
      regime: 'Ext. Intermittent', quantite: 1, tarif_ht: 10000, cout_ht: 3000,
    }))
    expect(r.coutCharge).toBeCloseTo(5010, 9)
    expect(r.margeHT).toBeCloseTo(4990, 9)
    expect(r.pctMarge).toBeCloseTo(0.499, 9)
  })
})

// =============================================================================
// calcLine — régimes Interne / Externe (passifs)
// =============================================================================
describe('calcLine — Interne et Externe (0 % charges)', () => {
  it('Interne : pas de charges, marge possible via cout_ht', () => {
    // Facturé 1000 au client, coût interne 400 → marge 600
    const r = calcLine(line({
      regime: 'Interne', quantite: 1, tarif_ht: 1000, cout_ht: 400,
    }))
    expect(r.chargesPat).toBe(0)
    expect(r.chargesFacturees).toBe(0)
    expect(r.margeHT).toBe(600)
  })

  it('Externe : 0 % de charges, calcul identique à Technique', () => {
    const r = calcLine(line({
      regime: 'Externe', quantite: 2, tarif_ht: 500, cout_ht: 300,
    }))
    expect(r.chargesPat).toBe(0)
    expect(r.margeHT).toBe(400) // (2×500) - (2×300)
  })
})

// =============================================================================
// calcLine — taux custom (jamais utilisé en prod mais signature publique)
// =============================================================================
describe('calcLine — taux custom', () => {
  it('accepte un objet taux personnalisé', () => {
    const tauxCustom = { ...TAUX_DEFAUT, 'Intermittent Technicien': 0.5 }
    const r = calcLine(line({
      regime: 'Intermittent Technicien', quantite: 2, tarif_ht: 100,
    }), tauxCustom)
    expect(r.chargesPat).toBeCloseTo(100, 9) // 200 × 0.5
  })

  it('régime inconnu → 0 % charges, pas de crash', () => {
    const r = calcLine(line({
      regime: 'RegimeInconnu', quantite: 1, tarif_ht: 500,
    }))
    expect(r.chargesPat).toBe(0)
    expect(r.prixVenteHT).toBe(500)
  })
})

// =============================================================================
// calcSynthese — cas de base
// =============================================================================
describe('calcSynthese — cas vide / inactifs', () => {
  it('aucune ligne → tout à zéro', () => {
    const s = calcSynthese([])
    expect(s.sousTotal).toBe(0)
    expect(s.totalHTFinal).toBe(0)
    expect(s.tva).toBe(0)
    expect(s.totalTTC).toBe(0)
    expect(s.pctMargeFinale).toBe(0)
  })

  it('ligne inactive ignorée', () => {
    const s = calcSynthese([
      line({ use_line: false, quantite: 10, tarif_ht: 500 }),
    ])
    expect(s.sousTotal).toBe(0)
  })
})

// =============================================================================
// calcSynthese — somme simple
// =============================================================================
describe('calcSynthese — agrégation', () => {
  it('somme des prix de vente sur les lignes actives', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 600 }),
      line({ regime: 'Frais',     quantite: 2, tarif_ht: 100,  cout_ht: 80 }),
    ], 20, 30)
    // Vente : 1000 + 200 = 1200
    expect(s.sousTotal).toBe(1200)
  })

  it('TVA 20 % et TTC = HT × 1.2', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 500 }),
    ], 20, 30)
    expect(s.totalHTFinal).toBe(1000)
    expect(s.tva).toBeCloseTo(200, 9)
    expect(s.totalTTC).toBeCloseTo(1200, 9)
  })

  it('acompte 30 % du TTC et solde = reste', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 500 }),
    ], 20, 30)
    expect(s.acompte).toBeCloseTo(360, 9) // 1200 × 0.3
    expect(s.solde).toBeCloseTo(840, 9)   // 1200 - 360
    expect(s.acompte + s.solde).toBeCloseTo(s.totalTTC, 9)
  })

  it('TVA 0 % (ex: export hors UE)', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 500 }),
    ], 0, 30)
    expect(s.tva).toBe(0)
    expect(s.totalTTC).toBe(1000)
  })

  it('TVA 10 % (activités culturelles)', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 500 }),
    ], 10, 30)
    expect(s.tva).toBeCloseTo(100, 9)
  })
})

// =============================================================================
// calcSynthese — charges intermittents facturées au client
// =============================================================================
describe('calcSynthese — charges intermittents ajoutées au total client', () => {
  it('Intermittent Tech : charges facturées sont ajoutées au sousTotalAvecCharges', () => {
    // 5 j × 400 = 2000 brut, 1340 charges → sousTotalAvecCharges = 3340
    const s = calcSynthese([
      line({ regime: 'Intermittent Technicien', quantite: 5, tarif_ht: 400 }),
    ])
    expect(s.sousTotal).toBe(2000)
    expect(s.totalCharges).toBeCloseTo(1340, 9)
    expect(s.sousTotalAvecCharges).toBeCloseTo(3340, 9)
    expect(s.totalHTFinal).toBeCloseTo(3340, 9)
  })

  it('Ext. Intermittent : charges NON ajoutées au total client', () => {
    // Vente 3000, brut 2000, charges 1340 → client voit 3000 seulement
    const s = calcSynthese([
      line({ regime: 'Ext. Intermittent', quantite: 5, tarif_ht: 600, cout_ht: 400 }),
    ])
    expect(s.sousTotal).toBe(3000)
    expect(s.totalCharges).toBe(0)                   // 0 facturé
    expect(s.totalChargesInternes).toBeCloseTo(1340, 9) // mais tracé en interne
    expect(s.totalHTFinal).toBe(3000)
  })
})

// =============================================================================
// calcSynthese — dans_marge vs hors_marge
// =============================================================================
describe('calcSynthese — blocs dans_marge vs hors marge', () => {
  it('seuls les blocs dans_marge nourrissent la marge agrégée', () => {
    const s = calcSynthese([
      // Dans marge : vente 1000, coût 600 → marge 400
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 600, dans_marge: true }),
      // Hors marge : vente 500, coût 500 → marge ignorée
      line({ regime: 'Technique', quantite: 1, tarif_ht: 500, cout_ht: 500, dans_marge: false }),
    ])
    expect(s.sousTotal).toBe(1500)     // tout compte
    expect(s.totalMarge).toBe(400)     // seulement la ligne dans_marge
    expect(s.pctMargeLignes).toBeCloseTo(400 / 1000, 9) // sur 1000, pas 1500
  })

  it('régime Interne exclu de totalMarge même dans_marge=true', () => {
    const s = calcSynthese([
      line({ regime: 'Interne', quantite: 1, tarif_ht: 2000, cout_ht: 500, dans_marge: true }),
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 400, dans_marge: true }),
    ])
    // Seule la ligne Technique compte dans totalMarge
    expect(s.totalMarge).toBe(600) // 1000 - 400
    expect(s.totalInterne).toBe(2000)
  })
})

// =============================================================================
// calcSynthese — ajustements globaux
// =============================================================================
describe('calcSynthese — marge globale (Mg+Fg)', () => {
  it('appliquée SEULEMENT sur le CA dans_marge', () => {
    // dans_marge 1000, hors marge 500, Mg 10 % → 100 € (pas 150)
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 600, dans_marge: true }),
      line({ regime: 'Technique', quantite: 1, tarif_ht: 500, cout_ht: 400, dans_marge: false }),
    ], 20, 30, TAUX_DEFAUT, { marge_globale_pct: 10 })
    expect(s.montantMargeGlobale).toBeCloseTo(100, 9)
    expect(s.sousTotalAvecCharges).toBeCloseTo(1600, 9) // 1500 + 100
  })
})

describe('calcSynthese — assurance', () => {
  it('appliquée sur TOUT le CA (dans_marge + hors marge)', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 600, dans_marge: true }),
      line({ regime: 'Technique', quantite: 1, tarif_ht: 500, cout_ht: 400, dans_marge: false }),
    ], 20, 30, TAUX_DEFAUT, { assurance_pct: 5 })
    expect(s.montantAssurance).toBeCloseTo(75, 9) // 1500 × 5 %
  })
})

describe('calcSynthese — remise globale', () => {
  it('remise en % appliquée sur le sous-total avec charges', () => {
    // Base 1000, remise 10 % → 100 de remise
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 500 }),
    ], 20, 30, TAUX_DEFAUT, { remise_globale_pct: 10 })
    expect(s.montantRemiseGlobale).toBeCloseTo(100, 9)
    expect(s.totalHTFinal).toBeCloseTo(900, 9)
  })

  it('remise en montant fixe prioritaire sur le %', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 500 }),
    ], 20, 30, TAUX_DEFAUT, { remise_globale_pct: 10, remise_globale_montant: 250 })
    // Montant prioritaire → 250, pas 100
    expect(s.montantRemiseGlobale).toBe(250)
    expect(s.totalHTFinal).toBeCloseTo(750, 9)
  })

  it('remise nulle si % = 0 et montant = 0', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 500 }),
    ])
    expect(s.montantRemiseGlobale).toBe(0)
  })
})

// =============================================================================
// calcSynthese — scénario combiné réaliste
// =============================================================================
describe('calcSynthese — scénario projet réaliste', () => {
  it('Captation Live : techniciens intermittents + technique + Mg + remise', () => {
    // - 3 intermittents × 2 jours × 500 € brut = 3000, charges 2010
    // - matériel technique : 1 lot × 2000 €, coût 1200 → marge 800
    // - Mg 8 % sur dans_marge (3000 + 2000 = 5000) → 400
    // - Remise 300 € finale
    //
    // sousTotal            = 5000
    // totalCharges         = 2010
    // montantMargeGlobale  = 400
    // sousTotalAvecCharges = 5000 + 400 + 0 + 2010 = 7410
    // montantRemiseGlobale = 300
    // totalHTFinal         = 7110
    // tva 20 %             = 1422
    // totalTTC             = 8532
    const lignes = [
      line({
        regime: 'Intermittent Technicien',
        nb: 3, quantite: 2, tarif_ht: 500,
        dans_marge: true,
      }),
      line({
        regime: 'Technique',
        quantite: 1, tarif_ht: 2000, cout_ht: 1200,
        dans_marge: true,
      }),
    ]
    const s = calcSynthese(lignes, 20, 30, TAUX_DEFAUT, {
      marge_globale_pct: 8,
      remise_globale_montant: 300,
    })

    expect(s.sousTotal).toBe(5000)
    expect(s.totalCharges).toBeCloseTo(2010, 9)
    expect(s.montantMargeGlobale).toBeCloseTo(400, 9)
    expect(s.sousTotalAvecCharges).toBeCloseTo(7410, 9)
    expect(s.montantRemiseGlobale).toBe(300)
    expect(s.totalHTFinal).toBeCloseTo(7110, 9)
    expect(s.tva).toBeCloseTo(1422, 9)
    expect(s.totalTTC).toBeCloseTo(8532, 9)
    expect(s.acompte).toBeCloseTo(8532 * 0.3, 9)
    expect(s.solde).toBeCloseTo(8532 * 0.7, 9)
  })

  it('Marge finale et totalCoutCharge cohérents', () => {
    // Vente 1000, coût 400, marge ligne 600
    // Pas d'ajustements → marge finale = 1000 - 400 = 600
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1000, cout_ht: 400 }),
    ])
    expect(s.totalCoutCharge).toBe(400)
    expect(s.margeFinale).toBe(600)
    expect(s.pctMargeFinale).toBeCloseTo(0.6, 9)
  })

  it('pctInterne = part des lignes Interne dans le total HT final', () => {
    const s = calcSynthese([
      line({ regime: 'Interne', quantite: 1, tarif_ht: 500, cout_ht: 0 }),
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1500, cout_ht: 500 }),
    ])
    expect(s.totalInterne).toBe(500)
    expect(s.totalHTFinal).toBe(2000)
    expect(s.pctInterne).toBeCloseTo(0.25, 9)
  })
})

// =============================================================================
// Formatteurs
// =============================================================================
describe('fmtEur / fmtPct / fmtNum', () => {
  it('fmtEur — espaces français + deux décimales', () => {
    const out = fmtEur(1234.5)
    // Le format exact dépend de l'ICU mais on vérifie la présence €, virgule et « 50 »
    expect(out).toMatch(/1[\s ]234/)
    expect(out).toMatch(/50/)
    expect(out).toContain('€')
  })

  it('fmtEur — tolère null / undefined / 0', () => {
    // Note: fmtEur utilise Number(v || 0) — donc null/undefined/0/'' sont
    // remplacés par 0, mais une chaîne non-numérique produit "NaN €" (cas
    // qui ne doit jamais se produire côté prod : les champs sont typés).
    expect(fmtEur(null)).toContain('0,00')
    expect(fmtEur(undefined)).toContain('0,00')
    expect(fmtEur(0)).toContain('0,00')
    expect(fmtEur('')).toContain('0,00')
  })

  it('fmtPct — ratio décimal vers pourcentage à 1 décimale', () => {
    expect(fmtPct(0.337)).toBe('33.7 %')
    expect(fmtPct(0)).toBe('0.0 %')
    expect(fmtPct(null)).toBe('0.0 %')
  })

  it('fmtNum — deux décimales par défaut', () => {
    expect(fmtNum(12.3456)).toMatch(/12,35/)
  })

  it('fmtNum — nombre de décimales paramétrable', () => {
    expect(fmtNum(12.3456, 0)).toBe('12')
    expect(fmtNum(12.3456, 4)).toMatch(/12,3456/)
  })
})

// =============================================================================
// Invariants / propriétés globales
// =============================================================================
describe('Invariants globaux', () => {
  it('TVA(HT) + HT = TTC toujours', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 3, tarif_ht: 777, cout_ht: 333 }),
    ], 20, 30)
    expect(s.totalHTFinal + s.tva).toBeCloseTo(s.totalTTC, 9)
  })

  it('Acompte + solde = TTC toujours', () => {
    const s = calcSynthese([
      line({ regime: 'Technique', quantite: 1, tarif_ht: 1234, cout_ht: 567 }),
    ], 20, 42)
    expect(s.acompte + s.solde).toBeCloseTo(s.totalTTC, 9)
  })

  it('Ext. Intermittent ne gonfle jamais le total client même avec charges', () => {
    const s = calcSynthese([
      line({ regime: 'Ext. Intermittent', quantite: 10, tarif_ht: 1000, cout_ht: 600 }),
    ])
    expect(s.sousTotalAvecCharges).toBe(10000) // pas 10000 + charges
    expect(s.totalCharges).toBe(0)
    expect(s.totalChargesInternes).toBeGreaterThan(0)
  })
})
