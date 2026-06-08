-- ============================================================================
-- Migration : MUSIQUES MVP1.5 — Table commentaires sur propositions
-- Date      : 2026-06-08 (F — vague 2 : collab par fil de discussion)
-- Contexte  : Hugo veut pouvoir mettre des commentaires sur chaque
--             proposition, avec audit (qui a posté, quand). Cas d'usage :
--               "Top pour le SEQ 4 mais le drop arrive trop tard"
--               "Bon pour reel récap J1 mais conditions label strictes"
--               "Marc → on a déjà utilisé en 2024 sur Plages Élec"
--
-- Périmètre :
--   1. CREATE TABLE projet_musique_comments
--   2. RLS read si peut lire l'outil musiques, write seulement ses
--      commentaires (user_id = auth.uid())
--   3. Trigger updated_at
--   4. Ajout à la publication supabase_realtime + REPLICA IDENTITY FULL
--
-- Idempotent : Oui.
-- ============================================================================

BEGIN;


-- ── 1. CREATE TABLE projet_musique_comments ──────────────────────────────
CREATE TABLE IF NOT EXISTS projet_musique_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  proposition_id UUID NOT NULL
    REFERENCES projet_musique_propositions(id) ON DELETE CASCADE,

  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Contenu du commentaire : texte simple en MVP. RichEditor pourra
  -- venir plus tard si besoin de mentions / mise en forme.
  body TEXT NOT NULL CHECK (LENGTH(body) >= 1 AND LENGTH(body) <= 2000),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE projet_musique_comments IS
  'MUSIQUES — Fil de discussion sur une proposition. Texte simple, '
  '2000 chars max, édition/suppression réservée à l''auteur (RLS).';


-- ── 2. Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_musique_comments_proposition
  ON projet_musique_comments (proposition_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_musique_comments_user
  ON projet_musique_comments (user_id);


-- ── 3. Trigger updated_at ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_musique_comments_updated_at
  ON projet_musique_comments;
CREATE TRIGGER trg_musique_comments_updated_at
  BEFORE UPDATE ON projet_musique_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 4. RLS ───────────────────────────────────────────────────────────────
-- Read : tout membre qui peut lire l'outil musiques voit tous les commentaires
-- Write : seulement ses propres commentaires (user_id = auth.uid())
ALTER TABLE projet_musique_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "musique_comments_read"   ON projet_musique_comments;
DROP POLICY IF EXISTS "musique_comments_insert" ON projet_musique_comments;
DROP POLICY IF EXISTS "musique_comments_update" ON projet_musique_comments;
DROP POLICY IF EXISTS "musique_comments_delete" ON projet_musique_comments;

CREATE POLICY "musique_comments_read" ON projet_musique_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_comments.proposition_id
        AND can_read_outil(p.project_id, 'musiques')
    )
  );

CREATE POLICY "musique_comments_insert" ON projet_musique_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_comments.proposition_id
        AND can_edit_outil(p.project_id, 'musiques')
    )
  );

CREATE POLICY "musique_comments_update" ON projet_musique_comments
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "musique_comments_delete" ON projet_musique_comments
  FOR DELETE USING (
    -- Soit l'auteur, soit un admin/charge_prod qui peut éditer l'outil
    -- (cleanup modération si besoin).
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projet_musique_propositions p
      WHERE p.id = projet_musique_comments.proposition_id
        AND can_edit_outil(p.project_id, 'musiques')
    )
  );


-- ── 5. Realtime publication ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'projet_musique_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.projet_musique_comments;
  END IF;
END;
$$;

ALTER TABLE projet_musique_comments REPLICA IDENTITY FULL;


COMMIT;
