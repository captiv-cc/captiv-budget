# PLAN — Plans techniques collaboratifs

> **Statut** : 🚧 **V0 POC en cours** (2026-07-05)
> **Date d'ouverture** : 2026-07-05
> **Owner** : Hugo MARTIN
> **Tag commits** : `feat(plans) — <titre>` / `fix(plans) — <titre>`

## Contexte / besoin

L'onglet Plans actuel (PLANS V1, mai 2026) est une bibliothèque de fichiers :
upload PDF/PNG/JPG, catégories org, versions, viewer plein écran, partage
équipe. C'est déjà utilisé en terrain, il ne faut PAS le casser.

On l'étend en vrai **éditeur de plans techniques collaboratifs** avec valeur
client : dessiner un plan caméra/lumière/son sur un fond importé, en
multi-utilisateur temps réel, le partager au client (lecture seule +
commentaires ancrés + validation), l'exporter en PDF.

Positionnement : entre **Excalidraw** (simple, collab) et **Vectorworks
Spotlight** (spécialisé scéno), avec la spécialisation audiovisuel
événementiel Captiv : bibliothèque d'icônes caméras/lumière/son, cônes de
vue par focale, échelle, cotations.

## Vision UX

3 vues :

1. **Liste des plans du projet** — sub-nav `Éditables | Fonds importés | Archivés`.
   Cards avec preview miniature, catégorie colorée, versions, éditeurs actifs.
   "Fonds importés" = l'onglet Plans existant, inchangé.
2. **Éditeur canvas** — toolbar tldraw + bibliothèque Captiv à gauche, canvas
   central, panel droit (layers / propriétés / participants). Collab realtime.
3. **Mode client partagé** — URL token, lecture seule, commentaires ancrés,
   téléchargement PDF, bouton "Valider".

## Choix techniques verrouillés

| Décision | Valeur |
|---|---|
| Canvas | **tldraw v5** (Apache 2 → licence *"tldraw"* watermark par défaut ; React, undo/redo, layers, export image intégrés). PAS de Fabric.js / canvas custom. |
| Collab | **Yjs + Supabase Realtime broadcast** — réutilise `useYjsCollab` (pattern Notes déroulé). `y-tldraw` **n'existe pas sur npm** → bridge custom ~100 lignes sur le modèle officiel `tldraw/tldraw-yjs-example` (`store.listen` ↔ `Y.Map` de records). |
| Storage fonds | Bucket `plans` existant (privé, signed URLs) — rien à créer. |
| Import | PNG/JPG natif, PDF rasterisé via pdf.js (déjà dans le projet). Pas de DWG/DXF en V1. |
| Permissions | `OUTIL_KEY = 'plans'` existant : `can_read_outil` / `can_edit_outil(project_id, 'plans')`. |
| Persistance doc | État Yjs (`Y.encodeStateAsUpdate`) encodé **base64 dans une colonne text** (`ydoc_state`) — plus simple que bytea avec supabase-js, ~33% d'overhead acceptable (docs de quelques centaines de Ko max). |

## Écarts vs cadrage initial (décisions d'implémentation)

Le cadrage supposait un onglet "simple upload" : l'existant est en fait un
système complet (tables `plans`, `plan_versions`, `plan_categories`,
`plans_share_tokens`, bucket + RLS). Conséquences :

- **Pas de table `plans_fonds`** : la table `plans` existante EST la
  bibliothèque de fonds. `plans_canvas.fond_id → plans(id)`.
- **Les documents éditables vivent dans `plans_canvas`** (le nom `plans`
  était pris) + `plans_canvas_versions` pour l'historique.
- **Pas de CHECK catégorie hardcodé** : on réutilise `plan_categories`
  (per-org, personnalisable, colorées) via `category_id`, comme les fonds.
- **RLS** : pattern outils existant (`can_read_outil`/`can_edit_outil`), pas
  de `project_access` (n'existe pas dans cette base).
- Les commentaires ancrés et tokens de partage client (Phase 3) auront leurs
  tables dédiées `plans_canvas_comments` / `plans_canvas_share_tokens`
  (les `plans_share_tokens` existants partagent des FICHIERS, sémantique
  différente).

## Schéma BDD

### `plans_canvas` (migration `20260705a_plans_canvas_v1.sql`)
```
id               uuid PK
project_id       uuid FK projects ON DELETE CASCADE
titre            text NOT NULL
description      text
category_id      uuid FK plan_categories ON DELETE SET NULL
fond_id          uuid FK plans ON DELETE SET NULL   -- fichier source en fond
ydoc_state       text                                -- état Yjs base64
snapshot_svg     text                                -- preview miniature (Phase 2)
echelle_ratio    numeric                             -- 1 unité canvas = X mètres (Phase 4)
version_current  int DEFAULT 1
statut           text CHECK (brouillon|partage_client|valide|archive) DEFAULT 'brouillon'
created_by/at, updated_by/at
```

### `plans_canvas_versions`
```
id            uuid PK
canvas_id     uuid FK plans_canvas ON DELETE CASCADE
version       int          -- UNIQUE (canvas_id, version)
ydoc_state    text         -- snapshot figé
snapshot_svg  text
commentaire   text
created_by/at
```

### Phase 3 (à créer plus tard)
`plans_canvas_share_tokens` (token, expires_at, permissions view|comment) et
`plans_canvas_comments` (anchor_x/y, threads via parent_id, author user|client,
resolved) — cf. cadrage produit. Route publique `/plans/share/:token` servie
par une Edge Function qui valide le token (bypass RLS service role).

### `plans_library_items` (Phase 2)
Bibliothèque org d'éléments (categorie, sous_categorie, nom, svg_content,
default_props jsonb, tags[]). Seed ~60 éléments : caméras (FX6, FX3, A7S,
drone, Ronin, jib), lumière (Fresnel, Skypanel S30/S60, LED bar, PAR64,
moving), son (perche, HF, HP), personnes, structures (truss, mât, grill),
décors (podium, écran LED), signalétique (extincteur, sortie secours).

## Architecture front (packages/web)

```
src/pages/tabs/PlansTab.jsx            wrapper sub-nav (Éditables | Fonds | Archivés)
src/pages/tabs/PlansFondsView.jsx      ex-PlansTab (renommé, inchangé fonctionnellement)
src/lib/plansCanvas.js                 CRUD plans_canvas + save état Yjs
src/hooks/useYjsTldraw.js              bridge Y.Map ↔ TLStore (sur useYjsCollab)
src/features/plans/canvas/
  PlansCanvasList.jsx                  liste éditables/archivés + création
  PlanEditor.jsx                       overlay plein écran tldraw + collab + autosave
  shapes/                              (Phase 2) CameraShape, ProjecteurShape, …
  LibraryPanel.jsx                     (Phase 2)
  PlanClientView.jsx                   (Phase 3)
```

Ouverture éditeur : URL state `?canvas=<id>` dans l'onglet Plans (même pattern
que `?plan=<id>` du viewer fonds) → overlay plein écran, pas de route dédiée.

### Sync collab (bridge useYjsTldraw)

- `doc.getMap('tldraw')` : `record.id → record` (records tldraw scope
  'document' uniquement — pas caméra/instance qui restent locaux).
- local → Yjs : `store.listen({source:'user', scope:'document'})` →
  `doc.transact(set/delete, 'local')`.
- Yjs → store : `yMap.observe` (origin ≠ local/persist) →
  `store.mergeRemoteChanges(put/remove)`.
- Restauration : `Y.applyUpdate(doc, base64(ydoc_state), 'persist')` au mount.
- Autosave : debounce 2s sur `doc.on('update')` → `saveCanvasState()`.
- Présence : `peers` de useYjsCollab → avatars top bar (curseurs live sur le
  canvas = Phase 2 via awareness → InstancePresence tldraw).

## Phasage

**Phase 0 — POC** ✅ livrée (2026-07-05, commit 4e8fea3)
- [x] Migration `plans_canvas` + `plans_canvas_versions` + RLS (appliquée)
- [x] `npm i tldraw` (v5, lazy chunk)
- [x] PlansTab sub-nav sans casser l'existant
- [x] PlanEditor minimal : tldraw + bridge Yjs + autosave + restauration
- [x] Test validé par Hugo : persistance + sync 2 navigateurs + présence

**Phase 1** ✅ livrée (2026-07-05)
- [x] Modale de création (titre, catégorie, fond choisi dans la bibliothèque)
- [x] Fond affiché dans le canvas : asset tldraw avec chemin storage en meta
      (`captivStoragePath`), résolu par client en object URL via TLAssetStore
      custom (`makeCaptivAssetStore`) — jamais d'URL signée ni de base64 dans
      le doc Yjs. PDF rasterisé page 1 (~2500px max) par client. Shape
      verrouillée + envoyée derrière, ids déterministes (shape:fond).
- [x] Images collées/déposées dans le canvas : upload bucket plans sous
      `<project_id>/canvas/<canvas_id>/`, même mécanique de résolution.
- [x] Titre renommable + catégorie changeable dans la top bar de l'éditeur
- [x] Lecture seule pour les membres sans can_edit_outil (isReadonly tldraw)
- [x] Archivage / restauration / suppression (V0)
- [ ] Changement de fond en cours de session non répercuté live (réouvrir) —
      accepté pour l'instant

**Phase 2** ✅ première passe livrée (2026-07-05) — cible UX = mockup Hugo
- [x] Shapes custom : `captiv-camera` (cône de vue = géométrie de la box,
      apex bas-centre, focale → largeur via FOV plein format, badge numéroté
      auto, rotation native) et `captiv-item` (glyphe par kind + label)
- [x] Catalogue ~32 éléments (shapes/catalog.jsx) : caméras (FX6, FX3, A7S,
      drone, Ronin, jib, épaule), lumière, son, personnes, structures,
      régie, signalétique — glyphes SVG schématiques (vraies icônes en V2)
- [x] LibraryPanel gauche (catégories, recherche, clic → placé au centre)
- [x] PlanSidePanel droit : onglets Layers | Propriétés + résumé sélection
      caméra (focale, angle) comme le mockup
- [x] Layers fixes par meta.layer (fond/zones/caméras/éclairage/son/
      personnes/structures/annotations) : œil = meta.hidden (via
      getShapeVisibility) et cadenas = isLocked — états DANS les shapes donc
      partagés en collab et persistés (comportement Figma)
- [x] Propriétés caméra : label, modèle, focale presets (14→135mm, recalcule
      le cône), couleur, cône on/off ; item : label, couleur
- [x] Export PNG (toImage ×2) et PDF A4 (jspdf, déjà dans le projet)
- [x] Miniature : JPEG dataURL (~480px) généré à la fermeture de l'éditeur
      → plans_canvas.snapshot_svg (colonne réutilisée, contenu dataURL) →
      affichée dans les cards de la liste
- [ ] Reste Phase 2+ : drag-drop depuis la bibliothèque (clic-placement en
      V1), curseurs collaborateurs nommés sur le canvas, "Nouveau layer"
      libre, vraies icônes designées, bouton Versions (snapshots figés)

**Phase 3 (Client)** — tokens de partage, route publique + Edge Function,
commentaires ancrés realtime, bouton Valider, PDF avec légende.

**Phase 4 (Différenciation)** — cônes de vue par focale, cotations, zones
nommées avec surface, versionning visuel, templates de configuration.

**Phase 5 (Intégration DESK)** — liens plan ↔ déroulé (config active par
créneau horaire), ↔ équipe (cadreur assigné à une position), ↔ matériel
(la FX6 #1 du module Matériel sur le plan), vue plan dans le brief créneau.

## Points d'attention

- **Perf** : tldraw tient quelques milliers d'éléments ; limiter la
  bibliothèque à l'utile. Broadcast Supabase = payloads JSON base64 → si les
  docs grossissent (> ~500 Ko), envisager Hocuspocus (cf. note useYjsCollab).
- **Mobile** : lecture + zoom seulement en V1 (l'édition reste desktop/iPad).
- **Icônes** : SVG génériques/Tabler au départ, vraies icônes designées en V2.
- **Undo/redo vs collab** : tldraw gère l'undo local ; via le bridge, un undo
  local se propage comme une modif normale — comportement attendu.
- **Autosave vs versions** : autosave continu (ydoc_state) + bouton "Créer une
  version" (Phase 2) qui fige un snapshot dans plans_canvas_versions.
