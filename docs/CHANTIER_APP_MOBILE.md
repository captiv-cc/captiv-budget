# CAD — Application mobile iOS / Android (V1 Cadreurs)

> **Statut** : 🟡 Cadré, en attente de design/maquettes avant code
> **Date d'ouverture** : 2026-06-10
> **Owner** : Hugo MARTIN
> **Estim V1** : ~6-8 semaines jusqu'à TestFlight externe pour les cadreurs

## Vision & contexte

DESK est aujourd'hui une webapp pour la production audiovisuelle. Sur le
terrain, les équipes (notamment les **cadreurs en festival**) ont besoin
d'un accès mobile rapide à leur planning, leurs livrables, et surtout
de **recevoir des notifications push** quand leur planning change ou
qu'on les sollicite.

V1 = **app cadreur** focus terrain. À terme (V3+), l'objectif est une
**app globale DESK** qui couvre tous les modules (devis, musiques, plans,
moodboard...). C'est cette vision long terme qui dicte les choix
techniques d'aujourd'hui (notamment le monorepo).

## Choix actés (2026-06-10)

| Décision | Valeur |
|---|---|
| Framework | **Expo / React Native** (vraie app native, pas WebView) |
| Architecture repo | **Monorepo** (web + mobile + shared dans 1 seul dépôt) |
| Bundle ID iOS / package Android | `cc.captiv.desk` |
| Service push | **Expo Push Service** (gratuit illimité, recommandé pour démarrer) |
| Stratégie iOS | **TestFlight externe** uniquement en V1 (pas d'App Store public) |
| Stratégie Android | **Google Play Internal Testing track** |
| Compte Apple Developer | Individu (suffit pour TestFlight) |
| Phasage | Pré-requis admin + maquettes design d'abord, puis code |
| iOS minimum | **iOS 15+** (couvre 96% des iPhone actifs) |
| Android minimum | **API 24 (Android 7+)** (couvre 95%+ des devices) |

### Pourquoi Expo plutôt que Capacitor

Capacitor = webview qui charge la webapp dans une coque native. Réutilise
100% du code mais l'UX reste "web-like" : drag-drop HTML5 ne marche pas
sur tactile, animations CSS moins fluides, gestes natifs absents. Pour
des cadreurs en festival qui dépendent de l'app, c'est moyen.

Expo/React Native = vraie app native. Les `<View>` se convertissent en
`UIView` iOS et `android.view.View` Android au runtime. Animations 60fps
via Reanimated, gestes natifs (swipe entre jours, pull-to-refresh,
long-press), listes virtualisées via `FlatList`. UX qui correspond
vraiment au besoin terrain.

### Pourquoi monorepo plutôt que repos séparés

Vision long terme = app DESK couvre tous les modules (devis, musiques,
plans, moodboard, livrables...). Donc partage de code massif à terme :
types BDD, constantes (statuts, priorités, palettes), helpers purs.

Sans monorepo, on aurait DESK web et DESK mobile qui divergent
silencieusement : "tiens, le statut affiché côté mobile dit 'En cours'
mais côté web 'En traitement'". C'est le scenario classique des équipes
qui regrettent de ne pas avoir fait monorepo dès le départ.

Avec monorepo, `packages/shared/constants.ts` est la source unique pour
les 2 apps.

## Scope V1 — App cadreur

### Écrans V1 (à maquetter)

1. **Login** — Email/password Supabase Auth (magic link en V2 plus tard)
2. **Mon planning** — Timeline scrollable des créneaux du cadreur, swipe
   entre jours, badges statut, pull-to-refresh
3. **Détail créneau** — Artiste, scène, horaires, notes, refs Moodboard
   éventuelles, contacts équipe
4. **Mes livrables** — Liste des livrables où le cadreur est crédité
   (lecture seule)
5. **Notifications** — Historique des push reçues, marquage lu/non-lu,
   filtres
6. **Profil & paramètres** — Nom, rôle, paramètres notifs (toggle on/off
   par type), bouton logout

### Hors scope V1

- Création / édition de données (l'app est **read-only majoritairement**)
- Modules Musiques, Moodboard, Devis, Compta, Settings admin (pas
  pertinent pour le terrain cadreur — V2/V3)
- Multi-projet (V1 = un projet "en cours" à la fois)
- Upload photo / vidéo des cadreurs (V2)
- Check-in scène / pointage horaire (V2)
- Mode hors-ligne complet avec queue de sync (V2 — V1 = cache lecture
  seule)

## Stack technique détaillée

```
Framework UI       : React Native (via Expo SDK 50+)
Langage            : TypeScript
Navigation         : React Navigation v6 (stack + tab)
État serveur       : React Query (TanStack Query)
Cache local        : AsyncStorage + React Query persist
Tokens sécurisés   : Expo SecureStore (Keychain iOS, EncryptedSharedPrefs Android)
Animations         : React Native Reanimated 3
Gestes             : React Native Gesture Handler
Listes virtuelles  : FlashList (Shopify, plus perf que FlatList)
Auth backend       : Supabase JS SDK
Realtime           : Supabase Realtime (déjà en place)
Push notifications : Expo Notifications + Expo Push Service
Crash reporting    : Sentry (gratuit jusqu'à 5k events/mois)
Build cloud        : Expo EAS Build
OTA updates        : Expo Updates (hot fix sans review Apple)
Distribution iOS   : TestFlight (externe)
Distribution Android : Google Play Internal Testing
```

## Architecture repo (monorepo)

### Structure cible

```
captiv-desk/                   ← repo renommé depuis captiv-budget
├── packages/
│   ├── web/                   ← l'ancien src/ déplacé ici
│   │   ├── src/
│   │   ├── public/
│   │   ├── index.html
│   │   └── package.json       ← deps webapp (React, Vite, etc.)
│   ├── mobile/                ← nouveau projet Expo
│   │   ├── src/
│   │   ├── app.json           ← config Expo
│   │   ├── eas.json           ← config EAS Build
│   │   └── package.json       ← deps mobile (React Native, Expo)
│   └── shared/                ← code commun
│       ├── src/
│       │   ├── types/         ← types BDD générés par Supabase
│       │   ├── constants/     ← labels, palettes, enum métier
│       │   └── helpers/       ← helpers purs (dates, formatage)
│       └── package.json
├── supabase/                  ← reste à la racine, partagé
│   ├── migrations/
│   └── functions/
├── docs/                      ← reste à la racine
├── pnpm-workspace.yaml        ← config monorepo
├── turbo.json                 ← orchestration des builds
└── package.json               ← root, gère scripts globaux
```

### Migration depuis le repo actuel

~3-4h de boulot bien fait, à zéro casse :

1. Backup branch `before-monorepo` du repo actuel
2. Création de `packages/web/`, déplacement de `src/`, `public/`,
   `index.html`, `vite.config.js`, etc.
3. Création de `packages/shared/` vide
4. Création de `packages/mobile/` via `npx create-expo-app`
5. Config `pnpm-workspace.yaml` + `turbo.json`
6. Réécriture des imports relatifs si besoin (rare avec Vite)
7. Test que `pnpm dev:web` lance toujours la webapp
8. Test que `pnpm dev:mobile` lance Expo Go
9. Commit en un seul gros chunk "chore: migrate to monorepo"

### Outils

- **pnpm workspaces** ou **yarn workspaces** : gestion des deps
- **Turborepo** : orchestration des builds + cache intelligent
  (recommandé)

## Pré-requis administratifs (à anticiper)

| Item | Statut | Coût | Délai |
|---|---|---|---|
| Apple Developer Account (individu) | À créer | **99 USD/an** | 24-48h validation |
| Google Play Console | À créer | **25 USD one-time** | ~24h validation |
| Compte Firebase (FCM) | À créer | Gratuit | ~10 min |
| Compte Expo (EAS) | À créer | Gratuit (Free tier suffit V1) | ~5 min |
| Compte Sentry | À créer | Gratuit jusqu'à 5k events/mois | ~10 min |
| Bundle ID `cc.captiv.desk` | À réserver | Gratuit | Inclus dans Apple Dev |
| Icône d'app + splash screen | À designer | Variable (~200-500€ chez designer) | Quelques jours |
| Privacy Policy URL publique | À écrire | Gratuit | ~30 min (template) |
| CGU (optionnel V1) | À écrire | Gratuit | ~1h |

**Ces 9 items doivent être validés AVANT le 1er build natif.**

## Coûts financiers (hors développement)

### Année 1

| Poste | Coût | Notes |
|---|---|---|
| Apple Developer Program | 95€ | Obligatoire |
| Google Play Console | 24€ | One-time |
| Expo EAS Build | 0€ ou 215€ | Free tier suffit V1 (30 builds/mois throttlés). Production plan 19 USD/mois si besoin de builds rapides. |
| Push notifications | 0€ | Expo Push Service illimité gratuit |
| Hébergement Edge Functions | 0€ | Déjà inclus dans le plan Supabase actuel |
| Sentry crash reporting | 0€ | Free tier 5k events/mois |
| Icône / design pro (optionnel) | 0-500€ | Si tu prends un designer |
| **Total année 1 minimum** | **~119€** | Sans EAS Production, design DIY |
| **Total année 1 réaliste** | **~334€** | Avec EAS Production, sans designer |

### Année N+1 et suivantes

| Poste | Coût |
|---|---|
| Apple renouvellement | 95€/an |
| EAS Build (si Production plan) | 215€/an |
| **Total année N** | **95-310€/an** |

### Coûts cachés à connaître

- **Renouvellement Apple oublié** : si tu oublies les 95€ annuels, l'app
  disparaît du store dans les 30 jours. **Mets un rappel calendrier.**
- **DUNS Number** : si tu inscris en société, Apple peut demander un
  DUNS Number (gratuit, mais ~5 jours à obtenir via D&B France)
- **Certificats APNs** : gratuits, mais expirent 1 an, à renouveler
- **Bundle ID** : si tu abandonnes ton compte, le bundle `cc.captiv.desk`
  est libéré et un tiers peut le réclamer

## Délais de déploiement iOS (résumé)

| Étape | Délai | Notes |
|---|---|---|
| Validation compte Apple Developer | 24-48h (individu), 1-2 semaines (société) | |
| Configuration App ID + certificats + provisioning | ~1h | |
| Premier build EAS | 15-30 min | |
| Upload sur App Store Connect | ~10 min | |
| Dispo TestFlight **interne** (toi + 25 max) | **Immédiat après upload** | Zéro review |
| Beta App Review pour TestFlight **externe** | **24-48h** la 1re fois, quasi-instantané ensuite | Jusqu'à 10 000 testeurs |
| App Review pour App Store **public** | **24-48h** en moyenne en 2026 | 7 jours si problème |

**Total réaliste pour atteindre une app fonctionnelle sur l'iPhone des
cadreurs (TestFlight externe) : ~1 semaine** après le go technique, en
supposant compte Apple validé sans pépin.

## Validation Apple

Apple valide **les deux** : ton compte (1 fois) ET chaque build d'app.

- **TestFlight interne** (25 testeurs max liés à ton équipe) : **zéro
  review**. Tu testes immédiatement.
- **TestFlight externe** (jusqu'à 10 000) : **Beta App Review** légère.
  24-48h la 1re fois, quasi-instantané ensuite.
- **App Store public** : **App Review** stricte. 24-48h en général.

### Critères de review (à respecter)

- L'app ne crash pas au démarrage
- Pas de Lorem Ipsum ou placeholder content
- L'app fonctionne tel que décrit dans la description du store
- Pas de contenu interdit (sex, violence, copyright)
- Permissions justifiées (notifs push avec phrase claire)
- Pas de paiement parallèle à Apple (sauf B2B exceptions)
- Compte de test fourni à Apple pour qu'ils puissent review

### Top 3 motifs de rejet typiques (pour apps internes)

1. **Compte de test non fourni** : tu dois donner login/password dans
   App Store Connect, sinon rejet automatique
2. **Permission insuffisamment justifiée** : pour les push, écrire dans
   Info.plist quelque chose comme "Activez les notifications pour être
   averti·e en temps réel des changements de planning". Pas "We need
   notifications"
3. **Crash au démarrage** : ils testent sur un device, si ça crash → rejet.
   D'où Sentry + tests sur device réel avant soumission

Apps de gestion interne pour équipe : taux de rejet **~10% en 1re
soumission**. Faible.

## Architecture push notifications

### Composants

- **Côté mobile** : l'app demande la permission au bon moment, récupère
  un push token via Expo Notifications, l'envoie au backend
- **Côté BDD** : table `device_push_tokens` (user_id, platform, token,
  device_label, created_at, last_active_at) — 1 row par device par user
- **Côté serveur** : Edge Function `send-push` qui prend un user_id (ou
  array) + payload, lookup les tokens, appel à Expo Push API
- **Côté métier** : triggers à des moments clés appellent send-push

### Triggers métier prioritaires V1

1. **Créneau assigné** : "Tu es assigné à un nouveau créneau : SCÈNE
   GARANCE 22h-23h SAMEDI"
2. **Créneau modifié** : "Ton créneau de 22h sur Garance a été déplacé
   à 22h30"
3. **Créneau supprimé** : "Ton créneau de 22h sur Garance a été annulé"
4. **Message équipe** (V1.5) : "Pierre t'a envoyé un message sur ton créneau"

### Limites iOS à connaître

- L'utilisateur DOIT autoriser au 1er prompt. S'il refuse, **pas de 2e
  chance facile** (faut aller dans Réglages iOS). Le 1er prompt doit
  être déclenché au **bon moment** (après une action positive du user).
- Push silencieuses (background) limitées à ~3/heure
- Push token change si l'utilisateur réinstalle l'app → re-stockage à
  chaque login mobile
- Certificat APNs expire 1 an, à renouveler

### Deep linking depuis les notifs

Une notif push n'est utile que si le tap dessus ouvre l'app **au bon
endroit**. Si tap = écran d'accueil, c'est nul.

Configuration **Universal Links** iOS et **App Links** Android pour que
les payloads de notif puissent dire "ouvre l'écran `/creneaux/abc-123`"
et que ça fonctionne. ~1j de setup au début, à penser pour chaque type
de notif.

## Pièges et points cachés (à éviter)

### Privacy Manifest (depuis 2024)

Apple exige un Privacy Manifest dans ton app : tu déclares les types de
données collectées. Expo gère ça automatiquement pour les libs courantes
si tu déclares correctement. Vérification à faire avant soumission.

### Politique de confidentialité publique

**Obligatoire**, même pour TestFlight externe. URL hébergée publique
(ex: `captiv.cc/privacy`). ~30 lignes suffisent pour un usage interne.
À créer **avant** la 1re soumission.

### Mises à jour rapides via Expo Updates (OTA)

**Une fois l'app installée, tout changement de code natif nécessite un
nouveau build + soumission + review Apple (24-48h)**. C'est lent et
stressant pour un bug critique.

**Expo Updates** te permet de pousser des mises à jour **JS/JSX OTA**
sans passer par Apple Review (légal, autorisé par Apple). 80% de tes
correctifs (UI, logique, fix toast) peuvent partir en 5 min au lieu de
48h. **À setup dès le départ.**

### Comportement offline (crucial pour les cadreurs)

Les cadreurs sont en festival, réseau aléatoire. Si l'app affiche un
écran blanc dès qu'il n'y a plus de réseau, c'est mort. Prévoir V1 :

- Cache local des données critiques (créneaux du jour, livrables) via
  React Query + AsyncStorage
- Affichage des dernières données connues avec badge "Vu il y a 15 min,
  mode hors-ligne"
- (V2) Queue de mutations optimistes : actions hors-ligne synchronisées
  au retour réseau

~3-5j de boulot bien fait, mais c'est ce qui différencie une app "qui
marche en démo" d'une app "qui marche en festival".

### Crash reporting dès le J1

Sentry ou Firebase Crashlytics. Sans ça, quand un cadreur dit "l'app a
crashé", tu navigues à l'aveugle. 2h de setup, sauve des semaines de
debug.

### Versions iOS/Android supportées

Fixer dès le début. Pour 2026 :
- **iOS 15+** : couvre 96% des iPhone actifs
- **Android API 24+ (Android 7)** : couvre 95%+ des devices

À chaque mise à jour majeure d'iOS/Android (1x/an), tester et ajuster si
besoin.

### Auth Supabase mobile (vs web)

- **Tokens de session** stockés dans **SecureStore** (Keychain iOS /
  EncryptedSharedPrefs Android), pas dans AsyncStorage non chiffré
- Le SDK Supabase pour React Native gère ça, à condition de bien le
  configurer (`storage: AsyncStorage` à remplacer par SecureStore custom)
- **Magic links** par email chiants sur mobile (Universal Links à
  configurer pour le retour) — démarrer par **email/password classique**

### Logistique équipe Apple Developer

Si à terme quelqu'un d'autre doit pouvoir builder/déployer (devs,
freelances), tu n'as **pas besoin de partager ton compte Apple**. Tu
invites des membres dans ton équipe Apple Developer (jusqu'à 100 membres
gratuit) avec rôles précis : Admin / App Manager / Developer / Marketing.

### Renouvellement des certificats

- **Certificat APNs** (pour les push) expire **1 an** après création.
  Si oublié, les push s'arrêtent du jour au lendemain.
- **Certificat de signing** : aussi ~1 an, gestion via EAS Build aide
  à éviter ça.

Mettre rappels calendrier 30 jours avant chaque échéance.

## Découpe en phases

### Phase 0 — Pré-requis admin (~3-5 jours)

- Création compte Apple Developer (paiement + validation)
- Création compte Google Play
- Création compte Firebase + projet
- Création compte Expo + équipe
- Création compte Sentry
- Réservation bundle ID `cc.captiv.desk`
- Configuration App ID, certificats, provisioning profiles
- Hébergement Privacy Policy URL `captiv.cc/privacy`

→ Peut se faire **en parallèle** des phases 1-2

### Phase 1 — Maquettes & design (~5-7 jours)

- Maquettes des 6 écrans V1 (low-fi puis hi-fi)
- Validation interne (Hugo + équipe)
- Validation cadreurs si dispos (idéalement au moins 1-2 cadreurs
  testeurs)
- Design system mobile : palette, typo, spacing, composants de base
- Création icône d'app + splash screen

### Phase 2 — Migration monorepo (~3-4h)

Migration du repo `captiv-budget` actuel vers structure monorepo :

```
captiv-desk/
├── packages/web/
├── packages/mobile/ (vide)
├── packages/shared/
└── supabase/
```

À faire **en un seul commit** pour ne pas polluer l'historique. Zéro
régression web visée.

### Phase 3 — Setup mobile + auth (~3-5 jours)

- `npx create-expo-app packages/mobile`
- Config TypeScript, ESLint, Prettier
- Setup React Navigation (Stack + Tabs)
- Intégration Supabase JS SDK + SecureStore
- Écran Login fonctionnel
- 1er build EAS sur ton iPhone via TestFlight interne

### Phase 4 — Écrans V1 + push (~3-4 semaines)

- Écran Planning (le plus complexe, ~5j)
- Écran Détail créneau (~2j)
- Écran Livrables (~2j)
- Écran Notifications (~2j)
- Écran Profil & paramètres (~1j)
- Setup Expo Notifications + Expo Push Service
- Table `device_push_tokens` en BDD + RLS
- Edge Function `send-push`
- 3 triggers métier prioritaires (créneau assigné/modifié/supprimé)
- Deep linking depuis les notifs
- Crash reporting Sentry
- Cache offline lecture seule (React Query persist)

### Phase 5 — TestFlight externe + tests cadreurs (~3-5 jours)

- Soumission TestFlight externe (Beta App Review 24-48h)
- Envoi du lien d'invitation aux cadreurs (mail/SMS)
- Récolte des retours via le module Feedback / Idées (FBK-1)
- Polish UX selon retours

### Phase 6 — Polish + bug fix (durée variable)

Selon retours cadreurs, itérations rapides via Expo Updates (OTA, sans
review Apple).

**Total réaliste V1 jusqu'à TestFlight externe : 6-8 semaines** en
travail focused.

## Backlog V2 / V3

### V2 — Cadreur enrichi

- Upload photo / vidéo des cadreurs (rush, livrables in-progress)
- Check-in scène / pointage horaire (geo + heure)
- Mode hors-ligne complet avec queue de sync
- Chat équipe par projet
- Notifications de groupe (annonce admin → tous les cadreurs)

### V3 — App globale DESK (vision long terme)

L'app mobile couvre tous les modules DESK avec UX adaptée mobile :

- Module Musiques (consultation playlist, votes rapides)
- Module Moodboard (consultation refs, réactions)
- Module Livrables complet (édition statut, upload rendus)
- Module Devis (consultation pour clients)
- Module Plans (carte du lieu, géoloc)
- Dashboard projet
- Multi-projet avec switcher

### Polish technique à reprendre

- Tests E2E (Detox ou Maestro)
- CI/CD pour builds automatiques sur push main
- Versioning sémantique des builds
- Analytics (PostHog auto-hébergé ou Mixpanel)
- Dark mode automatique selon iOS

## Risques

### Bloqueur compte Apple

Si la validation Apple traîne (~2 semaines pour société), ça repousse
tout. **Action** : démarrer la phase 0 admin en parallèle des phases
1-2 (maquettes + migration monorepo).

### Premier rejet App Review

Probabilité ~10%. Impact : +24-48h supplémentaires. **Action** :
respecter les guidelines, fournir compte de test, écrire les
justifications de permissions clairement.

### Performance écran Planning

Le planning timeline est l'écran central, avec potentiellement beaucoup
de créneaux. Si mal codé, ça peut ramer. **Action** : FlashList +
mesurer en condition réelle (50-100 créneaux sur 1 jour) avant
soumission.

### Push notifications fiabilité

iOS et Android peuvent retarder ou supprimer des push si l'appareil est
en économie d'énergie. **Action** : combiner push + polling Realtime
quand l'app est ouverte. Importance critique des push (créneau modifié)
doivent être bien typées (high priority).

### Coût Apple à terme

Si Captiv prend de l'ampleur, on passera peut-être en compte société.
Migration possible mais lourde. **Action** : commencer en individu pour
V1, migrer plus tard si volume justifie.

### Désynchronisation web ↔ mobile

Risque de "côté web ça marche, côté mobile pas". **Action** : monorepo
+ `packages/shared` pour les types et constantes critiques. Tests
manuels cross-platform pour les features partagées.

## Liens utiles

- **Expo docs** : https://docs.expo.dev/
- **React Navigation** : https://reactnavigation.org/
- **React Native Reanimated** : https://docs.swmansion.com/react-native-reanimated/
- **Expo Push Notifications** : https://docs.expo.dev/push-notifications/overview/
- **Supabase React Native guide** : https://supabase.com/docs/guides/auth/quickstarts/react-native
- **Apple Developer Program** : https://developer.apple.com/programs/
- **Google Play Console** : https://play.google.com/console
- **App Store Connect** : https://appstoreconnect.apple.com/
- **EAS Build** : https://docs.expo.dev/build/introduction/
- **Sentry React Native** : https://docs.sentry.io/platforms/react-native/
- **FlashList (Shopify)** : https://shopify.github.io/flash-list/

## Décisions à finaliser (avant code)

- [ ] Validation des maquettes des 6 écrans V1 par Hugo
- [ ] Validation par 1-2 cadreurs si possible
- [ ] Choix outil monorepo (pnpm + Turborepo recommandé)
- [ ] Création des comptes admin (Apple, Google, Firebase, Expo, Sentry)
- [ ] Rédaction Privacy Policy URL
- [ ] Choix icône + couleurs de la marque mobile

---

## 📌 État au 10/06/2026 02h00 — Nuit de dev autonome

Phases 1-4 codées en autonomie pendant la nuit (sandbox sans accès npm, donc
code écrit sans validation runtime — Hugo valide au matin via `npm install`).

### ✅ Phase 1 — Migration monorepo (done)
- Repo restructuré en npm workspaces (`packages/web` + `packages/shared` + `packages/mobile`)
- Pivot annoncé pnpm → **npm workspaces** (pragmatique, zéro install pour Hugo)
- Turborepo configuré (`turbo.json`)
- Vercel mis à jour (build/output packages/web/)
- Web rebranché sur `@captiv/shared/supabase` (factory commune)
- Doc complète : `docs/MIGRATION_MONOREPO.md`

### ✅ Phase 2 — Bootstrap Expo + Auth + Nav (done)
- `packages/mobile/` initialisé (Expo SDK 51, bundle id `cc.captiv.desk`)
- Metro config monorepo aware (watch packages/*)
- AuthProvider Supabase + SecureStore adapter
- React Navigation v6 (Auth Stack + Main Tabs Liquid Glass)

### ✅ Phase 3 — Écrans cœur (done)
- 6 écrans codés : Login / Planning (Mes+Timeline) / Détail créneau /
  Livrables / Notifications / Profil
- 9 composants atomiques : GlassCard, BottomSheet, StatusPill, Button,
  Input, Toggle, SegmentedControl, Avatar, IconButton
- TimelineView multi-lanes + ligne NOW rouge
- CreneauDetailSheet bottom sheet 82% + dropdown statuts
- Profil bottom sheet picker rappels (5/15/30/45/60/120 min, défaut 15)
- Fixtures complètes (MARSATAC 2026 + créneaux + livrables + notifs)

### ✅ Phase 4 — Push notifs stack (dry-run)
- Migration SQL : `push_tokens`, `user_settings`, `notifications` + RLS
- Edge function `send-push` (Deno + Expo Push Service)
- Hook `usePushNotifications` (register + handlers)
- Hook `useUserSettings` (CRUD préférences)
- Hook `useNotifications` (liste + Realtime)
- Trigger Postgres auto-notify : reporté en V2 (send-push appelable manuellement
  depuis le web admin pour V1)

### ✅ Phase 5 — Documentation
- `docs/REPRISE_MATIN.md` : setup mobile pas-à-pas (10 min npm install +
  expo install + start), validation visuelle écran par écran, APNs key
  (10 min sur dev portal Apple), wire push manager dans App.js,
  debug guide, TODOs ouverts à valider

### 📋 Reste à faire (au matin par Hugo, ~30-60 min)
1. `npm install` au root (valide structure monorepo)
2. `cd packages/mobile && npx expo install --fix` (installe deps Expo)
3. Copier `.env` mobile (cf packages/web/.env)
4. `expo start` → scanner QR code sur iPhone via Expo Go
5. Validation visuelle des 6 écrans
6. Créer 4 PNG assets (icon, splash, adaptive-icon, notification-icon)
7. APNs key Apple Developer + upload sur Expo (`eas credentials`)
8. Wire `usePushNotifications` dans App.js (5 min, voir REPRISE_MATIN section D)
9. `supabase functions deploy send-push`
10. Test push réelle sur device → 🎉

### Commits réalisés sur `feature/mobile-app`
1. `chore(monorepo)` — Migration npm workspaces : packages/web + packages/shared
2. `feat(mobile)` — CAD Phase 2+3 : Expo bootstrap + 6 écrans Liquid Glass complets
3. `feat(push)` — CAD Phase 4 : stack push notifs dry-run + docs reprise
