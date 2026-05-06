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

_(rien pour l'instant — chantier Équipe Sessions Phase A bouclé le 2026-05-08)_

---

## 📋 Backlog

### CONDUITE / DÉROULÉ JOUR — Tab planning tournage heure par heure
**Ajouté le** : 2026-05-08 · **Priorité** : haute (demandé par Hugo) · **Effort estimé** : ~12-13j sur 5 vagues · **V1 livrable en ~4-5j**

Tab dédiée pour gérer le déroulé temporel d'une journée de tournage :
qui fait quoi, à quelle heure, sur quelle équipe, à quel endroit. Multi-lane
(jusqu'à 5 équipes parallèles), granularité 5 min stockée / 15 min affichée,
import des présences techlist en 1 clic, partage public via lien, futur
agrégateur des call sheets.

Roadmap complète : [`CHANTIER_CONDUITE.md`](./CHANTIER_CONDUITE.md) :
- **V1 (~4-5j)** — édition fluide : timeline desktop + liste mobile,
  multi-lane, drag/resize, snap 15min/5min, import présences,
  now line, overlap warnings
- **V2 (~2j)** — partage public : token + page `/share/conduite/:token`
  + intégration sous-page portail projet
- **V3 (~1.5j)** — mode régie live : statuts par créneau (planifie /
  en_cours / fait), auto-highlight bloc en cours
- **V4 (~3j)** — call sheets PDF : agrégat équipe + conduite + lieux +
  contacts urgence, distribution lien public, versioning snapshot
- **V5 (~2j)** — templates inter-projets, documents attachés par
  créneau, diff entre versions

**Décision en attente** : nom final de la tab. Reco doc : "Déroulé"
(accessible tous métiers vs "Conduite" trop broadcast vs "Rundown"
anglo niche). À trancher avant V1.

---

### LOGISTIQUE V1/V2/V3 — Tab dédiée régie
**Ajouté le** : 2026-04-15 · **Priorité** : haute · **Effort estimé** : ~7-10j total (3 vagues)

Chantier complet documenté dans [`CHANTIER_LOGISTIQUE.md`](./CHANTIER_LOGISTIQUE.md) :
- **V1 (~3j)** — calendrier vue d'ensemble, hébergements (lieux + chambres + assignments), repas (planning + attendance)
- **V2 (~3j)** — transports (train/avion/voiture), documents (vouchers/billets), véhicules régie
- **V3 (~3-4j)** — per diems, notes de frais, lieux tournage, export PDF "Carnet de route", partage public régie, intégration Budget Réel

**Prérequis** : 6 questions ouvertes à trancher avec Hugo avant V1 (niveau de détail chambres, types de repas, aspect financier, migration `hebergement` TEXT existant, permissions, orientation vue).

**Articulation** : la techlist reste source de vérité pour `presence_days` / `arrival_*` / `departure_*` ; LOGISTIQUE enrichit (hébergement/repas/transport structurés) sans remplacer.

---

### Polish Équipe résiduel — backlog audits Phase A
**Ajouté le** : 2026-05-08 · **Priorité** : basse · **Effort estimé** : ~0.5j

Findings non-bloquants identifiés lors des audits de fin de chantier
Sessions Phase A. Liste détaillée dans
[`CHANTIER_EQUIPE_BACKLOG.md`](./CHANTIER_EQUIPE_BACKLOG.md) :
~10 items 🟠 Important + 🟡 Mineur + 🤔 Suspects (rollback EquipeTab trop large, lot_id fallback share, autosave stale closure modale, drift PERSONA_LEVEL_FIELDS, etc).

À reprendre opportunistiquement quand on touche aux fichiers concernés,
ou en passe cleanup dédiée avant un futur chantier Équipe.

---

### DEVIS-4 — Collab temps réel type Google Sheets
**Ajouté le** : 2026-05 · **Priorité** : moyenne · **Effort estimé** : ~4-5j

Édition collaborative en temps réel des lignes de devis (présence des
curseurs, locks optimistes, broadcast Realtime). Pattern à inspirer de
ce qui a été fait pour le matériel (MAT-9B) et la checklist terrain.
Pas de doc dédiée — à créer au démarrage.

---

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

### Import automatisé de la grille CC (minimas convention)
**Ajouté le** : 2026-04-12
**Priorité** : basse (mise à jour annuelle — le process SQL manuel suffit pour l'instant)
**Effort estimé** : ~0.5 jour

**Objectif** : permettre l'import direct d'un fichier Excel de minimas sociaux depuis l'interface, sans passer par le SQL Editor de Supabase.

**Process actuel (manuel)** : upload de l'Excel → script Python génère le SQL d'upsert → exécution dans Supabase SQL Editor. Fonctionne bien pour une mise à jour annuelle.

**Implémentation pressentie** :
- Bouton "Importer grille" dans l'onglet Grille CC Audiovisuelle (admin uniquement)
- Upload du fichier Excel → parsing côté client (SheetJS) ou via Edge Function Supabase
- Preview des changements (X nouveaux postes, Y montants mis à jour) avant validation
- Upsert via `supabase.from('minimas_convention').upsert(...)` avec `onConflict`
- Log de l'import (date, nb lignes, utilisateur) pour traçabilité

**Prérequis** : format Excel stable d'une année sur l'autre (structure CCPA relativement constante).

---

## 🐛 Bugs connus

_(rien de listé pour l'instant)_

---

## ✅ Terminé

### Chantier Équipe — Sessions Phase A (refonte multi-membres + share + PDF)
**Bouclé le** : 2026-05-08
**Commits clés** : `5dc2cd7` (migration SQL sessions) → `9e229a5` (useCrew session globale) → `5693f69` (joinSession) → `831d456` (finalisation Phase A) → `a7243c9` (fix audit critiques 4/7) → `1bd7753` (backlog Important + Mineur) → `e5b36b2` (drift SQL) → `4746153` (hotfix share_equipe_fetch) → `b9c3b0f` (fix lint BOM)

Refacto majeure du modèle Équipe : passage de 1-membre-par-session à des
sessions globales partagées entre N membres (`projet_sessions` +
`projet_session_membres`). Inclut :
- Migration SQL Phase A (sessions globales, denorm `project_id`, triggers
  auto sort_order, garde-fous cross-project, drop table legacy)
- Refonte modale Présence (autosave debounced, indicateur partage, chip
  badge `👥N`, SessionMetaEditor inline, raccourcis Prépa/Tournage)
- UI : chips de session dans la crew list, grille présence colorée,
  légende sessions, drawer cohérent
- Page share publique + PDF export avec coloring cellules X par session
  + légende
- 4 fixes critiques d'audit (rollback updateMembre/removeMembre,
  setState during render → useEffect, flushPending sur unmount,
  sort_order délégué au trigger DB)
- 7 fixes audit Important + Mineur (mémoïsation projectSessionTemplates,
  touchstart export menu, encodeURIComponent tel/mailto, Blob CSV,
  hexToRgb null-safe, lot_id ad-hoc share, ESC modale)

Backlog résiduel (non bloquant) consigné dans
[`CHANTIER_EQUIPE_BACKLOG.md`](./CHANTIER_EQUIPE_BACKLOG.md).

---

### Chantier Livrables (LIV-1 → LIV-23) — Tab Livrables complète
**Bouclé le** : 2026-04 (Vague 1) → 2026-05 (Pipeline + Gantt + intégration planning)
**Commits** : ~50 commits, `LIV-*` dans les messages

CRUD blocs + livrables + étapes, vue liste + Pipeline + Gantt, drag/resize,
mode Focus, export PDF vue d'ensemble, sync bidirectionnelle avec Planning,
duplication cross-project, soft delete + corbeille. Roadmap détaillée :
[`CHANTIER_LIV_ROADMAP.md`](./CHANTIER_LIV_ROADMAP.md).

---

### Chantier Matériel (MAT-1 → MAT-23) — Tab Matériel + checklist terrain + rendu loueur
**Bouclé le** : 2026-04 → 2026-05
**Commits** : ~80 commits, `MAT-*` dans les messages

CRUD matos par bloc, catalogue matériel global, dropdown loueurs, drag &
drop, collab Realtime, checklist terrain (route `/check/:token` plein
écran tactile), photos par item/bloc, bilan PDF essais, retrait soft +
additifs, rendu loueur (route `/rendu/:token`), bon de retour PDF + ZIP
par loueur, optimistic updates partout. Handoff doc :
[`CHANTIER_MAT_HANDOFF.md`](./CHANTIER_MAT_HANDOFF.md).

---

### Chantier Planning (PL-1 → PL-8 + PG-1 → PG-5) — Tab Planning projet + Planning global
**Bouclé le** : 2026-04
**Commits** : ~40 commits, `PL-*` / `PG-*` dans les messages

5 vues (mois, semaine/jour, kanban, table, gantt v2 + swimlanes), filtres
+ vues sauvegardées + presets, export iCal (token public), responsive
mobile, page Planning globale tous-projets confondus, RLS events
granulaire (PERM-1 → PERM-8).

---

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
