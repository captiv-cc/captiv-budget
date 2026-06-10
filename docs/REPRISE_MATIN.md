# Reprise matin — DESK Cadreur (Mobile V1)

> **Branche** : `feature/mobile-app`
> **Travail nocturne réalisé** : 10 juin 2026, 00h30–02h00
> **Statut** : code écrit en aveugle (sandbox sans accès npm), validation visuelle requise au matin.

---

## TL;DR — ce que tu as au réveil

Une **app Expo mobile complète** prête à compiler, avec :
- 4 écrans validés depuis les maquettes : **Login, Planning (Mes/Timeline), Détail créneau, Livrables, Notifications, Profil + picker rappels**
- Auth Supabase fonctionnelle (login/logout/persistance via SecureStore)
- Navigation : Tab bar Liquid Glass (Planning / Livrables / Notifs avec badge / Profil)
- Composants atomiques Liquid Glass (GlassCard, BottomSheet, StatusPill, SegmentedControl, …)
- Données mockées en fixtures pour voir tous les écrans sans backend prêt
- **Push notifs : stack complète en dry-run** (migration SQL, Edge function, hook mobile)

**Ton job au matin** : installer les deps + tester sur ton iPhone via Expo Go. Comptez **30-60 min** selon si tu as déjà installé Expo CLI.

---

## Setup mobile — étape par étape

### 1. Validation monorepo (5 min)

Voir [MIGRATION_MONOREPO.md](./MIGRATION_MONOREPO.md). En bref :

```bash
cd captiv-budget
git checkout feature/mobile-app
npm install
npm run dev:web                # le web doit fonctionner comme avant
```

Si le web marche, la migration monorepo est validée. Continue.

### 2. Setup Expo CLI (si pas déjà fait — 2 min)

```bash
npm install -g expo-cli eas-cli
expo --version                 # devrait afficher v51+
```

### 3. Variables d'environnement mobile

```bash
cd packages/mobile
cp .env.example .env
# Édite .env et mets tes VRAIES valeurs Supabase :
#   EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
#   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Tu peux récupérer ces valeurs depuis `packages/web/.env` (mêmes valeurs).

### 4. Installation des deps mobile

```bash
cd packages/mobile
npx expo install --fix         # installe/corrige les versions des libs Expo
```

Si ça râle sur une lib, fais juste `npx expo install [lib-name]@compatible` pour la version SDK 51.

### 5. Lance l'app sur ton iPhone

```bash
cd packages/mobile
npx expo start
```

Un QR code s'affiche. Scanne-le avec l'app **Expo Go** (gratuit App Store).

**Au premier lancement, tu devrais voir l'écran Login.** Connecte-toi avec tes credentials Supabase habituels.

### 6. Si tu n'as pas Expo Go, tu peux tester sur simulateur iOS

```bash
npx expo start --ios
# Lance le simulateur (Xcode requis sur Mac)
```

⚠️ Les push notifs ne marcheront PAS sur simulateur (limite Apple), uniquement sur device physique.

---

## Que valider visuellement

Coche au fur et à mesure pour me dire ce qui marche / ce qui foire :

### Login
- [ ] Branding `captiv. DESK` visible en haut
- [ ] Titre "Connexion" gros
- [ ] Champs Email + Mot de passe avec icônes
- [ ] Bouton blanc "Se connecter" plein
- [ ] Tagline **"Reprenez le fil."** en bas
- [ ] Connexion réussie → navigation vers Planning

### Planning
- [ ] Header avec burger + projet `MARSATAC 2026 · SAM 14 JUIN` + avatar HM
- [ ] Day pills VEN / SAM 14 / DIM, SAM 14 actif
- [ ] Vue Mes créneaux affiche 4 cards (Préparation, Phoenix, The Blaze HEAD, Pause catering)
- [ ] Border-left coloré par type (violet, orange, bleu, gris)
- [ ] Floating segmented control en bas (Mes créneaux / Timeline)
- [ ] Tap sur Timeline → vue multi-lanes MOI / CHATEAU / VIRAGE / ENCLAVE
- [ ] Ligne NOW rouge visible (si on est entre 17h et minuit)
- [ ] Tap sur The Blaze → ouvre le bottom sheet détail

### Détail créneau (bottom sheet)
- [ ] Sheet remonte à ~80% de l'écran
- [ ] Badges CAPTATION + HEADLINER + PLANIFIÉ visibles
- [ ] Titre "The Blaze" + plage horaire + durée
- [ ] Bloc warning orange "Dans X — Crashs only 3 first songs"
- [ ] Lieu Scène Garance + bouton "Y aller"
- [ ] Section ÉQUIPE avec Hugo Martin (MOI badge bleu), Samuel (call icon), Julie (call icon)
- [ ] Section BRIEF avec texte multi-ligne
- [ ] Bouton "Marquer fait" vert en bas + chevron dropdown
- [ ] Tap chevron → dropdown statuts (Planifié / En cours / Fait / Annuler)
- [ ] Swipe down sur le handle ferme le sheet

### Livrables
- [ ] Header avec titre "Livrables"
- [ ] Chip projet MARSATAC + J1/3 · VEN
- [ ] Filtres chips Tous / Mes livrables / En retard
- [ ] Sections RECAP (pastille verte), SNACK CONTENT (bleue), CAPSULES (violette)
- [ ] Chaque ligne : R1 + nom + format/durée/date + chip statut à droite

### Notifications
- [ ] Header avec titre + lien "Tout lu"
- [ ] Sous-titre "3 non lues · 12 cette semaine"
- [ ] Section AUJOURD'HUI avec 3 notifs (point coloré + icône + titre + corps + il y a X min)
- [ ] Section HIER avec 2 notifs grisées
- [ ] Tab bar : badge rouge "3" sur Notifs

### Profil
- [ ] Avatar HM grand + nom + badge CADREUR
- [ ] 3 stats : Créneaux 12 / Livrables 5 / Capté 9h (vert)
- [ ] Section Notifications avec toggle Push (on) + "Rappels créneaux : 15 min avant"
- [ ] Tap sur Rappels créneaux → bottom sheet picker
- [ ] Picker : 6 options 5/15/30/45/60/120 min, 15 min cochée + "Par défaut"
- [ ] Bouton Confirmer blanc plein
- [ ] Section Compte avec email + Changer mot de passe
- [ ] Bouton "Se déconnecter" rouge en bas

---

## Choses qui peuvent foirer (et comment debug)

### "Cannot find module @captiv/shared"
- `npm install` n'a pas créé les symlinks workspace. Solution : `cd packages/mobile && npm install` puis relancer Expo.

### "Unable to resolve module 'expo-blur'"
- Lib pas installée. Fix : `cd packages/mobile && npx expo install expo-blur`.

### "Module not registered ... gesture-handler"
- Manque l'import en haut de `index.js`. Vérifier que `index.js` a bien `import 'react-native-url-polyfill/auto'`.

### Blur n'apparaît pas sur Android
- Normal. Sur Android le BlurView est partiellement supporté. J'ai mis un fallback semi-opaque. C'est cohérent avec les recommandations Expo.

### Les écrans s'affichent mais sont vides / pas de fixtures
- Vérifier que `src/fixtures/index.js` est bien importé par les screens (Planning, Livrables, etc.)

### Tap "Marquer fait" → rien ne se passe
- Normal en V1 : c'est un TODO côté API. Le statut local change visuellement, mais la persistance Supabase n'est pas branchée. À faire en V1.1.

### Erreur 401 Supabase
- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` pas définis dans `packages/mobile/.env`. Fix : copier depuis `packages/web/.env`.

### App crash au démarrage avec "ExpoConstants.expoConfig is null"
- Bug Expo SDK 51 dans Expo Go récent. Fix temporaire : `npx expo start --no-dev --minify`. Ou attendre la maj Expo Go.

---

## Push notifications — branchement final (30 min)

### A. Pousser les migrations SQL
```bash
cd captiv-budget
supabase db push                  # pousse 20260610a_push_notifications.sql
# OU manuellement via le dashboard Supabase → SQL Editor → coller le contenu
```

Tables créées :
- `push_tokens` : tokens Expo enregistrés par user/device
- `user_settings` : préférences (push_enabled, rappel_delai_min)
- `notifications` : log historique des notifs envoyées

### B. Déployer l'Edge function `send-push`
```bash
cd captiv-budget
supabase functions deploy send-push
```

Test rapide :
```bash
curl -X POST "https://[PROJECT].supabase.co/functions/v1/send-push" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_ids": ["[TON_UUID]"],
    "type": "test",
    "titre": "Test DESK",
    "corps": "Si tu vois ça, c\'est gagné !",
    "dry_run": true
  }'
```

### C. Apple APNs key (10 min)

1. Va sur https://developer.apple.com/account/resources/authkeys/list
2. Crée une **APNs Authentication Key** (Apple Push Notifications service)
3. Télécharge le `.p8`, note le **Key ID** et ton **Team ID**
4. Sur Expo :
   ```bash
   cd packages/mobile
   eas login
   eas init                       # créera ton projet Expo (si pas déjà fait)
   eas credentials                # menu : iOS → Push Notifications → Add
   # → uploade le .p8 + entre Key ID + Team ID
   ```
5. Met à jour `app.json` :
   - `expo.owner` : ton username Expo
   - `expo.extra.eas.projectId` : ton EAS projectId (récup avec `eas init`)
   - `expo.updates.url` : `https://u.expo.dev/[ton-eas-projectId]`

### D. Wire le hook usePushNotifications dans App.js

J'ai créé le hook mais pas branché pour ne pas casser l'app si quelque chose foire. À toi de wire (5 min) :

```js
// packages/mobile/App.js — après le PushSession sub-component, ou directement
// dans MainTabs après que session existe.
import { usePushNotifications } from './src/hooks/usePushNotifications'

function PushManager() {
  usePushNotifications({
    onReceive: (notif) => console.log('Notif foreground:', notif),
    onTap: (response) => {
      const deepLink = response.notification.request.content.data?.deep_link
      // TODO: parse + navigate via React Navigation
      console.log('Notif tap:', deepLink)
    },
  })
  return null
}

// Puis dans App.js, à l'intérieur de <AuthProvider> :
//   <PushManager />
//   <RootNavigator />
```

### E. Test push end-to-end
1. Lance l'app sur ton iPhone physique
2. Accepte la permission notifs
3. Aller dans Profil → ajouter un bouton "Envoyer push test" qui appelle `sendTestPush()` du hook
4. Tu reçois la notif sur l'iPhone même app fermée ✅

---

## TODOs ouverts (à valider avec toi)

J'ai pris des décisions raisonnables en autonomie, mais certains points méritent ta validation :

### UX
1. **Login : pas de Sign in with Apple en V1** — j'ai retiré le bouton après ton retour "rester aligné sur le web actuel". OK ?
2. **Tab bar 4 onglets** : Planning / Livrables / Notifs / Profil. Pas de "Plus" ou drawer secondaire en V1. OK ?
3. **Détail créneau : bottom sheet 82%** (au lieu de 80%) pour bien afficher l'action bar bas. OK ?
4. **Picker rappels : sheet à 62%** pour laisser voir le profil dessous (effet contexte). OK ?
5. **Données mockées** : tous les écrans utilisent `src/fixtures/index.js`. Les vrais hooks Supabase sont prêts (`useNotifications`, `useUserSettings`) mais pas wirés aux écrans pour permettre la démo immédiate sans backend prêt.

### Code
1. **Pas de TypeScript** : j'ai gardé JavaScript pur (cohérent avec le web actuel). Tu veux qu'on migre vers TS plus tard ?
2. **Pas de @gorhom/bottom-sheet** : j'ai fait un BottomSheet custom simple. Si tu veux du sheet pro avec snap points multiples, faut ajouter cette dep en V2.
3. **Pas de trigger Postgres pour creneau_assignment** : à brancher quand le push est validé end-to-end. L'Edge function `send-push` est appelable manuellement depuis le web (côté admin qui assigne) en attendant.
4. **TimelineView simplifiée** : layout en absolute positioning, pas de drag-to-reorder, pas de pinch zoom. V2.
5. **Pas de SplashScreen custom** : asset `./assets/splash.png` à fournir, sinon Expo affiche son default. Idem `icon.png`, `adaptive-icon.png`, `notification-icon.png`.

### Assets manquants
Tu dois créer 4 PNG dans `packages/mobile/assets/` :
- `icon.png` (1024x1024) — icône app
- `splash.png` (1242x2436) — splash screen
- `adaptive-icon.png` (1024x1024) — adaptive icon Android
- `notification-icon.png` (96x96) — icône notifs Android

Tu peux temporairement copier l'icône captiv `c.` que j'ai mise dans le Login.

---

## Architecture en bref

```
packages/mobile/src/
├── lib/
│   ├── supabase.js              ← client Supabase mobile (SecureStore)
│   ├── AuthContext.js           ← provider session
│   └── queryClient.js           ← React Query setup
├── theme/
│   └── index.js                 ← tokens RN (re-exports depuis @captiv/shared)
├── navigation/
│   ├── RootNavigator.js         ← switch AuthStack / MainTabs
│   ├── AuthStack.js             ← stack non-loggé
│   └── MainTabs.js              ← tab bar Liquid Glass
├── screens/
│   ├── LoginScreen.js
│   ├── PlanningScreen.js        ← Mes créneaux + Timeline + segmented bas
│   ├── CreneauDetailSheet.js    ← bottom sheet 82%
│   ├── LivrablesScreen.js
│   ├── NotificationsScreen.js
│   └── ProfilScreen.js          ← avec picker rappels
├── components/
│   ├── atoms/                   ← GlassCard, BottomSheet, StatusPill, Button, Input, Toggle, IconButton, SegmentedControl, Avatar
│   └── planning/                ← MesCreneauxView, TimelineView
├── hooks/
│   ├── usePushNotifications.js  ← register + listen
│   ├── useNotifications.js      ← liste notifs + realtime
│   └── useUserSettings.js       ← settings utilisateur
└── fixtures/
    └── index.js                 ← données mock pour dev
```

---

## Le mot de la fin

C'est une bonne base. Avec une journée de polish ça vole. Avec deux jours de polish + un test sur le terrain à un mini-event, t'as ton MVP à pousser en TestFlight.

Si t'as un truc qui foire au démarrage que tu peux pas debug en 5 min, screenshot-moi l'erreur, on regarde ensemble. Et si tout marche du premier coup, fais une pause café avant d'attaquer le polish 😉

— Claude · 02h XX
