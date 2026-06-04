# CHANTIER MOBILE — PWA + Push notifications

> **État** : Anticipation. Pas commencé. Document de référence pour
> garantir que tous les futurs chantiers (et les chantiers actuels)
> respectent les règles "mobile-ready" — pour que quand on lancera le
> chantier PWA, ce soit ~5-7 jours de boulot et pas une refonte
> majeure.
>
> **À RELIRE avant tout chantier UI/UX** pour pas dériver.

## Vision

DESK by Captiv doit pouvoir devenir une **app mobile installable** avec
**notifications push** sans réécrire le code. Cibles d'usage :

- Cadreurs en festival qui consultent leur planning sur leur téléphone
  pendant qu'ils marchent sur le site
- Notifications push "Babylon Circus dans 30 min sur Découverte"
- Annonces broadcast régie en temps réel
- Validation présence, modifications de planning, rappels golden hour

Stack actuelle React + Vite + Tailwind + Supabase = **idéale pour PWA
puis éventuellement Capacitor**. Aucun lock-in technique, aucune
réécriture nécessaire.

## Stratégie à 2 paliers

### Palier 1 — PWA (Progressive Web App)

**Coût récurrent** : zéro
**Effort de dev** : 5-7 jours quand on lancera le chantier
**Cible** : majorité des SaaS B2B, suffit largement pour Captiv en V1

Ce qu'on rajoute à l'app web existante :
- `manifest.json` (nom, icônes, couleurs, mode standalone)
- Service Worker (cache + handler push)
- VAPID keys (Web Push standard)
- Table `user_push_subscriptions`
- Edge Function `send_push_to_user`
- UI prompt "Installer DESK sur ton téléphone"

Le cadreur ouvre `desk.captiv.cc` dans Safari ou Chrome → installation
en 2 clics depuis le partage → icône sur écran d'accueil → app
plein écran sans barre de browser.

Push notifications iOS supportées depuis **iOS 16.4 (mars 2023)** à
condition d'avoir installé la PWA sur l'écran d'accueil.

### Palier 2 — Capacitor wrap (si justifié)

**Coût récurrent** : 99$/an Apple Developer + 25$ one-time Google Play
**Effort de dev** : 15-20 jours quand on lancera ce chantier (en
partant de la PWA)
**Cible** : si la PWA prend bien et qu'on veut le boost App Store +
notifications push 100% natives + accès aux API natives

On wrappe la PWA dans une coquille Capacitor. Le code reste celui de la
PWA. On gagne :
- Présence App Store + Play Store
- Push notifications natives FCM/APNs (plus fiables iOS)
- Splash screen + icône natifs
- Live updates via Capacitor Live Update (pas besoin de re-soumettre
  Apple/Google pour chaque release)

Pas pressé. On verra dans 6-12 mois si la PWA suffit ou non.

### Palier 3 — React Native from scratch

**À NE JAMAIS FAIRE** dans le contexte Captiv. Pas de gain perçu,
énorme coût d'opportunité.

## Règles à respecter dès MAINTENANT

> **Ces règles s'appliquent à TOUS les chantiers en cours et à venir.**
> Si on les respecte, le chantier PWA sera ~5-7 jours. Si on ne les
> respecte pas, on aura ~3-4 semaines de dette à rattraper le jour où
> on bascule.

### UI / UX

**OBLIGATOIRE** :

- [ ] **Tap targets ≥ 44×44px** sur mobile pour tous les éléments
      cliquables (boutons, icônes, liens, chips). 44px est la
      recommandation Apple, c'est le minimum confortable au doigt.
- [ ] **Pas de comportement hover-only** : toute action accessible au
      hover (tooltip, popover, menu contextuel) doit être atteignable
      au tap. Si tooltip = info importante, prévoir une icône `ti-info`
      cliquable à côté. Si dropdown au hover, le rendre cliquable
      aussi.
- [ ] **Safe-area-inset** : sur les barres flottantes (modales, footers
      d'action, sticky headers), respecter le notch / Dynamic Island
      iPhone via :
      ```css
      padding-top: max(1rem, env(safe-area-inset-top));
      padding-bottom: max(1rem, env(safe-area-inset-bottom));
      ```
- [ ] **Tailles de police** : minimum 12px sur mobile, idéalement 14px+
      pour le texte courant. Pas de 10-11px sur mobile sauf labels
      vraiment secondaires.
- [ ] **Pas de scroll horizontal involontaire** : tester chaque écran
      en 320px (iPhone SE) et 380px (iPhone standard). Pas de table
      forcée qui dépasse, pas de bloc fixe trop large.
- [ ] **Modales et drawers** : largeur max 100% sur mobile, hauteur
      max 80vh (pour laisser respirer). Tap outside = ferme.
- [ ] **Bouton retour navigateur** : doit fonctionner naturellement. Si
      l'app ouvre un drawer/modal, le bouton retour le ferme avant de
      changer de page. Penser à pousser l'état dans l'URL (`?creneau=X`).

**RECOMMANDÉ** :

- Mode portrait par défaut, paysage optionnel. La majorité des cadreurs
  consultent en portrait.
- Police par défaut système (`-apple-system, BlinkMacSystemFont`) pour
  une intégration native une fois en PWA.
- Animations courtes (≤ 300ms) — sur mobile les transitions longues
  donnent l'impression de lag.
- Penser **gestes** : swipe pour fermer les modales, pull-to-refresh
  sur les listes (à coder explicitement).

### Auth / Sessions

- [ ] **Supabase Auth sessions persistantes** activées (déjà le cas) —
      garantit que l'utilisateur n'a pas à se reconnecter à chaque
      ouverture de l'app.
- [ ] **Pas de logique d'auth via cookies tiers** — uniquement Supabase
      Auth standard (JWT en localStorage géré par lib).
- [ ] **Refresh token automatique** — bibliothèque Supabase JS le fait
      déjà, vérifier qu'on n'a pas désactivé.

### Data / Network

- [ ] **Pas de localStorage CRITIQUE** pour des données métier (ex:
      "compteur de likes" stocké uniquement localStorage). Tout ce qui
      compte doit aller en Supabase. localStorage = préférences UI
      seulement (theme, view selected, etc.).
- [ ] **Offline-friendly gracieux** : si pas de réseau, afficher un
      message clair ("Reconnectez-vous pour rafraîchir") plutôt qu'un
      écran blanc. Pas obligé d'implémenter offline complet maintenant
      — juste ne pas casser.
- [ ] **Loading states partout** : skeleton ou spinner, jamais d'écran
      blanc qui flash. Sur mobile la latence est plus longue, les
      transitions doivent être visibles.
- [ ] **Compression images Supabase Storage** : pour les uploads cadreurs
      depuis téléphone, prévoir un re-encode côté client (canvas) avant
      upload pour ne pas faire monter des HEIC de 8 Mo. Existe déjà
      partiellement (MAT-11).

### Code / Build

- [ ] **Imports ESM seulement** : Vite gère, mais ne pas ajouter de
      `require()` à la louche. Toute lib en `import { x } from 'y'`.
- [ ] **CSP-friendly** : pas de scripts externes non bundlés. Si tu
      veux une lib, elle doit être en `package.json`, pas en
      `<script src="https://cdn..."`. Service Worker PWA aura une
      CSP stricte.
- [ ] **Routes React Router avec deep linking** : `/projets/:id/equipe`
      doit être ouvrable directement (pas seulement depuis la home).
      Déjà le cas, à ne pas casser.
- [ ] **Pas de `position: fixed` mal géré sur petit écran** : tester
      que les modales/popovers fixes restent dans le viewport, ne
      sortent pas en bas.

### Permissions / Notifications (préparation)

- [ ] **Garder en tête qu'on aura besoin du `user_id`** sur toutes les
      actions notifiables. Si tu crées un nouveau type d'entité (créneau,
      assignation, etc.) qui pourrait déclencher une notif → tu as un
      lien vers le user qui doit être notifié.
- [ ] **Préparer dès maintenant la nomenclature des events push** :
      `mission.created`, `mission.updated`, `mission.starting_soon`,
      `planning.published`, `broadcast.announce`, etc. À standardiser
      quand on lancera.

## Architecture cible PWA (récap)

### Côté code

```
public/
  manifest.json         ← nouveau
  service-worker.js     ← nouveau (cache + push handler)
  icons/
    icon-192.png        ← favicon mobile
    icon-512.png
    icon-maskable-512.png
    apple-touch-icon-180.png
    splash-*.png        ← optionnel mais propre

src/
  lib/
    pwa.js              ← register SW, prompt install
    pushNotifications.js ← subscribe VAPID, send token au serveur
  hooks/
    usePushPermission.js
    useInstallPrompt.js

index.html              ← link rel="manifest", apple-touch-icon, etc.
```

### Côté Supabase

```sql
-- Table à créer en lancement du chantier
CREATE TABLE user_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  -- VAPID Web Push : objet { p256dh, auth }
  -- FCM (Android Capacitor) : { fcm_token }
  -- APNs (iOS Capacitor) : { apns_token }
  keys jsonb NOT NULL,
  platform text NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
  device_label text,  -- "iPhone Hugo", debug + révoque manuelle
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

-- RLS : l'utilisateur ne voit que ses propres subscriptions
ALTER TABLE user_push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_subs" ON user_push_subscriptions
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

### Edge Function `send_push_to_user`

```typescript
// supabase/functions/send_push_to_user/index.ts
// Reçoit { user_id, payload: { title, body, url, ... } }
// Récupère toutes les subscriptions du user (admin bypass RLS)
// Pour chaque subscription :
//   - platform='web' → lib web-push (VAPID)
//   - platform='ios' → APNs (Apple key)
//   - platform='android' → FCM (server key)
// Si endpoint retourne 410/404 → DELETE la subscription
```

### Triggers / cron pour mission "starting soon"

Soit :
- **Trigger Postgres** au moment de la création d'un créneau, qui
  programme une notif via `pg_cron` (si extension dispo)
- **Cron Supabase** (Edge Function schedulée toutes les 5 min) qui
  scanne `projet_deroule_creneaux` pour les créneaux à T-30min et
  déclenche les notifs

Le 2e est plus simple et fiable.

## Anticipation business

Avant de lancer un palier 2 (Capacitor), prévoir :

- **Apple Developer Account** : 99$/an
- **Google Play Developer** : 25$ one-time
- **Branding mobile** :
  - Icône 1024×1024px (puis dérivés 192, 512, maskable, apple-touch)
  - Splash screen
  - Screenshots App Store (iPhone 6.7" / 5.5", iPad 12.9", etc.)
  - Description courte + longue
  - Mots-clés
  - Mentions légales (URL privacy policy, terms)
- **Bundle ID** : `cc.captiv.desk` (à réserver tôt sur Apple Connect)
- **Stratégie de support** : compte email contact, prévoir un canal
  pour les retours utilisateurs depuis les stores

Tout ça peut attendre — c'est uniquement quand on lance palier 2.

## Roadmap par phases

### Phase 0 — Maintenant (en cours, à respecter dans chaque chantier)

Toutes les règles "à respecter dès maintenant" ci-dessus.

### Phase 1 — PWA basique (5-7 jours)

1. `manifest.json` + icônes
2. Service Worker minimal (cache HTML/CSS/JS, pas de cache data)
3. Prompt "Installer DESK" qui apparaît au 2e visit
4. Migration SQL `user_push_subscriptions`
5. Edge Function `send_push_to_user` + lib `web-push`
6. UI "Activer les notifications" dans le profil utilisateur
7. Test sur iOS 16.4+ (Safari install + push) et Android Chrome
8. Documentation utilisateur (How-to installer)

### Phase 2 — Notifications métier (3-5 jours)

1. Notif "Mission dans 30 min" via cron Edge Function (scan créneaux,
   trigger push)
2. Notif "Ton planning a changé" (trigger Postgres sur update créneau)
3. Notif "Annonce broadcast régie" via UI admin
4. Préférences utilisateur (couper certaines catégories de notifs)
5. Anti-doublons : si déjà notifié dans la dernière heure, skip

### Phase 3 — Polish PWA (2-3 jours)

1. Pull-to-refresh sur les listes
2. Gestes swipe sur cards (où pertinent)
3. Mode offline cache des écrans visités
4. Optimisation perf (bundle size, lazy loading)
5. Stats d'usage (combien d'installs, combien de notifs envoyées)

### Phase 4 — (optionnel, si justifié) Capacitor wrap

1. Setup Capacitor sur le projet Vite (≤ 1 jour)
2. iOS : provisioning profile, push notif APNs, build Xcode
3. Android : keystore, FCM, build APK
4. Branding mobile complet
5. Soumission App Store + Play Store (2-7 jours d'attente review)
6. Test beta interne (TestFlight + Internal Track Google)
7. Release publique

## Liens avec les autres chantiers

Ces règles affectent **tous les chantiers en cours et à venir**. Ils
doivent intégrer la conformité PWA dès la conception :

- `CHANTIER_DEROULE.md` — Vue cadreur mobile-first
- `CHANTIER_DEROULE_FESTIVAL.md` — Vue cadreur mobile crucial,
  notif push prévues
- `CHANTIER_LOGISTIQUE.md` — Documents accessibles mobile
- `CHANTIER_EQUIPE_BACKLOG.md` — Tap targets, drawer responsive
- `ROADMAP.md` — Mentionner PWA comme jalon V2

**Convention** : quand on commence un nouveau chantier, ajouter dans
sa section "État actuel" une ligne :
> ✓ Conforme `CHANTIER_MOBILE_PWA.md` — toutes les règles respectées

Si une dérogation est nécessaire (rare), la documenter dans le chantier
concerné avec justification.

## Questions ouvertes

- **Choix du fournisseur push** : Web Push natif (gratuit, marche) ou
  OneSignal (gratuit < 10k users, plus simple à brancher) ? À trancher
  au lancement Phase 1.
- **Stratégie d'install prompt** : auto au 2e visit ? Bouton manuel
  dans le profil ? Banner contextuel sur une page particulière ?
  À tester en UX.
- **Notif preference granulaire** : par catégorie (planning,
  broadcasts, rappels) ou simple on/off global ? À voir avec retours
  utilisateurs.

## Historique

- **2026-05-13** : doc d'anticipation créé suite à discussion Hugo
  sur la possibilité d'une app mobile. Règles "à respecter dès
  maintenant" formalisées pour ne pas accumuler de dette UX mobile.
