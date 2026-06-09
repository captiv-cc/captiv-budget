-- ============================================================================
-- Migration : MOODBOARD MOD-1.1 — Schéma initial 4 tables + Storage bucket
-- Date      : 2026-06-09 (E — module Moodboard V1, cf. docs/CHANTIER_MOODBOARD.md)
-- Contexte  : Nouveau module collaboratif pour mutualiser refs / inspi /
--             concepts visuels au sein de l'équipe d'un projet.
--
--             Pattern produit : Are.na / Pinterest / Milanote (sans canvas
--             libre pour V1). Sections nommées + masonry de cartes dans
--             chaque section. Card types : link / image / video / note.
--
-- Périmètre :
--   1. INSERT 'moodboard' dans outils_catalogue
--   2. CREATE TABLE projet_moodboard_sections   (sections nommées)
--   3. CREATE TABLE projet_moodboard_cards      (cartes multi-type)
--   4. CREATE TABLE projet_moodboard_comments   (fil de discussion par carte)
--   5. CREATE TABLE projet_moodboard_reactions  (emoji 👍 ❤️ 🔥 ⚡)
--   6. Indexes utiles
--   7. Triggers updated_at
--   8. RLS sur les 4 tables (helper can_read/edit_outil)
--   9. Realtime publication + REPLICA IDENTITY FULL
--  10. Storage bucket 'moodboard' (image/video uploads)
--
-- Idempotent : Oui.
-- ============================================================================

BEGIN;


-- ── 1. Ajout 'moodboard' au catalogue d'outils ───────────────────────────
-- L'outil Moodboard apparaît dans la liste des outils du projet. Permet
-- aux admins de définir qui peut lire/écrire via project_outils_access
-- (mécanique standard Captiv).
INSERT INTO outils_catalogue (key, label, description, icon, sort_order)
VALUES (
  'moodboard',
  'Moodboard',
  'Mutualisation des références d''inspiration de l''équipe : '
  'reels Insta, vidéos TikTok, captures d''écran, GIFs, notes. '
  'Sections nommées + masonry, commentaires et réactions emoji.',
  'LayoutGrid',
  37
)
ON CONFLICT (key) DO NOTHING;


-- ── 2. CREATE TABLE projet_moodboard_sections ────────────────────────────
-- Une section = un bloc nommé qui empile des cartes. L'utilisateur peut
-- créer/renommer/supprimer ses propres sections. Une section "Vrac" est
-- créée automatiquement par le front à la 1re visite si la table est vide
-- pour ce projet.
CREATE TABLE IF NOT EXISTS projet_moodboard_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  nom TEXT NOT NULL CHECK (LENGTH(nom) >= 1 AND LENGTH(nom) <= 80),

  -- Couleur du header de section. Hex code ou nom de variable CSS.
  -- Optionnel : NULL = couleur neutre par défaut.
  color TEXT,

  -- Fractional ordering pour le drag-drop des sections elles-mêmes.
  -- Real plutôt que INTEGER pour permettre l'insertion entre 2 voisines
  -- sans renumérotation globale.
  sort_order REAL NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE projet_moodboard_sections IS
  'MOODBOARD — Sections nommées d''un moodboard projet. Chaque section '
  'contient un masonry de cartes (projet_moodboard_cards). Section "Vrac" '
  'créée automatiquement à la 1re visite par le front.';


-- ── 3. CREATE TABLE projet_moodboard_cards ───────────────────────────────
-- Une carte = une ref de l'équipe. Type discriminé :
--   link  : URL externe, metadata fetched via Edge Function og-fetch
--   image : upload Supabase Storage (PNG/JPG/WebP/GIF)
--   video : upload Supabase Storage (MP4/MOV/WebM)
--   note  : texte riche Tiptap (JSONB)
CREATE TABLE IF NOT EXISTS projet_moodboard_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  section_id UUID NOT NULL
    REFERENCES projet_moodboard_sections(id) ON DELETE CASCADE,

  type TEXT NOT NULL
    CHECK (type IN ('link', 'image', 'video', 'note')),

  -- ─── Champs link ────────────────────────────────────────────────────
  -- URL externe pour les cartes type='link'. Récupération metadata via
  -- Edge Function og-fetch (cf. MOD-1.2).
  url TEXT,

  -- ─── Champs communs (édibles inline) ────────────────────────────────
  -- Titre : par défaut = celui récupéré via og-fetch / nom de fichier /
  -- vide pour les notes. Éditable inline.
  title TEXT,

  -- Description : courte, optionnelle.
  description TEXT,

  -- ─── Champs preview ────────────────────────────────────────────────
  -- Hero image affichée sur la carte. Pour link = og:image, image = URL
  -- Storage, video = poster (première frame), note = NULL.
  image_url TEXT,

  -- HTML d'embed officiel pour les providers connus (YouTube, TikTok,
  -- Vimeo, Twitter, Instagram). NULL si pas d'embed dispo. Injecté
  -- côté front en mode opt-in (bouton "Lire dans la carte") pour ne
  -- pas charger N iframes en parallèle.
  oembed_html TEXT,

  -- Provider détecté par og-fetch : 'youtube' | 'tiktok' | 'vimeo' |
  -- 'twitter' | 'instagram' | NULL (générique).
  provider TEXT,

  -- ─── Champs upload (Storage) ───────────────────────────────────────
  -- Path dans le bucket 'moodboard'. Format : <project_id>/<card_id>.<ext>
  -- Construit côté front lors de l'upload. NULL si type != 'image'/'video'.
  file_path TEXT,

  -- ─── Champs note ───────────────────────────────────────────────────
  -- Contenu Tiptap pour les cartes type='note'. JSONB pour permettre
  -- l'évolution du schéma Tiptap sans migration.
  content_json JSONB,

  -- ─── Ordre + audit ──────────────────────────────────────────────────
  sort_order REAL NOT NULL DEFAULT 0,

  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ─── Cohérence type / champs ────────────────────────────────────────
  -- Link doit avoir une URL. Image/video doit avoir un file_path. Note
  -- doit avoir un content_json (vide possible mais clé présente).
  CONSTRAINT card_link_has_url
    CHECK (type <> 'link' OR url IS NOT NULL),
  CONSTRAINT card_upload_has_path
    CHECK (type NOT IN ('image', 'video') OR file_path IS NOT NULL),
  CONSTRAINT card_note_has_content
    CHECK (type <> 'note' OR content_json IS NOT NULL)
);

COMMENT ON TABLE projet_moodboard_cards IS
  'MOODBOARD — Cartes du moodboard, type discriminé (link/image/video/note). '
  'Pour link : url + metadata fetched via og-fetch. Pour image/video : '
  'file_path dans le bucket Storage moodboard. Pour note : content_json '
  '(Tiptap).';

COMMENT ON COLUMN projet_moodboard_cards.oembed_html IS
  'HTML d''embed officiel pour les providers connus (YouTube/TikTok/Vimeo/'
  'Twitter/Instagram). Injecté côté front en mode opt-in (lazy) pour ne '
  'pas pénaliser le scroll initial. Fallback : image_url + titre.';


-- ── 4. CREATE TABLE projet_moodboard_comments ────────────────────────────
-- Fil de discussion par carte. Pattern identique à projet_musique_comments.
CREATE TABLE IF NOT EXISTS projet_moodboard_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  card_id UUID NOT NULL
    REFERENCES projet_moodboard_cards(id) ON DELETE CASCADE,

  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  body TEXT NOT NULL CHECK (LENGTH(body) >= 1 AND LENGTH(body) <= 2000),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE projet_moodboard_comments IS
  'MOODBOARD — Fil de discussion sur une carte du moodboard. Texte simple, '
  '2000 chars max, édition/suppression réservée à l''auteur (RLS).';


-- ── 5. CREATE TABLE projet_moodboard_reactions ───────────────────────────
-- Réactions emoji 1 user × 1 emoji × 1 carte. Un user peut poser plusieurs
-- emojis sur la même carte mais pas le même emoji deux fois.
CREATE TABLE IF NOT EXISTS projet_moodboard_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  card_id UUID NOT NULL
    REFERENCES projet_moodboard_cards(id) ON DELETE CASCADE,

  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- 4 emojis fixes en V1 :
  --   thumbs_up = 👍 (j'aime / OK)
  --   heart     = ❤️ (coup de cœur)
  --   fire      = 🔥 (banger / wow)
  --   zap       = ⚡ (idée / inspirant)
  emoji TEXT NOT NULL
    CHECK (emoji IN ('thumbs_up', 'heart', 'fire', 'zap')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Pas deux fois la même réaction d'un même user sur la même carte.
  UNIQUE (card_id, user_id, emoji)
);

COMMENT ON TABLE projet_moodboard_reactions IS
  'MOODBOARD — Réactions emoji légères sur une carte (alternative aux '
  'commentaires textuels). 4 emojis fixes : 👍 ❤️ 🔥 ⚡. Un user peut '
  'cumuler plusieurs emojis sur une même carte (UNIQUE par triplet).';


-- ── 6. Indexes ────────────────────────────────────────────────────────────
-- sections
CREATE INDEX IF NOT EXISTS idx_moodboard_sections_project_order
  ON projet_moodboard_sections (project_id, sort_order);

-- cards : lookup par section (rendu) + sort_order interne
CREATE INDEX IF NOT EXISTS idx_moodboard_cards_section_order
  ON projet_moodboard_cards (section_id, sort_order);

-- cards : lookup par créateur (rare mais utile pour "mes cartes")
CREATE INDEX IF NOT EXISTS idx_moodboard_cards_created_by
  ON projet_moodboard_cards (created_by)
  WHERE created_by IS NOT NULL;

-- comments : lookup par carte (drawer)
CREATE INDEX IF NOT EXISTS idx_moodboard_comments_card
  ON projet_moodboard_comments (card_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moodboard_comments_user
  ON projet_moodboard_comments (user_id);

-- reactions : lookup par carte (agrégat) + dédup par user (UNIQUE déjà)
CREATE INDEX IF NOT EXISTS idx_moodboard_reactions_card
  ON projet_moodboard_reactions (card_id);


-- ── 7. Triggers updated_at ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_moodboard_sections_updated_at
  ON projet_moodboard_sections;
CREATE TRIGGER trg_moodboard_sections_updated_at
  BEFORE UPDATE ON projet_moodboard_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_moodboard_cards_updated_at
  ON projet_moodboard_cards;
CREATE TRIGGER trg_moodboard_cards_updated_at
  BEFORE UPDATE ON projet_moodboard_cards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_moodboard_comments_updated_at
  ON projet_moodboard_comments;
CREATE TRIGGER trg_moodboard_comments_updated_at
  BEFORE UPDATE ON projet_moodboard_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 8. RLS — projet_moodboard_sections ───────────────────────────────────
ALTER TABLE projet_moodboard_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "moodboard_sections_read"   ON projet_moodboard_sections;
DROP POLICY IF EXISTS "moodboard_sections_insert" ON projet_moodboard_sections;
DROP POLICY IF EXISTS "moodboard_sections_update" ON projet_moodboard_sections;
DROP POLICY IF EXISTS "moodboard_sections_delete" ON projet_moodboard_sections;

CREATE POLICY "moodboard_sections_read" ON projet_moodboard_sections
  FOR SELECT USING (can_read_outil(project_id, 'moodboard'));

CREATE POLICY "moodboard_sections_insert" ON projet_moodboard_sections
  FOR INSERT WITH CHECK (can_edit_outil(project_id, 'moodboard'));

CREATE POLICY "moodboard_sections_update" ON projet_moodboard_sections
  FOR UPDATE
  USING (can_edit_outil(project_id, 'moodboard'))
  WITH CHECK (can_edit_outil(project_id, 'moodboard'));

CREATE POLICY "moodboard_sections_delete" ON projet_moodboard_sections
  FOR DELETE USING (can_edit_outil(project_id, 'moodboard'));


-- ── 9. RLS — projet_moodboard_cards (hérité via section → project) ──────
ALTER TABLE projet_moodboard_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "moodboard_cards_read"   ON projet_moodboard_cards;
DROP POLICY IF EXISTS "moodboard_cards_insert" ON projet_moodboard_cards;
DROP POLICY IF EXISTS "moodboard_cards_update" ON projet_moodboard_cards;
DROP POLICY IF EXISTS "moodboard_cards_delete" ON projet_moodboard_cards;

CREATE POLICY "moodboard_cards_read" ON projet_moodboard_cards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_moodboard_sections s
      WHERE s.id = projet_moodboard_cards.section_id
        AND can_read_outil(s.project_id, 'moodboard')
    )
  );

CREATE POLICY "moodboard_cards_insert" ON projet_moodboard_cards
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_moodboard_sections s
      WHERE s.id = projet_moodboard_cards.section_id
        AND can_edit_outil(s.project_id, 'moodboard')
    )
  );

CREATE POLICY "moodboard_cards_update" ON projet_moodboard_cards
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projet_moodboard_sections s
      WHERE s.id = projet_moodboard_cards.section_id
        AND can_edit_outil(s.project_id, 'moodboard')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_moodboard_sections s
      WHERE s.id = projet_moodboard_cards.section_id
        AND can_edit_outil(s.project_id, 'moodboard')
    )
  );

CREATE POLICY "moodboard_cards_delete" ON projet_moodboard_cards
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projet_moodboard_sections s
      WHERE s.id = projet_moodboard_cards.section_id
        AND can_edit_outil(s.project_id, 'moodboard')
    )
  );


-- ── 10. RLS — projet_moodboard_comments ──────────────────────────────────
-- Read : tout membre qui peut lire l'outil. Write : seulement ses propres
-- commentaires (user_id = auth.uid()). Delete : auteur OU admin (cleanup).
ALTER TABLE projet_moodboard_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "moodboard_comments_read"   ON projet_moodboard_comments;
DROP POLICY IF EXISTS "moodboard_comments_insert" ON projet_moodboard_comments;
DROP POLICY IF EXISTS "moodboard_comments_update" ON projet_moodboard_comments;
DROP POLICY IF EXISTS "moodboard_comments_delete" ON projet_moodboard_comments;

CREATE POLICY "moodboard_comments_read" ON projet_moodboard_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM projet_moodboard_cards c
      JOIN projet_moodboard_sections s ON s.id = c.section_id
      WHERE c.id = projet_moodboard_comments.card_id
        AND can_read_outil(s.project_id, 'moodboard')
    )
  );

CREATE POLICY "moodboard_comments_insert" ON projet_moodboard_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM projet_moodboard_cards c
      JOIN projet_moodboard_sections s ON s.id = c.section_id
      WHERE c.id = projet_moodboard_comments.card_id
        AND can_edit_outil(s.project_id, 'moodboard')
    )
  );

CREATE POLICY "moodboard_comments_update" ON projet_moodboard_comments
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "moodboard_comments_delete" ON projet_moodboard_comments
  FOR DELETE USING (
    -- Soit l'auteur, soit un admin/charge_prod qui peut éditer l'outil
    -- (cleanup modération si besoin).
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM projet_moodboard_cards c
      JOIN projet_moodboard_sections s ON s.id = c.section_id
      WHERE c.id = projet_moodboard_comments.card_id
        AND can_edit_outil(s.project_id, 'moodboard')
    )
  );


-- ── 11. RLS — projet_moodboard_reactions ─────────────────────────────────
-- Read : tout membre qui peut lire l'outil. Insert/Delete : ses propres
-- réactions (user_id = auth.uid()). Pas d'UPDATE (on toggle add/remove).
ALTER TABLE projet_moodboard_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "moodboard_reactions_read"   ON projet_moodboard_reactions;
DROP POLICY IF EXISTS "moodboard_reactions_insert" ON projet_moodboard_reactions;
DROP POLICY IF EXISTS "moodboard_reactions_delete" ON projet_moodboard_reactions;

CREATE POLICY "moodboard_reactions_read" ON projet_moodboard_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM projet_moodboard_cards c
      JOIN projet_moodboard_sections s ON s.id = c.section_id
      WHERE c.id = projet_moodboard_reactions.card_id
        AND can_read_outil(s.project_id, 'moodboard')
    )
  );

CREATE POLICY "moodboard_reactions_insert" ON projet_moodboard_reactions
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM projet_moodboard_cards c
      JOIN projet_moodboard_sections s ON s.id = c.section_id
      WHERE c.id = projet_moodboard_reactions.card_id
        AND can_edit_outil(s.project_id, 'moodboard')
    )
  );

CREATE POLICY "moodboard_reactions_delete" ON projet_moodboard_reactions
  FOR DELETE USING (user_id = auth.uid());


-- ── 12. Realtime publication ─────────────────────────────────────────────
-- Sans cette étape, le subscribeToMoodboard côté front ne recevra aucun
-- event. Pattern identique à 20260608e_musique_realtime_publication.sql.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'projet_moodboard_sections',
    'projet_moodboard_cards',
    'projet_moodboard_comments',
    'projet_moodboard_reactions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END;
$$;

-- REPLICA IDENTITY FULL : permet au client de récupérer l'ancienne row
-- sur UPDATE/DELETE pour un reconcile précis. Coût négligeable à ces
-- volumes.
ALTER TABLE projet_moodboard_sections  REPLICA IDENTITY FULL;
ALTER TABLE projet_moodboard_cards     REPLICA IDENTITY FULL;
ALTER TABLE projet_moodboard_comments  REPLICA IDENTITY FULL;
ALTER TABLE projet_moodboard_reactions REPLICA IDENTITY FULL;


-- ── 13. Storage bucket 'moodboard' ───────────────────────────────────────
-- Bucket dédié aux uploads images/vidéos des cartes Moodboard.
-- Path convention : <project_id>/<card_id>.<ext>
--
-- Politique : SELECT public (les URLs sont utilisées dans <img>/<video>
-- pour les utilisateurs autorisés, on évite les signed URLs qui
-- compliqueraient le rendu masonry). WRITE filtré par can_edit_outil
-- sur le project_id du préfixe path.
INSERT INTO storage.buckets (id, name, public)
VALUES ('moodboard', 'moodboard', true)
ON CONFLICT (id) DO NOTHING;

-- Lecture publique (assumée par bucket.public = true mais on garde la
-- policy explicite pour clarté + compatibilité futur).
DROP POLICY IF EXISTS "moodboard_storage_read" ON storage.objects;
CREATE POLICY "moodboard_storage_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'moodboard');

-- Upload : peut uploader dans le préfixe de son projet si edit autorisé
DROP POLICY IF EXISTS "moodboard_storage_insert" ON storage.objects;
CREATE POLICY "moodboard_storage_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'moodboard'
    AND can_edit_outil(
      ((storage.foldername(name))[1])::uuid,
      'moodboard'
    )
  );

-- Update : idem (cas overwrite éventuel)
DROP POLICY IF EXISTS "moodboard_storage_update" ON storage.objects;
CREATE POLICY "moodboard_storage_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'moodboard'
    AND can_edit_outil(
      ((storage.foldername(name))[1])::uuid,
      'moodboard'
    )
  );

-- Delete : cleanup quand une carte est supprimée côté app
DROP POLICY IF EXISTS "moodboard_storage_delete" ON storage.objects;
CREATE POLICY "moodboard_storage_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'moodboard'
    AND can_edit_outil(
      ((storage.foldername(name))[1])::uuid,
      'moodboard'
    )
  );


COMMIT;
