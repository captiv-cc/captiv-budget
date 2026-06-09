# MOD-1 — Module Moodboard (V1)

> **Statut** : cadré, prêt à coder
> **Date d'ouverture** : 2026-06-09
> **Owner** : Hugo MARTIN
> **Estim V1** : ~5j en 9 tickets

## Contexte / besoin

Aujourd'hui l'équipe créa partage ses références d'inspiration via Slack, Drive,
captures d'écran épinglées un peu partout. Ça se perd, ce n'est pas commentable,
et on n'a aucun moyen de structurer la pré-prod visuelle d'un projet.

On veut un onglet **fourre-tout collaboratif live-edit**, où l'on pose des refs
visuelles (reels Insta, vidéos TikTok, posts, sites, captures d'écran, GIFs,
notes brèves...). Chaque ref a une **preview du média**, peut recevoir des
**commentaires + réactions** de l'équipe, et peut être **organisée par
sections nommées**. Style Are.na / Pinterest / Milanote (sans le canvas libre
pour V1).

## Choix actés (cadrage 2026-06-09)

| Décision | Valeur |
|---|---|
| Nom du module | **Moodboard** |
| Layout | **Sections + masonry** (canvas libre éventuel en V2) |
| Stratégie embeds externes | **Hybrid** : OG card par défaut + embed live pour providers connus |
| Card types V1 | `link` / `image` / `video` / `note` (Tiptap rich text) |
| Réactions emoji | **V1** — 4 emojis fixes : 👍 ❤️ 🔥 ⚡ |
| Position onglet | Entre **Musiques** et **Déroulé** dans ProjetLayout |
| Permissions | Nouveau `OUTIL_KEY = 'moodboard'` (`read` + `edit`) |
| Realtime | Pattern Supabase Realtime identique à Musiques |

## Schéma BDD (4 tables)

### `projet_moodboard_sections`
Sections nommées qui empilent les cartes. Une section "Vrac" par défaut créée à la
1re visite si aucune section n'existe.

```
id              uuid PK
project_id      uuid FK projects.id ON DELETE CASCADE
nom             text NOT NULL
color           text  -- hex code ou ref CSS var, optionnel pour la couleur du header
sort_order      real NOT NULL DEFAULT 0  -- fractional ordering
created_at      timestamptz DEFAULT now()
updated_at      timestamptz DEFAULT now()
```

### `projet_moodboard_cards`
Une carte = une ref. Type discriminé par `type` ∈ {link, image, video, note}.

```
id              uuid PK
section_id      uuid FK projet_moodboard_sections.id ON DELETE CASCADE
type            text NOT NULL CHECK (type IN ('link','image','video','note'))
url             text         -- pour type='link' : URL externe
title           text         -- titre éditable, par défaut récupéré via og-fetch
description     text         -- optionnel
image_url       text         -- hero image (OG, vignette vidéo, ou URL Storage)
oembed_html     text         -- HTML d'embed officiel pour providers connus
provider        text         -- 'youtube' | 'tiktok' | 'vimeo' | 'twitter' | 'instagram' | null
file_path       text         -- Storage path pour type='image'/'video'
content_json    jsonb        -- pour type='note' : JSON Tiptap
sort_order      real NOT NULL DEFAULT 0
created_by      uuid FK auth.users.id
created_at      timestamptz DEFAULT now()
updated_at      timestamptz DEFAULT now()
```

### `projet_moodboard_comments`
Commentaires sur une carte. Pattern identique à `projet_musique_comments`.

```
id              uuid PK
card_id         uuid FK projet_moodboard_cards.id ON DELETE CASCADE
user_id         uuid FK auth.users.id
body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000)
created_at      timestamptz DEFAULT now()
updated_at      timestamptz DEFAULT now()
```

### `projet_moodboard_reactions`
Réactions emoji 1 user × 1 emoji × 1 carte.

```
id              uuid PK
card_id         uuid FK projet_moodboard_cards.id ON DELETE CASCADE
user_id         uuid FK auth.users.id
emoji           text NOT NULL CHECK (emoji IN ('thumbs_up','heart','fire','zap'))
created_at      timestamptz DEFAULT now()
UNIQUE(card_id, user_id, emoji)
```

### RLS
Toutes les tables : `read` si le user a `read` sur le projet, `write` si `edit`.
Pattern identique aux tables Musiques (helper RLS existant à réutiliser).

### Realtime publication
Ajouter les 4 tables à la publication Realtime (cf. migration
`20260608e_musique_realtime_publication.sql` pour le pattern).

## Edge Function `og-fetch`

Une seule fonction utilitaire pour résoudre une URL → metadata embed.

**Input** : `{ url: string }`

**Output** :
```json
{
  "title": "string",
  "description": "string",
  "image_url": "string",
  "provider": "youtube|tiktok|vimeo|twitter|instagram|null",
  "oembed_html": "string|null"
}
```

**Logique** :
1. Détection du provider via regex sur l'URL (`youtube.com|youtu.be`, `tiktok.com`, `vimeo.com`, `twitter.com|x.com`, `instagram.com`)
2. Si provider connu : appel oEmbed officiel
   - YouTube : `https://www.youtube.com/oembed?url=...`
   - TikTok : `https://www.tiktok.com/oembed?url=...`
   - Vimeo : `https://vimeo.com/api/oembed.json?url=...`
   - Twitter : pas d'oEmbed public — fabrique un blockquote + script `widgets.js`
   - Instagram : oEmbed restreint, fabrique un blockquote + script `embed.js`
3. Si inconnu OU oEmbed KO : fetch la page HTML, parse les `<meta property="og:*">` tags
4. Si rien : retourne `{ title: url, image_url: null, provider: null, oembed_html: null }` — l'UI affichera une carte minimaliste

**Cache** : on stocke directement `oembed_html` + `image_url` dans la BDD au moment de la création. Pas de refresh auto. Bouton "rafraîchir" manuel dans le drawer si les URLs Storage / embeds vieillissent.

## Card types — comportement détaillé

### `link`
- Création : paste URL → og-fetch → carte rendue avec `image_url` en hero + titre + URL
- Si `oembed_html` présent : bouton "Lire dans la carte" qui inject l'embed (lazy, opt-in pour éviter de charger 50 iframes en parallèle)
- Click carte (corps, hors bouton lire) → drawer
- Edit : titre éditable, description éditable

### `image`
- Création : drop fichier (PNG/JPG/WebP/GIF) OU Ctrl+V depuis clipboard OU file picker → upload Storage → carte
- Bucket Storage : `moodboard/{project_id}/{card_id}.{ext}`
- `image_url` = signed URL ou public URL (TBD selon politique Storage)
- Display : image plein cadre dans la carte (object-fit cover)
- Click → drawer avec image full + commentaires

### `video`
- Création : drop fichier MP4/MOV/WebM OU file picker → upload Storage
- Cap taille : 50 Mo par fichier (configurable, à valider)
- Display : `<video>` tag avec controls, poster = première frame extraite côté client si possible
- Click → drawer avec video full + commentaires

### `note`
- Création : bouton "Ajouter une note" dans la section (pas paste-able)
- Tiptap rich text (réutilise le `RichEditor` existant pour les notes Festival)
- Display : aperçu des 3-4 premières lignes dans la carte
- Click → drawer avec édition full Tiptap

## Interactions UX clés

### Paste-first
- **Ctrl+V URL** n'importe où sur la page → carte link créée dans la section "Vrac" (ou la section actuellement scrollée en viewport)
- **Drag-drop fichier** depuis le bureau → upload + carte image/video
- **Ctrl+V image** depuis le presse-papier → upload + carte image
- **Paste multi-URLs** (5 URLs séparées par newlines) → 5 cartes

### Drag-drop
- Réorder dans une section : drag-drop libre, fractional `sort_order`
- Déplacer entre sections : drag-drop sur la zone d'une autre section
- Réorder les sections elles-mêmes : drag-drop sur le header

### Sections
- Header avec nom (édition inline au clic), couleur (color picker right-click)
- Bouton "+" pour créer une nouvelle section sous la courante
- Right-click sur header : Renommer / Changer couleur / Supprimer (avec confirm si non vide)
- Section "Vrac" par défaut (créée auto à la 1re visite)

### Drawer carte
- Pattern identique à `PropositionDetailDrawer` de Musiques
- Hero du média (image full / video full / link preview / note Tiptap éditable)
- Meta : créateur, date, section, URL source
- Réactions (4 boutons emoji avec compteurs)
- Commentaires (liste + champ d'ajout, pattern Musique)
- Bouton Supprimer (avec confirm)

### Réactions
- 4 emojis fixes : 👍 (`thumbs_up`), ❤️ (`heart`), 🔥 (`fire`), ⚡ (`zap`)
- Un user peut poser plusieurs emojis sur la même carte
- Affichage agrégé sous la carte (rangée compacte : `❤️ 3 · 🔥 2`)
- Toggle au clic (si déjà réagi → retire)

## Architecture front

### Files / composants
- `src/pages/tabs/MoodboardTab.jsx` — page principale (header + sections + paste handler)
- `src/features/moodboard/SectionList.jsx` — liste verticale des sections avec drag-drop
- `src/features/moodboard/Section.jsx` — header de section + masonry intérieur
- `src/features/moodboard/Card.jsx` — carte multi-type (rendu link/image/video/note)
- `src/features/moodboard/CardDrawer.jsx` — drawer détail + commentaires + réactions
- `src/features/moodboard/PasteHandler.jsx` — composant invisible qui capte paste-anywhere
- `src/features/moodboard/ReactionsBar.jsx` — barre des 4 emojis
- `src/lib/moodboard.js` — helpers CRUD + realtime + uploads Storage
- `supabase/functions/og-fetch/index.ts` — Edge Function

### Routing
- Route : `/projets/:id/moodboard`
- Onglet inséré dans `ProjetLayout` entre Musiques et Déroulé
- Icône Lucide : à valider visuellement (`LayoutGrid`, `Image`, `Palette` ou `Lightbulb`)

### Permissions
```js
const OUTIL_KEY = 'moodboard'
const canRead = can(OUTIL_KEY, 'read')
const canEdit = can(OUTIL_KEY, 'edit')
```
Côté BDD : ajouter `moodboard` aux rôles outil dans la table de permissions
existante.

### Masonry
Pas de librairie externe pour V1 — implémentation CSS native via
`grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))` ou
`column-count` responsive selon résultat visuel. Si insatisfaisant, fallback
sur `react-masonry-css` (5 Ko gzip).

## Découpe en tickets MOD-1.x

| Ticket | Description | Estim |
|---|---|---|
| MOD-1.1 | Migration BDD (4 tables + RLS + Realtime publication) | 0.5j |
| MOD-1.2 | Edge Function `og-fetch` (6 providers + fallback OG) | 1j |
| MOD-1.3 | Helpers `lib/moodboard.js` (CRUD + realtime + uploads Storage) | 0.5j |
| MOD-1.4 | Page `MoodboardTab.jsx` + routing + insertion onglet ProjetLayout | 0.5j |
| MOD-1.5 | Composant `Card.jsx` multi-type (rendu link/image/video/note) | 0.5j |
| MOD-1.6 | `Section` + `SectionList` + drag-drop entre sections + réordre | 0.5j |
| MOD-1.7 | `CardDrawer` (commentaires + réactions + meta) | 0.5j |
| MOD-1.8 | `PasteHandler` (URL paste, file drop, clipboard image) | 0.5j |
| MOD-1.9 | Lint + tests + commit final + push | 0.25j |
| **Total** | | **~5j** |

## Backlog V2 (cadré, pas codé en V1)

- **Tags transversaux** : "concept", "lumière", "couleur", "mouvement", "ref client"... filtrage cross-sections
- **Cross-link card → livrable / musique / artiste** : "cette ref c'est pour la vidéo 14"
- **Share read-only public** : envoyer le Moodboard à un client/artiste via lien tokenisé (pattern Déroulé share existant)
- **Canvas libre alternatif** : mode toggle entre sections+masonry et canvas libre infini
- **Lignes / arrows entre cartes** (canvas libre uniquement)
- **Sub-sections** (sections-in-sections type Milanote)
- **Search globale** sur titre / description / commentaires / tags
- **Browser extension capture** (épingler depuis n'importe quel onglet Chrome)
- **Card types additionnels** : color swatch / palette, audio snippet, file PDF, divider/sous-titre
- **AI tagging auto** : Claude Vision sur les images pour suggérer tags

## Risques et points d'attention

### Fragilité des embeds Instagram/TikTok
Les providers sociaux changent leur stratégie d'embed tous les 6 mois. Il faut
absolument que la stratégie **fallback OG card** fonctionne 100% du temps,
même si l'embed live tombe en panne. À tester explicitement en cassant
volontairement l'oEmbed en dev.

### Iframe-blocking sites
Beaucoup de sites refusent l'iframe via `X-Frame-Options: DENY` ou `CSP frame-ancestors`.
La carte OG link (image hero + titre + URL clickable) couvre ce cas. Pas d'effort
à faire au-delà.

### Storage costs
Les vidéos uploadées peuvent peser lourd vite. Cap à 50 Mo par fichier (à
valider). Surveiller quota Storage projet — au-delà de X Go, prévoir un cleanup
manuel ou archivage S3.

### Realtime conflicts sur drag-drop
2 users qui drag la même carte au même moment → last-write-wins (pattern simple,
déjà utilisé pour les sort_order Musiques). Pas besoin de CRDT pour V1.

### Mobile
Sections + masonry est responsive natif. Mais paste-anywhere + drag-drop sont
clavier-only / souris. Sur mobile, fallback bouton "+ Ajouter une ref" qui ouvre
un modal de choix (URL / photo / vidéo / note). À cadrer en MOD-1.4.

## Liens utiles

- Pattern Musiques (référence d'architecture) : `src/pages/tabs/MusiquesTab.jsx`
- Helpers CRUD + realtime pattern : `src/lib/musiques.js`
- Drawer pattern : `src/features/musiques/PropositionDetailDrawer.jsx`
- Commentaires pattern : `projet_musique_comments` + `subscribeComments`
- RichEditor Tiptap (pour cards `note`) : `src/components/rich-editor/`
- Permissions hook : `src/hooks/useProjectPermissions.js`
- Edge Functions existantes (pattern) : `supabase/functions/`
- Realtime publication (pattern migration) : `supabase/migrations/20260608e_musique_realtime_publication.sql`
