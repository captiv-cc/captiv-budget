/**
 * Moteur de calcul cotisations & devis — CAPTIV SARL / OMNI FILMS
 * Source: CC Audiovisuelle, avenant n°20, SMIC 01/01/2026
 */

// ─── Taux charges patronales par catégorie ───────────────────────────────────
export const TAUX_DEFAUT = {
  'Intermittent Technicien': 0.67,
  'Intermittent Artiste': 0.67,
  'Ext. Intermittent': 0.67, // Vendu en Externe, recruté en intermittent
  Interne: 0,
  Externe: 0,
  Technique: 0,
  Frais: 0,
}

export const CATS = Object.keys(TAUX_DEFAUT)

// Rétrocompatibilité (anciens régimes présents en DB)
/** @deprecated utiliser CATS */
export const REGIMES = CATS

export const CAT_COLORS = {
  'Intermittent Technicien': 'bg-purple-100 text-purple-800',
  'Intermittent Artiste': 'bg-pink-100 text-pink-800',
  'Ext. Intermittent': 'bg-violet-100 text-violet-700',
  Interne: 'bg-slate-100 text-slate-700',
  Externe: 'bg-amber-100 text-amber-800',
  Technique: 'bg-blue-100 text-blue-800',
  Frais: 'bg-gray-100 text-gray-600',
}

// Rétrocompatibilité
/** @deprecated utiliser CAT_COLORS */
export const REGIME_COLORS = CAT_COLORS

export const UNITES = ['J', 'H', 'F', 'S', 'M', 'K', '%', 'lot']

export const TYPES_PROJET = [
  'Film institutionnel',
  'Publicité',
  'Clip musical',
  'Documentaire',
  'Court-métrage',
  'Long-métrage',
  'Reportage',
  'Émission TV',
  'Captation événement',
  'Formation',
  'Autre',
]

// Cats avec charges patronales (salaire brut = coût, pas de coût d'achat séparé)
export const REGIMES_SALARIES = ['Intermittent Technicien', 'Intermittent Artiste']

// Cats "humains" → apparaissent dans l'onglet ÉQUIPE
export const CATS_HUMAINS = [
  'Intermittent Technicien',
  'Intermittent Artiste',
  'Ext. Intermittent',
  'Interne',
  'Externe',
]

// ─── Calcul d'une ligne ───────────────────────────────────────────────────────
export function calcLine(line, taux = TAUX_DEFAUT) {
  // qt = nb (unités physiques) × quantite (jours/périodes) — rétrocompat : nb absent = 1
  const qt = (Number(line.nb) || 1) * (Number(line.quantite) || 0)
  const tarif = Number(line.tarif_ht) || 0
  const remise = Number(line.remise_pct) || 0
  const regime = line.regime || 'Frais'

  // Prix de vente : tarif × qté, avec remise en RÉDUCTION (-)
  const prixVenteHT = line.use_line ? qt * tarif * (1 - remise / 100) : 0

  // Coût réel HT :
  // - Régimes salariés : coût = tarif brut (salaire brut)
  // - cout_ht === null/undefined : non renseigné → coût = prix de vente (marge nulle)
  // - cout_ht === 0 : produit ne coûte rien (marge = 100%)
  // - cout_ht > 0 : coût saisi manuellement
  const isSalarie = REGIMES_SALARIES.includes(regime)

  let coutReelHT
  if (isSalarie) {
    // Intermittents : coût = salaire brut (charges calculées séparément)
    coutReelHT = qt * tarif
  } else if (line.cout_ht !== null && line.cout_ht !== undefined && line.cout_ht !== '') {
    // Coût explicitement renseigné (0 inclus = produit gratuit)
    coutReelHT = qt * Number(line.cout_ht)
  } else {
    // Défaut : coût = prix de vente → marge nulle sauf remise
    coutReelHT = prixVenteHT
  }

  // Charges calculées avant la marge pour Ext. Intermittent
  const tauxCharges = line.use_line ? (taux[regime] ?? 0) : 0
  const chargesPat = coutReelHT * tauxCharges
  const coutCharge = coutReelHT + chargesPat

  // Marge : pour Ext. Intermittent, calculée sur le coût chargé (brut + cotisations)
  // → la marge reflète le vrai résultat net, charges patronales comprises
  const coutPourMarge = regime === 'Ext. Intermittent' ? coutCharge : coutReelHT
  const margeHT = line.use_line ? prixVenteHT - coutPourMarge : 0
  const pctMarge = prixVenteHT !== 0 ? margeHT / prixVenteHT : 0

  // chargesFacturees = charges ajoutées au total client du devis
  // Pour les intermittents purs : le client paie brut + charges (elles s'ajoutent au total)
  // Pour Ext. Intermittent : les charges sont un coût INTERNE — le client paie uniquement tarif_ht
  const chargesFacturees = REGIMES_SALARIES.includes(regime) ? chargesPat : 0

  return { prixVenteHT, coutReelHT, margeHT, pctMarge, chargesPat, chargesFacturees, coutCharge }
}

// ─── Calcul synthèse complète ─────────────────────────────────────────────────
/**
 * @param {Array}  lines        - toutes les lignes du devis
 * @param {number} tvaTaux      - taux TVA (ex: 20)
 * @param {number} acomptePct   - acompte en %
 * @param {object} taux         - taux charges patronales
 * @param {object} global       - ajustements globaux:
 *   { marge_globale_pct, assurance_pct, remise_globale_pct, remise_globale_montant }
 */
export function calcSynthese(
  lines,
  tvaTaux = 20,
  acomptePct = 30,
  taux = TAUX_DEFAUT,
  global = {},
) {
  let sousTotal = 0 // CA total toutes lignes actives (base assurance, TTC…)
  let sousTotalMarge = 0 // CA blocs "dans_marge" uniquement (base Mg+Fg)
  let totalCoutReel = 0
  let totalMarge = 0 // marge nette des blocs "dans_marge"
  let totalCharges = 0 // charges ajoutées au total client (intermittents purs)
  let totalChargesInternes = 0 // toutes les charges réelles (y compris Ext. Intermittent)
  let totalCoutCharge = 0
  let totalInterne = 0 // CA des lignes interne

  for (const line of lines) {
    if (!line.use_line) continue
    const c = calcLine(line, taux)
    sousTotal += c.prixVenteHT
    // Ext. Intermittent : coût réel affiché = coût chargé (brut + cotisations)
    totalCoutReel += line.regime === 'Ext. Intermittent' ? c.coutCharge : c.coutReelHT
    totalCharges += c.chargesFacturees // uniquement les charges facturées au client
    totalChargesInternes += c.chargesPat // toutes les charges (analyse interne)
    totalCoutCharge += c.coutCharge
    if (line.dans_marge) {
      sousTotalMarge += c.prixVenteHT
      if (line.regime !== 'Interne') totalMarge += c.margeHT
    }
    if (line.regime === 'Interne') totalInterne += c.prixVenteHT
  }

  // ── Ajustements globaux ────────────────────────────────────────────────────
  const margeGlobalePct = Number(global.marge_globale_pct) || 0
  const assurancePct = Number(global.assurance_pct) || 0
  const remiseGlobalePct = Number(global.remise_globale_pct) || 0
  const remiseGlobaleMontant = Number(global.remise_globale_montant) || 0

  // Mg+Fg → sur le CA "dans_marge" uniquement
  // Assurance → sur le CA total (tous blocs, y compris "Hors Marge")
  const montantMargeGlobale = (sousTotalMarge * margeGlobalePct) / 100
  const montantAssurance = (sousTotal * assurancePct) / 100

  // Sous-total 2 = lignes + Mg/Fg + Assurance + Cotisations patronales
  const sousTotalAvecCharges = sousTotal + montantMargeGlobale + montantAssurance + totalCharges

  // Remise globale appliquée sur le sous-total 2 (montant fixe prioritaire sur %)
  const montantRemiseGlobale =
    remiseGlobaleMontant > 0
      ? remiseGlobaleMontant
      : (sousTotalAvecCharges * remiseGlobalePct) / 100

  const totalHTFinal = sousTotalAvecCharges - montantRemiseGlobale

  // ── Marge finale (après ajustements) ──────────────────────────────────────
  const margeFinale = totalHTFinal - totalCoutCharge
  const pctMargeFinale = totalHTFinal > 0 ? margeFinale / totalHTFinal : 0

  // Marge sur lignes — exprimée en % du CA "dans_marge" uniquement
  const pctMargeLignes = sousTotalMarge > 0 ? totalMarge / sousTotalMarge : 0

  // Part interne
  const pctInterne = totalHTFinal > 0 ? totalInterne / totalHTFinal : 0

  // ── Totaux finaux ──────────────────────────────────────────────────────────
  const tva = totalHTFinal * (tvaTaux / 100)
  const totalTTC = totalHTFinal + tva
  const acompte = totalTTC * (acomptePct / 100)
  const solde = totalTTC - acompte

  return {
    // Sous-totaux lignes
    sousTotal,
    sousTotalAvecCharges,
    totalCoutReel,
    totalCoutCharge,
    totalCharges, // charges facturées au client (intermittents purs)
    totalChargesInternes, // toutes les charges réelles (incl. Ext. Intermittent)
    // Marge lignes (dans_marge)
    totalMarge,
    pctMargeLignes,
    // Ajustements globaux
    montantMargeGlobale,
    montantAssurance,
    montantRemiseGlobale,
    // Totaux finaux
    totalHTFinal,
    margeFinale,
    pctMargeFinale,
    // Part interne
    totalInterne,
    pctInterne,
    // TTC
    tva,
    totalTTC,
    acompte,
    solde,
  }
}

// ─── Helpers formatage ────────────────────────────────────────────────────────
export const fmtEur = (v) =>
  Number(v || 0).toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  })

export const fmtPct = (v) => `${(Number(v || 0) * 100).toFixed(1)} %`

export const fmtNum = (v, d = 2) =>
  Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })

export const DETAIL_TAUX = {
  'Maladie / AT (pat.)': '7.00 %',
  'Retraite base': '8.55 %',
  'Retraite compl. AGIRC-ARRCO T1': '6.40 %',
  'Chômage spécifique intermittent': '6.40 %',
  'Congés spectacles (CACF)': '15.50 %',
  'AFDAS (formation)': '2.10 %',
  'Fnal / CSA': '0.50 %',
  'Divers (CMB, etc.)': '20.55 %',
  'TOTAL utilisé par CAPTIV': '67.00 %',
}
