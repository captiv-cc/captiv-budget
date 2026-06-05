# CHANTIER — Notes & Docs (collab temps réel)

> Outil DESK dédié à l'écriture collaborative : briefs, notes de réa,
> documentation projet, retex post-prod. **Vision : Google Docs intégré
> au projet, sans devoir basculer sur Notion.**

---

## 🎯 Vision produit

Un nouvel outil DESK, à côté du Déroulé / Devis / Techlist / Materiel /
Logistique, qui s'appelle **"Notes & Docs"** (ou **"Pages"**, ou
**"Wiki"** — à trancher au moment du chantier).

**Capacités cibles** :

- Plusieurs **pages** par projet, organisées hiérarchiquement (liste plate
  V1, arbo plus tard)
- Chaque page = un document riche éditable à plusieurs en temps réel
- Curseurs colorés inline des autres éditeurs (Tiptap + Y.js Awareness)
- Merge automatique des modifs concurrentes (CRDT Y.js, pas de conflit)
- Mentions `@membre` → notification (push PWA / mail)
- Embed images, vidéos, liens
- Tables, listes, headings, blockquotes, code blocks
- Historique des versions (snapshot horaire ou sur diff significatif)
- Export PDF avec le style devis Captiv
- Commentaires inline (post-MVP)

**Cas d'usage** :

- Brief client co-écrit pendant un appel
- Notes de prod partagées équipe technique
- Retex post-prod : ce qui a bien marché / à améliorer
- Plan de tournage long format / découpage
- Documentation technique d'une captation (config caméras, schéma régie)
- Process / checklists internes Captiv (transversal projet, dans un
  espace "Équipe" plutôt que "Projet" ?)

---

## 🏗️ Architecture

### Couche éditeur (déjà en place après Sprint 2 Déroulé)

- **Tiptap** : framework React, extensions B/I/H1-H3/listes/lien/code/quote
- Stockage : **JSON ProseMirror** dans une colonne `content JSONB`
- Composant `<RichEditor />` réutilisé tel quel, juste avec
  `collaboration={{ provider }}` en plus

### Couche collab temps réel (à activer ici)

- **Y.js** : CRDT qui modélise le doc en op-based, merge sans conflit
- Extension Tiptap officielle : `@tiptap/extension-collaboration` +
  `@tiptap/extension-collaboration-cursor`
- **Awareness Y.js** : présence fine-grain (curseur, sélection, user
  meta) → curseurs colorés visibles inline

### Couche sync (le choix d'infra)

Trois options évaluées :

| Option | Avantages | Inconvénients |
|---|---|---|
| **Hocuspocus** (serveur Node officiel Tiptap) | Propre, prêt à l'emploi, ecosystem | +1 service à héberger (Railway/Fly/Vercel Function), ~10-20€/mois |
| **y-supabase** (lib communauté) | Reste 100% Supabase | Maintenance sporadique, peu de prod en France |
| **Custom bridge Realtime → Y.js** | Reste 100% Supabase, simple à comprendre | ~1-2j à coder, à maintenir |

**Reco actuelle** : custom bridge. On a déjà la stack Supabase Realtime
en main (cf. `useEquipePresence`), on l'étend pour broadcaster les
updates Y.js binaires (base64 dans le payload). Snapshot du doc en
JSON ProseMirror dans la table `notes_docs` toutes les N secondes
(debounce).

### Persistence

- Table `notes_docs` :
  - `id UUID`
  - `project_id UUID FK projects`
  - `parent_id UUID NULL FK notes_docs` (arbo)
  - `titre TEXT`
  - `content JSONB` (snapshot ProseMirror)
  - `ydoc BYTEA` (état Y.Doc sérialisé, optionnel pour reconnexion rapide)
  - `created_by UUID`, `created_at`, `updated_at`
  - `version INT` (auto-increment via trigger pour optimistic concurrency)
- Table `notes_docs_versions` (historique snapshots) :
  - `doc_id UUID FK`, `version INT`, `content JSONB`, `created_at`,
    `created_by`

### Présence haute (réutilisée de l'existant)

- Pattern `useEquipePresence` / `useMaterielPresence` → `useNotesPresence`
- Channel `notes-presence:${projectId}` (ou `:${docId}` selon le scope)
- `editing_row_id` devient `editing_doc_id`
- `<PresenceAvatars>` affichés dans le header de la page Notes & Docs

---

## 📋 Sprints (estimation)

### Sprint NDOC-1 — Migration + structure (2j)
- Migration `notes_docs` + `notes_docs_versions`
- RLS : `can_read_outil('notes')` / `can_edit_outil('notes')`
- Ajouter outil 'notes' au catalogue des permissions
- Endpoint share token (lecture seule public, future)

### Sprint NDOC-2 — UI navigation + CRUD pages (3j)
- Onglet "Notes & Docs" dans la nav projet
- Sidebar liste des pages (création, suppression, renommage)
- Page vide avec `<RichEditor />` (single-user pour l'instant)
- `useNotesPresence` + avatars header

### Sprint NDOC-3 — Activation collab Y.js (3-4j)
- Install `@tiptap/extension-collaboration` + `@tiptap/extension-collaboration-cursor` + `yjs`
- Bridge Supabase Realtime ↔ Y.js (broadcast updates binaires)
- Awareness : user meta (user_id, full_name, couleur déterministe)
- Snapshot debounced en BDD (toutes les 3s d'inactivité)
- Tests multi-onglets / multi-utilisateurs

### Sprint NDOC-4 — Mentions + notifications (2j)
- Extension Tiptap `Mention` avec autocomplete sur membres projet
- Trigger Postgres : à chaque mention, créer entrée `notifications`
- Push PWA (cf. CHANTIER_MOBILE_PWA) si actif, sinon mail

### Sprint NDOC-5 — Embed images + export PDF (2j)
- Upload image → bucket Supabase Storage scoped au projet
- Extension Tiptap `Image` + résolution upload-promise
- Export PDF : via `html2pdf` ou rendu serveur ?
  - Préférence : rendu côté serveur (Edge Function) pour fidélité
  - Style devis Captiv réutilisé

### Sprint NDOC-6 — Historique versions + diff viewer (3j)
- Liste des versions dans un panel latéral
- Restauration version → crée une nouvelle version "rollback"
- Diff visuel (ajouts en vert / suppressions en rouge) via Y.js
  snapshots ou ProseMirror diff

### Sprint NDOC-7 — Arbo + recherche (2j)
- Drag-drop pour réorganiser hiérarchie pages
- Recherche full-text (PostgreSQL tsvector sur `content` extrait)

### Sprint NDOC-8 — Commentaires inline (3j, post-MVP)
- Extension Tiptap pour highlights commentés
- Panel latéral avec fil de discussion
- Résolution / réouverture

---

## 🔗 Dépendances avec autres chantiers

- **Sprint 2 Déroulé** : installe Tiptap + crée `<RichEditor />`. NDOC
  hérite de ce composant.
- **CHANTIER_MOBILE_PWA** : nécessaire pour push notifications sur
  mentions (mobile). Sinon mail fallback OK.

---

## 🚧 Points à trancher avant lancement

1. **Nom de l'outil** : Notes & Docs / Pages / Wiki / Docs
2. **Scope** : 100% projet, ou un espace "Équipe Captiv" transversal pour
   process internes ?
3. **Hocuspocus vs bridge Supabase** : selon disponibilité ops / volume
   d'utilisateurs simultanés au moment du lancement
4. **Extension AI (Tiptap Pro payant)** : "résume ce paragraphe",
   "traduire en anglais", etc. Probablement bonne idée vu le positionnement
   Captiv, mais coût d'extension + API Anthropic à budgéter.

---

## 📅 Timing prévisionnel

À planifier après :
- ✅ Sprint 1 Festival Déroulé terminé
- ⏳ Sprint 2 Festival Déroulé (Tiptap base posée)
- ⏳ Sprint 3-7 Festival Déroulé (extension importante prévue)
- ⏳ Logistique V1 / V2 si décidée
- ⏳ CHANTIER_MOBILE_PWA (au moins le palier PWA pour push)

Estimation totale chantier complet : **20-25 jours** (NDOC-1 à NDOC-7,
NDOC-8 optionnel).
