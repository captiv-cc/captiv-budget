# CHANTIER CONDUITE / DÉROULÉ JOUR

> **État** : Roadmap notée — démarrage prévu après LOGISTIQUE V1 (ou avant
> selon priorité Hugo). Document vivant, à mettre à jour au fil des vagues.

## TL;DR

Tab dédiée pour gérer le **déroulé temporel d'une journée de tournage** :
qui fait quoi, à quelle heure, sur quelle équipe, à quel endroit. Multi-lane
(jusqu'à 5 équipes parallèles), granularité 5 min stockée / 15 min affichée,
import des présences techlist en 1 clic, partage public via lien, futur
agrégateur des call sheets.

## Nommage

**Décision à prendre avant V1** :
- `conduite` (terme broadcast pro français — précis mais ambigu hors contexte)
- **`déroulé`** *(reco)* — neutre, accessible tous métiers (pub, fiction, live, corporate)
- `rundown` — anglo niche, friction lecture FR
- `feuille de service` — fiction uniquement

Le code utilisera `conduite` (vocab métier) ou `derouleÉ` selon décision.
La tab UI utilisera la décision finale Hugo. Ce doc utilise "conduite" par
défaut, à remplacer.

## Pourquoi une tab dédiée

La techlist gère "qui travaille quel jour". La conduite gère "qui fait quoi
**dans la journée**, heure par heure". Cas d'usage typique (live ZLAN) :

```
09:00       Camion arrivée
10:00–13:00 Installation : Équipe A (caméras) + Équipe B (régie son)
13:00–14:00 Pause repas (toute l'équipe)
14:00–17:00 Cadrage : Équipe A · Tests audio + lumière : Équipe B
18:00       Briefing direct
20:00–22:00 LIVE émission (toute l'équipe)
```

Aucune tab existante ne couvre ce besoin :
- **Planning** = agenda projet haut niveau (prépa / tournage / livraisons),
  pas de granularité < jour
- **Équipe** = qui est attribué et présent quels jours, pas de "à quelle heure"
- **Logistique (futur)** = hébergement / repas / transport, pas de déroulé
  artistique du tournage

La conduite est aussi le **bloc principal d'une call sheet** — un futur
export PDF "feuille de service" agrégera : projet info + techlist du jour
+ conduite + logistique (lieux/repas) + contacts d'urgence.

## Architecture data

3 tables, FK nullable vers `logistique_lieux` (préparation V2 logistique).

```sql
projet_conduites (1 row par jour)
  ├ id (uuid PK)
  ├ project_id (FK projects)
  ├ date_jour (date NOT NULL)
  ├ titre (text)                    -- "J3 — Tournage live ZLAN"
  ├ granularite_min (int 5)         -- snap réel : 5min stockés
  ├ display_step_min (int 15)       -- snap visuel : 15min affichés
  ├ heure_debut (time '06:00')      -- bornes affichage timeline
  ├ heure_fin (time '23:00')
  ├ statut (text 'planifie')        -- planifie | valide | verrouille
  ├ notes (text)                    -- briefing global jour
  ├ revision (int 0)                -- incrémenté à chaque valide
  ├ created_at, updated_at, created_by
  └ UNIQUE(project_id, date_jour)

projet_conduite_lanes (catalogue des lanes du jour)
  ├ id (uuid PK)
  ├ conduite_id (FK)
  ├ sort_order (int 0..4 — lane 0 toujours "Global")
  ├ libelle (text 'Équipe A')       -- défaut "Équipe A/B/C/D" pour 1..4
  └ UNIQUE(conduite_id, sort_order)

projet_conduite_creneaux (1 row par bloc)
  ├ id (uuid PK)
  ├ conduite_id (FK)
  ├ heure_debut (time NOT NULL)
  ├ heure_fin (time NOT NULL)
  ├ lane_id (FK lanes)              -- mode mono-lane
  ├ multi_lane (bool false)         -- si true, ignore lane_id et span toutes lanes
  ├ titre (text NOT NULL)
  ├ description (text)
  ├ type (text 'autre')             -- install | repas | prise | pause | transport | brief | live | autre
  ├ couleur (text)                  -- override sinon dérivée du type
  ├ lieu_text (text)
  ├ lieu_id (uuid)                  -- FK future logistique_lieux
  ├ statut (text 'planifie')        -- planifie | en_cours | fait (V3 mode live)
  ├ notes (text)
  ├ sort_order (int)
  ├ created_at, updated_at, created_by
  └ CHECK heure_fin > heure_debut

projet_conduite_creneau_membres (assignations N-N)
  ├ id (uuid PK)
  ├ creneau_id (FK)
  ├ membre_id (FK projet_membres)
  ├ role (text)                     -- "Cadreur 1", "Régie son" — optionnel
  └ UNIQUE(creneau_id, membre_id)
```

**RLS** : scoped projet (cohérent avec techlist / matériel / livrables).
Lecture pour tous les membres avec accès projet, écriture pour
`canEdit` projet (admin + charge_prod + coordinateur + prestataires).
Le partage public passe par token (cf. Vague 2).

**Triggers** :
- `BEFORE INSERT/UPDATE` sur `projet_conduite_creneaux` : sort_order auto
  (max+1 par conduite si NULL, pattern Phase A)
- `BEFORE INSERT/UPDATE` cross-conduite check : empêche un créneau de
  pointer vers une lane d'une autre conduite

## Vagues de livraison

Estimé total ~12-13j sur 5 vagues, V1 livrable en 4-5j.

### Vague 1 — MVP édition fluide (~4-5j)

**A. Foundation data (~1j)**
- Migration SQL : 4 tables + RLS + triggers + indexes
- `lib/conduite.js` : helpers purs (overlap detection, snap-to-grid,
  membres présents un jour donné, tri chronologique des créneaux,
  conversion time ↔ minutes pour les calculs)
- `lib/conduite.test.js` : tests unitaires des helpers
- `hooks/useConduite.js` : CRUD + Realtime (pattern useCrew/useMateriel)
- Permissions : `canEdit` projet, hooks de gating

**B. UI core lecture (~1.5j)**
- Page `ConduiteTab.jsx` (entry point, sélecteur jour + actions)
- Vue **Timeline** desktop : axe heures vertical + lanes en colonnes
- Vue **Liste** alternative (toggle Timeline/Liste, default mobile)
- Side-panel inspecteur (clic bloc, slide depuis la droite, ne couvre
  pas la timeline)
- ContactPicker filtré sur membres techlist présents ce jour
- Empty state pédagogique : "Démarrer vide" / "Importer présences"

**C. Édition fluide (~1j)**
- Drag & drop : déplacer un bloc verticalement (heure) et horizontalement
  (lane)
- Resize bordure haute/basse pour ajuster début/fin
- Snap visuel 15min, **Alt enfoncé pendant drag = précision 5min**
- Click sur zone vide d'une lane = crée un créneau de 30min par défaut
  à cette heure
- Mode multi-lane : un bloc peut couvrir plusieurs lanes (ex: "Pause
  repas" sur Équipe A + B en simultané) via toggle "multi-lane" dans
  l'inspecteur
- Détection overlap membres : un membre dans 2 créneaux qui se
  chevauchent → bordure rouge + tooltip warning (pas blocage)

**D. Polish + import (~0.5j)**
- Bouton "Importer présences techlist" : pour chaque membre présent ce
  jour, propose un créneau "Présence" lane Global de `arrival_time` à
  `departure_time` (preview, validation manuelle avant import)
- **Now line** : trait horizontal rouge marquant l'heure courante,
  visible UNIQUEMENT si conduite affichée = aujourd'hui
- Lanes nommables : header de lane éditable (default "Équipe A/B/C/D"
  pour lanes 1-4, "Global" pour lane 0)
- Bouton "+ Ajouter une lane" jusqu'à 5, "Supprimer la lane" si vide
- Tests smoke + lint + commit

### Vague 2 — Partage public + intégration portail (~2j)

- Migration SQL : `conduite_share_tokens` (calqué sur `equipe_share_tokens`)
- Lib `conduiteShare.js` + hook `useConduiteShareSession`
- Modal `ConduiteShareModal` : créer / révoquer / lister les liens
- Page `ConduiteShareSession.jsx` : route `/share/conduite/:token`
  - Vue Liste compacte mobile-first (lecture seule, pas de drag)
  - Now line interactive
  - Filtres : par lane / par membre (le presta voit "ses" créneaux)
- Sous-page portail projet : `/share/projet/:token/conduite`
  - RPC `share_projet_conduite_fetch` (cohérent avec `share_projet_equipe_fetch`)
  - Réutilise le composant `ConduiteShareView` (export named)
- Intégration menu portail projet (cf. ProjectShareSession.jsx)

### Vague 3 — Mode régie live (~1.5j)

- Statut par créneau visible : `planifie` (gris) / `en_cours` (animé) /
  `fait` (check vert + barré)
- Auto-highlight du créneau qui contient l'heure courante
- Mode "Régie live" (toggle dans le header) : tap sur un bloc → cycle
  planifie → en_cours → fait. Optimistic + Realtime broadcast
- Push notifications navigateur (V3.1, optionnel) : alerter 10min
  avant le prochain créneau
- Mode lecture seule mobile : pas d'édition structurelle mais le bouton
  "Cocher fait" reste accessible aux régisseurs sur tél

### Vague 4 — Call sheets (~3j)

- Migration SQL : table `projet_callsheets` (1 par jour, snapshot JSON
  pour traçabilité — la version envoyée à 18h32 le mardi)
- Composant export PDF agrégeant :
  - Header projet (cover, titre, ref, date jour)
  - Équipe du jour (techlist filtrée par presence_days, avec
    `arrival_time` / `departure_time`)
  - Conduite (vue liste compacte triée chrono, avec lanes en colonnes
    ou une seule colonne avec badge lane selon mise en page)
  - Lieux (depuis Logistique V1 si disponible)
  - Repas (idem)
  - Contacts d'urgence (futur — table `projet_contacts_urgence`)
  - Plan d'accès / météo (V4.5)
- Distribution : token public, page de prévisualisation `/callsheet/:token`
  avec bouton télécharger PDF
- Versioning : à chaque envoi, snapshot JSONB de la conduite + équipe
  → permet de voir l'historique des versions distribuées
- Bouton "Nouvelle version" qui re-snapshot et notifie tous les destinataires

### Vague 5 — Templates et avancé (~2j)

- Bouton "Dupliquer ce jour" : copie d'une conduite vers une autre
  date du même projet (utile pour live multi-jours répétitifs)
- Bouton "Importer depuis un autre projet" : sélectionne un projet
  passé, import sa conduite type "live show / fiction 1j / corporate"
- Templates en bibliothèque (org-level) : "Live broadcast standard",
  "Tournage pub 1 jour", "Tournage fiction journée type"
- Documents attachés par créneau (storyboard, plan de feu, brief
  technique) : table `projet_conduite_creneau_documents`,
  bucket Storage, upload + preview
- Versioning visible : timeline des révisions ("Modifié il y a 2h par Lucie")
- Diff entre versions : "Qu'est-ce qui a changé depuis la v3 envoyée
  hier soir ?" — UI side-by-side ou unified diff

## Articulation avec les autres tabs

### Techlist (Équipe)
- **Source** des membres assignables aux créneaux (filtre `presence_days`
  qui couvre la date du jour)
- **Source** des horaires `arrival_time` / `departure_time` pour le
  bouton "Importer présences"
- **Pas de retour** : la conduite ne modifie jamais la techlist. Si
  l'admin veut changer les heures de présence, il le fait dans la modale
  Présence et la conduite reflète au prochain refresh.
- **Warning UX** : si on assigne Marc à un créneau hors de
  `arrival_time` / `departure_time`, on affiche un warning (pas blocage).

### Logistique V1+ (futur)
- `lieu_id` sur `projet_conduite_creneaux` → FK nullable vers
  `logistique_lieux` (table pas encore créée, on prépare le terrain)
- Repas auto : un créneau type='repas' peut pointer un fournisseur
  Logistique
- Vue d'ensemble Logistique pourrait afficher les créneaux conduite
  comme overlay (V3 logistique)

### Planning
- **Pas de sync auto** — Planning reste agenda projet haut niveau.
- Idée V5 (optionnelle) : un événement Planning de type "Tournage" peut
  ouvrir directement la conduite du jour correspondant en 1 clic.

### Budget Réel
- Pas en V1-V4. V5+ : remontée des coûts par créneau (heures × tarif
  équipe) pour comparaison devis vs réel par journée.

### Livrables
- Pas de lien direct. Les jours de tournage du Planning sont la base
  des dates auxquelles on crée des conduites — rien d'automatique.

### Call sheets
- La conduite est la **source principale** pour les call sheets PDF.
  Cf. Vague 4. Elle alimente, jamais l'inverse.

### Page share projet (portail global)
- Vague 2 ajoute la sous-page `/share/projet/:token/conduite` —
  intégration au portail projet existant (cohérent avec equipe,
  livrables, materiel).

## Fichiers à créer

```
supabase/migrations/
  ├ <date>_conduite_v1_schema.sql              (V1)
  ├ <date>_conduite_v2_share_tokens.sql        (V2)
  ├ <date>_conduite_v4_callsheets.sql          (V4)
  └ <date>_conduite_v5_documents.sql           (V5)

src/
  ├ lib/conduite.js                            (fetch + CRUD + helpers)
  ├ lib/conduite.test.js                       (tests helpers purs)
  ├ lib/conduiteShare.js                       (V2)
  ├ lib/callsheetExport.js                     (V4 — PDF jsPDF)
  ├ hooks/useConduite.js                       (V1)
  ├ hooks/useConduiteShareSession.js           (V2)
  ├ pages/tabs/ConduiteTab.jsx                 (V1 entry point)
  ├ pages/ConduiteShareSession.jsx             (V2 — /share/conduite/:token)
  ├ pages/ProjectShareConduiteSession.jsx      (V2 — sous-page portail)
  └ features/conduite/
      ├ TimelineView.jsx                       (vue principale desktop)
      ├ ListView.jsx                           (vue compacte / mobile)
      ├ CreneauInspector.jsx                   (side-panel édition)
      ├ DaySelector.jsx                        (header sélecteur date)
      ├ LaneHeader.jsx                         (header lane éditable)
      ├ NowLine.jsx                            (indicateur heure courante)
      ├ ImportPresencesModal.jsx               (V1 import depuis techlist)
      ├ ConduiteShareModal.jsx                 (V2 gestion liens)
      ├ CallsheetExportModal.jsx               (V4 export PDF)
      └ components/
          ├ CreneauBlock.jsx                   (rectangle bloc cliquable)
          ├ TimelineGrid.jsx                   (axes heures + lanes)
          ├ MembreAssignList.jsx               (multi-select techlist)
          └ TypeSelector.jsx                   (chip selector type)
```

Routes à ajouter dans `src/router.jsx` :
```
/projets/:id/conduite              (V1)
/share/conduite/:token             (V2)
/share/projet/:token/conduite      (V2 — sous-page)
/callsheet/:token                  (V4)
```

ProjectSideNav : ajouter l'entrée "Conduite" (ou "Déroulé") entre
Équipe et Matériel.

## Permissions

- **Lecture** : tous les utilisateurs avec accès projet (`canRead`)
- **Édition** : `canEdit` projet — admin + charge_prod + coordinateur +
  prestataires liés (cohérent avec la décision Hugo "tous ceux qui ont
  canEdit, prestataires inclus")
- **Mode régie live** (V3) : `canEdit` aussi. Si un user doit être en
  lecture seule pendant le tournage, on lui retire le rôle.
- **Partage public** (V2) : token opaque, lecture seule, pas
  d'authentification requise. Le presta scanne le QR code de la call
  sheet et accède directement.

## Questions ouvertes (à trancher avant V1)

1. **Nom final** : "Conduite" / "Déroulé" / "Rundown" ?
   (Reco Claude : "Déroulé", accessible tous métiers.)

2. **Lane "Global" toujours présente** ? Reco oui (lane 0 non
   supprimable, sert pour les créneaux toute l'équipe).

3. **Type de créneau extensible** ? V1 : enum fermé (install / repas /
   prise / pause / transport / brief / live / autre). V2+ : autoriser
   types custom par projet ? Reco : enum fermé suffit jusqu'à preuve
   du contraire.

4. **Granularité par projet ou par jour** ? Reco : par jour
   (`granularite_min` sur `projet_conduites`). Permet à un live précis
   d'utiliser 5min, et à un tournage fiction d'utiliser 30min sans
   imposer un standard.

5. **Heures de bornes timeline** : configurables par jour
   (`heure_debut` / `heure_fin`) ou fixes (06:00 - 23:00) ? Reco :
   configurables par jour avec defaults raisonnables. Un tournage
   nuit (20h-04h) doit pouvoir afficher minuit pile.

6. **Nuit après minuit** : un créneau peut-il aller de 23h à 02h ? V1
   on bloque à un jour max. V2 : split auto en 2 créneaux liés
   (23-24h sur conduite J et 00-02h sur conduite J+1).

7. **Mode régie live** dès V1 ou V3 ? Reco V3 — V1 se concentre sur
   la création/édition, pas l'opérationnel direct.

8. **Notifications push** : V3.1 ou plus tard ? Reco V3.1 mais
   optionnel — c'est une feature qui demande beaucoup de polish
   (préférences, désinscription, fenêtres horaires).

9. **Templates inter-projets** : V5 ou avant ? Reco V5 — on observe
   d'abord 2-3 conduites créées en V1 pour comprendre les vrais
   patterns à templater.

10. **Documents attachés par créneau** : V5 ou besoin observé en V1 ?
    Reco V5 — on n'a pas eu le besoin remonté pour le matériel
    avant la V2 photos, attendons un cas d'usage.

## Évolutions futures (V6+)

- Synchronisation calendrier externe (export iCal du jour pour les
  membres qui veulent l'avoir dans leur calendrier perso, comme
  PL-8 v1 a fait pour le Planning)
- Mode "rehearsal" : générer une conduite "à blanc" pour répétition
  (ex: filage live à 14h pour le live à 20h) avec heures décalées
- Métriques post-tournage : durée réelle vs prévue, blocs retardés,
  pour analyser et améliorer les futures conduites
- Intégration AI : "Génère-moi une conduite type pour un live broadcast
  3 caméras 2h" en partant des templates org

## Notes méta

- Préfixe migrations : `<date>_conduite_v<N>_<scope>.sql`
- Préfixe commits : `conduite-v<N>` (cohérent avec `livrables-v1`,
  `materiel-v1`, etc.)
- À chaque vague livrée, mettre à jour ce doc avec la date de
  bouclage et les commits clés.
