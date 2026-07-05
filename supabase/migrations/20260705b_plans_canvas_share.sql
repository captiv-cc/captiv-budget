-- ============================================================================
-- Migration : PLANS CANVAS PHASE 3 — partage client + commentaires ancrés
-- Date      : 2026-07-05
-- Chantier  : docs/CHANTIER_PLANS.md
-- ============================================================================
--
-- - plans_canvas_share_tokens : liens client (view | comment), expiration,
--   révocation, compteur de vues. Servis par l'edge function plans-public
--   (service role) : AUCUNE policy anon ici.
-- - plans_canvas_comments : commentaires ancrés sur le canvas (anchor_x/y en
--   coordonnées page tldraw), threads via parent_id, auteur user (desk) ou
--   client (via token). Realtime activé pour la vue desk.
--
-- RLS desk : tokens gérés par les éditeurs (can_edit_outil), commentaires
-- lisibles par les lecteurs (can_read_outil), écriture desk par les éditeurs.
--
-- Idempotent.
-- ============================================================================

BEGIN;


-- ── 1. Tokens de partage client ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans_canvas_share_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id      uuid NOT NULL REFERENCES plans_canvas(id) ON DELETE CASCADE,
  token          text NOT NULL UNIQUE
                 DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  permissions    text NOT NULL DEFAULT 'comment'
                 CHECK (permissions IN ('view', 'comment')),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  view_count     integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS plans_canvas_share_tokens_canvas_idx
  ON plans_canvas_share_tokens(canvas_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE plans_canvas_share_tokens IS
  'Liens de partage client d''un plan éditable. Résolus par l''edge function plans-public (service role). revoked_at ≠ null = lien désactivé.';


-- ── 2. Commentaires ancrés ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans_canvas_comments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id           uuid NOT NULL REFERENCES plans_canvas(id) ON DELETE CASCADE,
  parent_id           uuid REFERENCES plans_canvas_comments(id) ON DELETE CASCADE,
  anchor_x            numeric,
  anchor_y            numeric,
  body                text NOT NULL,
  author_type         text NOT NULL CHECK (author_type IN ('user', 'client')),
  author_user_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author_client_name  text,
  resolved            boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plans_canvas_comments_canvas_idx
  ON plans_canvas_comments(canvas_id);

COMMENT ON TABLE plans_canvas_comments IS
  'Commentaires ancrés sur un plan éditable. anchor_x/y = coordonnées PAGE tldraw (null pour les réponses de thread via parent_id). author_type client = posté via token de partage (edge function).';


-- ── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE plans_canvas_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_canvas_tokens_scoped" ON plans_canvas_share_tokens;
CREATE POLICY "plans_canvas_tokens_scoped" ON plans_canvas_share_tokens
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM plans_canvas c
    WHERE c.id = plans_canvas_share_tokens.canvas_id
      AND can_edit_outil(c.project_id, 'plans')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plans_canvas c
    WHERE c.id = plans_canvas_share_tokens.canvas_id
      AND can_edit_outil(c.project_id, 'plans')
  ));

ALTER TABLE plans_canvas_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_canvas_comments_read"  ON plans_canvas_comments;
DROP POLICY IF EXISTS "plans_canvas_comments_write" ON plans_canvas_comments;

CREATE POLICY "plans_canvas_comments_read" ON plans_canvas_comments
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM plans_canvas c
    WHERE c.id = plans_canvas_comments.canvas_id
      AND can_read_outil(c.project_id, 'plans')
  ));

CREATE POLICY "plans_canvas_comments_write" ON plans_canvas_comments
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM plans_canvas c
    WHERE c.id = plans_canvas_comments.canvas_id
      AND can_edit_outil(c.project_id, 'plans')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plans_canvas c
    WHERE c.id = plans_canvas_comments.canvas_id
      AND can_edit_outil(c.project_id, 'plans')
  ));


-- ── 4. Realtime : commentaires live dans l'éditeur desk ────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE plans_canvas_comments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;


COMMIT;
