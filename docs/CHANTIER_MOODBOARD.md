# MOD — Module Moodboard

> **Statut** : ✅ **V1 livrée** (2026-06-10) — V2 en backlog
> **Date d'ouverture** : 2026-06-09
> **Owner** : Hugo MARTIN
> **Livrés V1** : 17 tickets (MOD-1.1 → MOD-2.2)

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

## Tickets livrés (V1)

| Ticket | Description | Statut |
|---|---|---|
| MOD-1.1 | Migration BDD (4 tables + RLS + Realtime + bucket Storage) | ✅ |
| MOD-1.2 | Edge Function `og-fetch` (YouTube/TikTok/Vimeo/Twitter/IG + OG scrape) | ✅ |
| MOD-1.3 | Helpers `lib/moodboard.js` (CRUD + realtime + uploads + og-fetch) | ✅ |
| MOD-1.4 | `MoodboardTab.jsx` + routing + insertion onglet ProjetLayout | ✅ |
| MOD-1.5/6/7/8 | `Card.jsx` + `SectionList` + `CardDrawer` + `PasteHandler` | ✅ |
| MOD-1.9 | Bouton "+ Ajouter" par section + YouTube full-width + IG/TikTok embed | ✅ |
| MOD-1.10 | Fix regex Instagram `/reels/` + bouton "Rafraîchir le preview" | ✅ |
| MOD-1.11 | Fix sizing embed Instagram + TikTok | ✅ |
| MOD-1.12 | Refonte Insta/TikTok via blockquote + `embed.js` officiel (auto-resize) | ✅ |
| MOD-1.13 | Fix chevauchement embed via injection impérative `innerHTML` | ✅ |
| MOD-1.14 | Remplacement `window.confirm` par `lib/confirm` (harmonisation UI) | ✅ |
| MOD-1.15 | Header drawer informatif + toast loading + avatars + bug fix commentaires + tooltips réactions | ✅ |
| MOD-2.1 | Tags transversaux (BDD + helpers + chips filtre + section drawer + autocomplete) | ✅ |
| MOD-2.2 | Polish UX (sticky headers + color picker section + astuce dismissible + note vide engageante) | ✅ |

## Rétrospective V1 (2026-06-10)

### Ce qui s'est bien passé

- **Pattern paste-first + bouton "+ Ajouter"** couvre les 2 personas (power user clavier vs novice). Adopté immédiatement par Hugo.
- **embed.js officiel d'Instagram/TikTok** : la bonne décision technique au final. Auto-resize natif + on hérite des updates de Meta. Plus robuste que les iframes directs qu'on avait initialement tentés.
- **Injection impérative `innerHTML`** (MOD-1.13) : nécessaire pour éviter les conflits entre React et les scripts officiels qui modifient le DOM.
- **Toast loading sur og-fetch** : transforme une attente silencieuse de 2-3s en feedback rassurant.
- **lib/confirm + lib/notify** existants réutilisés : cohérence UI immédiate, pas de divergence.
- **Tags transversaux livrés en V1** plutôt qu'en V2 : valeur immédiate jugée trop forte pour attendre.

### Pivots significatifs en cours de route

1. **Strategy embed Insta/TikTok** : passage de iframe direct (MOD-1.9) → fixed height en pixels (MOD-1.11) → blockquote + script officiel (MOD-1.12) après échec des 2 premières approches. La 3e marche.
2. **Polish UX en cours d'usage** : header drawer "LINK" jugé peu utile par Hugo → refactor en titre + provider + domain. Commentaires sans avatar = bug (le helper `listAllComments` n'incluait pas le JOIN `author`). Tooltips réactions ajoutés sur demande.
3. **Scope élargi en cours** : MOD-2 initialement prévu en V2, livré dans la foulée car valeur immédiate (tags + polish UX).

### Limitations connues V1 (à addresser en V2 si besoin)

- **Reels Instagram non lisibles inline** : Instagram bloque délibérément la lecture des vidéos dans leurs iframes d'embed (mesure anti-scrape depuis ~2021). L'utilisateur voit la vignette + caption + likes mais doit cliquer "Regarder sur Instagram" qui ouvre un nouvel onglet. **Pas de workaround sans IG Business token + Graph API**.
- **Pas de DOMPurify sur oembed_html** : on fait confiance aux providers officiels (YouTube, TikTok, Vimeo, IG via Meta). À ajouter avant tout déploiement avec usage externe public.
- **Drag-drop HTML5 natif** : marche bien desktop, pas sur mobile. Pas critique pour V1 (usage prod = desktop).
- **Pas de virtualization** : performances correctes jusqu'à ~100-150 cartes. Au-delà, à reprendre.
- **Storage non encrypté** : les uploads images/vidéos sont en bucket public. OK pour usage interne, à revoir avant un share public.
- **`UserAvatar.jsx` exporte un helper non-composant** (`userDisplayName`) → warning Fast Refresh. À extraire dans `utils.js` dédié.

### Stats V1

- **17 tickets livrés** (MOD-1.1 → MOD-2.2)
- **7 fichiers** : `MoodboardTab.jsx`, `Card.jsx`, `SectionList.jsx`, `CardDrawer.jsx`, `PasteHandler.jsx`, `UserAvatar.jsx`, `lib/moodboard.js`
- **1 Edge Function** : `og-fetch`
- **2 migrations BDD** : `20260609e_moodboard_schema.sql` + `20260609f_moodboard_tags.sql`
- **5 tables BDD** : `sections`, `cards`, `comments`, `reactions`, `tags`
- **1 bucket Storage** : `moodboard`

## Backlog V2 (priorisé)

### 🔥 Priorité haute (forte valeur pour l'usage réel)

- **Cross-link card → livrable / musique / artiste** : "cette ref c'est pour la vidéo 14" ou "cette palette pour le set DJ X". Briser le silo, intégrer Moodboard au reste de DESK. Affichage croisé dans le drawer Livrable et Musique. → table N:M `projet_moodboard_card_link` + UI bidirectionnelle.
- **Share read-only public** : envoyer le Moodboard à un client/artiste via lien tokenisé (pattern Déroulé share existant à réutiliser). Le client peut voir + réagir + commenter sans compte. Forte valeur agence (validation directionnelle, retours rapides).
- **Search globale** : input search dans le header, full-text sur titre + description + body commentaires + tags. À partir de ~50 cartes c'est indispensable.
- **Notifications / @mentions** : quand un user commente, les autres reçoivent une notif in-app + email (settings utilisateur). Tag `@nom` dans les commentaires pour mentionner. Sans ça, la collab est purement synchrone (Realtime), pas asynchrone.

### 🟢 Priorité moyenne (nice-to-have qui change le ressenti)

- **Loading skeletons** lors des refetches (vs juste un texte "Chargement…")
- **Lazy loading des images** dans la masonry (intersection observer)
- **Card types additionnels** :
  - Color swatch / palette (hex + nom)
  - Audio snippet (mp3 upload + waveform mini)
  - File PDF (preview vignette de la 1re page)
  - Divider / sous-titre (organisation visuelle interne)
- **AI tagging auto** : Claude Vision sur les images au moment de l'upload pour suggérer des tags ("lumière naturelle", "couleur saturée", "mouvement", "portrait"). Suggestions affichées dans le drawer, l'utilisateur valide.
- **DOMPurify sur `oembed_html`** avant tout déploiement avec usage externe public.
- **Mobile UX** : drag-drop HTML5 ne marche pas sur tactile. Plan B : bouton "Déplacer vers…" dans le menu carte pour mobile + AB testing du paste sur input mobile.
- **Drawer mobile responsive** : sur petit écran, le drawer 640px ne tient pas — pivot vers fullscreen ou sheet bottom.

### 🟡 Priorité basse (V3+ probable)

- **Canvas libre alternatif** : mode toggle entre sections+masonry et canvas libre infini (style Milanote). Gros chantier (~10-15j) avec collab realtime des positions, viewport sync, snap. À évaluer après usage réel.
- **Lignes / arrows entre cartes** (canvas libre uniquement)
- **Sub-sections** (sections-in-sections type Milanote)
- **Browser extension Chrome** : capture depuis n'importe quel onglet → envoie à un projet Moodboard
- **Virtualization** des sections pour scale 500+ cartes
- **Export PDF du moodboard** (snapshot statique pour partage hors-ligne)
- **Templates de moodboard** (reproduire la structure d'un autre projet)

### 🐛 Polish technique à reprendre

- **Tests vitest** pour les helpers purs (`normalizeTag`, `aggregateReactions`, `tagsByCard`, `extractUrlsFromText`, `calcSortOrderBetween`)
- **Warning Fast Refresh** sur `UserAvatar.jsx` : extraire `userDisplayName` dans un fichier `utils.js` séparé
- **Dédup `UserAvatar` vs `ProposerAvatar`** : extraire un composant partagé `src/components/UserAvatar.jsx` réutilisable par Moodboard + Musiques
- **Header MoodboardTab** condensable : trop chargé (icône + titre + sub + 3 pills + 2 CTAs + astuce). À simplifier ou réorganiser quand on aura plus d'éléments.

## Risques et limitations (V1 finalisée)

### Fragilité des embeds Instagram/TikTok
Les providers sociaux changent leur stratégie d'embed tous les 6 mois. La V1 utilise leurs scripts officiels `embed.js` qui auto-resize les iframes. Si Meta/TikTok cassent ce flow, on a un fallback OG card en première ligne (image + titre + URL clickable). À surveiller via tests manuels périodiques.

### Iframe-blocking sites
Beaucoup de sites refusent l'iframe via `X-Frame-Options: DENY` ou `CSP frame-ancestors`. La carte OG link (image hero + titre + URL clickable) couvre ce cas — observé en pratique pour ~30% des sites random.

### Storage costs
Les vidéos uploadées peuvent peser lourd vite. Cap actuel à 50 Mo par fichier (côté front). Surveiller quota Storage projet — au-delà de quelques Go par projet, prévoir un cleanup manuel ou archivage S3.

### Realtime conflicts sur drag-drop
2 users qui drag la même carte au même moment → last-write-wins (pattern simple, déjà éprouvé sur les sort_order Musiques). Pas besoin de CRDT pour V1.

### Mobile (limitation V1)
Sections + masonry est responsive natif. Mais paste-anywhere + drag-drop sont clavier/souris uniquement. Sur mobile, en pratique le module est consultable mais pas éditable confortablement. **À cadrer en V2 si l'usage mobile remonte**.

## Liens utiles

- Pattern Musiques (référence d'architecture) : `src/pages/tabs/MusiquesTab.jsx`
- Helpers CRUD + realtime pattern : `src/lib/musiques.js`
- Drawer pattern : `src/features/musiques/PropositionDetailDrawer.jsx`
- Commentaires pattern : `projet_musique_comments` + `subscribeComments`
- RichEditor Tiptap (pour cards `note`) : `src/components/rich-editor/`
- Permissions hook : `src/hooks/useProjectPermissions.js`
- Edge Functions existantes (pattern) : `supabase/functions/`
- Realtime publication (pattern migration) : `supabase/migrations/20260608e_musique_realtime_publication.sql`
- Confirm dialog réutilisable : `src/lib/confirm.js`
- Notify toasts réutilisable : `src/lib/notify.js`

