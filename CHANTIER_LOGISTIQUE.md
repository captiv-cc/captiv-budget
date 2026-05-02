# CHANTIER LOGISTIQUE / RÉGIE

> **État** : Roadmap notée — démarrage différé, à attaquer après validation
> de la phase 1 Équipe et clarification des questions ouvertes (cf. fin du doc).

## Pourquoi une tab dédiée

La techlist gère « qui travaille quand » (présence + arrivée/retour de chaque
personne). Tout le reste de la logistique régie (qui dort où, qui mange quoi,
gestion des transports, documents, véhicules…) déborde du modèle « 1 ligne =
1 attribution » de la techlist et a son propre vocabulaire :

- pivot temporel = jours, lignes = personnes (ou inverse selon la vue)
- objets indépendants : lieux d'hébergement, chambres, fournisseurs repas,
  trajets, véhicules, documents administratifs
- récaps métier : nuitées × tarif, nb couverts × prix, kilométrage, totaux
  par personne / par lieu / par jour
- audience : régisseur général + régisseurs (potentiellement un rôle dédié)

Une tab `Logistique` dans la page projet les regroupe au bon niveau.

## Ce qui reste dans la techlist

**On garde dans la techlist les champs de "qui travaille quand"** :

- `presence_days` — jours de présence
- `arrival_date` / `arrival_time` — jour d'arrivée
- `departure_date` / `departure_time` — jour de retour
- `chauffeur` (boolean)
- `logistique_notes` (texte libre court)

C'est la **source de vérité** pour la planification temporelle. La tab
Logistique lit ces champs et les enrichit avec ses propres tables (sans les
remplacer).

Le champ `hebergement` (TEXT) actuel sur projet_membres devient
**déprécié à terme** : remplacé par les assignations structurées de la tab
Logistique. Pendant la transition, on l'affiche en read-only sur la techlist
si rempli, et la tab Logistique lit l'existant pour permettre une migration
manuelle vers le modèle structuré.

## Architecture globale

```
projet_membres (techlist)
  ├ presence_days, arrival_*, departure_* ← source de vérité temporelle
  ├ chauffeur, logistique_notes (boolean + texte court)
  └ hebergement (deprecated, migrer)

logistique_lieux              (catalogue)
  - id, project_id, type ('hotel'|'gite'|'airbnb'|'autre')
  - nom, adresse, contact, prix_base, notes

logistique_chambres           (catalogue, FK lieu)
  - id, lieu_id, numero, capacite, type ('single'|'double'|'twin'|...)
  - prix_nuit (override du prix_base si différent)

logistique_hebergement        (assignment)
  - id, project_id, projet_membre_id, chambre_id (ou lieu_id si pas de chambres)
  - date_debut, date_fin (ou nuit unique date_nuit)
  - notes (codes accès, instructions)

logistique_repas_fournisseurs (catalogue, optionnel)
  - id, project_id, nom, type ('caterer'|'restau'|'livraison'|'autre')
  - prix_couvert, contact

logistique_repas              (planning + assignment)
  - id, project_id, date, type ('petit_dej'|'dejeuner'|'diner'|...)
  - fournisseur_id (nullable)
  - prix_couvert (override fournisseur)
  - notes

logistique_repas_attendance   (jointure : qui mange quoi)
  - id, repas_id, projet_membre_id
  - regime_alim_override (pour ce repas spécifique, hérite contact sinon)

logistique_transports         (V2)
  - id, project_id, projet_membre_id, type ('train'|'avion'|'voiture'|...)
  - sens ('aller'|'retour'|'autre')
  - depart_lieu, depart_datetime
  - arrivee_lieu, arrivee_datetime
  - reference (n° vol/train/réservation)
  - prix, document_id (FK vers logistique_documents)

logistique_documents          (V2)
  - id, project_id, type, label, file_url, file_size
  - lien optionnel : projet_membre_id, lieu_id, transport_id

logistique_vehicules          (V2)
  - id, project_id, type ('perso'|'location'|'utilitaire')
  - marque, modele, plaque, conducteur_membre_id, places_dispos, notes

logistique_per_diems          (V3)
  - barème par jour selon zone
  - calcul auto par personne et par jour de tournage hors zone

logistique_notes_de_frais     (V3)
  - id, project_id, projet_membre_id, date, montant, justificatif_url, statut
```

## Structure UI

Tab Logistique avec sous-vues (sidebar gauche ou onglets internes) :

1. **📅 Vue d'ensemble** (calendrier pivot — page d'accueil régisseur)
   - Lignes = personnes, colonnes = jours
   - Cellules = présence (couleur) + petits indicateurs (lit / fourchette / 🚗)
   - Filtres : par catégorie, par lieu d'hébergement
   - Click cellule → détail jour×personne

2. **🛏️ Hébergements**
   - Vue grille (lieux × jours) ou liste (par personne)
   - Catalogue lieux + chambres
   - Plan d'attribution (drag & drop possible)
   - Récaps : par lieu, par personne, par nuit, totaux €

3. **🍽️ Repas**
   - Planning par jour : petit-déj / déj / dîner (extensible)
   - Pour chaque repas : fournisseur, prix, qui y participe
   - Régimes alim agrégés (3 vegé, 2 sans gluten)
   - Récaps : par repas, par jour, par personne

4. **✈️ Transport** (V2)
   - Vue par personne : ses trajets aller/retour
   - Vue par jour : qui arrive quand (gare / aéroport / heure)
   - Lien aux documents (billets PDF)

5. **📄 Documents** (V2)
   - Bibliothèque : autorisations, billets, vouchers, attestations
   - Tags + recherche

6. **🚗 Véhicules régie** (V2)
   - Catalogue + affectations + plein/km

7. **💰 Per diems / NDF** (V3)
   - Calcul auto + saisie manuelle

8. **📍 Lieux de tournage** (V3 — peut-être à externaliser dans une tab dédiée)

## Vagues de livraison (~7-10j total estimé)

### Vague 1 — MVP (~3j)
- Migration SQL : `logistique_lieux`, `logistique_chambres`, `logistique_hebergement`, `logistique_repas`, `logistique_repas_attendance`
- Lib `logistique.js` (fetch, CRUD, helpers de récap)
- Hook `useLogistique`
- Tab Logistique + ProjetLayout + permissions
- Vue d'ensemble calendrier (read-only V1)
- Module Hébergements (CRUD lieux + chambres + assignments)
- Module Repas (CRUD repas + attendance)
- Récaps de base (totaux par lieu, par personne, par jour)

### Vague 2 — Extensions (~3j)
- Migration SQL : `logistique_transports`, `logistique_documents`, `logistique_vehicules`
- Module Transport (CRUD trajets, n° vol/train, prix)
- Module Documents (upload + tags + recherche)
- Module Véhicules régie (catalogue + affectations)
- Vue d'ensemble interactive (drag pour attribuer hébergement / repas)

### Vague 3 — Avancé (~3-4j)
- Migration SQL : `logistique_per_diems`, `logistique_notes_de_frais`
- Per diems (barème + calcul auto)
- Notes de frais (saisie + photo justif)
- Lieux de tournage structurés
- Export PDF "Carnet de route" par personne
- Partage public régie (token + page `/share/regie/:token`)
- Intégration Budget Réel : remontée auto des coûts hébergement / repas

## Articulation avec les autres tabs

- **Techlist** ↔ Logistique :
  - Techlist source la liste des personnes (projet_membres principales)
  - Logistique enrichit (hébergement structuré, repas, etc.)
  - Modifs des dates de présence / arrivée / retour côté techlist propagent
    naturellement dans la vue calendrier de Logistique
  - Sur la techlist, on garde un aperçu condensé (icônes Home / Car / repas)
    qui résume l'état logistique sans naviguer

- **Budget Réel** : V3 fait remonter les coûts logistique (nuitées × tarif,
  couverts × prix, transport) dans des lignes Budget Réel structurées →
  comparaison devis vs réel régie

- **Planning** : les périodes du projet (prépa, tournage…) bordent les vues
  calendrier de Logistique

- **Livrables** : indirect (les jours de tournage du planning servent de
  base aux jours à gérer en logistique)

## Permissions

Démarrage avec `canSeeCrewBudget` (= INTERNAL_ROLES = admin, charge_prod,
coordinateur). Si besoin plus tard : ajouter un rôle `regisseur` dédié au
catalogue `permissions.js`.

## Questions ouvertes (à trancher avant V1)

1. **Niveau de détail des chambres** : on gère les chambres individuelles
   avec capacité (single/double/twin) ou juste le lieu ? Ma reco : oui, les
   chambres, parce que les conflits/overbooking sont là où le régisseur
   perd du temps. Mais c'est plus de schema.

2. **Types de repas par défaut** : 3 (petit-déj, déj, dîner) suffisent en
   V1, ou on supporte directement collation/brunch/cocktail ? Reco : 3 +
   mécanisme d'ajout par projet.

3. **Aspect financier en V1** : on calcule les totaux euros automatiquement
   et on prévoit l'intégration Budget Réel dès le départ, ou la V1 est
   purement organisationnelle (saisie des prix sans agrégation budget) ?
   Reco : afficher les totaux dès V1 mais réserver l'intégration Budget
   Réel pour V3.

4. **Migration des données existantes** : les rows projet_membres ont
   `arrival_date`, `arrival_time`, `departure_date`, `departure_time`,
   `hebergement` (TEXT). On garde ces colonnes telles quelles (techlist
   reste source de vérité pour les dates) et on migre uniquement
   `hebergement` (TEXT) vers `logistique_hebergement` (structuré) ?
   Reco : oui — migration légère via un import manuel au lancement de la
   tab Logistique.

5. **Permissions** : OK avec canSeeCrewBudget en V1 ou tu veux un rôle
   régisseur dédié ?

6. **Vue d'ensemble — orientation** : par défaut, lignes = personnes ×
   colonnes = jours, ou l'inverse ? Reco : personnes × jours (alignement
   avec les call-sheets / techlists Excel).

## Fichiers à créer (référence — pour l'implémentation)

```
supabase/migrations/
  └ <date>_logistique_v1_schema.sql       (V1)
  └ <date>_logistique_v2_schema.sql       (V2)
  └ <date>_logistique_v3_schema.sql       (V3)

src/
  ├ lib/logistique.js                     (fetch + CRUD + helpers)
  ├ lib/logistique.test.js                (helpers purs)
  ├ hooks/useLogistique.js
  └ features/logistique/
      ├ LogistiqueTab.jsx                 (entry point — sous-tabs)
      ├ views/
      │   ├ OverviewCalendar.jsx          (vue d'ensemble)
      │   ├ HebergementsView.jsx
      │   ├ RepasView.jsx
      │   ├ TransportView.jsx             (V2)
      │   ├ DocumentsView.jsx             (V2)
      │   └ VehiculesView.jsx             (V2)
      └ components/
          ├ LieuCard.jsx, ChambrePicker.jsx, RepasPlanner.jsx, ...
```

Et dans `src/pages/ProjetLayout.jsx` + `src/components/ProjectSideNav.jsx` :
ajouter l'entrée de menu "Logistique" + route `/projets/:id/logistique`.
