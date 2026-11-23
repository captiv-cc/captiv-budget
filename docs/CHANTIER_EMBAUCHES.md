# CHANTIER EMBAUCHES — Suivi des contrats d'intermittence

> Cadrage du 2026-11-23, arbitrages Hugo intégrés. Module de suivi des
> contrats d'intermittence, en portage auprès d'autres sociétés de
> production comme sur les projets Captiv. Rien n'est codé : ce document
> est la proposition à valider.

---

## 1. Objectif

Remplacer l'Excel « SUIVI INTERMITTENCE » par un module du Desk qui :

1. prépare la saisie Movinmotion (mêmes notions, mêmes unités, même
   configurateur d'heures) ;
2. produit le récap à envoyer au client (jours, montants, coût global
   détaillé) ;
3. révèle la marge réelle de chaque contrat, aujourd'hui invisible ;
4. collecte les infos légales manquantes des intermittents via un lien.

**Ce que le module n'est pas** : un logiciel de paie. Le chiffre qui fait
foi reste celui de Movinmotion. L'outil estime, prépare et compare.

**Hors périmètre (décidé)** : aucune génération de facture. Le module
s'arrête au récap chiffré ; la facturation reste dans l'onglet Factures.

**Nom retenu** : « Embauches ». Il couvre le portage comme les embauches
Captiv, ce que « Portage » aurait exclu.

---

## 2. Le modèle de calcul

### 2.1 Formule actuelle de l'Excel (reconstituée et vérifiée)

```
Facturé client = (brut + heures majorées) × (1 + coef_vente)
                 + défraiements + frais de dossier
```

Avec `coef_vente = 80 %`. Vérifications :

| Personne | Brut | Maj. | Défr. | Frais | Calcul | Excel |
|---|---|---|---|---|---|---|
| Amaya (Check In) | 1 080 | 25,35 | 54 | 25 | 2 068,63 | 2 068,63 ✓ |
| Benoit (Check In) | 500 | 23,44 | 18 | 25 | 985,19 | 985,19 ✓ |
| Amaya (Leroy M.) | 1 350 | 67,50 | 90 | — | 2 641,50 | 2 641,50 ✓ |

Les défraiements et frais de dossier ne sont **pas** chargés : ils
s'ajoutent après application du coefficient.

### 2.2 Le coefficient de 80 % est un tarif, pas un taux de charges

C'est le point structurant. En rapprochant les captures Movinmotion du
projet Leroy Merlin :

| Poste | Brut | Facturé ×1,8 | Coût réel MM | Taux réel | Marge |
|---|---|---|---|---|---|
| Décorateur (tech. cadre) | 1 417,50 | 2 641,50 | 2 425,85 | ~65 % | 215,65 € · 8,2 % |
| Ass. rippeur (non cadre) | 637,50 | 1 219,50 | 1 039,24 | ~52 % | 180,26 € · 14,8 % |

> Chiffres reconstitués depuis les captures, à confirmer sur les données
> réelles. L'écart de taux s'explique (statut catégoriel, abattement pour
> frais professionnels, plafonds), mais sa conséquence est nette : la
> marge varie du simple au double sans que rien ne l'affiche.

### 2.3 Deux modes de facturation par dossier

**Décision Hugo** : le coefficient ne doit pas s'appliquer partout. Les
projets internes Captiv se suivent aux frais réels.

Le mode est donc une propriété du dossier, **choisie à la création, sans
valeur implicite** :

| Mode | Facturé | Marge |
|---|---|---|
| **Portage (coefficient)** | `(brut + maj) × (1 + coef_vente) + défraiements + frais de dossier facturés` | calculée |
| **Frais réels** | `coût réel + défraiements + frais de dossier au coût` | nulle par construction |

En mode frais réels, le montant « facturé » suit le coût réel : tant que
Movinmotion n'a pas rendu son chiffre, il reste une estimation.
**L'interface doit le dire explicitement**, sinon on facture une
estimation en croyant facturer le réel.

Un dossier **sans client** est un suivi interne : pas de récap client,
pas de lien de partage.

### 2.4 Les trois montants

| Montant | Calcul | Visibilité |
|---|---|---|
| **Facturé** | selon le mode (§ 2.3) | interne + client |
| **Coût réel** | relevé Movinmotion, sinon estimé `brut × (1 + taux_charges)` + frais de dossier dus | **admin** en mode portage |
| **Marge** | `facturé − coût réel` | **admin uniquement** |

Le coût réel affiche sa provenance (`estimé` ou `relevé Movinmotion`) et,
quand les deux existent, l'écart. Le `taux_charges` d'estimation est
paramétrable par organisation, surchargeable par statut catégoriel.

Les défraiements s'annulent entre facturé et coût réel : **pas de marge
sur les défraiements** (décision Hugo, conforme à la formule actuelle).

### 2.5 Frais de dossier Movinmotion

Deux montants distincts, tous deux paramétrables et surchargeables par
embauche, avec un interrupteur d'activation par ligne :

- `frais_dossier_facture` : 25 € par défaut, refacturé au client ;
- `frais_dossier_cout` : 20 € par défaut, dû à Movinmotion.

L'écart entre les deux fait partie de la marge.

### 2.6 Coefficient de vente

Unique par dossier, **surchargeable ligne par ligne** quand un contrat
sort de la règle.

---

## 3. Permissions

**Pas de nouveau rôle.** Le système existant couvre déjà le besoin :
`metier_template_permissions` + overrides par projet, avec un CRUD admin
complet dans `TemplatesMetiersTab`. Un gestionnaire social externe est
un `prestataire` porteur d'un template métier « Gestion sociale » qui
n'ouvre que la clé `embauches`.

| Surface | Accès |
|---|---|
| Onglet global « Embauches » (accueil Desk) | `admin` uniquement, garde de route |
| Onglet « Embauches » du projet | clé outil `embauches` (read / edit), attribuable à un externe via template métier ou override projet |
| Coût réel et marge | `admin` uniquement, **check explicite** |

⚠️ **Piège** : `can()` accorde un bypass total aux rôles internes
(`admin`, `charge_prod`, `coordinateur`). Un `coordinateur` verrait donc
la marge si on se contentait d'une clé outil. Le gating des colonnes
confidentielles doit donc passer par un contrôle de rôle explicite, et
être appliqué **côté serveur** (RLS ou colonnes filtrées dans le RPC),
jamais seulement masqué en front.

En mode frais réels, le coût réel **est** le montant facturé : il n'y a
rien à cacher et la colonne marge disparaît.

Nouveau template métier livré avec le chantier : **« Gestion sociale »**
(`embauches` en edit, rien d'autre).

---

## 4. Ce qui existe déjà et qu'on réutilise

| Existant | Usage dans le module |
|---|---|
| `minimas_convention` | Grille CCNTA par poste × type d'œuvre (Fiction / Flux / Hors fiction & flux) × unité (jour 7h, jour 8h, sem. 35h, sem. 39h). Alimente le sélecteur de poste et l'alerte sous-minimum, comme les 3 radios de Movinmotion. |
| `contacts` | Nom, prénom, date de naissance, adresse, CP, ville, pays, email, téléphone, IBAN, SIRET, régime, tarif jour. |
| `projet_membres.movinmotion_statut` | Déjà en base (`non_applicable` → `paie_terminee`), jamais branché. Devient le statut contrat. |
| `cotisations.js` | Régime `Ext. Intermittent` (« vendu en Externe, recruté en intermittent ») = le portage côté devis. Les deux mondes doivent afficher le même chiffre. |
| `metier_template_permissions` | Template « Gestion sociale » (§ 3). |
| Pattern de partage | Token par module + RPC `SECURITY DEFINER` + filtrage serveur. Rien de neuf à inventer pour les vues client et intermittent. |
| `outils_catalogue` | Nouvelle clé `embauches`. |

### Ce qui manque dans `contacts` pour un contrat

Numéro de sécurité sociale, lieu de naissance, nationalité, numéro
Congés Spectacles. C'est précisément l'objet du formulaire de collecte.
Ces colonnes s'ajoutent sur `contacts` (données de la personne, pas du
contrat), avec accès restreint.

---

## 5. Modèle de données

```
embauche_dossiers
  org_id, nom, client_id?, project_id?            ← lien Desk optionnel
  mode (portage | frais_reels), coef_vente
  convention (IDCC : 2642 | 3252), type_projet, resume, lieu
  numero_objet (France Travail), bon_commande (client)
  statut, date_debut, date_fin

embauches
  dossier_id, contact_id?                          ← + snapshot identité
  poste_france_travail, libelle_poste, statut_categoriel, type_oeuvre
  taux, unite_taux (jour_7h | jour_8h | semaine_35h | semaine_39h | heure)
  coef_vente?                                      ← surcharge du dossier
  infos_recues, contrat_fait, contrat_signe        ← jalons de l'Excel
  frais_dossier_actif, frais_dossier_facture, frais_dossier_cout
  cout_reel_mm, cout_reel_source, remarques

embauche_jours
  embauche_id, date, heures, heure_debut?, heure_fin?
  nature (normal | dimanche | ferie), heures_nuit

embauche_majorations
  embauche_id, semaine, taux (125 | 150 | 175 | 200), heures
  + autres heures majorées (125 | 130 | 150 | 200)

embauche_frais
  embauche_id, type (repas | defraiement | ik | transport | prime | …)
  montant, nombre

embauche_collecte_tokens
  embauche_id, token, statut, expire_at, used_at

embauche_params        (par org)
  seuil_hs_hebdo, maj_hs, maj_dimanche, maj_ferie, maj_nuit
  taux_charges_estime, coef_vente_defaut
  frais_dossier_facture_defaut, frais_dossier_cout_defaut
```

Catégories multi-tenant (cf. `MT_RULES.md`) : `embauche_dossiers` et
`embauche_params` en **A** (`org_id` direct), tout le reste en **B**
(héritage via `dossier_id`).

### Jours fériés

Calculés, pas saisis (Pâques + règle française). Une saisie manuelle
reste possible pour les cas particuliers (Alsace-Moselle, outre-mer).

### Règles de majoration

Paramétrables, **jamais codées en dur**. Pré-remplies avec tes valeurs
(seuil 35 h, HS 25 %, dimanche 100 %, férié 100 %, nuit 25 % de minuit à 6 h),
surchargeables par convention et par poste. Je n'invente pas les règles
conventionnelles par filière : si elles diffèrent selon les postes, tu
les renseignes et l'outil les applique.

### Convention Movinmotion à respecter

> « Les heures supplémentaires sont incluses dans le total des heures
> indiquées. »

Même règle ici, sinon double comptage. Idem pour les autres heures
majorées.

---

## 6. Le configurateur d'heures

Calqué sur Movinmotion, avec une sortie supplémentaire.

1. **Calendrier multi-sélection** des jours d'embauche (dimanches grisés,
   fériés signalés).
2. **Une ligne par jour** avec un nombre d'heures, 8 par défaut.
3. **Mode horaires** (optionnel, par jour) : saisir 9 h → 19 h, l'outil
   en déduit 10 h dont la part de nuit. Le total reste affiché au format
   Movinmotion pour le report.
4. **Blocs heures sup** par semaine (125 / 150 / 175 / 200 %) et autres
   heures majorées (125 / 130 / 150 / 200 %), pré-remplis par les règles,
   toujours corrigeables à la main. **La saisie manuelle prime.**
5. **Frais professionnels** : repas (montant × nombre), défraiements
   journaliers, IK, transport, primes.

---

## 7. Les vues

### 7.1 Interne — le tableur

Reproduit l'Excel, éditable au clavier (sinon retour à Excel sous huit
jours). Colonnes : identité, poste, taux, jalons contrat, calendrier
jour par jour, total heures, brut, majorations, défraiements, frais de
dossier, **facturé**, **coût réel**, **marge**, remarques. Totaux en tête.

Les colonnes sont redimensionnables et mémorisées (`useColumnWidths`,
clé `embauches.tableur`).

### 7.2 Globale — onglet d'accueil

Entrée dans la barre latérale à côté de Crew et Clients, **admin
uniquement**. Ouvre sur les embauches du **mois courant tous dossiers
confondus** : masse salariale, facturé, marge, contrats non signés,
infos manquantes.

### 7.3 Client — lien partagé

Récap jours et montants, coût global détaillé (brut, heures sup,
défraiements, frais de dossier). **Sans marge ni coût réel**, filtrés
côté serveur dans le RPC, pas dans le front.

### 7.4 Intermittent — formulaire de collecte

Lien unique par embauche, **écriture seule** : aucune lecture des autres
embauches, aucun montant affiché. Pré-rempli par ce que `contacts`
connaît déjà, la personne complète le reste.

---

## 8. Rattachement au Desk

Le lien `embauche_dossiers.project_id` est **optionnel** et
bidirectionnel :

- **Depuis le projet** : onglet « Embauches », visible dès que le droit
  outil `embauches` est accordé. Sans dossier lié, il propose d'en lier
  un ou d'en créer un pour ce projet. (Un onglet qui apparaît et
  disparaît tout seul est introuvable : il reste donc toujours là.)
- **Depuis le dossier** : retour vers le projet, reprise des membres,
  des postes et des dates de présence.
- **Remontée** : le coût réel des embauches peut alimenter le budget réel
  du projet. À cadrer en phase 4.

Rappel des trois branchements obligatoires d'un onglet projet :
route dans `App.jsx`, déclaration dans `ProjetLayout.ALL_TABS`, section
dans `ProjectSideNav.GROUPS`. Param de route projet = `id`.

---

## 9. Données personnelles

Le formulaire collecte du numéro de sécurité sociale, de la date et du
lieu de naissance, un IBAN. Donnée sensible transitant par une URL.

- Token **à usage unique**, expiration courte (7 jours par défaut),
  révocable.
- Le token n'ouvre **aucune lecture** : il ne sert qu'à écrire sa propre
  fiche.
- RPC en whitelist stricte de colonnes, jamais `select *`.
- Accès aux colonnes sensibles de `contacts` restreint par RLS.
- Règle de purge à définir.

---

## 10. Découpage

**Phase 1 — le tableur interne** (point de départ validé)
Migration, `lib/embauches.js` (calculs purs, testés), dossiers avec leur
mode, embauches, configurateur d'heures, tableur éditable, vue mensuelle
globale, onglet latéral admin, clé outil `embauches`, template métier
« Gestion sociale ».

**Phase 2 — rattachement projet**
Lien dossier ↔ projet, onglet « Embauches » dans le projet, reprise des
membres et des dates depuis l'équipe.

**Phase 3 — partages**
Lien client (lecture filtrée serveur), formulaire intermittent, colonnes
légales sur `contacts`, export PDF du récap client.

**Phase 4 — bouclage**
Remontée vers le budget réel, cohérence avec le régime
`Ext. Intermittent` du devis, alertes (contrat non signé, infos
manquantes, sous-minimum conventionnel).

---

## 11. Arbitrages actés (2026-11-23)

| # | Décision |
|---|---|
| 1 | Pas de nouveau rôle : template métier « Gestion sociale » + clé outil `embauches`. Onglet global admin seul ; marge et coût réel gatés par contrôle de rôle explicite, appliqué côté serveur. |
| 2 | Le module s'appelle **Embauches**. |
| 3 | Frais de dossier : 25 € facturés / 20 € dus, activables et modifiables par embauche. |
| 4 | Aucune marge sur les défraiements. |
| 5 | Coefficient de vente unique par dossier, surchargeable par embauche. |
| 6 | Deux modes par dossier : **portage (coefficient)** ou **frais réels**. Choisi à la création, sans valeur implicite. |
| 7 | Pas de génération de facture : suivi seul. |
| 8 | Saisie des heures au format Movinmotion, avec mode horaires optionnel et calcul automatique. |
| 9 | Deux conventions seulement, stockées par IDCC : 2642 (production audiovisuelle) et 3252 (entreprises au service de la création et de l'événement). La grille des minima en base ne vaut que pour la 2642. |
| 10 | « Numéro d'objet » (France Travail) et « BC / Réf. projet » (client) sont deux références distinctes. Le premier porte un lien vers le portail employeur. |
| 11 | Grille 3252 fournie par Hugo (Grilles de fonctions et salaires, filière AV 2024 ETSCE) : table `minimas_etsce` à part, 105 fonctions, plancher = taux horaire CDDU. |
| 12 | Les majorations se règlent PAR CONVENTION (`embauche_params`, une ligne par IDCC), depuis « Règles de calcul » sur la page Embauches. Sans ligne enregistrée, le calcul applique les valeurs par défaut et l'interface le signale. |
| 13 | Les heures de nuit se comptent **à partir de minuit** (plage 00:00 → 06:00 par défaut). La plage reste un paramètre par convention : une convention qui compte la nuit dès 22 h se règle sans toucher au code. |
| 14 | Une embauche peut n'avoir **personne** : sans nom ni fiche annuaire, c'est un « poste à pourvoir ». Pas de colonne dédiée, l'état se déduit, et la fiche refuse d'enregistrer un anonyme autrement que par la case. |
| 15 | Les minima d'un poste sont **proposés**, pas seulement contrôlés : la 2642 en publie un par type d'œuvre, un clic renseigne le taux et le type d'œuvre. Le poste ne se saisit plus librement, il se choisit dans la grille de la convention. |
| 16 | Le bandeau de la fiche affiche le brut **majorations comprises** (`brutTotal`). `brut` reste la base nue pour le calcul de l'assiette. Dans le tableur, la colonne s'appelle « Base », puisque « Major. » est juste à côté. |
| 17 | Une seule page, pas d'onglets : contrat, puis jours. Heures majorées saisies à la main, frais et relevé de coût sont repliés sur une ligne tant qu'ils sont vides. |
| 18 | Le libellé du poste reprend l'intitulé de la grille **en écriture inclusive** (`libelleInclusif`), tant qu'il n'a pas été écrit à la main. Proposition, pas vérité : la langue a trop d'exceptions. |
| 19 | En unité « heure » sous la 2642, le minimum se déduit du **jour de 7 h divisé par 7**. Le jour de 8 h donnerait un plancher horaire plus bas que le plancher réel. |
| 20 | L'avancement du contrat (infos reçues, contrat fait, contrat signé) se pointe **dans le tableur**, pas dans la fiche : c'est du suivi, pas du réglage. Coefficient et frais de dossier sont repliés, ils suivent le dossier neuf fois sur dix. |
