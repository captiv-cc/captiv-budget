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
| LIV-3 | Lib `livrables.js` + hook `useLivrables` | L | CRUD complet + Realtime + helpers purs |
| LIV-4 | Sync bidirectionnelle events (lib `livrablesPlanningSync.js`) | L | Hooks applicatifs, trigger à la création/edit/delete |
| LIV-5 | Page `LivrablesTab` (structure vue liste) | M | Layout, routing, gating permissions, empty state |
| LIV-6 | CRUD blocs + drag & drop | M | Créer/rename/delete + reorder (pattern MAT-9D) |
| LIV-7 | CRUD livrables + inline edit + numérotation auto | L | Tous les champs éditables, autocomplete monteur |
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
- Comportement précis d'un event planning supprimé depuis le planning
  (détacher vs recréer vs toast) — à trancher à LIV-4.
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

### Prochaine étape — LIV-3 (data layer)

Lib `src/lib/livrables.js` (CRUD config / blocks / livrables / versions /
étapes / phases) + hook `src/hooks/useLivrables.js` avec Realtime + helpers
purs (compteurs retard, prochain). Pattern miroir de `useMateriel`.
Optimistic dès la V1 (pattern MAT-9B-opt). Effort : 2-3 jours.
