# 🗺️ Roadmap CAPTIV Budget

> Fichier vivant — backlog, idées, décisions et chantiers du projet.
> Édité à la fois par Hugo et par Claude au fil des sessions.
> Convention : on coche ✅ ce qui est fait, on note la date + le commit quand pertinent.

---

## 🎯 Légende

- 🚧 **En cours** — chantier actif
- 📋 **Backlog** — décidé, à faire dès qu'on en a le temps
- 💡 **Idées** — pas encore validé, à creuser
- 🐛 **Bugs** — à corriger
- ✅ **Terminé** — historique des chantiers bouclés
- ❌ **Abandonné** — décidé qu'on ne le fait pas, avec la raison

---

## 🚧 En cours

_(rien pour l'instant)_

---

## 📋 Backlog

### Refonte de la page Projet (ProjetTab) — vue résumée + édition contrôlée
**Ajouté le** : 2026-04-11
**Priorité** : haute (visible par tous les utilisateurs du projet)
**Effort estimé** : ~1.5 jour (sans la timeline horizontale, +2-3h avec)

**Contexte** : aujourd'hui `src/pages/tabs/ProjetTab.jsx` (549 lignes) est un gros formulaire en mode édition permanente, sans contrôle de rôle. N'importe qui ayant accès à l'onglet peut tout modifier. C'est la première page que voient TOUS les utilisateurs (admin, charge_prod, coordinateur, prestataires) — elle doit donc résumer le projet visuellement et n'autoriser l'édition qu'aux rôles habilités.

**Objectifs** :
- Mode **lecture par défaut** pour tous les utilisateurs
- Mode **édition** uniquement pour `admin` + `charge_prod` (bouton "Modifier" → bascule la page)
- Présentation **visuelle** type fiche, plus de mur de placeholders
- Y intégrer un **récap équipe** centré sur la vue groupée par personne (pas par poste)
- Délégation propre vers AccessTab pour la gestion fine des accès

**Structure cible (lecture)** :
1. **Hero** — gros titre + sous-ligne (type · réalisateur · agence) + client + ref projet + badge statut cliquable + bouton ✏ Modifier (admin/charge_prod uniquement)
2. **Planning** — timeline horizontale (Prépa → Tournage → V1 → Master) ou chips datés. V1 sans timeline.
3. **Équipe** — bloc clé : liste des personnes du projet **groupées par individu**. Si Marc est cadreur ET monteur, il apparaît une seule fois avec "Cadreur · Monteur" en sous-titre. Bouton "Voir →" qui mène à l'onglet Équipe.
4. **Livrables** — résumé compact (3 livrables, formats, dates de livraison). Bouton "Voir tout".
5. **Note de production** — texte libre, mode lecture distinct du mode édition.
6. **Détails admin** — section repliable (collapsed par défaut) : ref projet, BC, date devis.
7. **Gestion des accès** (admin/charge_prod uniquement) — petit bloc en bas : "X personnes ont accès à ce projet" + bouton "Gérer →" qui mène à AccessTab.

**Mode édition** :
- Bouton ✏ Modifier en haut bascule toute la page en formulaire (pas d'édition par bloc)
- Boutons Annuler / Enregistrer explicites (on retire l'auto-save actuel pour gagner en clarté)
- Seuls les blocs Identité / Planning / Note / Détails admin sont éditables ici
- Les blocs Équipe et Livrables restent gérés depuis leurs onglets dédiés

**Contrôle de rôle** :
- Lecture : tous (déjà géré par RequirePermission au niveau de la route)
- Édition : `isAdmin || isChargeProd`
- Bouton "Gérer les accès" : `isAdmin || isChargeProd` (cohérent avec AccessTab)

**Détails techniques** :
- Bloc Équipe : récupérer les rôles depuis la table `project_team_members` (ou équivalent), grouper par `user_id` côté React, agréger les postes en string `"Poste1 · Poste2"`
- Le hook `useAuth()` expose déjà `isAdmin`, `isChargeProd` — RAS côté permissions
- Confidentialité : la page n'affiche aucune donnée financière (déjà le cas), donc pas de `canSeeFinance` à gérer ici

**Pistes V2** :
- Timeline horizontale du planning (graphique Gantt mini)
- Visibilité par champ (système `_visible` déjà en partie présent dans `metadata`)
- Édition par bloc (un bouton ✏ par section au lieu du bouton global)
- Autorisations plus fines (coordinateur peut éditer note + livrables ?)

---

### Recherche globale + palette Cmd+K
**Ajouté le** : 2026-04-11
**Priorité** : moyenne
**Effort estimé** : ~1 jour pour V1 + 0.5 jour fignolage

**Objectif** : trouver n'importe quoi dans l'app en 2 secondes (devis, ligne, membre, fournisseur) et déclencher des actions courantes sans passer par la souris.

**UX cible** :
- Raccourci global `Cmd+K` (Mac) / `Ctrl+K` (Win) ouvre une palette modale centrée
- Icône loupe dans la nav qui ouvre la même palette (pour les non-power-users)
- Recherche fuzzy instantanée, résultats groupés par catégorie
- Navigation 100% clavier (↑↓ + Enter, Esc pour fermer)

**Stack technique pressentie** :
- `cmdk` (Paco Coursey / Vercel) — headless, ~5 KB, Tailwind-friendly
- `fuse.js` côté client pour le fuzzy matching (suffisant tant que < 10k entrées)
- Index chargé une fois au montage du Layout, rafraîchi au focus de fenêtre

**Entités à indexer** :
- Projets / devis (numéro, client, type, statut)
- Lignes de devis (ref, produit, description) — gros volume, le plus utile pour "où j'ai facturé tel matos"
- Membres équipe (prénom + nom, poste, régime)
- Fournisseurs (nom, catégorie)

**Actions/raccourcis à inclure** (à affiner) :
- Nouveau devis
- Nouveau membre
- Nouveau fournisseur
- Aller au Budget Réel du devis courant
- Exporter le devis courant en PDF
- Ouvrir Statistiques / Cotisations / Réglages

**Architecture côté code** :
- `src/features/search/CommandPalette.jsx` — composant palette
- `src/features/search/useSearchIndex.js` — hook qui charge + indexe les données Supabase
- `src/features/search/commands.js` — déclaration des actions/raccourcis
- Intégration dans `Layout.jsx` (listener `Cmd+K` global + render conditionnel)

**Pistes V2** :
- Recherche serveur via Supabase `textSearch()` si l'index client devient trop lourd
- Historique des recherches récentes (localStorage)
- "Pages récentes" en suggestion à l'ouverture vide
- Aperçu inline (preview à droite du résultat sélectionné, façon Linear)
- Filtres avancés (`devis:` / `membre:` / `fournisseur:` comme préfixes)

---

## 💡 Idées à creuser

_(rien encore — à remplir au fil de l'eau)_

---

## 🐛 Bugs connus

_(rien de listé pour l'instant)_

---

## ✅ Terminé

### Refacto BudgetReelTab.jsx (2148 → 788 lignes)
**Bouclé le** : 2026-04-11
**Commits** : `ea3a16b` → `cdf81d6` (9 commits)

Extraction mécanique en 9 modules dans `src/features/budget-reel/` :
- `utils.js` — TAUX_INTERM, isIntermittentLike, refCout, memberName
- `components/atoms.jsx` — BlocTotal, StatusToggle, Checkbox, Th, InlineInput, InlineNumberInput, RegimeBadge
- `components/FournisseurSelect.jsx`
- `components/KpiBar.jsx`
- `components/FiltersBar.jsx`
- `components/BlocFooter.jsx`
- `components/LineRow.jsx`
- `components/AdditifRow.jsx`
- `components/RecapPaiements.jsx` (+ PersonGroupCard + FournisseurGroupCard)

### Tests unitaires features/budget-reel/utils.js
**Bouclé le** : 2026-04-11
**Commit** : `aa33495`

27 tests sur `isIntermittentLike`, `refCout`, `memberName`, `TAUX_INTERM`.
Total app : 130 tests verts (cotisations + permissions + budget-reel utils).

### Refacto DevisEditor.jsx
**Bouclé le** : (avant le 2026-04-11, voir historique git)

Extraction en `src/features/devis/` (constants.js + components/).

---

## ❌ Abandonné

_(rien pour l'instant)_

---

## 📝 Notes & décisions d'archi

- **Refacto** : approche purement mécanique, sucrase syntax-check à chaque étape, un commit par extraction. On ne touche jamais la logique pendant un refacto.
- **Tests** : prioriser les fonctions pures du domaine métier (cotisations, permissions, utils). Les composants React seulement quand le rendu est critique.
- **Stack tests** : Vitest + React Testing Library (déjà en place).
- **CI** : pas encore en place — à prévoir un `.github/workflows/test.yml` pour faire tourner `vitest run` à chaque push/PR.
