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
