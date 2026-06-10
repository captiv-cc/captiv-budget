# Migration monorepo — captiv-budget → captiv-desk

> **Branche** : `feature/mobile-app`
> **Date** : 2026-06-10 (nuit)
> **Statut** : structure en place, validation requise via `npm install`

## TL;DR — ce qui a changé

Le repo `captiv-budget/` a été restructuré en **npm workspaces monorepo** :

```
captiv-budget/             ← racine du monorepo (renommé en captiv-desk dans package.json)
├── package.json           ← root : workspaces + scripts orchestrateurs
├── turbo.json             ← pipelines Turborepo
├── vercel.json            ← build packages/web
├── docs/                  ← docs projet (préservées)
├── supabase/              ← migrations + edge functions (commun web + mobile)
└── packages/
    ├── web/               ← ANCIEN root : src/, public/, index.html, vite.config.js…
    │   ├── package.json   ← @captiv/web
    │   └── src/lib/supabase.js  ← rebranché sur @captiv/shared
    ├── shared/            ← code commun web + mobile (factory Supabase, constants, tokens, helpers purs)
    │   ├── package.json   ← @captiv/shared
    │   └── src/
    │       ├── index.js
    │       ├── supabase.js
    │       ├── constants/{statuts,rappels}.js
    │       ├── lib/{dateFormat,format}.js
    │       └── theme/tokens.js
    └── mobile/            ← app Expo SDK 51+ (DESK Cadreur)
        ├── package.json   ← @captiv/mobile
        ├── app.json       ← config Expo (bundle id cc.captiv.desk)
        ├── App.js, index.js, babel.config.js, metro.config.js
        └── src/{lib,theme,navigation,screens,components,hooks,fixtures}/
```

## Pourquoi `npm workspaces` et pas `pnpm` ?

J'ai initialement annoncé pnpm + Turborepo dans le cadrage. Pivot vers **npm workspaces** car :

- Tu utilises déjà npm (pas besoin d'installer un nouveau tool global)
- npm 7+ supporte les workspaces nativement
- Turborepo fonctionne très bien avec npm workspaces (testé largement)
- Pivot pragmatique : moins de friction au démarrage

Si tu veux passer à pnpm plus tard, c'est ~5 min : `npm i -g pnpm` + ajouter `pnpm-workspace.yaml` + `rm package-lock.json && pnpm install`.

## Validation au matin (10 min)

```bash
cd captiv-budget
git checkout feature/mobile-app
npm install                          # installe tout via workspaces (~3 min)
npm run dev:web                      # lance le web : doit marcher EXACTEMENT comme avant
# → ouvre http://localhost:3000 et clique partout pour vérifier
```

**Si le web marche comme avant, la migration monorepo est validée**.

Pour le mobile, voir [REPRISE_MATIN.md](./REPRISE_MATIN.md).

## Changements détaillés

### Au root (avant : tout en vrac)
- `package.json` → réécrit, contient juste workspaces + scripts orchestrateurs
- `package-lock.json` → supprimé, sera régénéré par `npm install`
- `node_modules/` → supprimé, sera régénéré
- `turbo.json` → **nouveau**, configure les pipelines build/dev/lint/test
- `.gitignore` → enrichi avec patterns `packages/*/…` et Expo/RN

### Déplacés vers `packages/web/`
Via `git mv` (historique préservé) :

| Avant | Après |
|---|---|
| `src/` | `packages/web/src/` |
| `public/` | `packages/web/public/` |
| `index.html` | `packages/web/index.html` |
| `vite.config.js` | `packages/web/vite.config.js` |
| `tailwind.config.js` | `packages/web/tailwind.config.js` |
| `postcss.config.js` | `packages/web/postcss.config.js` |
| `eslint.config.js` | `packages/web/eslint.config.js` |
| `.prettierrc` | `packages/web/.prettierrc` |
| `.prettierignore` | `packages/web/.prettierignore` |
| `.env.example` | `packages/web/.env.example` |
| `package.json` (renommé) | `packages/web/package.json` (`name: @captiv/web`) |

### Modifié dans `packages/web/`
- `src/lib/supabase.js` — utilise désormais `createSupabaseClient` from `@captiv/shared/supabase` pour la cohérence avec le mobile. **Comportement identique côté utilisateur**, juste plomberie interne.

### Nouveau : `packages/shared/`
Tout le code partagé entre web et mobile. Pour l'instant :
- `createSupabaseClient` (factory agnostique web/mobile)
- Constantes statuts (livrables, créneaux, types)
- Constantes rappels (5/15/30/45/60/120 min)
- Helpers date (formatDateCourte, formatRelatif, formatCountdown, …)
- Helpers format (initiales, couleurAvatar, formatDistance)
- Design tokens (couleurs Liquid Glass, spacing, radius, fontSize)

**Note** : Le web n'est PAS encore migré pour utiliser les constantes statuts de `@captiv/shared`. C'est un chantier V2 (faut auditer tous les `src/lib/livrables.js`, `cotisations.js`, etc. pour éviter les doublons). Ce qui compte pour la V1 : `@captiv/shared` est dispo si on en a besoin.

### Nouveau : `packages/mobile/`
App Expo prête à démarrer. Détaillé dans [REPRISE_MATIN.md](./REPRISE_MATIN.md).

### `vercel.json` modifié
Pointe désormais sur `packages/web/dist` au lieu de `dist/`. **Action requise sur Vercel** :
- Si Vercel auto-detect framework : aucun changement
- Sinon : Vercel Dashboard → Settings → General → `Build & Development Settings` :
  - Build Command : `npm run build:web`
  - Output Directory : `packages/web/dist`
  - Install Command : `npm install`

## Si quelque chose ne marche pas

### `npm install` échoue
- Vérifier Node ≥ 18 et npm ≥ 8 : `node -v && npm -v`
- Cache corrompu ? `npm cache clean --force && rm -rf node_modules packages/*/node_modules && npm install`

### `npm run dev:web` ne lance pas
- L'import `@captiv/shared` ne résout pas ? Vérifier que `npm install` au root s'est bien fini sans erreur (les workspace symlinks sont créés à ce moment-là).
- Erreur Vite "Cannot find module" → `npm install` n'a pas hoisté correctement. Workaround : `cd packages/web && npm install` (force install local).

### Le web marchait avant mais plus maintenant
- Vérifier que `packages/web/.env` existe avec les bonnes valeurs Supabase
- Si rien ne marche : `git checkout main` pour retrouver l'ancienne structure intacte, puis on debug ensemble

### Rollback complet
La branche `feature/mobile-app` ne touche pas `main`. Pour revenir à l'ancien état :
```bash
git checkout main
git branch -D feature/mobile-app  # ⚠️ supprime la branche locale
```

## Prochaines étapes

Voir [REPRISE_MATIN.md](./REPRISE_MATIN.md) pour démarrer le mobile et compléter la stack push.
