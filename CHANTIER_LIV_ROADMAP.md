# Chantier Livrables (LIV) — Roadmap

> Créé le 2026-04-24. Document de référence pour la construction de l'outil
> Livrables dans MATRICE GOLDEN. Mis à jour au fil des sessions ; les tickets
> terminés sont cochés ✅ avec le commit de validation.

---

## 1. Contexte & vision

Un livrable en post-production audiovisuelle n'est pas un fichier : c'est
une obligation contractuelle à une date, déclinée en plusieurs versions
techniques, qui mobilise des ressources (monteur, motion, son, DA) jusqu'à
une deadline. LIV transforme l'actuel suivi Excel/PDF (deux templates de
référence : "V and B Fest" multi-livrables, et "Mandatory Wow" mono-livrable
avec pipeline riche) en un outil centralisé, relié au planning, à l'accueil
projet, à l'index global, et (niveau 1) au devis.

**Objectifs fondateurs :**
- Centraliser la vision post-prod par projet ET par personne (index global).
- Lier deadlines de livraison ↔ events planning dans les deux sens.
- Tracer l'historique des versions et des retours client (V1 → V2 → VDEF).
- Rester flexible : un projet peut avoir 1 livrable complexe ou 40 livrables
  simples, sans friction d'UI.

**Out of scope (backlog) :** notifications email, intégrations API Frame.io /
Drive, mode partage client, templates projet-type, génération automatique
depuis devis, trigger facture.

---

## 2. Décisions validées (2026-04-24)

| Point | Décision |
|---|---|
| Scope MVP | Ambitieux (structure riche dès V1, miroir MAT) |
| Sync planning | Bidirectionnelle : étape ↔ event miroir |
| Fichiers | URLs externes uniquement (Frame.io validation + Drive master) |
| Lien devis | Niveau 1 (pointeur `devis_lot_id` nullable) |
| Partage client | Vague 3 |
| Versions | **Vraie entité avec historique** (table `livrable_versions`) |
| Version_label + Statut | Deux champs distincts (label texte + enum statut) |
| Monteur | Lien `profiles.id` (+ champ texte externe pour freelances) |
| Numérotation | Auto (préfixe bloc + index) avec override possible |
| Import devis | Pas au MVP (création manuelle) |
| Duplication cross-project | MVP |
| Retards + prochain livrable | Header LIV + widget accueil projet + widget index global |
| Filtre "Mes livrables" | Oui (par `auth.uid()`) |
| Dupliquer livrable | Oui (variante dans même bloc) |
| Drag & drop | Oui (réordonner livrables + blocs) |
| Bulk edit | Oui (sélection multiple → batch update) |
| Soft delete | Oui (`deleted_at` + corbeille) |
| Regroupement blocs | MVP (blocs = AFTERMOVIE, SNACK CONTENT, COCKTAIL…) |
| Phases projet | MVP, répétables, events multi-jours uniques |
| Pipeline Gantt | Vague 2 (à ne pas oublier) |

---

## 3. Modèle de données

### 3.1 Tables principales

**`projet_livrable_config`** (1-1 avec projet) — en-tête commun.
```
id             uuid pk
project_id     uuid fk unique
client_nom     text
client_logo_url text
producteur_postprod text
tournage_label text   -- ex "21-24 août 2025" ou "/"
version_numero int    -- version du planning post-prod lui-même
notes          text
created_at / updated_at / updated_by
```

**`livrable_blocks`** — regroupement de livrables (ex "AFTERMOVIE / RÉCAP").
```
id           uuid pk
project_id   uuid fk
nom          text       -- "AFTERMOVIE / RÉCAP"
prefixe      text(4)    -- "A", "S", "C"
couleur      text       -- hex, pour colonnes/headers
sort_order   int
deleted_at   timestamptz null
created_at / updated_at
```

**`livrables`** — l'entité principale.
```
id              uuid pk
block_id        uuid fk
project_id      uuid fk (redondance pour RLS rapide)
numero          text    -- "A1", "S12", "C4*" (auto ou override)
nom             text    -- "AFTERMOVIE", "COCKTAIL #4 : SAINT JAMES"
format          text    -- "16/9", "9/16", "16/9 + 9/16"
duree           text    -- "15s", "4min", "1m30"
version_label   text    -- "V1", "V3", "V3*", "??"
statut          enum    -- brief | en_cours | a_valider | valide | livre | archive
projet_dav      text    -- "A", "B" (référence projet DaVinci)
assignee_profile_id uuid fk profiles null
assignee_external   text null -- nom libre pour freelance hors équipe
date_livraison      date null
lien_frame      text    -- URL Frame.io pour validation
lien_drive      text    -- URL Drive pour master
devis_lot_id    uuid fk devis_lots null  -- Niveau 1
notes           text
sort_order      int
deleted_at      timestamptz null
created_at / updated_at / updated_by
```

**`livrable_versions`** — historique des versions envoyées au client.
```
id               uuid pk
livrable_id      uuid fk
numero_label     text    -- "V0", "V1", "VDEF"
date_envoi       date null
lien_frame       text null
statut_validation enum   -- en_attente | retours_a_integrer | valide | rejete
feedback_client  text
created_at / updated_at / updated_by
```

**`livrable_etapes`** — étapes de post-prod par livrable (pipeline).
```
id              uuid pk
livrable_id     uuid fk
nom             text    -- "Edit/Motion", "DA", "Envoi V0", "VDEF"
kind            enum    -- production | da | montage | sound | delivery | feedback | autre
date_debut      date
date_fin        date    -- = date_debut pour étape d'un jour
assignee_profile_id uuid fk profiles null
couleur         text null
notes           text
sort_order      int
event_id        uuid fk events null  -- event planning miroir (si créé)
is_event        bool default true    -- créer un event ou non
created_at / updated_at
```

**`projet_phases`** — phases projet globales (PROD, TOURNAGE, MONTAGE…),
répétables dans le temps.
```
id              uuid pk
project_id      uuid fk
nom             text    -- "PROD", "TOURNAGE", "MONTAGE", "DELIVERY", "OFF"
kind            enum    -- prod | tournage | montage | delivery | off | autre
date_debut      date
date_fin        date
couleur         text
event_id        uuid fk events null   -- event planning miroir multi-jours
created_at / updated_at
```

### 3.2 Contraintes & indexes clés
- `livrables.numero` unique par `(block_id, deleted_at IS NULL)`.
- `livrable_etapes.event_id` unique (un event ne peut miroiter qu'une étape).
- `projet_phases.event_id` unique (idem).
- Index sur `livrables.date_livraison` (queries compteurs retard / prochain).
- Index sur `livrables.assignee_profile_id` (filtre "Mes livrables").
- Soft delete via `deleted_at` sur `livrable_blocks` et `livrables` ; cascade
  logique (bloc supprimé → livrables marqués supprimés).

### 3.3 RLS
Miroir MAT : gated par `can_read_outil(project_id, 'livrables')` et
`can_edit_outil(project_id, 'livrables')`. Les tables satellites
(`livrable_versions`, `livrable_etapes`, `livrable_versions`) se réfèrent à
`livrables.project_id` via join RLS.

---

## 4. Architecture technique

### 4.1 Fichiers prévus

```
src/
├─ pages/
│  └─ tabs/LivrablesTab.jsx              ← onglet principal du projet
├─ features/livrables/
│  ├─ components/
│  │  ├─ LivrablesHeader.jsx             ← titre + compteurs + actions
│  │  ├─ LivrableBlockCard.jsx           ← bloc dépliable avec livrables
│  │  ├─ LivrableRow.jsx                 ← ligne éditable inline
│  │  ├─ LivrableVersionsModal.jsx       ← historique versions
│  │  ├─ LivrableEtapesDrawer.jsx        ← pipeline étapes d'un livrable
│  │  ├─ ProjetPhasesDrawer.jsx          ← gestion phases projet
│  │  ├─ LivrableBulkEditBar.jsx         ← barre fixe sélection multiple
│  │  ├─ DuplicateProjetModal.jsx        ← duplication cross-project
│  │  └─ LivrableHomeWidget.jsx          ← widget accueil projet
│  └─ livrablesPdfExport.js              ← (Vague 2) PDF des plannings
├─ hooks/
│  └─ useLivrables.js                    ← orchestration état + actions
├─ lib/
│  ├─ livrables.js                       ← CRUD + helpers purs
│  ├─ livrablesPlanningSync.js           ← sync bidirectionnelle events
│  └─ livrablesHelpers.js                ← helpers purs (retards, prochain)
└─ features/home/
   └─ ProchainsLivrablesWidget.jsx       ← index global "Mes prochains livrables"
```

### 4.2 Hook `useLivrables(projectId)` — shape de retour

```js
{
  loading, error,
  // En-tête projet
  config,                  // projet_livrable_config
  // Contenu structuré
  blocks,                  // livrable_blocks triés par sort_order
  livrables,               // tous les livrables du projet
  livrablesByBlock,        // Map<blockId, livrable[]>
  phases,                  // projet_phases
  // Dérivés
  compteurs: { total, enRetard, livres, valides, prochain },
  monteurs,                // liste des assignees distincts
  versionsByLivrable,      // Map<livrableId, versions[]>
  etapesByLivrable,        // Map<livrableId, etapes[]>
  // Actions
  actions: {
    // config
    updateConfig,
    // blocks
    createBlock, renameBlock, deleteBlock, reorderBlocks,
    // livrables
    createLivrable, updateLivrable, deleteLivrable,
    reorderLivrables, duplicateLivrable,
    // versions
    addVersion, updateVersion, deleteVersion,
    // etapes
    addEtape, updateEtape, deleteEtape,
    // phases
    addPhase, updatePhase, deletePhase,
    // bulk
    bulkUpdateLivrables,
    // duplication cross-project
    duplicateFromProject,
    // refresh manuel
    refresh,
  },
}
```

### 4.3 Sync bidirectionnelle livrable ↔ planning

**Principe fondateur :** l'étape (ou la phase projet) est **propriétaire**,
l'event planning est une **projection**. Le lien est stocké dans
`livrable_etapes.event_id` et `projet_phases.event_id`.

**Pipeline création/modif côté LIV :**
1. `createEtape({...})` : insert dans `livrable_etapes`.
2. Si `is_event=true` et `kind in (delivery, montage, etc.)`, création
   immédiate d'un event `events` avec `source='livrable_etape'` et
   `livrable_etape_id=<id>`. L'id retourné est stocké dans `etape.event_id`.
3. Retour atomique au client.

**Pipeline édition côté planning :**
1. L'user drag un event lié (`event.livrable_etape_id IS NOT NULL`) sur le
   Gantt. Le handler détecte le lien et route la mutation vers
   `updateEtape({ id, date_debut, date_fin })` au lieu de `updateEvent`.
2. Le trigger applicatif (dans `livrablesPlanningSync.js`) re-synchronise
   l'event en retour.

**Pipeline suppression :**
- Suppression de l'étape : supprime aussi l'event miroir (CASCADE applicatif).
- Suppression de l'event depuis le planning : détache (nullify
  `etape.event_id`) mais conserve l'étape. Toast "étape orpheline, relancer
  le sync pour recréer l'event ?".

**Conflits de concurrence :**
- Le bumpReload pattern de MAT s'applique. En cas de divergence, le serveur
  gagne : le feed Realtime des events re-sync l'étape miroir au prochain
  refetch.

### 4.4 Intégrations UI

**LivrablesTab (onglet projet) :**
- Header avec compteurs (total, en retard, prochain), boutons (nouveau bloc,
  dupliquer depuis projet, gérer phases), filtres (monteur, statut, Mes),
  toggle Bulk edit.
- Corps : liste verticale de blocs → chaque bloc listes ses livrables sous
  forme de lignes éditables inline (format tableau).
- Slide-over "Étapes" depuis une ligne livrable.
- Modal "Versions" depuis une ligne livrable.
- Drawer "Phases projet" depuis le header.

**Accueil projet (HomePage / ProjetLayout) :**
- `LivrableHomeWidget` : "6 livrables, 2 en retard, prochain le 27/08/2025 :
  Aftermovie". Cliquable → onglet Livrables.

**Index global (home générale) :**
- `ProchainsLivrablesWidget` : les 10 prochains livrables des projets où
  `auth.uid()` fait partie du projet_team_members, triés par `date_livraison
  ASC`, limités à J+30. Cliquable → ouvre le projet + onglet Livrables.

**Planning :**
- Les events dérivés (livrable_etape + projet_phase) sont affichés avec un
  style distinctif (icône petit drapeau ? ruban coloré ?) et un menu
  contextuel "Ouvrir le livrable" / "Voir les étapes".

**Devis (BudgetTab / DevisTab) :**
- Sur un lot de devis, badge "Lié à N livrable(s)" cliquable → filtre LIV par
  `devis_lot_id`.

---

## 5. Découpage par vagues

### Vague 1 — MVP (Foundation + Core)

Objectif : table multi-livrables fonctionnelle, sync planning bidirectionnelle,
widgets accueil + index global. Tu peux remplacer ton Excel au complet sans
les templates PDF.

| # | Ticket | Effort | Description |
|---|---|---|---|
| LIV-1 ✅ | Migration SQL — schéma complet | M | 6 tables + indexes + RLS + policies + sync events. Migration `20260424_liv1_livrables_schema.sql` — à appliquer côté Supabase. |
| LIV-2 ✅ | Permissions OUTILS.LIVRABLES | S | Déjà fait par anticipation : `OUTILS.LIVRABLES` présent dans `permissions.js` depuis 3A, `outils_catalogue` seed dans `ch3a_permissions.sql`, gating posé dans la migration LIV-1. |
| LIV-3 ✅ | Lib `livrables.js` + hook `useLivrables` | L | CRUD complet + Realtime + helpers purs (livrablesHelpers.js + 23 tests Vitest). Pas encore de sync planning : LIV-4 cablera les events miroirs. |
| LIV-4 ✅ | Sync bidirectionnelle events (lib `livrablesPlanningSync.js`) | L | Forward sync étape/phase → event miroir câblée dans `livrables.js` (create/update/delete). Reverse via helpers purs `eventPatchToEtapePatch/Phase` consommés par le planning à LIV-5. `backfillMirrorEvents(projectId)` exposé dans `useLivrables`. 40+ tests Vitest sur helpers purs. |
| LIV-5 ✅ | Page `LivrablesTab` (structure vue liste) | M | Page gated `useProjectPermissions`, header 4 compteurs + CTA `Nouveau bloc`, liste `BlockCard` (pastille / préfixe / livrables avec pill statut), empty state Inbox + création bloc câblée via `prompt()` → `actions.createBlock` (rotation couleurs preset). Commit `ab903b1`. |
| LIV-6 ✅ | CRUD blocs + drag & drop | M | `LivrableBlockCard` + `LivrableBlockList` extraits dans `features/livrables/components/`. Rename inline, popover palette couleur, édition préfixe (uppercase, max 4 car), suppression soft + toast undo 5 s (`restoreBlock`), collapse/expand, drag & drop HTML5 natif (pattern MAT-9D). Fix bug popover clipping (`overflow-hidden` → `rounded-t-xl` sur header). |
| LIV-7 ✅ | CRUD livrables + inline edit + numérotation auto | L | `LivrableRow` (desktop table) + `LivrableRowCard` (mobile) + `LivrableStatutPill` popover extraits dans `features/livrables/components/`. Inline edit tous les champs (numero, nom, format, durée, statut, monteur texte libre, date livraison, liens Frame/Drive, notes). Auto-numero géré serveur via `nextLivrableNumero`. Menu `...` par ligne (Dupliquer, Modifier Frame/Drive, Notes, Supprimer soft + toast undo 5s). Footer "+ Nouveau livrable" par bloc. Responsive pattern MAT-RESP-1 (`useBreakpoint`). Autocomplete monteur (profiles) = report plus tard. |
| LIV-8 | Table versions + UI historique | M | Modal avec timeline, add/edit/delete version |
| LIV-9 | Étapes — CRUD + events planning | L | Slide-over pipeline, event miroir kind='delivery' |
| LIV-10 | Phases projet — CRUD + events multi-jours | M | Drawer gestion phases, events continus |
| LIV-11 | Drag & drop livrables dans bloc | S | Pattern MAT-9C |
| LIV-12 | Duplication livrable (variante) | S | Bouton "Dupliquer" → copie dans même bloc |
| LIV-13 | Duplication cross-project | M | Modal "Dupliquer depuis projet X" (blocs + livrables + phases) |
| LIV-14 | Bulk edit (sélection multiple) | M | Checkbox sur lignes + barre d'action batch |
| LIV-15 | Filtres (monteur, statut, Mes livrables) | S | Header LIV, persistence localStorage |
| LIV-16 | Compteurs retard + prochain (header LIV) | S | En-tête LivrablesTab |
| LIV-17 | Widget accueil projet | S | `LivrableHomeWidget` dans ProjetLayout / HomePage projet |
| LIV-18 | Widget index global | M | `ProchainsLivrablesWidget` + query server-side filtrée |
| LIV-19 | Lien devis Niveau 1 (pointeur) | S | Champ `devis_lot_id` + autocomplete lots + badge croisé |
| LIV-20 | Soft delete + corbeille | S | `deleted_at` + vue "Archivés" dépliable |
| LIV-21 | Tests + validation finale | M | Helpers purs testés, ESLint, smoke test bout-en-bout |

**Effort total Vague 1 :** ~15-20 jours de Claude selon la densité des tickets.

### Vague 2 — Pipeline, PDF, Niveau 3 devis

Objectif : rendre visible le pipeline post-prod (swimlanes style Mandatory
Wow), régénérer les PDF des deux templates, et verrouiller le lien devis.

| # | Ticket | Effort | Description |
|---|---|---|---|
| LIV-22 | Vue Pipeline / Gantt par voies | XL | Swimlanes par kind, drag étapes sur timeline, zoom jour/semaine |
| LIV-23 | Export PDF vue ensemble (style V and B Fest) | L | Multi-livrables + timeline verticale + phases en fond |
| LIV-24 | Export PDF vue détaillée (style Mandatory Wow) | M | Pipeline mono-livrable par voies |
| LIV-25 | Niveau 3 devis — compteur contractuel vs planifié | M | Badge "16 contractuels / 18 planifiés, 2 hors devis" |
| LIV-26 | Templates de projet livrables | M | "Festival musical", "Film institutionnel", etc. — pré-remplissent la structure |

### Vague 3 — Partage client + notifications

| # | Ticket | Effort | Description |
|---|---|---|---|
| LIV-27 | Migration SQL tokens validation client | M | Pattern MAT-10A : tokens anon + RLS + RPC |
| LIV-28 | Route `/validation/:token` | L | UI client-facing : liste versions, feedback, bouton "Valider" |
| LIV-29 | Notifications email/in-app J-X | L | Digest + alertes 3j/1j avant deadline, config par user |

### Vague 4+ — Intégrations externes + niveaux devis avancés

| # | Ticket | Effort | Description |
|---|---|---|---|
| LIV-30 | Niveau 2 devis — génération automatique | L | Lots "type: livrable" → ébauches livrables créées |
| LIV-31 | API Frame.io — commentaires non lus | L | Polling / webhook, badge sur ligne livrable |
| LIV-32 | API Drive — vérification existence masters | M | Check régulier, alerte si fichier supprimé |
| LIV-33 | Niveau 4 devis — trigger facture à la livraison | L | Statut 'livre' → génère ligne dans outil Facture |

---

## 6. Points de vigilance & conventions

### 6.1 Conventions de code (miroir MAT)
- Tables SQL snake_case, enums commentés en tête de migration.
- Hook `useLivrables` retourne `{ loading, error, ..., actions }` — miroir de
  `useMateriel`.
- Actions optimistes (MAT-9B-opt pattern) dès la V1 pour les inline edits.
- Drag & drop : `@dnd-kit` (déjà utilisé pour MAT-9C/D).
- ESLint clean avant chaque commit.
- Commit messages : `feat(livrables): ... (LIV-X)`, `fix(livrables): ... (LIV-X)`.

### 6.2 Questions à re-valider en cours de route
- Couleurs des kinds d'étapes (production / da / montage / sound / delivery /
  feedback) — palette à définir quand on attaque LIV-9.
- Exact set de statuts — on part de `brief | en_cours | a_valider | valide |
  livre | archive` ; à re-challenger après 2-3 projets réels utilisant LIV.
- Comportement précis d'un event planning supprimé depuis le planning —
  **tranché à LIV-4** : la FK `etape.event_id ON DELETE SET NULL` détache
  automatiquement l'étape (qui reste). Le backfill reposera un miroir au
  prochain passage. Pas de toast undo à ce stade.
- UX du bloc collapsed (pattern MAT-9D vs autre ?) — à regarder à LIV-5.

### 6.3 Risques identifiés
- **Sync bidirectionnelle** : zone chaude, facile à casser. Test bout-en-bout
  obligatoire (LIV-21). Un test : créer étape → vérifier event apparaît →
  drag event sur planning → vérifier date étape à jour → supprimer étape →
  vérifier event disparu.
- **Volumétrie index global** : la query "prochains livrables des projets
  dont je suis membre" peut devenir lourde si N projets × M livrables.
  Prévoir index composite `(project_id, date_livraison) WHERE deleted_at IS
  NULL`.
- **Double vue (liste + Vague 2 pipeline)** : la table `livrable_etapes` doit
  supporter les deux vues sans duplication. Bien tester la cohérence dès
  LIV-9, même si le pipeline n'arrive qu'en Vague 2.
- **Concurrence edit** : 2 producteurs modifient le même livrable au même
  moment → Realtime + optimistic + server wins (pattern MAT-9B établi).

---

## 7. Backlog nommé (idées à ne pas perdre)

- **LIV-PIPELINE** (Vague 2) : vue Gantt par voies (production / DA / edit /
  sound / feedback / delivery) façon Mandatory Wow.
- **LIV-PDF** (Vague 2) : régénérer les 2 templates historiques en PDF depuis
  LIV.
- **LIV-TEMPLATES** (Vague 2) : projets types ("Festival musical" → 1
  aftermovie + N récaps + M snacks + K cocktails pré-créés).
- **LIV-PARTAGE** (Vague 3) : route `/validation/:token` client-facing,
  validation V1/V2/VDEF sans compte.
- **LIV-NOTIF** (Vague 3) : digest email + alertes J-3 / J-1.
- **LIV-FRAME-API** (Vague 4) : pull commentaires non lus Frame.io, badge
  sur livrable.
- **LIV-DRIVE-API** (Vague 4) : vérifier existence masters Drive.
- **LIV-DEVIS-NIVEAU-2** (Vague 4) : générer livrables depuis lots devis.
- **LIV-DEVIS-NIVEAU-4** (Vague 4) : statut livré → facture auto.
- **LIV-RELATIF-J** (V1.5) : affichage relatif "J+3, J+26" quand le projet a
  une date de tournage (toggle dans LivrablesHeader).
- **LIV-ARCHIVE-BULK** (V1.5) : "Archiver ce projet" → tous les livrables
  livrés passent en `archive`.

---

## 8. Avancement

### Session 2026-04-24 — Bootstrap (LIV-1, LIV-2)

- 21 tasks créées dans le gestionnaire (#214 → #234), dépendances configurées.
- **LIV-1 ✅** : migration `supabase/migrations/20260424_liv1_livrables_schema.sql`
  écrite — 6 tables + indexes + RLS scoped sur `'livrables'` + 3 colonnes sur
  `events` (`source`, `livrable_etape_id`, `projet_phase_id`) avec contraintes
  CHECK pour cohérence FK ↔ source. Idempotente. Reste à appliquer côté
  Supabase + activer Realtime (cf. notes en pied de migration).
- **LIV-2 ✅** : déjà acquis sans nouvelle migration. Vérifications faites :
  - `OUTILS.LIVRABLES = 'livrables'` présent dans `src/lib/permissions.js`.
  - `outils_catalogue` seed `('livrables', 'Livrables', 'Rushes, versions,
    validations client', 'FileVideo', 60)` présent dans `ch3a_permissions.sql`.
  - Templates métiers comportent déjà des permissions par défaut sur
    `'livrables'` (cf. `ch3a_permissions.sql` lignes 222 et 255).

### Session 2026-04-24 (suite) — LIV-3 (data layer)

- **LIV-3 ✅** : 3 fichiers livrés.
  - `src/lib/livrablesHelpers.js` (helpers PURS, 0 dépendance Supabase) :
    constantes UI (statuts, kinds, couleurs), `sortBySortOrder`,
    `groupLivrablesByBlock`, `indexVersionsByLivrable`, `indexEtapesByLivrable`,
    `isLivrableEnRetard`, `computeCompteurs` (total/actifs/enRetard/livres/
    valides/prochain), `listMonteurs` (dedupe interne+externe, tri alpha),
    `nextLivrableNumero` (préfixe + premier index libre, tolère caractères
    spéciaux), `pickAllowed`, whitelist `LIVRABLE_EDITABLE_FIELDS`.
  - `src/lib/livrables.js` (data layer) : `fetchProjectLivrablesBundle` (4
    round-trips au lieu de 6), CRUD complet sur les 6 tables, soft delete
    `deleteBlock` avec cascade applicative + `restoreBlock` qui restaure
    uniquement les livrables tombés ensemble (fenêtre ±5s), `bulkUpdateLivrables`,
    `duplicateLivrable` et `duplicateFromProject` (blocs + livrables + phases
    avec options `includeBlocks/Livrables/Phases`).
  - `src/hooks/useLivrables.js` (orchestration) : pattern miroir useMateriel
    (bumpReload + lastReloadAtRef + aliveRef), Realtime channel
    `livrables-collab:${projectId}` (debounce 400ms + mute self-echo 1500ms,
    filter project_id sur 4 tables, RLS sur les 2 tables jointes), optimistic
    updates dès la V1 sur updateLivrable / updateBlock / updatePhase /
    updateVersion / updateEtape / updateConfig / bulkUpdateLivrables /
    deleteLivrable / deleteVersion / deleteEtape / deletePhase / reorderLivrables.
  - `src/lib/livrablesHelpers.test.js` : 23 tests Vitest sur les helpers purs
    (couverture sortBySortOrder, groupBy, indexBy, isLivrableEnRetard avec
    frontière minuit, computeCompteurs avec sélection prochain, listMonteurs
    avec dedupe + profile lookup + tri français, nextLivrableNumero avec
    préfixes case-insensitive et caractères spéciaux échappés, pickAllowed).
- **Limites volontaires LIV-3** : pas de sync planning. Les étapes et phases
  sont créées avec `event_id = NULL` même si `is_event=true` — c'est `LIV-4`
  (`livrablesPlanningSync.js`) qui cablera la création/maj/suppression du
  miroir bidirectionnel et résoudra rétroactivement les liens manquants.
- **Validation** : `npm run lint` → 0 erreur sur les 4 fichiers (15 warnings
  pré-existants ailleurs). `node --check` OK sur les 4 fichiers. Tests
  Vitest à lancer côté Hugo (le sandbox est Linux ARM64, ses node_modules
  sont darwin-arm64 — mismatch).

### Session 2026-04-24 (suite) — LIV-4 (sync planning bidirectionnelle)

- **LIV-4 ✅** : 4 fichiers livrés (1 nouveau, 3 modifs, 1 test).
  - `src/lib/livrablesPlanningSync.js` (NOUVEAU, ~450 lignes) : module central
    qui détient la logique du miroir étape/phase ↔ event.
    - **Constantes** : `EVENT_SOURCE_{MANUAL,LIVRABLE_ETAPE,PROJET_PHASE}`,
      `ETAPE_SYNCED_FIELDS`, `PHASE_SYNCED_FIELDS`.
    - **Helpers purs dates** : `dateToDayStartIso` (YYYY-MM-DD → ISO 00:00Z),
      `dateToDayEndExclusiveIso` (date → lendemain 00:00Z, convention all_day
      PL-1), `isoToDate`, `isoExclusiveToDateInclusive` (reverse pour le
      drag planning).
    - **Helpers purs classification** : `isEventMirror`, `isEtapeMirrorEvent`,
      `isPhaseMirrorEvent`.
    - **Helpers purs couleurs** : `etapeEventColor` (override → kind → slate),
      `phaseEventColor`.
    - **Helpers purs payloads** : `buildEtapeEventPayload/Patch`,
      `buildPhaseEventPayload/Patch`.
    - **Helpers purs reverse** : `eventPatchToEtapePatch/PhasePatch`
      (starts_at→date_debut, ends_at exclusif→date_fin inclus, title→nom,
      color_override→couleur). À consommer par le planning UI au lieu de
      toucher les events directement.
    - **Helpers purs diff** : `etapePatchAffectsEvent/PhasePatchAffectsEvent`
      (fast path : skip sync si seul notes/assignee changent),
      `shouldEtapeHaveEvent/PhaseHaveEvent`.
    - **I/O** : `createEventForEtape/Phase` (INSERT events + pose
      `etape.event_id` symétrique), `updateEventForEtape/Phase` (filtré par
      livrable_etape_id UNIQUE, plus robuste qu'event_id),
      `deleteEventForEtape/Phase`.
    - **Orchestration** : `syncEtapeOnCreate/Update/Delete` (4 cas dans
      onUpdate : flipToOn → create, flipToOff → delete + null event_id,
      shouldHave + syncFieldsChanged → update, else noop), idem phases.
      Erreurs sync → `console.warn` + continue (la CRUD primaire ne throw
      jamais, le backfill rattrapera).
    - **Réconciliation** : `backfillMirrorEvents(projectId)` → scan étapes
      `is_event=true, event_id=null` via jointure `livrables.project_id`
      + phases `event_id=null` et crée les events manquants. Utile pour les
      étapes créées sous LIV-3.
  - `src/lib/livrables.js` : câblage forward. `addEtape/addPhase` appellent
    `syncOnCreate` après INSERT et re-fetchent pour exposer `event_id`.
    `updateEtape/updatePhase` appellent `syncOnUpdate` + re-fetch.
    `deleteEtape/deletePhase` appellent `syncOnDelete` **AVANT** le DELETE
    (respect du CHECK `events_source_fk_consistency` côté DB — sinon le
    `ON DELETE SET NULL` laisserait un event `source='livrable_etape'` +
    `livrable_etape_id=null` qui viole la contrainte).
  - `src/hooks/useLivrables.js` : expose `backfillEvents` dans l'objet
    actions, tire `bumpReload` pour rafraîchir après un backfill réussi.
  - `src/lib/livrablesPlanningSync.test.js` : 40+ tests Vitest sur les
    helpers purs (dates + round-trip, classification, couleurs, payloads,
    patches partiels, reverse patches, diff detection, shouldHave).
- **Contrat suivant** : le planning UI (LIV-5+) devra détecter
  `event.source in (livrable_etape, projet_phase)` et router les edits vers
  `updateEtape/updatePhase` via `eventPatchToEtapePatch/PhasePatch`. Pas de
  listener events dans `useLivrables` — le contrat est "tout passe par les
  mutations étape/phase côté LIV", le self-echo de l'update event n'a pas
  besoin de handler séparé.
- **Validation** : `npm run lint` → 0 erreur sur les 4 fichiers. `node
  --check` OK. Tests Vitest à lancer côté Hugo (sandbox Linux ARM64 vs
  darwin-arm64, connu).

### Session 2026-04-24 (suite) — LIV-5 (Page LivrablesTab — structure vue liste)

- **LIV-5 ✅** : 1 fichier entièrement réécrit (`src/pages/tabs/LivrablesTab.jsx`,
  ~340 lignes, remplace le placeholder de 171 lignes).
  - **Gating permissions** : `useProjectPermissions(projectId).can('livrables',
    ...)`. `canRead=false` → écran `AccessDenied` (icône Lock + texte d'aide).
    `canEdit=false` → CTA masqués (mode lecture). `projectId` passé à
    `useLivrables` conditionnellement (`canRead ? projectId : null`).
  - **Header** (`LivrablesHeader` sous-composant) : icône CheckSquare + titre
    "Livrables" + 4 compteurs (Total / Actifs / En retard / Livrés — icônes
    CheckCircle2 / Clock / AlertTriangle + couleur contextuelle) + CTA
    "Nouveau bloc".
  - **Liste des blocs** (`BlockCard` sous-composant) : pastille couleur 8px
    (`style={{ background: bloc.couleur }}`), nom + préfixe, compteur de
    livrables ; corps : liste verticale des livrables avec `numero` en mono +
    `nom` + pill de statut (via `LIVRABLE_STATUTS` de `livrablesHelpers`).
    Mode lecture cache les menus d'action.
  - **Empty state** : icône Inbox + h2 "Aucun bloc encore" + paragraphe d'aide
    + CTA "Créer un bloc" (si `canEdit`).
  - **États annexes** : loading spinner, error screen (icône AlertTriangle +
    message), AccessDenied (icône Lock + explication "demande l'accès à un
    admin").
  - **Création de bloc câblée** : `handleCreateBlock(actions, nextSortOrder)`
    utilise le helper `prompt()` de `src/lib/confirm.js` (titre "Nouveau bloc",
    message explicatif avec exemples MASTER / AFTERMOVIE / SNACK CONTENT,
    placeholder "AFTERMOVIE / RÉCAP", required:true). Appelle
    `actions.createBlock({ nom, couleur, sort_order })` avec rotation des
    couleurs depuis `LIVRABLE_BLOCK_COLOR_PRESETS`.
- **Hors scope LIV-5, remis à plus tard** :
  - **Reverse sync planning** (drag event miroir → `updateEtape` via
    `eventPatchToEtapePatch`) : à câbler côté PlanningTab quand LIV-9 existera,
    pas dans LivrablesTab.
  - **Filtres** (monteur / statut / Mes livrables) : LIV-15.
  - **Édition / suppression / drag&drop des blocs** : LIV-6 (juste en dessous).
  - **Table livrables inline editable** : LIV-7.
  - **Responsive cards sur mobile** : pris en compte dans LIV-7 quand l'UI
    livrable sera dense. Pour l'instant la liste actuelle est déjà fluide en
    mobile (pas de table horizontale).
- **Validation** : `npx eslint src/pages/tabs/LivrablesTab.jsx` → 0 warning
  (après fix : retrait imports `useCallback`/`useState` non utilisés +
  échappement de 2 apostrophes dans le texte AccessDenied). Pas de Vitest
  sur ce fichier (UI).

### Session 2026-04-24 (suite) — LIV-6 (CRUD blocs + drag & drop)

- **LIV-6 ✅** : extraction architecturale + CRUD blocs complet.
  - **Nouveaux fichiers** :
    - `src/features/livrables/components/LivrableBlockCard.jsx` (~470 lignes) :
      carte d'un bloc. Porte rename inline (click titre → input → Enter / Esc),
      popover palette couleur (5×2 grid des `LIVRABLE_BLOCK_COLOR_PRESETS`),
      édition préfixe inline (max 4 car, uppercase auto, champ "+ préfixe" si
      vide), menu `...` (Renommer / Préfixe / Couleur / Supprimer), collapse/
      expand via chevron, handle GripVertical pour drag & drop, suppression
      soft avec toast custom `react-hot-toast` qui expose un bouton **Annuler**
      pendant 5 s → `actions.restoreBlock(block.id)`.
    - `src/features/livrables/components/LivrableBlockList.jsx` (~80 lignes) :
      orchestre la liste et capte le drag & drop inter-blocs. Pattern
      strictement miroir de `features/materiel/components/BlockList` :
      `dragBlockIdx` ref pour l'index source, `dragOverBlockIdx` state pour
      l'outline bleu, `handleReorderBlocks(from, to)` = splice + `actions.reorderBlocks(orderedIds)`.
  - **`LivrablesTab.jsx`** : réduit de 95 lignes, délègue au nouveau `LivrableBlockList`.
  - **Drag & drop** : HTML5 natif (pas d'installation `@dnd-kit`, aligné avec
    MAT-9D). Header du bloc est à la fois drag-source (`draggable`) et
    drop-target. `setData('text/plain', ...)` requis pour Firefox.
- **Bug fix en live** : le popover du menu `...` était clippé par
  `overflow-hidden` sur la `<section>` (seuls Renommer + Préfixe visibles,
  Couleur + Supprimer masqués). Correction : retrait d'overflow-hidden +
  ajout de `rounded-t-xl` sur le `<header>` pour préserver les coins arrondis
  supérieurs du bg-elev. Le popover Actions et la palette couleur s'étendent
  maintenant librement.
- **Hors scope LIV-6** :
  - Drag & drop des livrables dans un bloc → LIV-11.
  - Corbeille UI (voir les blocs soft-deleted) → LIV-20.
  - Duplication de bloc → pas dans la roadmap (pas demandé côté blocs —
    seule la duplication de livrable est prévue à LIV-12).
- **Validation** : `npx eslint` → 0 warning sur les 3 fichiers (`LivrablesTab`
  + 2 nouveaux). Smoke test manuel côté Hugo OK après fix popover.

### Session 2026-04-24 (suite) — LIV-7 (CRUD livrables + inline edit + numérotation auto)

- **LIV-7 ✅** : édition fine des livrables. Pattern responsive MAT-RESP-1
  (table desktop / cards mobile), inline edit tous champs, statut pill
  popover, auto-numero serveur.
  - **Nouveaux fichiers** :
    - `src/features/livrables/components/LivrableStatutPill.jsx` (~130 lignes) :
      pill cliquable + popover des 6 statuts (`brief / en_cours / a_valider /
      valide / livre / archive`). Réutilise `LIVRABLE_STATUTS` de
      `livrablesHelpers`. Props `value / onChange / canEdit / size ('xs'|'sm') /
      align ('left'|'right')`. Click-outside via listener `mousedown` global
      scopé au ref container. Check mark pour le statut actif. Composant à
      vocation réutilisable (LIV-17 widgets, LIV-15 filtres…).
    - `src/features/livrables/components/LivrableRow.jsx` (~350 lignes) :
      ligne `<tr>` desktop avec inline edit. Colonnes : grip 20 / numero 70 /
      nom flex / format 90 / duree 70 / statut 108 / monteur 130 / date 132 /
      liens 112 / menu 32 (≈ 960 px total). Helper `saveField(field, value)`
      unifié : bail-out si inchangé, sinon `actions.updateLivrable`. Monteur =
      texte libre sur `assignee_external` (autocomplete profiles reporté). Liens
      via `<LinkChip>` : placeholder pointillé "+ Frame" / "+ Drive" si vide et
      canEdit, chip coloré `ExternalLink` si URL. Menu `⋯` : Dupliquer, Lien
      Frame.io, Lien Drive, Notes, Supprimer (danger). Props DnD acceptés mais
      neutres — câblage réel en LIV-11.
    - `src/features/livrables/components/LivrableRowCard.jsx` (~360 lignes) :
      carte mobile. Layout : L1 numero + nom + ⋯ / L2 statut pill + format ·
      durée / L3 monteur + date / L4 liens chips / L5 notes textarea 2 rows
      toujours visible. Même helper `saveField` que LivrableRow.
  - **`LivrableBlockCard.jsx`** : switch responsif via `useBreakpoint()`,
    table desktop (`overflow-x-auto` + `minWidth 960px`) ou liste de cards
    mobile. Footer "+ Nouveau livrable" (icône `Plus`) si `canEdit`.
    Handlers : `handleCreateLivrable` (crée avec `nom: ''` — numero auto via
    `actions.createLivrable` qui appelle `nextLivrableNumero` côté hook),
    `handleDeleteLivrable` (confirm → soft delete → `toast.custom` avec
    bouton **Annuler** 5 s → `actions.restoreLivrable`), `handleEditNotes`
    (`uiPrompt` multiline, triggered depuis menu `⋯`). Helper `<Th>` ajouté
    en bas du fichier pour uniformiser les en-têtes de table.
  - **UX notes** :
    - Notes non affichées dans la table desktop (trop long) — edit via
      `uiPrompt({ multiline: true })`. Visibles en textarea inline sur card
      mobile.
    - Inline edit pattern uniforme : `onBlur` OU `Enter` commit, `Escape`
      annule. Optimistic update assuré par `useLivrables.updateLivrable`
      (patche le state avant `await`).
    - Soft delete pattern MAT-10I : `actions.deleteLivrable(id)` +
      `toast.custom` avec callback **Annuler** qui dismiss le toast et
      relance `restoreLivrable`.
- **Polish LIV-7 (intégré au même ticket)** : 4 itérations UX sur la table
  livrables, post-validation visuelle initiale.
  - **Bug fix** : menu `⋯` (et popover statut) clippés en bas par le wrapper
    `overflow-x-auto` de la table — la spec CSS force `overflow-y: auto` sur
    l'autre axe quand un axe est ≠ `visible`. Correction : tous les popovers
    de ligne sont rendus via `createPortal` sur `document.body` avec
    `position: fixed`, position calculée à partir du
    `getBoundingClientRect()` de l'ancre + listeners scroll/resize pour
    recalc ou close. Pattern extrait dans `PopoverFloat.jsx` (réutilisé par
    `LivrableStatutPill`, `LivrableRow.menu`, `LivrableRowCard.menu`,
    `FormatSelect`). Pattern aligné sur `LoueurPillsEditor` (matériel).
  - **Nouveaux helpers** dans `livrablesHelpers.js` :
    - `LIVRABLE_FORMATS = ['16:9', '9:16', '1:1', '4:5', '5:4', '4:3']`
      (presets dropdown, + choix "Autre…" pour texte libre côté UI).
    - `parseDuree(raw) → { ok, normalized, error? }` : parse souple des
      saisies utilisateur :
      - vide → `null`
      - 1-2 chiffres → secondes (`00:XX`, refuse > 59)
      - 3-6 chiffres → `MM:SS` ou `HH:MM:SS` selon longueur
      - `M:SS` / `MM:SS` → normalisé sur 2 chiffres
      - `H:MM:SS` / `HH:MM:SS` → idem
      - validation : segments min/sec ∈ [0..59]
    - `dureeToSeconds(normalized) → number|null` (utile stats LIV-15/17 ; pas
      de migration DB nécessaire, conversion à la volée).
    - `monteurAvatar(name) → { initials, color }|null` : initiales 1-2 lettres
      uppercase (1 mot → 2 premières lettres ; 2+ mots → première lettre du
      premier et du dernier mot) + couleur stable hash djb2 dans une palette
      de 10 teintes (`MONTEUR_AVATAR_COLORS`).
  - **Nouveaux composants** :
    - `PopoverFloat.jsx` (~110 lignes) : helper portal + position fixed + listeners
      scroll/resize/mousedown. Props `anchorRef / open / onClose / align /
      offsetY / children`. N'embarque pas de styling — le contenu fournit son
      propre look.
    - `MonteurAvatar.jsx` (~35 lignes) : pastille initiale colorée 20×20 ou
      24×24. Renvoie `null` si nom vide. API stable : ajouter `profile.avatar_url`
      plus tard ne cassera rien.
    - `FormatSelect.jsx` (~165 lignes) : dropdown des `LIVRABLE_FORMATS` +
      "Autre…" (bascule sur input texte libre) + "Effacer" (si valeur déjà
      saisie). Utilise `PopoverFloat` pour échapper à `overflow-x-auto`.
    - `DurationInput.jsx` (~95 lignes) : input texte qui appelle `parseDuree`
      à `onBlur`/`Enter`, normalise avant commit. Erreur affichée en
      border-bottom rouge dashed + `title` (tooltip natif). `Escape` revert.
  - **Intégrations** :
    - `LivrableRow.jsx` : pastille rouge (`var(--red)`, dot 1.5×1.5) à gauche
      du `numero` si `isLivrableEnRetard(livrable) === true`. Cellule
      `Livraison` passe en rouge si retard. Format → `<FormatSelect>`. Durée
      → `<DurationInput>`. Cellule monteur a maintenant `<MonteurAvatar>` à
      gauche de l'input. Menu `⋯` rendu via `<PopoverFloat>` au lieu de
      `position: absolute`.
    - `LivrableRowCard.jsx` : dot rouge 2×2 en début de ligne 1 si retard.
      Date passe en rouge si retard. Format/Durée/Avatar/Menu : mêmes
      remplacements que desktop.
    - `LivrableStatutPill.jsx` : popover déplacé dans `<PopoverFloat>`. API
      inchangée pour l'extérieur.
  - **Saisie rapide en rafale** (`LivrableQuickAdd`, inline dans
    `LivrableBlockCard.jsx`) : le footer "+ Nouveau livrable" passe d'un
    bouton `(click → ligne avec nom 'Nouveau livrable' à effacer)` à un
    input inline (icône `Plus` + placeholder `Nouveau livrable… (Entrée pour
    valider)`). Pattern aligné sur `BlockItemAdder` (matériel) en version
    simplifiée (pas de catalogue côté livrables) :
    - Click sur la zone (icône / vide à droite) → focus l'input.
    - Entrée (avec contenu) → `actions.createLivrable({ data: { nom } })` +
      reset l'input + garde le focus → saisie en rafale possible.
    - Entrée (vide) → crée une ligne avec le default serveur "Nouveau
      livrable" (cas pratique : l'utilisateur préfère poser une ligne vide
      à remplir plus tard).
    - Escape → reset + blur. Blur naturel → reset.
    - Wrapping `<div onMouseDown>` au lieu de `<button>` pour éviter
      l'imbrication input-dans-button (invalide HTML5). `e.preventDefault()`
      sur `mouseDown` hors-input pour ne pas voler le focus.
- **Validation polish** : ESLint clean (0 warning sur 8 fichiers concernés).
  Parse-check `@babel/parser` OK sur les 7 fichiers JSX + 1 helper. Smoke
  test des helpers via dynamic import :
  - `parseDuree('1:30') → 01:30`, `parseDuree('130') → 01:30`,
    `parseDuree('45') → 00:45`, `parseDuree('01:30:00') → 01:30:00`,
    `parseDuree('99:99') → erreur Secondes > 59`,
    `parseDuree('60') → erreur Secondes > 59`,
    `parseDuree('abc') → erreur format`.
  - `dureeToSeconds('01:30') = 90`, `dureeToSeconds('01:30:00') = 5400`.
  - `monteurAvatar('Hugo') = { initials: 'HU', color: '#10b981' }`,
    `monteurAvatar('Marie Dupont') = { initials: 'MD', color: '#0ea5e9' }`.
- **Hors scope LIV-7** (reporté) :
  - **Autocomplete monteur** (profiles du projet) → ticket de suite. MVP =
    texte libre sur `assignee_external`.
  - **Drag & drop livrables** → LIV-11.
  - **Duplication livrable** → LIV-12 (bouton déjà présent dans le menu,
    câblé à `actions.duplicateLivrable` qui existe mais sera consolidé à
    LIV-12).
- **Validation** : ESLint clean sur les 4 fichiers (0 warning, 0 error).
  Parse-check via `@babel/parser` (plugins: `['jsx']`) OK. Build/test Vitest
  non exécutés — rollup module natif `@rollup/rollup-linux-arm64-gnu` absent
  du `node_modules` (machine Mac M1 côté user, sandbox Linux ARM64). `npm
  install` éviterait l'écrasement d'`node_modules` côté Mac, donc skip.

### Prochaine étape — LIV-8 (Table versions + UI historique)

Créer le modal "Historique des versions" pour chaque livrable :
  - **Trigger UI** : bouton/lien "v1, v2, …" cliquable sur la ligne (desktop)
    ou dans la card mobile → ouvre un modal/drawer.
  - **Timeline** : liste triée des versions (`livrables_versions` ?) avec
    `numero_version`, `date`, `lien` (frame/drive), `commentaire`, `auteur`.
  - **Actions** : ajouter version (form inline), éditer commentaire/lien d'une
    version existante, supprimer (soft ou hard à valider). Actions
    `addVersion / updateVersion / deleteVersion` déjà exposées par
    `useLivrables` (cf. LIV-3) — câblage UI pur.
  - **Statut vs version** : une nouvelle version remet-elle le statut à
    `a_valider` ? → à trancher avec Hugo.
  - **Responsive** : drawer plein écran mobile / modal centered desktop
    (réutiliser pattern des modals déjà existants dans `shared/components`).

Voir roadmap §4.2 pour le schéma exact de `livrables_versions` et les props
des actions `useLivrables`.
