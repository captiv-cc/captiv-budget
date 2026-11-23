// ════════════════════════════════════════════════════════════════════════════
// embauches.js — moteur de calcul du module Embauches
// ════════════════════════════════════════════════════════════════════════════
//
// Module PUR : aucune dépendance React, aucun appel réseau. Tout est testé
// dans embauches.test.js. Cf. docs/CHANTIER_EMBAUCHES.md pour le cadrage.
//
// ── Le principe du calcul ───────────────────────────────────────────────────
//
// Movinmotion raisonne en TAUX × HEURES, et son bandeau prévient que « les
// heures supplémentaires sont incluses dans le total des heures indiquées ».
// On applique la même règle : le brut couvre TOUTES les heures, et une
// majoration n'ajoute que sa PART supplémentaire (125 % → +25 %). Additionner
// les heures majorées au brut les compterait deux fois.
//
// Vérifié sur les données réelles d'Hugo :
//   · Leroy Merlin, décorateur à 270 €/jour (8 h), 42 h travaillées
//     → 42 × 33,75 = 1 417,50 € = le brut affiché par Movinmotion ✓
//   · Check In, 4 jours à 270 € → 4 × 8 × 33,75 = 1 080 € ✓
//
// ── Les deux modes ──────────────────────────────────────────────────────────
//
//   portage     : facturé = assiette × (1 + coef) + frais + frais de dossier
//   frais_reels : facturé = coût réel (le coefficient est forcé à 0)
//
// Les défraiements ne portent AUCUNE marge (décision Hugo) : ils s'ajoutent
// après le coefficient, à l'identique des deux côtés du calcul.
//
// ── Confidentialité ─────────────────────────────────────────────────────────
//
// `computeEmbauche` ne renvoie un coût et une marge QUE si on lui passe un
// objet `cout`. Celui-ci vient de la table `embauche_couts`, dont la RLS
// refuse la lecture aux non-admins (hors mode frais_reels). Pas de ligne
// servie = pas de marge calculée. Le fail-safe est donc côté serveur, et la
// lib n'a rien à décider.
// ════════════════════════════════════════════════════════════════════════════

// ─── Constantes ─────────────────────────────────────────────────────────────

export const MODES = [
  { key: 'portage', label: 'Portage', aide: 'Coefficient de vente appliqué, marge calculée.' },
  { key: 'frais_reels', label: 'Frais réels', aide: 'Facturation au coût réel, sans marge.' },
]

/**
 * Conventions collectives utilisées par Captiv (retour Hugo 23/11).
 * Stockées par leur numéro d'IDCC : court, stable, et c'est ce que demande
 * Movinmotion. `grilleMinimas` dit si `minimas_convention` couvre la
 * convention — la grille en base est celle de la 2642 ; afficher ses planchers
 * sous un contrat 3252 donnerait un chiffre faux.
 */
export const CONVENTIONS = [
  {
    key: '2642',
    label: 'CCN de la production audiovisuelle (2642)',
    grilleMinimas: true,
  },
  {
    key: '3252',
    label: 'CCN des entreprises au service de la création et de l’événement (3252)',
    grilleMinimas: false,
  },
]

/** Clé normalisée : tolère les anciens libellés complets stockés en base. */
export function conventionKey(v) {
  if (!v) return null
  const s = String(v)
  const trouve = CONVENTIONS.find((c) => s.includes(c.key))
  return trouve ? trouve.key : s
}

export function conventionLabel(v) {
  const k = conventionKey(v)
  return CONVENTIONS.find((c) => c.key === k)?.label || (v ? String(v) : '')
}

/** Vrai si la grille des minima en base s'applique à cette convention. */
export function conventionAGrille(v) {
  const k = conventionKey(v)
  return CONVENTIONS.find((c) => c.key === k)?.grilleMinimas === true
}

/** Heures de référence par unité de taux (vocabulaire Movinmotion). */
export const UNITES_TAUX = [
  { key: 'jour_7h', label: 'Jour (7 h)', heures: 7 },
  { key: 'jour_8h', label: 'Jour (8 h)', heures: 8 },
  { key: 'semaine_35h', label: 'Semaine (35 h)', heures: 35 },
  { key: 'semaine_39h', label: 'Semaine (39 h)', heures: 39 },
  { key: 'heure', label: 'Heure', heures: 1 },
]

// `grille` = la valeur telle qu'elle est stockée dans minimas_convention,
// qui n'a pas la même casse que nos clés internes.
export const TYPES_OEUVRE = [
  { key: 'fiction', label: 'Fiction', grille: 'Fiction' },
  { key: 'flux', label: 'Flux', grille: 'Flux' },
  { key: 'hors_fiction_flux', label: 'Hors fiction & flux', grille: 'Hors_fiction_flux' },
]

export function typeOeuvreGrille(key) {
  return TYPES_OEUVRE.find((t) => t.key === key)?.grille || null
}

export const NATURES_JOUR = [
  { key: 'normal', label: 'Normal' },
  { key: 'dimanche', label: 'Dimanche' },
  { key: 'ferie', label: 'Férié' },
]

/** Paliers Movinmotion : heures sup ventilées par semaine, autres majorées à part. */
export const TAUX_HEURES_SUP = [125, 150, 175, 200]
export const TAUX_AUTRES_MAJOREES = [125, 130, 150, 200]

export const TYPES_FRAIS = [
  { key: 'repas', label: 'Frais de repas', soumis: false },
  { key: 'defraiement', label: 'Défraiement journalier', soumis: false },
  { key: 'ik', label: 'Indemnité kilométrique', soumis: false },
  { key: 'transport', label: 'Transport', soumis: false },
  { key: 'prime', label: 'Prime', soumis: true },
  { key: 'autre', label: 'Autre', soumis: false },
]

export const STATUTS_DOSSIER = [
  { key: 'brouillon', label: 'Brouillon' },
  { key: 'en_cours', label: 'En cours' },
  { key: 'termine', label: 'Terminé' },
  { key: 'archive', label: 'Archivé' },
]

/** Reflète les DEFAULT de la table embauche_params. */
export const DEFAULT_PARAMS = Object.freeze({
  seuil_hs_hebdo: 35,
  maj_hs: 0.25,
  maj_dimanche: 1,
  maj_ferie: 1,
  maj_nuit: 0.25,
  nuit_debut: '22:00',
  nuit_fin: '06:00',
  taux_charges_estime: 0.65,
  coef_vente_defaut: 0.8,
  frais_dossier_facture_defaut: 25,
  frais_dossier_cout_defaut: 20,
  feries_extra: [],
})

const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ─── Jours fériés ───────────────────────────────────────────────────────────

/**
 * Dimanche de Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien).
 * Vérifié : 2026 → 5 avril.
 * @returns {string} date ISO 'YYYY-MM-DD'
 */
export function paques(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mois = Math.floor((h + l - 7 * m + 114) / 31)
  const jour = ((h + l - 7 * m + 114) % 31) + 1
  return toISO(new Date(Date.UTC(year, mois - 1, jour)))
}

function toISO(d) {
  return d.toISOString().slice(0, 10)
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return toISO(d)
}

/**
 * Les 11 fériés nationaux français d'une année donnée.
 * Calculés plutôt que saisis : c'est public et une saisie manuelle se trompe.
 * Les cas particuliers (Alsace-Moselle, outre-mer) passent par
 * `params.feries_extra`.
 * @returns {string[]} dates ISO triées
 */
export function feriesFrance(year) {
  const p = paques(year)
  return [
    `${year}-01-01`, // Jour de l'an
    addDays(p, 1), // Lundi de Pâques
    `${year}-05-01`, // Fête du travail
    `${year}-05-08`, // Victoire 1945
    addDays(p, 39), // Ascension
    addDays(p, 50), // Lundi de Pentecôte
    `${year}-07-14`, // Fête nationale
    `${year}-08-15`, // Assomption
    `${year}-11-01`, // Toussaint
    `${year}-11-11`, // Armistice
    `${year}-12-25`, // Noël
  ].sort()
}

/**
 * Ensemble des fériés couvrant les années citées, extras de l'org compris.
 * @param {string[]} dates  - dates ISO quelconques (on en déduit les années)
 * @param {string[]} extras - fériés supplémentaires saisis par l'org
 */
export function feriesSet(dates = [], extras = []) {
  const annees = new Set()
  for (const d of dates) {
    const y = Number(String(d).slice(0, 4))
    if (Number.isFinite(y) && y > 1900) annees.add(y)
  }
  const out = new Set(extras.filter(Boolean))
  for (const y of annees) for (const f of feriesFrance(y)) out.add(f)
  return out
}

/**
 * Nature d'une journée. Un férié qui tombe un dimanche reste UN férié : sans
 * cette priorité, les deux majorations se cumuleraient sur la même journée.
 */
export function natureForDate(iso, feries = new Set()) {
  if (!iso) return 'normal'
  if (feries.has(iso)) return 'ferie'
  const d = new Date(`${iso}T00:00:00Z`)
  return d.getUTCDay() === 0 ? 'dimanche' : 'normal'
}

/** Lundi de la semaine contenant `iso` (ancrage des heures sup hebdomadaires). */
export function lundiDeLaSemaine(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  const jour = d.getUTCDay() // 0 = dimanche
  const recul = jour === 0 ? 6 : jour - 1
  return addDays(iso, -recul)
}

// ─── Horaires → heures ──────────────────────────────────────────────────────

function minutesFromTime(t) {
  if (!t) return null
  const [h, m] = String(t).split(':').map(Number)
  if (!Number.isFinite(h)) return null
  return h * 60 + (Number.isFinite(m) ? m : 0)
}

/**
 * Convertit une plage horaire en heures travaillées et part de nuit.
 * Gère le passage de minuit (19 h → 2 h = 7 h).
 *
 * @returns {{heures: number, heuresNuit: number}}
 */
export function heuresFromHoraires(debut, fin, params = DEFAULT_PARAMS) {
  const d = minutesFromTime(debut)
  let f = minutesFromTime(fin)
  if (d == null || f == null) return { heures: 0, heuresNuit: 0 }
  if (f <= d) f += 24 * 60 // franchit minuit

  const total = f - d
  const nd = minutesFromTime(params.nuit_debut ?? DEFAULT_PARAMS.nuit_debut)
  const nf = minutesFromTime(params.nuit_fin ?? DEFAULT_PARAMS.nuit_fin)

  // La plage de nuit enjambe minuit : on la teste sur deux jours glissants
  // pour couvrir un service qui déborde.
  let nuit = 0
  for (let offset = -24 * 60; offset <= 24 * 60; offset += 24 * 60) {
    const debutNuit = nd + offset
    const finNuit = (nd < nf ? nf : nf + 24 * 60) + offset
    nuit += Math.max(0, Math.min(f, finNuit) - Math.max(d, debutNuit))
  }

  return {
    heures: round2(total / 60),
    heuresNuit: round2(Math.min(total, nuit) / 60),
  }
}

export function round2(v) {
  return Math.round((num(v) + Number.EPSILON) * 100) / 100
}

// ─── Taux ───────────────────────────────────────────────────────────────────

export function heuresReference(unite) {
  return UNITES_TAUX.find((u) => u.key === unite)?.heures ?? 8
}

/** Taux horaire déduit du taux saisi et de son unité (270 € / 8 h → 33,75 €). */
export function tauxHoraire(embauche) {
  const h = heuresReference(embauche?.unite_taux)
  if (!h) return 0
  return num(embauche?.taux) / h
}

/** Coefficient effectif : la surcharge de la ligne prime sur celle du dossier. */
export function coefVente(embauche, dossier) {
  if (dossier?.mode === 'frais_reels') return 0
  if (embauche?.coef_vente !== null && embauche?.coef_vente !== undefined) {
    return num(embauche.coef_vente)
  }
  return num(dossier?.coef_vente, DEFAULT_PARAMS.coef_vente_defaut)
}

// ─── Calcul d'une embauche ──────────────────────────────────────────────────

/**
 * Calcule tous les montants d'une embauche.
 *
 * @param {object}  embauche
 * @param {Array}   jours        - embauche_jours
 * @param {Array}   majorations  - embauche_majorations
 * @param {Array}   frais        - embauche_frais
 * @param {object}  dossier      - embauche_dossiers (mode + coef)
 * @param {object}  params       - embauche_params
 * @param {object?} cout         - embauche_couts, ou null si non autorisé
 *
 * @returns {object} totaux. `cout` et `marge` valent null quand la base n'a
 *                   pas servi de ligne de coût (= pas le droit de la voir).
 */
export function computeEmbauche({
  embauche = {},
  jours = [],
  majorations = [],
  frais = [],
  dossier = {},
  params = DEFAULT_PARAMS,
  cout = null,
} = {}) {
  const p = { ...DEFAULT_PARAMS, ...(params || {}) }
  const th = tauxHoraire(embauche)

  // ── Heures ────────────────────────────────────────────────────────────────
  const totalHeures = round2(jours.reduce((s, j) => s + num(j.heures), 0))
  const totalJours = jours.length
  const heuresNuit = round2(jours.reduce((s, j) => s + num(j.heures_nuit), 0))

  // ── Brut : toutes les heures, majorations non comprises ───────────────────
  const brut = round2(totalHeures * th)

  // ── Majorations automatiques, déduites de la nature des jours ─────────────
  // On n'ajoute que la PART majorée : les heures elles-mêmes sont déjà
  // payées dans le brut.
  const heuresDimanche = jours
    .filter((j) => j.nature === 'dimanche')
    .reduce((s, j) => s + num(j.heures), 0)
  const heuresFerie = jours
    .filter((j) => j.nature === 'ferie')
    .reduce((s, j) => s + num(j.heures), 0)

  const majDimanche = round2(heuresDimanche * th * num(p.maj_dimanche))
  const majFerie = round2(heuresFerie * th * num(p.maj_ferie))
  const majNuit = round2(heuresNuit * th * num(p.maj_nuit))

  // ── Majorations saisies (heures sup + autres heures majorées) ─────────────
  let majSup = 0
  let majAutres = 0
  for (const m of majorations) {
    const part = (num(m.taux) - 100) / 100
    const montant = num(m.heures) * th * part
    if (m.kind === 'sup') majSup += montant
    else majAutres += montant
  }
  majSup = round2(majSup)
  majAutres = round2(majAutres)

  const majorationsMontant = round2(majDimanche + majFerie + majNuit + majSup + majAutres)

  // ── Frais ─────────────────────────────────────────────────────────────────
  // Une prime soumise à cotisations entre dans l'assiette chargée ; un
  // défraiement passe en direct, sans charges et sans marge.
  let fraisSoumis = 0
  let fraisNonSoumis = 0
  for (const f of frais) {
    const montant = num(f.montant) * num(f.nombre, 1)
    if (f.soumis_cotisations) fraisSoumis += montant
    else fraisNonSoumis += montant
  }
  fraisSoumis = round2(fraisSoumis)
  fraisNonSoumis = round2(fraisNonSoumis)

  const assiette = round2(brut + majorationsMontant + fraisSoumis)

  // ── Frais de dossier Movinmotion ──────────────────────────────────────────
  const fraisDossierActif = embauche.frais_dossier_actif !== false
  const fraisDossierFacture = fraisDossierActif
    ? num(
        embauche.frais_dossier_facture ?? p.frais_dossier_facture_defaut,
        p.frais_dossier_facture_defaut,
      )
    : 0
  const fraisDossierCout = fraisDossierActif
    ? num(cout?.frais_dossier_cout ?? p.frais_dossier_cout_defaut, p.frais_dossier_cout_defaut)
    : 0

  // ── Coût réel (ou estimation) ─────────────────────────────────────────────
  // `cout === null` = la RLS n'a rien servi : on ne calcule ni coût ni marge.
  let coutDetail = null
  if (cout) {
    const releve = cout.cout_reel_mm
    const estime = round2(assiette * (1 + num(p.taux_charges_estime)) + fraisNonSoumis)
    // Le relevé Movinmotion est le TOTAL affiché par Movinmotion, frais
    // professionnels compris : l'estimation suit la même convention pour
    // que les deux soient comparables.
    const employeur = releve !== null && releve !== undefined ? round2(releve) : estime
    coutDetail = {
      montant: round2(employeur + fraisDossierCout),
      employeur,
      estime,
      fraisDossier: fraisDossierCout,
      source: releve !== null && releve !== undefined ? 'movinmotion' : 'estime',
      estEstimation: releve === null || releve === undefined,
    }
  }

  // ── Facturé ───────────────────────────────────────────────────────────────
  const coef = coefVente(embauche, dossier)
  const modeFraisReels = dossier?.mode === 'frais_reels'

  let facture
  if (modeFraisReels) {
    // On refacture ce que ça coûte. Sans ligne de coût, rien à afficher.
    facture = coutDetail ? coutDetail.montant : null
  } else {
    facture = round2(assiette * (1 + coef) + fraisNonSoumis + fraisDossierFacture)
  }

  const marge =
    coutDetail && facture !== null ? round2(facture - coutDetail.montant) : null

  return {
    totalJours,
    totalHeures,
    heuresNuit,
    tauxHoraire: round2(th),
    brut,
    majorations: {
      total: majorationsMontant,
      dimanche: majDimanche,
      ferie: majFerie,
      nuit: majNuit,
      sup: majSup,
      autres: majAutres,
    },
    fraisSoumis,
    fraisNonSoumis,
    assiette,
    fraisDossierFacture,
    coef,
    facture,
    cout: coutDetail,
    marge,
    margePct: marge !== null && facture ? round2((marge / facture) * 100) : null,
  }
}

/**
 * Agrège un ensemble de lignes déjà calculées (un dossier, un mois…).
 * Les totaux confidentiels restent à null tant qu'une seule ligne les ignore :
 * un total partiel serait plus trompeur qu'une absence.
 */
export function totauxEmbauches(resultats = []) {
  const base = {
    lignes: resultats.length,
    totalJours: 0,
    totalHeures: 0,
    brut: 0,
    majorations: 0,
    frais: 0,
    facture: 0,
    cout: null,
    marge: null,
  }

  let coutComplet = resultats.length > 0
  let factureComplete = resultats.length > 0
  let cout = 0
  let facture = 0

  for (const r of resultats) {
    base.totalJours += num(r.totalJours)
    base.totalHeures += num(r.totalHeures)
    base.brut += num(r.brut)
    base.majorations += num(r.majorations?.total)
    base.frais += num(r.fraisNonSoumis) + num(r.fraisSoumis)
    if (r.facture === null || r.facture === undefined) factureComplete = false
    else facture += num(r.facture)
    if (!r.cout) coutComplet = false
    else cout += num(r.cout.montant)
  }

  base.totalJours = round2(base.totalJours)
  base.totalHeures = round2(base.totalHeures)
  base.brut = round2(base.brut)
  base.majorations = round2(base.majorations)
  base.frais = round2(base.frais)
  base.facture = factureComplete ? round2(facture) : null
  base.cout = coutComplet ? round2(cout) : null
  base.marge =
    coutComplet && factureComplete ? round2(round2(facture) - round2(cout)) : null
  base.margePct =
    base.marge !== null && base.facture ? round2((base.marge / base.facture) * 100) : null

  return base
}

// ─── Aides de saisie ────────────────────────────────────────────────────────

/**
 * Construit les jours d'une sélection de dates, en reprenant ce qui existe
 * déjà pour ne pas écraser des heures saisies à la main.
 */
export function buildJours(datesISO = [], existants = [], params = DEFAULT_PARAMS) {
  const p = { ...DEFAULT_PARAMS, ...(params || {}) }
  const feries = feriesSet(datesISO, p.feries_extra)
  const parDate = new Map(existants.map((j) => [j.date_jour, j]))

  return [...datesISO].sort().map((iso) => {
    const existant = parDate.get(iso)
    if (existant) return existant
    return {
      date_jour: iso,
      heures: 8,
      heure_debut: null,
      heure_fin: null,
      nature: natureForDate(iso, feries),
      heures_nuit: 0,
    }
  })
}

/**
 * Propose la ventilation des heures sup par semaine à partir des jours saisis.
 * Proposition SEULEMENT : la saisie manuelle prime toujours, parce que les
 * règles varient selon la convention et le poste.
 */
export function suggestHeuresSup(jours = [], params = DEFAULT_PARAMS) {
  const p = { ...DEFAULT_PARAMS, ...(params || {}) }
  const seuil = num(p.seuil_hs_hebdo, 35)
  if (seuil <= 0) return []

  const parSemaine = new Map()
  for (const j of jours) {
    if (!j.date_jour) continue
    const lundi = lundiDeLaSemaine(j.date_jour)
    parSemaine.set(lundi, round2((parSemaine.get(lundi) || 0) + num(j.heures)))
  }

  const out = []
  for (const [semaine, heures] of [...parSemaine.entries()].sort()) {
    const sup = round2(heures - seuil)
    if (sup > 0) {
      out.push({ kind: 'sup', semaine, taux: 125, heures: sup, heuresSemaine: heures })
    }
  }
  return out
}

/** Nom affichable d'une embauche (snapshot d'abord, contact en secours). */
export function nomEmbauche(embauche = {}) {
  const direct = [embauche.prenom, embauche.nom].filter(Boolean).join(' ').trim()
  if (direct) return direct
  const c = embauche.contact
  const viaContact = [c?.prenom, c?.nom].filter(Boolean).join(' ').trim()
  return viaContact || 'Sans nom'
}

/** Avancement du contrat, pour la pastille du tableur. */
export function etatContrat(embauche = {}) {
  if (embauche.contrat_signe) return { key: 'signe', label: 'Signé' }
  if (embauche.contrat_fait) return { key: 'fait', label: 'Contrat fait' }
  if (embauche.infos_recues) return { key: 'infos', label: 'Infos reçues' }
  return { key: 'attente', label: 'À lancer' }
}

/**
 * Infos manquantes pour rédiger le contrat, parmi ce que l'annuaire sait
 * déjà stocker. Le numéro de sécurité sociale, le lieu de naissance et le
 * numéro Congés Spectacles arrivent avec le formulaire de collecte (phase 3)
 * et ne sont donc pas réclamés ici.
 */
export function infosManquantes(embauche = {}) {
  const c = embauche.contact || {}
  const manques = []
  if (!embauche.email && !c.email) manques.push('email')
  if (!c.date_naissance) manques.push('date de naissance')
  // La base porte les deux orthographes selon l'ancienneté des colonnes.
  if (!c.address && !c.adresse && !c.ville) manques.push('adresse')
  return manques
}

/** Bornes ISO d'un mois, pour la vue mensuelle globale. */
export function bornesMois(annee, mois) {
  const debut = new Date(Date.UTC(annee, mois, 1))
  const fin = new Date(Date.UTC(annee, mois + 1, 0))
  return { debut: toISO(debut), fin: toISO(fin) }
}

export { toISO, addDays }
