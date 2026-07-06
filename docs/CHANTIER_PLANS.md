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
| Canvas | **tldraw v5** — licence SDK tldraw (PAS Apache 2 contrairement au cadrage initial) : gratuit avec watermark « Made with tldraw », y compris en usage commercial, fonctionnalités complètes. **Décision Hugo 2026-07-05 : on garde le watermark** (pas de budget licence). PAS de Fabric.js / canvas custom. |
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
- [x] Remplacement/retrait du fond depuis l'éditeur (bouton « Fond » →
      FondPickerModal) — passe par le doc Yjs, donc répercuté en LIVE chez
      les collaborateurs (l'ancienne limite « réouvrir » est levée)

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

**Phase 3 (Client)** ✅ livrée (2026-07-05) — à ACTIVER : appliquer
`20260705b_plans_canvas_share.sql` + `supabase functions deploy plans-public
--no-verify-jwt`
- [x] Tables plans_canvas_share_tokens (view|comment, expiration, révocation,
      compteur de vues) + plans_canvas_comments (ancrage page x/y, threads
      parent_id, auteur user/client, resolved) + realtime commentaires
- [x] Edge function plans-public : get (plan + ydocState + org/projet +
      commentaires), sign-assets (URLs signées restreintes au project_id),
      comment (permissions comment), validate (statut → valide)
- [x] Desk : bouton « Partager au client » (modale lien : permissions,
      validité 7/30/90j/∞, copier, révoquer, vues) ; statut brouillon →
      partage_client ; badge statut top bar + chips liste
- [x] Desk : commentaires realtime — marqueurs jaunes numérotés sur le
      canvas, onglet « Comms » (threads, répondre, résoudre/rouvrir,
      résolus repliés), clic marqueur ↔ liste, centrage sur l'ancre
- [x] Page publique /plans/share/:token (lazy) : tldraw lecture seule (doc
      reconstruit du ydoc_state, assets via URLs signées, PDF rasterisés
      client), SharePageHeader liquid glass, mode « Commenter » (clic sur le
      plan → bulle nom+message, nom mémorisé), threads, bouton « Valider le
      plan », téléchargement PNG
- [ ] PDF avec légende (repoussé en Phase 4 avec cotations/échelle)

**Phase 4 (Différenciation)** ✅ cœur livré (2026-07-05)
- [x] Cônes de vue par focale (livrés dès la Phase 2)
- [x] Échelle du plan : étalonnage 2 clics + distance réelle (bouton
      Échelle, vert quand définie) → plans_canvas.echelle_ratio (m/px) +
      meta.metersPerPx de la page tldraw (lue par les shapes, synchronisée
      collab, embarquée dans le doc → la page publique affiche les mètres)
- [x] CotationShape ('captiv-cote') : 2 poignées, traits d'extrémité,
      étiquette de distance auto (m si échelle, px sinon), layer Cotations
- [x] ZoneShape ('captiv-zone') : rectangle translucide nommé + dimensions
      réelles et surface (« 12 × 8 m · 96 m² », toggle), layer Zones,
      reprise dans la légende de la page publique
- [x] Bibliothèque : catégorie « Zones & mesures »
- [x] Versionning : bouton « Versions » → figer l'état courant (snapshot
      JPEG + commentaire, table plans_canvas_versions, version_current++),
      liste avec vignettes/auteur/date, restauration (remplace shapes/assets/
      bindings, propagée collab via le bridge)
- [x] Duplication d'un plan depuis la card (contenu compris, statut brouillon)
- [x] PDF avec légende (lib/planPdfExport partagée desk + page publique) :
      A4 paysage, bandeau titre·catégorie/projet·date, colonne légende
      dérivée du contenu, pied de page
- [ ] Templates de configuration réutilisables (org) — backlog Phase 4+
      (la duplication couvre le besoin intra-projet)

**Sprint « outil complet » — passe 1** ✅ (2026-07-05/06, 15 axes validés
par Hugo sur les 18 proposés après audit ; exclus : #3 « assigné à » pas
encore, #9 cartouche PDF pro à travailler EN SESSION COMMUNE, #18
bibliothèque org plus tard)
- [x] Tailles réelles : realW/realH (m) sur les items du catalogue ; à la
      pose, si l'échelle est définie, l'item prend sa taille réelle
- [x] Nomenclature (menu Exporter) : caméras/items/zones/câbles agrégés,
      métrage câbles avec marge paramétrable (10 % défaut), export CSV
      (BOM + séparateur ;) ; top bar réorganisée en menus Plan ▾ / Exporter ▾
- [x] Câbles magnétiques : binding custom 'captiv-cable-anchor' — les
      extrémités s'ancrent aux caméras/items/zones et suivent leurs
      déplacements ; labels coulissants le long du câble
- [x] Raccourcis capture C (câble, dernier type mémorisé) / X (zone) /
      M (cotation), aide « ? » discrète en bas à droite, alerte (toast,
      1×/session) quand on modifie un plan au statut « validé »
- [x] Robustesse : sauveur élu (multi-éditeurs → seul le plus petit
      clientID persiste), compaction du ydoc quand on est seul (purge des
      tombstones CRDT), miniature rafraîchie toutes les 2 min, tests
      vitest railMath + scale (27 cas)

**Sprint « outil complet » — passe 2** ✅ (2026-07-06)
- [x] #7 Propriétés : sections repliables (Identité/Optique/Apparence,
      état localStorage) + édition groupée multi-sélection (couleur,
      modèle, focale, cônes, type de câble, dims zones — selon ce que la
      sélection a en commun)
- [x] #8 Onglet « Éléments » : inventaire groupé par couche (pastille,
      métrages), recherche, clic = sélection + zoom animé
- [x] #11 Commentaires internes ancrés : bouton « Commenter sur le plan »
      (onglet Comms) → marqueur + bulle de saisie ; colonne `internal`
      (migration 20260706a À APPLIQUER + redéployer plans-public) ; les
      internes sont BLEUS et invisibles des liens de partage ; une réponse
      hérite de la visibilité du thread
- [x] #12 Curseurs nommés live : présence tldraw ↔ awareness Yjs
      (bridge useYjsTldraw, throttle ~12 msg/s) → curseurs collaborateurs
      natifs (nom + couleur)
- [x] #13 Comparaison de versions : bouton « Comparer » dans le viewer —
      état actuel en PNG transparent superposé au canvas de la version,
      aligné page + suivi caméra, slider d'opacité Vn ↔ En cours

**Cartouche PDF pro (#9)** ✅ (2026-07-06, cadré en session avec Hugo)
- [x] Bande cartouche pleine largeur en bas du PDF : logos (1-3, org par
      défaut) | projet/réf/client/lieu/date événement/édité le + Vn |
      personnes rôle+nom (presets + libre, 2 colonnes) | échelle GRAPHIQUE
      (barre segmentée, survit à l'impression « ajuster ») + ratio ≈1:N +
      contact ; mention de pied ; format A3 (défaut)/A4
- [x] Modale « Mise en page du PDF » (menu Exporter), pré-remplie depuis le
      projet (clients, période tournage, module Lieu) ; config persistée
      par plan (migration 20260706b, colonne cartouche jsonb)
- [x] Viewer de version : même cartouche ; page publique : layout
      historique (pas de cartouche dans le payload public pour l'instant)
- Décisions Hugo : PAS de tableau de révisions, PAS de tampon statut,
  PAS de QR code
- Retours intégrés (2026-07-06) : infos libres label+valeur dans le bloc
  projet (« Production : ZQSD »…) ; « Version : Vn du date » ; PAS de
  bandeau noir quand cartouche (titre du plan → en-tête du bloc projet) ;
  colonne droite du PDF = LISTING des caméras dans l'ordre (label +
  modèle · optique) + CÂBLES, repris à l'identique dans la sidebar de la
  page publique ; image du PDF en JPEG q0.85 (un PNG 4096 px du fond
  rasterisé donnait des PDF de 200 Mo)

**⏸ CHANTIER EN PAUSE (2026-07-06)** — reste à faire :
- Licence tldraw : trial 100 jours actif (clé VITE_TLDRAW_LICENSE_KEY
  dans Vercel) → décider licence commerciale avant expiration (~oct. 2026)
- #3 champ « assigné à » sur les caméras (lien équipe)
- #18 bibliothèque d'items niveau org
- Tailles capteur PTZ posées (UE100 1/2,5", UE150/160 1") — à confirmer
  par Hugo ; vraies icônes designées (V2)
- Cartouche sur le PDF de la page publique (payload plans-public à
  enrichir) ; B-contenu bibliothèque (plateforme, catégorie Vidéo,
  public/orga)
- Phase 5 : liens plan ↔ déroulé (config par créneau), ↔ équipe
  (cadreur assigné), ↔ matériel (la FX6 #1 du module Matériel sur le
  plan), vue plan dans le brief créneau

**Backlog hors sprint** : #3 champ « assigné à », #18 bibliothèque org,
tailles capteur réelles des PTZ restantes (valeurs constructeur posées :
UE100 1/2,5", UE150/160 1" — à confirmer), cartouche sur la page publique.

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
