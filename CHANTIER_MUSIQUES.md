# CHANTIER MUSIQUES — Module de gestion des choix musicaux festival

> **État** : Roadmap discutée et validée avec Hugo le 2026-06-08.
> Maquette MVP1 validée. Code pas encore commencé.
> Document vivant, à mettre à jour au fil des sprints.
>
> **Contexte** : Pour chaque festival que Captiv couvre en vidéo, l'équipe
> doit sélectionner des titres musicaux qui serviront dans les livrables
> (aftermovie, reels récap, vidéos RSO, dailies…). Aujourd'hui ça se gère
> dans des Google Sheets fourre-tout, à plusieurs mains, sans lien avec la
> programmation ni avec le suivi des autorisations labels. Ce chantier
> internalise cet outil dans Captiv pour relier toutes les étapes.

## TL;DR

**Module Musiques** : un onglet dans le projet festival qui couvre les
4 phases du workflow musique :

1. **Vrac collaboratif** — toute l'équipe balance des titres d'artistes
   programmés (ou pas), avec note ★, tags, commentaires
2. **Affinage** — sélection + attribution à un média/segment précis
   (Aftermovie / Reel J1 / RSO mainstage…) avec durée cible et style
3. **Validation festival** — récap envoyé au festival pour validation
   artistique (page partagée interactive ou PDF)
4. **Suivi presse** — équipe presse contacte les labels, track les
   autorisations, conditions, masters, docs signés

Différenciateurs vs gsheet :

- **Annuaire artistes unifié** : un seul `projet_artistes` partagé entre
  Musiques et Déroulé. L'affiche festival importée par IA peuple cet
  annuaire, qui sert ensuite à suggérer dans le picker Musiques. Plus
  tard, l'import de la grille horaire enrichit ces mêmes artistes (pas
  de doublon).
- **Recherche Spotify intégrée** : preview 30s sans pub, audio-features
  (BPM, énergie, danceability) auto-récupérées, click-to-add avec toutes
  les métadonnées préremplies.
- **Lien YouTube full** : paste URL → extraction titre via oEmbed →
  match Spotify auto. Pour les passages timecodés précis ("intro à
  2:20"), embed YouTube avec `?start=140&end=155`.
- **Médias = livrables existants** : pas de duplication, l'assignment
  musique pointe vers la table `livrables`.
- **Realtime multi-user** : tout le monde voit les ajouts/votes/tags en
  temps réel (réutilise les Supabase subscriptions déjà rodées sur
  Déroulé).
- **Recherche IA niveau 3 (futur, game changer)** : description en
  langage naturel → Claude croise audio-features + annuaire artistes
  + tags → propositions ciblées. Même barre de recherche, mode 🪄.

## Analyse des Google Sheets actuels d'Hugo

Échantillons analysés : Plages Électroniques 2025 (sélec aftermovie),
V&B Fest 2025 (choix musiques aftermovie), Marsatac 2025 (choix musiques
reels).

### Ce qui marche déjà bien (à conserver)

- Notation ★ pour trier dans le vrac
- Sections narratives par séquence ("SEQ 4 BOOBA arrive en bateau pirate.
  Une journaliste lui pose la question.") — précieuses pour donner le
  ton à l'équipe créa
- Color-coding statut autorisation (vert / rouge / orange) — lecture
  instantanée
- Champ "remarques" libre pour les timecodes ("intro + 2.20 à 2.35",
  "hummm + eat sleep slay repeat - 34s à 55s")
- Notion de J1/J2/J3 pour relier au calendrier du festival
- Notation "ils autorisent aussi Shit Squad + Haute Tension" → un OK
  label peut débloquer des titres bonus
- Catégorisation Master / Doc signé pour l'audit légal

### Limites des gsheets (que Captiv résout)

| Problème | Solution Captiv |
|---|---|
| Aucun lien avec la programmation artistique | Annuaire `projet_artistes` partagé, suggéré au picker |
| Statut autorisation hétérogène (case / OUI / EN COURS / NON / couleur) | Enum statut unique + statut presse séparé enrichi |
| Pas de détection de doublons (même titre proposé 3x) | Matching artiste flou + warning duplicate |
| YouTube = juste un lien bleu | Embed inline + preview 30s Spotify sans pub |
| Pas de timeline / relance label | Historique contacts label + alertes deadline |
| Pas de durée cumulée vs cible média | Vue Médias avec compteur progression |
| Difficile à donner en lecture seule au festival | Share link interactif avec permissions |
| Pas d'audit (qui a proposé quand, qui a validé) | created_at + updated_by partout + log Realtime |

## Acteurs et rôles

| Rôle | Phase principale | Permissions cibles |
|---|---|---|
| Membre équipe créa | Vrac, notation, tags | CRUD propositions, ses propres notes/tags |
| Lead créa / chef monteur | Affinage, assignment média | CRUD + statut + assignment + envoi festival |
| Lead com | Envoi récap festival | Génération share link + export PDF |
| Festival (externe) | Validation artistique | Read share + commentaires/validation |
| Équipe presse (interne OU externe) | Contact labels, suivi autorisations | CRUD statut presse + conditions + masters |

## Décisions cadre validées avec Hugo (2026-06-08)

| Décision | Choix retenu |
|---|---|
| Où ça vit dans Captiv | **Onglet dans projet** (à côté de Déroulé, Équipe, Livrables, Budget) |
| Naming | **"Musiques"** (simple, compréhensible par tous les rôles) |
| Segments narratifs (SEQ 1 INTRO…) | **Optionnel selon le média** (aftermovie = segments, reel court = pool) |
| Validation festival | **Les deux modes** : share interactif + export PDF |
| Presseur interne ou externe | **Les deux configurations supportées** (share link dédié si externe) |
| Picker artiste | **Souple** — suggestion forte depuis annuaire prog + libre saisie possible |
| Annuaire artistes | **Unifié** — `projet_artistes` partagé Musiques/Déroulé |
| Notes ★ | **Individuelles** par user + moyenne calculée |
| Tags collaboratifs | **MVP1** dès le début (avec autocomplete sur tags existants) |
| Templates de médias d'un festival sur l'autre | **Pas essentiel** pour MVP1 |
| Médias = | **Livrables existants** (FK vers la table livrables) |
| Recherche musicale | **3 niveaux dans la même barre** : (1) texte Spotify, (2) paste YouTube, (3) AI naturel — niveau 3 = futur game-changer |
| Spotify intégration | **First-class** en MVP1 + YouTube en fallback pour timecodes précis |

## Architecture data — tables proposées

### `projet_artistes` (annuaire unifié)

```sql
CREATE TABLE projet_artistes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  nom             text NOT NULL,
  nom_normalise   text NOT NULL,  -- NFD + lowercase + sans ponctuation
  jour            text,           -- 'J1' | 'J2' | 'J3' | ... optionnel
  scene           text,           -- libellé scène optionnel
  headliner       boolean DEFAULT false,
  source          text NOT NULL,  -- 'affiche' | 'grille' | 'manuel'
  spotify_artist_id text,         -- enrichi quand on lookup Spotify
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX ON projet_artistes (project_id);
CREATE INDEX ON projet_artistes (project_id, nom_normalise);
```

### `projet_deroule_creneaux` (migration douce)

```sql
ALTER TABLE projet_deroule_creneaux
  ADD COLUMN artiste_id uuid REFERENCES projet_artistes(id) NULL;
```

Aucun breaking change. Les anciens créneaux gardent `artiste_id = NULL`
et leur `titre` libre. Les nouveaux créés via import IA ou drag-and-drop
depuis l'annuaire matérialisent le lien.

### `projet_musique_propositions`

```sql
CREATE TABLE projet_musique_propositions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  artiste_id      uuid REFERENCES projet_artistes(id) NULL,
  artiste_text    text,                 -- fallback si pas dans annuaire
  titre           text NOT NULL,
  -- Sources externes
  spotify_id      text,
  spotify_url     text,
  preview_url     text,                 -- mp3 30s Spotify, sans pub
  cover_url       text,
  duration_ms     integer,
  audio_features  jsonb,                -- {bpm, energy, danceability, valence, key}
  lien_youtube    text,
  -- Sélection timecode (pour usage précis dans un montage)
  timecode_start_sec integer,
  timecode_end_sec   integer,
  -- Cycle de vie
  statut          text DEFAULT 'vrac',  -- vrac | selectionne | valide_festival | en_nego | accorde | refuse
  proposer_id     uuid REFERENCES profiles(id),
  remarques       text,
  -- Audit
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX ON projet_musique_propositions (project_id);
CREATE INDEX ON projet_musique_propositions (project_id, statut);
```

### `projet_musique_notes`

```sql
CREATE TABLE projet_musique_notes (
  proposition_id  uuid REFERENCES projet_musique_propositions(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES profiles(id),
  note            smallint NOT NULL CHECK (note BETWEEN 1 AND 5),
  created_at      timestamptz DEFAULT now(),
  PRIMARY KEY (proposition_id, user_id)
);
```

Moyenne agrégée côté front en MVP1 (passe en vue SQL si charge élevée).

### `projet_musique_tags`

```sql
CREATE TABLE projet_musique_tags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposition_id  uuid REFERENCES projet_musique_propositions(id) ON DELETE CASCADE,
  tag             text NOT NULL,        -- normalisé (lowercase, trim)
  user_id         uuid REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX ON projet_musique_tags (proposition_id);
CREATE INDEX ON projet_musique_tags (tag);
```

### Tables MVP2+ (pas dans MVP1)

```sql
-- MVP2 : assignment vers livrables (médias) + segments optionnels
CREATE TABLE projet_musique_assignments (
  id              uuid PRIMARY KEY,
  proposition_id  uuid REFERENCES projet_musique_propositions(id),
  livrable_id     uuid REFERENCES livrables(id),
  segment_id      uuid REFERENCES livrable_segments(id) NULL,
  sort_order      integer,
  timecode_in_segment_sec integer NULL,
  notes           text
);

CREATE TABLE livrable_segments (
  id              uuid PRIMARY KEY,
  livrable_id     uuid REFERENCES livrables(id),
  sort_order      integer,
  label           text,                 -- "SEQ 1 INTRO"
  description     text,                 -- "BOOBA arrive en bateau pirate"
  duree_cible_sec integer,
  style           text                  -- "Punk / rock / metal"
);

-- MVP4 : suivi presse / labels
CREATE TABLE projet_musique_label_contacts (
  id              uuid PRIMARY KEY,
  proposition_id  uuid REFERENCES projet_musique_propositions(id),
  label_name      text,
  contact_name    text,
  contact_email   text,
  last_attempt_at timestamptz,
  status          text,                 -- pending | contacte | en_nego | accorde | refuse
  conditions_text text,
  doc_signed_url  text,
  master_url      text,
  date_signed     timestamptz,
  notes           text
);

CREATE TABLE projet_musique_label_history (
  id              uuid PRIMARY KEY,
  proposition_id  uuid REFERENCES projet_musique_propositions(id),
  date            timestamptz,
  type            text,                 -- email | tel | meeting | doc_signe
  contact         text,
  contenu_court   text,
  next_step       text,
  user_id         uuid REFERENCES profiles(id)
);
```

## Recherche musicale — barre unifiée 3 niveaux

Une seule barre de recherche, comportement détecté automatiquement selon
l'input.

### Niveau 1 — Recherche Spotify directe (MVP1)

L'utilisateur tape un nom d'artiste, un titre, ou un mélange.

- Debounce 300ms
- Hit l'endpoint `/spotify-search?q=...`
- Affiche 5-10 matches avec cover, artiste, titre, album, durée,
  popularité, BPM + énergie en métadonnée discrète
- Bouton ▶ play preview 30s sans pub
- Click "Ajouter" → proposition créée avec toutes les métadonnées
  préremplies (artist, title, cover_url, spotify_id, preview_url,
  duration, BPM, énergie, danceability)
- En parallèle, recherche YouTube `{artist} {title}` pour pré-remplir
  `lien_youtube`

### Niveau 2 — Coller un lien YouTube (MVP1)

L'utilisateur colle une URL YouTube.

- Détection URL automatique
- oEmbed YouTube (gratuit sans clé) → extrait le titre vidéo
- Parser heuristique : "Horsegiirl - Eat Sleep Slay (Official Video)"
  → `{artiste: "Horsegiirl", titre: "Eat Sleep Slay"}` (retire suffixes
  Official Video, Lyrics, HD, etc.)
- Lookup Spotify avec ces tokens
- Si match → tout est prérempli, preview 30s dispo
- Si pas de match Spotify → YouTube reste seul (sans preview rapide)

### Niveau 3 — Recherche en langage naturel (MVP5, futur game-changer)

L'utilisateur active 🪄 et décrit ce qu'il cherche.

Exemples :
- "Un titre techno autour de 130 BPM avec un drop énergique pour le
  SEQ 4 de Plages Élec"
- "Le morceau de Peggy Gou avec le remix qu'on entendait partout en
  2023"
- "Quelque chose dans le mood de Eat Sleep Slay mais plus chill"
- "Un artiste qui joue cette année et qui aurait un track punk-rock
  pour SEQ 5 PAPY ROCKEUR"

Sous le capot : Claude reçoit la requête + contexte (annuaire artistes
du projet, tags existants dans le vrac, audio-features cibles si
mentionnées), reformule en une ou plusieurs queries Spotify ciblées,
filtre les résultats par audio-features (BPM range, énergie,
danceability) et croise avec les artistes du festival. Renvoie 3-5
propositions pertinentes avec mini-justification ("Bicep — Apricots :
124 BPM, énergie 0.8, joue J2 main stage, mood drop").

**Important** : MVP1 doit déjà architecturer la barre pour accueillir
le niveau 3 sans refacto (prop `smartMode` futur, icône ti-sparkles à
droite avec tooltip "Recherche intelligente — bientôt").

## Roadmap par MVP

### MVP1 — Vrac collaboratif (sprint en cours)

**Scope** : tableau collaboratif fonctionnel pour la phase brainstorm.
À la fin de ce sprint, l'équipe peut balancer des titres dans le module,
les noter, les tagger, les écouter. Le pipeline d'affinage n'existe pas
encore (tout est en statut "vrac").

Inclus :
- Migration BDD : `projet_artistes` (annuaire unifié) + colonne
  `artiste_id` sur `projet_deroule_creneaux` (rétro-compat)
- Migration BDD : `propositions` + `notes` + `tags`
- Edge Function `spotify-search` (Client Credentials + audio-features)
- Helper `youtubeOEmbed` + parser titre vidéo → artiste/titre
- Edge Function `import-programmation` (Claude Vision sur affiche)
- Helpers `lib/musiques.js` + `lib/projetArtistes.js` (CRUD + matching flou)
- Onglet "Musiques" dans `ProjetLayout` + routing `/projet/:id/musiques`
- Composant `UnifiedSearchBar` (texte + YouTube paste, hook AI ready)
- Modal `AddProposition` (résultats Spotify + paste YouTube)
- Modal `ImportAffiche` (Claude Vision preview + confirm)
- Composant `PropositionRow` (cover, artiste/titre, tags, note, play,
  YouTube)
- Système notes individuelles + moyenne agrégée
- Système tags collaboratifs avec autocomplete
- Realtime multi-user (subscriptions sur 3 tables)
- Lint + tests + validation

Voir tasklist détaillée : `MUS-1.1` à `MUS-1.15`.

### MVP2 — Médias + Kanban

**Scope** : la phase affinage. Le vrac se structure, les titres sont
assignés à des livrables, on visualise le pipeline.

Inclus :
- Modélisation `livrable_segments` (segments narratifs optionnels)
- Table `projet_musique_assignments` (proposition → livrable [+ segment])
- Vue Kanban par statut (Vrac → Sélectionné → Validé festival →
  En négo → Accordé)
- Vue Médias : par livrable, ses segments, ses titres alloués, durée
  cumulée vs cible
- Côté Livrables : afficher "🎵 12 titres associés (3 validés festival)"
- Drag-and-drop pour assigner une proposition à un segment

### MVP3 — Share festival

**Scope** : envoi de la sélection au festival pour validation
artistique.

Inclus :
- Page publique share `/share/musiques/:token` (read-only sauf
  validation/commentaires)
- Embed Spotify preview + lien YouTube full sur chaque titre
- Validation par titre (✓ / ✗ / commentaire)
- Notification côté équipe quand le festival a validé/refusé
- Export PDF récap pour les festivals qui préfèrent l'envoi mail

### MVP4 — Suivi presse

**Scope** : tracking complet des autorisations labels.

Inclus :
- Statut presse enrichi (pending / contacté / en négo / accordé /
  refusé / conditions particulières)
- Historique communications label (date, type, contact, contenu court,
  next step)
- Conditions de cession (territoire, durée d'usage, médias autorisés,
  mention crédit, paiement)
- Lien doc signé + lien master + date_signed
- Vue Presse dédiée
- Share link externe presseur avec permissions resserrées (voit seulement
  les titres validés festival, édite uniquement les statuts labels)

### MVP5 — Recherche IA + Polish

**Scope** : le game-changer.

Inclus :
- Recherche IA langage naturel (niveau 3 dans la barre unifiée)
- Détection doublons avec merge proposé
- Templates de médias réutilisables d'un festival à l'autre
- Dashboard couverture par média (% durée remplie, % validé festival,
  % accordé label)
- Alertes deadline (festival dans 14j + N titres en pending →
  intégration au système d'alertes existant)
- Mode "Présentation" slideshow plein écran pour réunion équipe de
  sélection finale
- Export "moodboard média" PDF/Markdown pour le monteur

## Idées identifiées (parking pour plus tard)

Notes prises pendant le brainstorm — à évaluer au moment des MVPs
correspondants.

- **Versions / variantes** d'un même morceau (radio edit, extended,
  remix). Souvent un label autorise une version mais pas l'autre.
  Modélisable comme `parent_proposition_id` + libellé variante.
- **Tracking légal exhaustif** : territoire (FR / world / EU), durée
  d'usage (1 an / 5 ans / illimité), médias autorisés (web only / TV /
  cinéma), mention crédit obligatoire, paiement (forfait / royalties /
  gratuit).
- **Stats équipe** light : qui propose le plus, taux d'acceptation
  par proposeur, profil musical de chacun. Plus fun que utile.
- **Coût / budget** : certains labels chargent les sync (€/sec ou flat
  fee). Si tracké, peut remonter au module Budget du projet.
- **Mode "blind review"** pour éviter le biais : on note sans voir qui
  a proposé et sans voir les autres notes. Optionnel.
- **Suggestions audio-features auto** : si BPM=130 + énergie=0.85 +
  danceability=0.9, suggérer le tag "banger 130bpm" à l'ajout.
- **"Trouver similaire"** sur n'importe quelle proposition existante
  (Spotify Recommendations API avec seed_track + filtres audio).
- **Coloration par énergie** dans la liste : titre énergie 0.9 = couleur
  "banger", 0.3 = "chill". Très visuel.
- **Tri par BPM** pour la coupe vidéo (matcher la cadence).
- **SoundCloud** comme fallback pour les titres non commerciaux (DJ
  sets, edits, bootlegs) — API restrictive aujourd'hui, à reévaluer.

## Pré-requis avant de coder MVP1

### Spotify credentials (bloquant à partir de MUS-1.3)

Hugo doit créer une app Spotify (gratuit) :

1. Aller sur https://developer.spotify.com → Dashboard
2. Create app → type "Web API"
3. Récupérer `Client ID` et `Client Secret`
4. Les pousser en secrets Supabase Edge Functions :
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`

Tant que pas configuré, l'Edge Function `spotify-search` retourne une
erreur claire et le front affiche "Spotify non configuré — utilisez le
paste YouTube en attendant".

**Demande à faire à Hugo quand on attaque MUS-1.3.**

### Refacto léger du déroulé (intégré à MUS-1.1)

Ajout d'une colonne `artiste_id` nullable sur `projet_deroule_creneaux`.
Aucun breaking change. Validé par Hugo le 2026-06-08.

## Considérations transversales

### Mobile

Le module Musiques sera principalement utilisé sur desktop (équipe créa
au montage), mais doit rester consultable mobile (équipe sur le terrain
qui valide une proposition rapidement). Respect des règles
`CHANTIER_MOBILE_PWA.md` : tap targets ≥ 44px, pas de hover-only,
preview Spotify joue inline mobile.

### Realtime

Réutilise les Supabase subscriptions postgres_changes déjà rodées sur
Déroulé. 3 channels par projet : propositions, notes, tags. Filtre par
project_id côté client. Optimistic updates pour la latence perçue.

### Permissions

RLS basée sur l'appartenance au projet (déjà standardisé dans Captiv) :

- Membres du projet : CRUD propositions du projet, leurs propres notes
  et tags
- Festival via share link : read + commentaire/validation seulement
- Presseur externe via share link dédié : read + édition statut presse
  + historique label seulement

### Audit

Tous les `created_at` + `updated_at` + `proposer_id` / `user_id` sur
chaque action. Permet de répondre à "qui a proposé Eat Sleep Slay et
quand", "qui a validé tel titre", "qui a contacté le label X la
dernière fois".

## Glossaire métier

- **Vrac** : pool initial de propositions, brainstorm collectif
- **Affinage** : phase de tri, sélection, attribution à un média
- **Média / livrable** : aftermovie, reel, vidéo RSO, dailies, focus
  mainstage… ce qui sera produit en sortie
- **Segment / SEQ** : sous-partie narrative d'un média (SEQ 1 INTRO,
  SEQ 4 BOOBA arrive en bateau pirate…)
- **Sync** : jargon métier pour cession de droits musicaux
- **Master** : fichier audio final fourni par le label après accord
- **Doc signé** : contrat de cession entre festival/agence et label
- **Audio-features** : BPM, énergie, danceability, valence, key
  (métadonnées Spotify gratuit)
- **Preview** : extrait 30s gratuit Spotify, sans pub
- **oEmbed** : protocole gratuit YouTube pour récupérer le titre d'une
  vidéo sans clé API
- **Annuaire artistes** : table `projet_artistes` partagée Musiques +
  Déroulé, alimentée affiche/grille/manuel
