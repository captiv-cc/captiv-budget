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

### [archivé — voir ✅ Terminé] Refonte de la page Projet (ProjetTab) — vue résumée + édition contrôlée
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

### Light mode + toggle de thème
**Ajouté le** : 2026-04-12
**Priorité** : basse (pas urgent — confort visuel)
**Effort estimé** : ~2h pour Claude (1h30 de code + 30 min de ping-pong visuel avec Hugo)

**Objectif** : permettre à l'utilisateur de basculer entre dark mode (par défaut) et light mode via un bouton dans la sidebar. Persistance localStorage.

**État des lieux** (audit du 2026-04-12) :
- ✅ La base est saine : `src/index.css` définit ~30 variables CSS dans `:root` (`--bg`, `--bg-surf`, `--bg-elev`, `--txt`, `--txt-2`, `--txt-3`, `--brd`, `--brd-sub`, accents colorés…) et la majorité des composants utilisent `style={{ background: 'var(--bg-surf)' }}`.
- ⚠️ Trois nids de couplage à nettoyer avant que le light mode soit présentable :
  1. **~220 classes Tailwind grises hardcodées** (`bg-slate-*`, `text-gray-*`, `text-slate-500`…) sur ~13 fichiers. Elles ne suivent pas les variables → resteront sombres en light mode. Liste des fichiers concernés à récupérer via `grep -rl "bg-slate\|text-slate\|bg-gray\|text-gray" src --include="*.jsx"`.
  2. **~35 occurrences de `rgba(255,255,255,...)`** (overlays blancs pour hover/borders). Blanc sur blanc en light mode → invisible. À remplacer par un token `--overlay-hover` qui s'inverse selon le thème.
  3. **~23 occurrences de `rgba(0,0,0,...)`** : pareil mais inversé.
- Plus quelques hex literals dispersés (`#0d0d0d`, `#3a3a3a`, `#111`) dans `index.css` à remplacer par des variables.

**Plan d'attaque (en deux phases)** :

*Phase 1 — infra (15 min, zéro risque) :*
- Dupliquer le bloc `:root` de `index.css` en `[data-theme="dark"]` (par défaut) et `[data-theme="light"]` (avec les valeurs inversées)
- Créer un `ThemeContext` (ou un simple hook `useTheme()`) qui set `document.documentElement.dataset.theme` et persiste dans `localStorage`
- Ajouter le bouton toggle dans la sidebar (icône Sun/Moon de lucide-react)
- Dark mode reste par défaut, comportement inchangé tant qu'on ne touche pas au toggle

*Phase 2 — nettoyage (~1h30 + ping-pong visuel) :*
- Introduire des tokens `--overlay-hover`, `--overlay-press`, `--overlay-brd` dans les deux blocs de variables
- Search/replace les `rgba(255,255,255,...)` et `rgba(0,0,0,...)` par ces tokens
- Convertir les ~220 classes Tailwind grises : soit vers `style={{ color: 'var(--txt-3)' }}`, soit en créant des classes utilitaires (`.text-muted`, `.bg-surf`) dans `index.css` qui pointent vers les variables
- Remplacer les hex literals restants
- Tester chaque page en alternant les deux thèmes (Hugo doit être présent — Claude ne voit pas le rendu)

**Règles à appliquer dès maintenant** (pour ne pas créer de nouvelle dette) :
- ❌ **Plus jamais** de `bg-slate-*`, `text-gray-*`, `bg-zinc-*` dans le nouveau code
- ❌ **Plus jamais** de `rgba(255,255,255,...)` ou `rgba(0,0,0,...)` hardcodé pour les overlays — utiliser une variable CSS
- ❌ **Plus jamais** de hex literal (`#1a1a1a`) dans le JSX — passer par une variable
- ✅ Toujours utiliser `style={{ background: 'var(--bg-surf)', color: 'var(--txt)' }}` ou les classes utilitaires dédiées
- ✅ Pour les couleurs accentuées (vert/rouge/bleu/orange), continuer à utiliser les variables (`var(--green)`, etc.) — elles peuvent garder les mêmes valeurs ou être ajustées dans le bloc `[data-theme="light"]`

**Pistes V2** :
- Détection auto via `prefers-color-scheme` (suivre la préférence OS)
- Thème custom utilisateur (sliders pour l'accent principal)
- "Soft dark" alternatif (anthracite/beige) entre dark et light

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

### Grilles tarifaires par client (price lists)
**Ajouté le** : 2026-04-12
**Priorité** : moyenne (utile dès qu'il y a des clients récurrents avec accords-cadres)
**Effort estimé** : ~0.5–1 jour

**Objectif** : pouvoir définir des tarifs négociés par client pour certains éléments du catalogue. Lors de la création d'un devis, le système applique automatiquement le tarif client s'il existe, sinon le `tarif_defaut` du catalogue.

**Exemple concret** : ZQSD Productions a négocié un tarif cadreur à 350 €/j au lieu des 400 €/j du catalogue. Quand on crée un devis pour ZQSD et qu'on ajoute "Cadreur", le tarif pré-rempli est 350 € — pas 400 €.

**Implémentation pressentie** :
- Nouvelle table `tarifs_client` : `id`, `client_id` (FK clients), `produit_id` (FK produits_bdd), `tarif_ht` (numeric), `notes` (text), `created_at`
- Index unique sur `(client_id, produit_id)` pour éviter les doublons
- UI côté fiche client : section "Tarifs négociés" avec liste des surcharges + ajout/suppression
- UI côté catalogue : indicateur discret si l'élément a des tarifs spécifiques (ex: petit badge "2 clients")
- Logique AddLineModal / ProduitAutocomplete : lookup `tarifs_client` en priorité, fallback `tarif_defaut`

**Prérequis** : catalogue stabilisé + flux devis solide (les deux zones impactées).

**Pistes V2** :
- Grilles par type de projet (pub vs fiction vs corporate) en plus de par client
- Import/export des grilles tarifaires en Excel
- Historique des tarifs (date début / date fin) pour tracer l'évolution

---

## 🐛 Bugs connus

_(rien de listé pour l'instant)_

---

## ✅ Terminé

### Refonte ProjetTab.jsx — vue résumée + édition contrôlée
**Bouclé le** : 2026-04-11
**Commits** : `bb89794` (extract STATUS_OPTIONS) → `11ebbe4` (extract StatusBadgeMenu) → `031bd81` (rewrite ProjetTab)

- Mode lecture par défaut pour tous (hero, identité, planning, équipe, livrables, note, détails admin repliables, accès)
- Bouton ✏ Modifier visible uniquement pour `admin` + `charge_prod` → bascule la page entière en formulaire
- Save explicite (Annuler / Enregistrer) — fini l'auto-save
- Bloc Équipe : membres groupés par personne (un seul item même avec plusieurs postes), avatars + lien vers /equipe
- Bloc Gestion des accès : compteur + lien vers /access (admin/charge_prod uniquement)
- StatusBadgeMenu réutilisé dans le hero (taille `md`, alignement à gauche)
- Constantes Projet centralisées dans `src/features/projets/constants.js` (STATUS_OPTIONS + getStatusOption)

### Status badge cliquable + suppression ProjetDetail.jsx mort
**Bouclé le** : 2026-04-11
**Commits** : `e8d2d60` (badge cliquable + delete ProjetDetail) → `bb89794` (extract constants)

Quick win sur la liste `/projets` : badge de statut cliquable avec menu déroulant (optimistic UI + rollback en cas d'erreur). Suppression de `src/pages/ProjetDetail.jsx` (366 lignes de code mort jamais routées).

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
