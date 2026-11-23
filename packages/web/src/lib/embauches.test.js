import { describe, it, expect } from 'vitest'
import {
  paques,
  feriesFrance,
  feriesSet,
  natureForDate,
  lundiDeLaSemaine,
  heuresFromHoraires,
  plageNuit,
  libelleInclusif,
  estAPourvoir,
  infosManquantes,
  tauxHoraire,
  coefVente,
  computeEmbauche,
  totauxEmbauches,
  buildJours,
  suggestHeuresSup,
  nomEmbauche,
  etatContrat,
  bornesMois,
  DEFAULT_PARAMS,
  conventionKey,
  conventionLabel,
  conventionAGrille,
  minimumPourUnite,
  paramsPourConvention,
  DEFAULT_PARAMS as _DP,
} from './embauches'

// ─── Jours fériés ───────────────────────────────────────────────────────────

describe('paques', () => {
  it('tombe le 5 avril en 2026', () => {
    expect(paques(2026)).toBe('2026-04-05')
  })

  it('reste juste sur des années de contrôle', () => {
    expect(paques(2024)).toBe('2024-03-31')
    expect(paques(2025)).toBe('2025-04-20')
    expect(paques(2027)).toBe('2027-03-28')
  })
})

describe('feriesFrance', () => {
  it('renvoie les 11 fériés nationaux', () => {
    const f = feriesFrance(2026)
    expect(f).toHaveLength(11)
    expect(f).toContain('2026-01-01')
    expect(f).toContain('2026-04-06') // lundi de Pâques
    expect(f).toContain('2026-05-14') // Ascension = Pâques + 39
    expect(f).toContain('2026-05-25') // lundi de Pentecôte = Pâques + 50
    expect(f).toContain('2026-11-11') // Armistice, celui de la capture
    expect(f).toContain('2026-12-25')
  })
})

describe('feriesSet', () => {
  it('couvre toutes les années des dates fournies', () => {
    const s = feriesSet(['2026-12-30', '2027-01-02'])
    expect(s.has('2026-12-25')).toBe(true)
    expect(s.has('2027-01-01')).toBe(true)
  })

  it('ajoute les fériés supplémentaires de l’org', () => {
    const s = feriesSet(['2026-05-10'], ['2026-05-26'])
    expect(s.has('2026-05-26')).toBe(true)
  })
})

describe('natureForDate', () => {
  const feries = feriesSet(['2026-11-11'])

  it('reconnaît un férié', () => {
    expect(natureForDate('2026-11-11', feries)).toBe('ferie')
  })

  it('reconnaît un dimanche', () => {
    expect(natureForDate('2026-11-08', feries)).toBe('dimanche')
  })

  it('ne cumule pas férié et dimanche', () => {
    // 2026-11-01 (Toussaint) tombe un dimanche : férié l'emporte, sinon les
    // deux majorations à 100 % se cumuleraient sur la même journée.
    expect(new Date('2026-11-01T00:00:00Z').getUTCDay()).toBe(0)
    expect(natureForDate('2026-11-01', feries)).toBe('ferie')
  })

  it('renvoie normal le reste du temps', () => {
    expect(natureForDate('2026-11-12', feries)).toBe('normal')
  })
})

describe('lundiDeLaSemaine', () => {
  it('ancre un mercredi sur son lundi', () => {
    expect(lundiDeLaSemaine('2026-11-04')).toBe('2026-11-02')
  })

  it('rattache le dimanche à la semaine qui s’achève', () => {
    expect(lundiDeLaSemaine('2026-11-08')).toBe('2026-11-02')
  })

  it('est stable sur un lundi', () => {
    expect(lundiDeLaSemaine('2026-11-02')).toBe('2026-11-02')
  })
})

// ─── Horaires ───────────────────────────────────────────────────────────────

describe('heuresFromHoraires', () => {
  it('calcule une journée ordinaire sans nuit', () => {
    expect(heuresFromHoraires('09:00', '19:00')).toEqual({ heures: 10, heuresNuit: 0 })
  })

  it('gère le passage de minuit', () => {
    // La plage par défaut court de minuit à 6 h : sur 19 h → 2 h, seules les
    // deux dernières heures sont des heures de nuit.
    expect(heuresFromHoraires('19:00', '02:00')).toEqual({ heures: 7, heuresNuit: 2 })
  })

  it('compte la nuit de fin de service', () => {
    expect(heuresFromHoraires('23:00', '07:00')).toEqual({ heures: 8, heuresNuit: 6 })
  })

  it('compte la nuit de début de service', () => {
    expect(heuresFromHoraires('05:00', '13:00')).toEqual({ heures: 8, heuresNuit: 1 })
  })

  it('suit la plage de nuit de la convention', () => {
    // Même service, deux conventions : 19 h → 3 h donne 3 h de nuit à partir
    // de minuit, et 5 h si la convention compte la nuit dès 22 h.
    expect(heuresFromHoraires('19:00', '03:00')).toEqual({ heures: 8, heuresNuit: 3 })
    expect(
      heuresFromHoraires('19:00', '03:00', { nuit_debut: '22:00', nuit_fin: '06:00' }),
    ).toEqual({ heures: 8, heuresNuit: 5 })
  })

  it('renvoie zéro sans horaires', () => {
    expect(heuresFromHoraires(null, '19:00')).toEqual({ heures: 0, heuresNuit: 0 })
  })
})

describe('libelleInclusif', () => {
  it('accorde les métiers en -ateur', () => {
    expect(libelleInclusif('Décorateur')).toBe('Décorateur.rice')
    expect(libelleInclusif('Réalisateur')).toBe('Réalisateur.rice')
  })

  it('accorde les autres métiers en -eur', () => {
    expect(libelleInclusif('Cadreur')).toBe('Cadreur.se')
    expect(libelleInclusif('Monteur')).toBe('Monteur.se')
  })

  it('accorde chaque mot porteur d’un genre', () => {
    expect(libelleInclusif('1er assistant décorateur')).toBe('1er assistant.e décorateur.rice')
    expect(libelleInclusif('Chef électricien')).toBe('Chef.fe électricien.ne')
  })

  it('laisse les mots épicènes et les mots sans genre tranquilles', () => {
    expect(libelleInclusif('Machiniste')).toBe('Machiniste')
    expect(libelleInclusif('Scripte')).toBe('Scripte')
    // « son » ne porte pas de genre : l'accorder donnerait « son.e ».
    expect(libelleInclusif('Chef opérateur du son')).toBe('Chef.fe opérateur.rice du son')
  })

  it('ne rend rien sans poste', () => {
    expect(libelleInclusif('')).toBe('')
    expect(libelleInclusif(null)).toBe('')
  })
})

describe('plageNuit', () => {
  it('affiche la plage appliquée', () => {
    expect(plageNuit()).toBe('00:00 → 06:00')
    expect(plageNuit({ nuit_debut: '22:00:00', nuit_fin: '07:00:00' })).toBe('22:00 → 07:00')
  })
})

// ─── Taux ───────────────────────────────────────────────────────────────────

describe('tauxHoraire', () => {
  it('ramène un taux journalier 8 h à l’heure', () => {
    expect(tauxHoraire({ taux: 270, unite_taux: 'jour_8h' })).toBe(33.75)
  })

  it('gère la semaine de 35 h', () => {
    expect(tauxHoraire({ taux: 700, unite_taux: 'semaine_35h' })).toBe(20)
  })

  it('laisse un taux horaire intact', () => {
    expect(tauxHoraire({ taux: 18, unite_taux: 'heure' })).toBe(18)
  })
})

describe('coefVente', () => {
  it('prend celui du dossier par défaut', () => {
    expect(coefVente({}, { mode: 'portage', coef_vente: 0.8 })).toBe(0.8)
  })

  it('laisse la ligne surcharger le dossier', () => {
    expect(coefVente({ coef_vente: 0.5 }, { mode: 'portage', coef_vente: 0.8 })).toBe(0.5)
  })

  it('accepte une surcharge à zéro', () => {
    expect(coefVente({ coef_vente: 0 }, { mode: 'portage', coef_vente: 0.8 })).toBe(0)
  })

  it('force zéro en frais réels', () => {
    expect(coefVente({ coef_vente: 0.8 }, { mode: 'frais_reels', coef_vente: 0 })).toBe(0)
  })
})

// ─── Cas réels (captures Hugo, projet Leroy Merlin) ─────────────────────────

describe('computeEmbauche — cas réels', () => {
  const PARAMS = { ...DEFAULT_PARAMS }
  const DOSSIER = { mode: 'portage', coef_vente: 0.8 }

  // Décorateur à 270 €/jour (8 h). Movinmotion affiche 42 h et 1 417,50 €
  // de brut ; l'Excel facture 2 641,50 € et Movinmotion coûte 2 425,85 €.
  const DECORATEUR = {
    embauche: {
      taux: 270,
      unite_taux: 'jour_8h',
      frais_dossier_actif: false,
    },
    jours: [
      { date_jour: '2026-11-02', heures: 8, nature: 'normal', heures_nuit: 0 },
      { date_jour: '2026-11-09', heures: 8, nature: 'normal', heures_nuit: 0 },
      { date_jour: '2026-11-10', heures: 8, nature: 'normal', heures_nuit: 0 },
      { date_jour: '2026-11-12', heures: 8, nature: 'normal', heures_nuit: 0 },
      { date_jour: '2026-11-16', heures: 10, nature: 'normal', heures_nuit: 0 },
    ],
    frais: [{ type: 'repas', montant: 18, nombre: 5, soumis_cotisations: false }],
    dossier: DOSSIER,
    params: PARAMS,
  }

  it('retrouve le brut de Movinmotion (42 h → 1 417,50 €)', () => {
    const r = computeEmbauche(DECORATEUR)
    expect(r.totalHeures).toBe(42)
    expect(r.tauxHoraire).toBe(33.75)
    expect(r.brut).toBe(1417.5)
  })

  it('retrouve le montant facturé de l’Excel (2 641,50 €)', () => {
    const r = computeEmbauche(DECORATEUR)
    // (1 417,50 × 1,8) + 90 € de repas, non chargés et sans marge.
    expect(r.fraisNonSoumis).toBe(90)
    expect(r.facture).toBe(2641.5)
  })

  it('calcule la marge face au coût relevé sur Movinmotion', () => {
    const r = computeEmbauche({
      ...DECORATEUR,
      cout: { cout_reel_mm: 2425.85, frais_dossier_cout: 0 },
    })
    expect(r.cout.source).toBe('movinmotion')
    expect(r.cout.montant).toBe(2425.85)
    expect(r.marge).toBe(215.65)
  })

  // Assistant rippeur à 150 €/jour (8 h), 34 h sur 4 jours.
  const RIPPEUR = {
    embauche: { taux: 150, unite_taux: 'jour_8h', frais_dossier_actif: false },
    jours: [
      { date_jour: '2026-11-09', heures: 8, nature: 'normal', heures_nuit: 0 },
      { date_jour: '2026-11-10', heures: 8, nature: 'normal', heures_nuit: 0 },
      { date_jour: '2026-11-12', heures: 8, nature: 'normal', heures_nuit: 0 },
      { date_jour: '2026-11-16', heures: 10, nature: 'normal', heures_nuit: 0 },
    ],
    frais: [{ type: 'repas', montant: 18, nombre: 4, soumis_cotisations: false }],
    dossier: DOSSIER,
    params: PARAMS,
  }

  it('retrouve le facturé du rippeur (1 219,50 €)', () => {
    const r = computeEmbauche(RIPPEUR)
    expect(r.totalHeures).toBe(34)
    expect(r.brut).toBe(637.5)
    expect(r.facture).toBe(1219.5)
  })

  it('montre que la marge varie du simple au double selon le poste', () => {
    const deco = computeEmbauche({
      ...DECORATEUR,
      cout: { cout_reel_mm: 2425.85, frais_dossier_cout: 0 },
    })
    const rip = computeEmbauche({
      ...RIPPEUR,
      cout: { cout_reel_mm: 1039.24, frais_dossier_cout: 0 },
    })
    expect(rip.marge).toBe(180.26)
    // Montants proches, taux de marge du simple au double : c'est tout
    // l'intérêt du module.
    expect(deco.margePct).toBeCloseTo(8.16, 1)
    expect(rip.margePct).toBeCloseTo(14.78, 1)
  })
})

// ─── Majorations ────────────────────────────────────────────────────────────

describe('computeEmbauche — majorations', () => {
  const base = {
    embauche: { taux: 160, unite_taux: 'jour_8h', frais_dossier_actif: false },
    dossier: { mode: 'portage', coef_vente: 0 },
    params: DEFAULT_PARAMS,
  }
  // taux horaire = 20 €

  it('n’ajoute que la part majorée des heures sup', () => {
    const r = computeEmbauche({
      ...base,
      jours: [{ date_jour: '2026-11-02', heures: 10, nature: 'normal', heures_nuit: 0 }],
      majorations: [{ kind: 'sup', semaine: '2026-11-02', taux: 125, heures: 2 }],
    })
    // Les 10 h sont déjà dans le brut (200 €) : 125 % n'ajoute que +25 %
    // sur 2 h, soit 10 €. Les recompter en entier ferait 250 €.
    expect(r.brut).toBe(200)
    expect(r.majorations.sup).toBe(10)
    expect(r.facture).toBe(210)
  })

  it('fait entrer les majorations dans le brut versé', () => {
    const r = computeEmbauche({
      ...base,
      jours: [{ date_jour: '2026-11-02', heures: 8, nature: 'normal', heures_nuit: 3 }],
    })
    // La base ne couvre que les heures (8 × 20 = 160 €) ; les 3 h de nuit à
    // +25 % ajoutent 15 €. C'est `brutTotal` que touche l'intermittent, et
    // c'est lui que la fiche affiche : un brut immobile quand on saisit une
    // nuit passe pour un calcul en panne.
    expect(r.brut).toBe(160)
    expect(r.majorations.nuit).toBe(15)
    expect(r.brutTotal).toBe(175)
    // L'assiette part de la base, pas du brut total : sinon les majorations
    // compteraient deux fois.
    expect(r.assiette).toBe(175)
  })

  it('majore le dimanche à 100 %', () => {
    const r = computeEmbauche({
      ...base,
      jours: [{ date_jour: '2026-11-08', heures: 8, nature: 'dimanche', heures_nuit: 0 }],
    })
    expect(r.brut).toBe(160)
    expect(r.majorations.dimanche).toBe(160)
    expect(r.facture).toBe(320)
  })

  it('majore un férié sans le cumuler avec le dimanche', () => {
    const r = computeEmbauche({
      ...base,
      jours: [{ date_jour: '2026-11-01', heures: 8, nature: 'ferie', heures_nuit: 0 }],
    })
    expect(r.majorations.ferie).toBe(160)
    expect(r.majorations.dimanche).toBe(0)
  })

  it('majore les heures de nuit à 25 %', () => {
    const r = computeEmbauche({
      ...base,
      jours: [{ date_jour: '2026-11-02', heures: 8, nature: 'normal', heures_nuit: 4 }],
    })
    expect(r.majorations.nuit).toBe(20)
  })

  it('cumule les paliers de majoration saisis', () => {
    const r = computeEmbauche({
      ...base,
      jours: [{ date_jour: '2026-11-02', heures: 8, nature: 'normal', heures_nuit: 0 }],
      majorations: [
        { kind: 'sup', semaine: '2026-11-02', taux: 150, heures: 2 }, // +50 % → 20
        { kind: 'autre', semaine: null, taux: 200, heures: 1 }, // +100 % → 20
      ],
    })
    expect(r.majorations.sup).toBe(20)
    expect(r.majorations.autres).toBe(20)
    expect(r.majorations.total).toBe(40)
  })
})

// ─── Frais ──────────────────────────────────────────────────────────────────

describe('computeEmbauche — frais', () => {
  const base = {
    embauche: { taux: 160, unite_taux: 'jour_8h', frais_dossier_actif: false },
    jours: [{ date_jour: '2026-11-02', heures: 8, nature: 'normal', heures_nuit: 0 }],
    dossier: { mode: 'portage', coef_vente: 1 },
    params: DEFAULT_PARAMS,
  }

  it('ne met aucune marge sur les défraiements', () => {
    const r = computeEmbauche({
      ...base,
      frais: [{ type: 'repas', montant: 18, nombre: 2, soumis_cotisations: false }],
    })
    // 160 × 2 = 320, plus 36 € de repas en direct : le coefficient ne les
    // touche pas.
    expect(r.facture).toBe(356)
  })

  it('charge les primes soumises à cotisations', () => {
    const r = computeEmbauche({
      ...base,
      frais: [{ type: 'prime', montant: 100, nombre: 1, soumis_cotisations: true }],
    })
    expect(r.assiette).toBe(260)
    expect(r.facture).toBe(520)
  })

  it('applique les frais de dossier quand ils sont actifs', () => {
    const r = computeEmbauche({
      ...base,
      embauche: { taux: 160, unite_taux: 'jour_8h', frais_dossier_actif: true },
    })
    expect(r.fraisDossierFacture).toBe(25)
    expect(r.facture).toBe(345)
  })

  it('accepte un montant de frais de dossier propre à la ligne', () => {
    const r = computeEmbauche({
      ...base,
      embauche: {
        taux: 160,
        unite_taux: 'jour_8h',
        frais_dossier_actif: true,
        frais_dossier_facture: 40,
      },
    })
    expect(r.fraisDossierFacture).toBe(40)
  })
})

// ─── Modes et confidentialité ───────────────────────────────────────────────

describe('computeEmbauche — modes', () => {
  const commun = {
    embauche: { taux: 160, unite_taux: 'jour_8h', frais_dossier_actif: false },
    jours: [{ date_jour: '2026-11-02', heures: 8, nature: 'normal', heures_nuit: 0 }],
    params: DEFAULT_PARAMS,
  }

  it('facture au coût réel en mode frais réels, sans marge', () => {
    const r = computeEmbauche({
      ...commun,
      dossier: { mode: 'frais_reels', coef_vente: 0 },
      cout: { cout_reel_mm: 250, frais_dossier_cout: 0 },
    })
    expect(r.facture).toBe(250)
    expect(r.marge).toBe(0)
  })

  it('estime le coût tant que Movinmotion n’a rien rendu', () => {
    const r = computeEmbauche({
      ...commun,
      dossier: { mode: 'portage', coef_vente: 0.8 },
      cout: { cout_reel_mm: null },
    })
    // 160 × 1,65 = 264 €
    expect(r.cout.estEstimation).toBe(true)
    expect(r.cout.source).toBe('estime')
    expect(r.cout.employeur).toBe(264)
  })

  it('ne divulgue ni coût ni marge sans ligne de coût servie', () => {
    const r = computeEmbauche({
      ...commun,
      dossier: { mode: 'portage', coef_vente: 0.8 },
      cout: null,
    })
    expect(r.facture).toBe(288)
    expect(r.cout).toBeNull()
    expect(r.marge).toBeNull()
    expect(r.margePct).toBeNull()
  })

  it('n’affiche aucun montant en frais réels sans accès au coût', () => {
    // Le facturé EST le coût : sans accès, il n'y a rien à montrer.
    const r = computeEmbauche({
      ...commun,
      dossier: { mode: 'frais_reels', coef_vente: 0 },
      cout: null,
    })
    expect(r.facture).toBeNull()
    expect(r.marge).toBeNull()
  })
})

// ─── Totaux ─────────────────────────────────────────────────────────────────

describe('totauxEmbauches', () => {
  const ligne = (facture, cout) => ({
    totalJours: 1,
    totalHeures: 8,
    brut: 100,
    majorations: { total: 10 },
    fraisNonSoumis: 5,
    fraisSoumis: 0,
    facture,
    cout: cout === null ? null : { montant: cout },
  })

  it('additionne les lignes', () => {
    const t = totauxEmbauches([ligne(200, 150), ligne(300, 250)])
    expect(t.lignes).toBe(2)
    expect(t.brut).toBe(200)
    expect(t.facture).toBe(500)
    expect(t.cout).toBe(400)
    expect(t.marge).toBe(100)
  })

  it('tait le total de marge dès qu’une ligne échappe à la vue', () => {
    // Un total partiel serait plus trompeur qu'une absence.
    const t = totauxEmbauches([ligne(200, 150), ligne(300, null)])
    expect(t.facture).toBe(500)
    expect(t.cout).toBeNull()
    expect(t.marge).toBeNull()
  })

  it('renvoie des totaux nuls sur une liste vide', () => {
    const t = totauxEmbauches([])
    expect(t.lignes).toBe(0)
    expect(t.brut).toBe(0)
    expect(t.marge).toBeNull()
  })
})

// ─── Aides de saisie ────────────────────────────────────────────────────────

describe('buildJours', () => {
  it('crée les jours manquants avec leur nature', () => {
    const jours = buildJours(['2026-11-11', '2026-11-08', '2026-11-12'])
    expect(jours.map((j) => j.date_jour)).toEqual([
      '2026-11-08',
      '2026-11-11',
      '2026-11-12',
    ])
    expect(jours[0].nature).toBe('dimanche')
    expect(jours[1].nature).toBe('ferie') // Armistice
    expect(jours[2].nature).toBe('normal')
    expect(jours[2].heures).toBe(8)
  })

  it('préserve les heures déjà saisies', () => {
    const existant = { date_jour: '2026-11-12', heures: 10, nature: 'normal', heures_nuit: 2 }
    const jours = buildJours(['2026-11-12'], [existant])
    expect(jours[0]).toBe(existant)
  })
})

describe('suggestHeuresSup', () => {
  it('propose les heures au-delà du seuil hebdomadaire', () => {
    const jours = [
      { date_jour: '2026-11-02', heures: 10 },
      { date_jour: '2026-11-03', heures: 10 },
      { date_jour: '2026-11-04', heures: 10 },
      { date_jour: '2026-11-05', heures: 10 },
    ]
    const sug = suggestHeuresSup(jours)
    expect(sug).toHaveLength(1)
    expect(sug[0]).toMatchObject({ semaine: '2026-11-02', taux: 125, heures: 5 })
  })

  it('ne propose rien sous le seuil', () => {
    expect(suggestHeuresSup([{ date_jour: '2026-11-02', heures: 8 }])).toEqual([])
  })

  it('sépare les semaines', () => {
    const sug = suggestHeuresSup([
      { date_jour: '2026-11-02', heures: 40 },
      { date_jour: '2026-11-09', heures: 36 },
    ])
    expect(sug.map((s) => s.semaine)).toEqual(['2026-11-02', '2026-11-09'])
    expect(sug.map((s) => s.heures)).toEqual([5, 1])
  })
})

describe('nomEmbauche', () => {
  it('prend le snapshot en priorité', () => {
    expect(nomEmbauche({ prenom: 'Amaya', nom: 'Bongiardino' })).toBe('Amaya Bongiardino')
  })

  it('retombe sur le contact lié', () => {
    expect(nomEmbauche({ contact: { prenom: 'Axel', nom: 'Agletiner' } })).toBe(
      'Axel Agletiner',
    )
  })

  it('nomme le poste ouvert plutôt que de laisser un vide', () => {
    expect(nomEmbauche({})).toBe('Poste à pourvoir')
  })
})

describe('estAPourvoir', () => {
  it('reconnaît une ligne sans identité ni fiche', () => {
    expect(estAPourvoir({ nom: '', prenom: '' })).toBe(true)
  })

  it('une fiche annuaire liée suffit à désigner quelqu’un', () => {
    expect(estAPourvoir({ nom: '', contact_id: 'abc' })).toBe(false)
  })

  it('un nom suffit', () => {
    expect(estAPourvoir({ nom: 'Bongiardino' })).toBe(false)
  })

  it('ne réclame rien à un poste ouvert', () => {
    expect(infosManquantes({ nom: '', prenom: '' })).toEqual([])
  })
})

describe('etatContrat', () => {
  it('suit l’avancement des trois cases', () => {
    expect(etatContrat({}).key).toBe('attente')
    expect(etatContrat({ infos_recues: true }).key).toBe('infos')
    expect(etatContrat({ infos_recues: true, contrat_fait: true }).key).toBe('fait')
    expect(etatContrat({ contrat_signe: true }).key).toBe('signe')
  })
})

describe('bornesMois', () => {
  it('borne un mois de 30 jours', () => {
    expect(bornesMois(2026, 10)).toEqual({ debut: '2026-11-01', fin: '2026-11-30' })
  })

  it('gère février bissextile', () => {
    expect(bornesMois(2028, 1)).toEqual({ debut: '2028-02-01', fin: '2028-02-29' })
  })
})

describe('conventions collectives', () => {
  it('normalise un ancien libellé complet en IDCC', () => {
    expect(conventionKey('CCN de la production audiovisuelle (2642)')).toBe('2642')
    expect(conventionKey('3252')).toBe('3252')
    expect(conventionKey(null)).toBeNull()
  })

  it('rend le libellé complet pour l’affichage', () => {
    expect(conventionLabel('2642')).toContain('production audiovisuelle')
    expect(conventionLabel('3252')).toContain('création')
  })

  it('n’applique la grille des minima qu’à la 2642', () => {
    // La grille `minimas_convention` est celle de la CCN production
    // audiovisuelle : sous la 3252 elle donnerait un plancher faux.
    expect(conventionAGrille('2642')).toBe(true)
    expect(conventionAGrille('3252')).toBe(false)
    expect(conventionAGrille(null)).toBe(false)
  })
})

describe('minimum dérivé d’un taux horaire (grille 3252)', () => {
  // Cadreur AV, grille ETSCE filière AV : 23,56 €/h.
  it('multiplie par les heures de l’unité', () => {
    expect(minimumPourUnite(23.56, 'jour_8h')).toBe(188.48)
    expect(minimumPourUnite(23.56, 'semaine_35h')).toBe(824.6)
  })

  it('majore les heures au-delà du seuil hebdomadaire', () => {
    // 35 h à 23,56 = 824,60 ; 4 h à 125 % = 117,80 ; soit 942,40. Ignorer la
    // majoration placerait le minimum sous le plancher réel.
    expect(minimumPourUnite(23.56, 'semaine_39h')).toBe(942.4)
  })

  it('ne rend rien sans taux ou sans unité connue', () => {
    expect(minimumPourUnite(0, 'jour_7h')).toBeNull()
    expect(minimumPourUnite(23.56, 'inconnue')).toBeNull()
  })
})

describe('paramètres par convention', () => {
  it('rend la ligne de la convention demandée', () => {
    const map = { 2642: { maj_dimanche: 1 }, 3252: { maj_dimanche: 0.5 } }
    expect(paramsPourConvention(map, '3252').maj_dimanche).toBe(0.5)
    expect(paramsPourConvention(map, 'CCN ... (2642)').maj_dimanche).toBe(1)
  })

  it('retombe sur les valeurs par défaut, en le signalant', () => {
    const p = paramsPourConvention({}, '3252')
    expect(p._defaut).toBe(true)
    expect(p.maj_dimanche).toBe(_DP.maj_dimanche)
  })
})
