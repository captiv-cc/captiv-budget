-- ============================================================================
-- Migration : MOODBOARD MOD-2.1 — Tags transversaux sur les cartes
-- Date      : 2026-06-09 (F — après 20260609e_moodboard_schema)
-- Contexte  : Hugo veut pouvoir tagger les cartes du moodboard avec des
--             mots-clés libres ("concept", "lumière", "couleur", "mouvement",
--             "ref client"...) pour filtrer transversalement entre sections.
--
-- Pattern   : identique à projet_musique_tags (déjà éprouvé).
--
-- Périmètre :
--   1. CREATE TABLE projet_moodboard_tags
--   2. Indexes (lookup par carte + par tag pour distinct)
--   3. RLS héritée via JOIN cards → sections → project
--   4. Ajout à la publication Realtime + REPLICA IDENTITY FULL
--
-- Idempotent : Oui.
-- ============================================================================

BEGIN;


-- ── 1. CREATE TABLE projet_moodboard_tags ────────────────────────────────
-- Tags collaboratifs sur une carte. Free-form, normalisés côté JS
-- (lowercase + trim + slice 40 chars). Plusieurs users peuvent tagger
-- la même carte avec des tags différents, mais UNIQUE(card_id, tag)
-- empêche les doublons exacts.
CREATE TABLE IF NOT EXISTS projet_moodboard_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  card_id UUID NOT NULL
    REFERENCES projet_moodboard_cards(id) ON DELETE CASCADE,

  -- Tag normalisé : 1-40 chars, lowercase, trimmé côté JS avant insert.
  -- Stockage simple TEXT, pas de table tags séparée (over-engineering V1).
  tag TEXT NOT NULL CHECK (LENGTH(tag) >= 1 AND LENGTH(tag) <= 40),

  -- Audit + analyse "qui tagge quoi"
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (card_id, tag)
);

COMMENT ON TABLE projet_moodboard_tags IS
  'MOODBOARD — Tags collaboratifs libres sur les cartes. Pattern identique '
  'à projet_musique_tags : free-form string normalisé côté JS, autocomplete '
  'sur DISTINCT(tag) du projet, UNIQUE(card_id, tag).';


-- ── 2. Indexes ────────────────────────────────────────────────────────────
-- Lookup par carte (drawer + affichage en grid)
CREATE INDEX IF NOT EXISTS idx_moodboard_tags_card
  ON projet_moodboard_tags (card_id);

-- Lookup par tag (DISTINCT pour autocomplete + filtres)
CREATE INDEX IF NOT EXISTS idx_moodboard_tags_tag
  ON projet_moodboard_tags (tag);

-- Lookup par user (rare mais utile pour "mes tags")
CREATE INDEX IF NOT EXISTS idx_moodboard_tags_user
  ON projet_moodboard_tags (user_id)
  WHERE user_id IS NOT NULL;


-- ── 3. RLS — hérité via JOIN cards → sections → project ──────────────────
-- Read : tout membre qui peut lire l'outil moodboard
-- Insert : tout membre qui peut éditer l'outil + user_id = soi
-- Delete : auteur OU admin/charge_prod qui peut éditer (modération)
ALTER TABLE projet_moodboard_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "moodboard_tags_read"   ON projet_moodboard_tags;
DROP POLICY IF EXISTS "moodboard_tags_insert" ON projet_moodboard_tags;
DROP POLICY IF EXISTS "moodboard_tags_delete" ON projet_moodboard_tags;

CREATE POLICY "moodboard_tags_read" ON projet_moodboard_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM projet_moodboard_cards c
      JOIN projet_moodboard_sections s ON s.id = c.section_id
      WHERE c.id = projet_moodboard_tags.card_id
        AND can_read_outil(s.project_id, 'moodboard')
    )
  );

CREATE POLICY "moodboard_tags_insert" ON projet_moodboard_tags
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM projet_moodboard_cards c
      JOIN projet_moodboard_sections s ON s.id = c.section_id
      WHERE c.id = projet_moodboard_tags.card_id
        AND can_edit_outil(s.project_id, 'moodboard')
    )
  );

CREATE POLICY "moodboard_tags_delete" ON projet_moodboard_tags
  FOR DELETE USING (
    -- Soit l'auteur, soit un admin/charge_prod qui peut éditer l'outil
    (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM projet_moodboard_cards c
        JOIN projet_moodboard_sections s ON s.id = c.section_id
        WHERE c.id = projet_moodboard_tags.card_id
          AND can_edit_outil(s.project_id, 'moodboard')
      )
    )
  );


-- ── 4. Realtime publication ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'projet_moodboard_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.projet_moodboard_tags;
  END IF;
END;
$$;

ALTER TABLE projet_moodboard_tags REPLICA IDENTITY FULL;


COMMIT;
