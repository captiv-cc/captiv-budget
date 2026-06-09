-- ============================================================================
-- Migration : FEEDBACK FBK-1.1 — Schéma initial Retours / Idées
-- Date      : 2026-06-10 (A)
-- Contexte  : Nouvel outil GLOBAL (non lié à un projet) pour récolter les
--             bugs et idées de l'équipe sur DESK lui-même.
--
-- Pattern produit :
--   - Tout utilisateur peut créer ses propres tickets (bug ou idée)
--   - User voit uniquement ses tickets
--   - Admin + charge_prod voient TOUS les tickets, peuvent changer statut,
--     commenter, marquer comme doublon (champ duplicate_of)
--   - 3 statuts : proposed → in_progress → done
--   - Priorité auto-déclarée : urgent / normal / nice_to_have
--   - Screenshots/refs en Storage privé (signed URLs)
--   - Auto-capture du contexte technique en JSONB (URL, user-agent,
--     viewport, version build)
--
-- Périmètre :
--   1. CREATE TABLE feedback_tickets   (tickets bug/idée)
--   2. CREATE TABLE feedback_attachments (screenshots / refs images)
--   3. CREATE TABLE feedback_comments  (discussion par ticket)
--   4. Indexes + triggers updated_at
--   5. RLS sur les 3 tables (perso ou admin)
--   6. Realtime publication + REPLICA IDENTITY FULL
--   7. Storage bucket 'feedback' privé (signed URLs)
--
-- Idempotent : Oui.
-- ============================================================================

BEGIN;


-- ── 1. CREATE TABLE feedback_tickets ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Type discriminé : bug | idea
  type TEXT NOT NULL CHECK (type IN ('bug', 'idea')),

  -- Auteur (peut être NULL si profile supprimé, mais le ticket reste audit)
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Page concernée (texte libre, ex: "/projets/X/livrables" ou "Devis")
  -- Auto-rempli côté front avec l'URL/nom de la page courante.
  page TEXT,

  -- Catégorie libre : "type de bug" (ex: "crash", "UI", "lenteur") ou
  -- "thématique" (ex: "amélioration UX", "intégration"). Texte court.
  category TEXT,

  -- Titre court (obligatoire)
  title TEXT NOT NULL CHECK (LENGTH(title) BETWEEN 1 AND 200),

  -- Description longue (markdown plain text en V1)
  description TEXT NOT NULL CHECK (LENGTH(description) BETWEEN 1 AND 8000),

  -- Pour les bugs uniquement : étapes pour reproduire (optionnel)
  steps_to_reproduce TEXT,

  -- Priorité déclarée par l'auteur
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('urgent', 'normal', 'nice_to_have')),

  -- Cycle de vie : proposed → in_progress → done (= archive)
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'in_progress', 'done')),

  -- Doublon : pointe vers le ticket source si admin a mergé
  duplicate_of UUID REFERENCES feedback_tickets(id) ON DELETE SET NULL,

  -- Contexte technique auto-capturé côté front au moment de la création
  -- { url, user_agent, viewport_w, viewport_h, build, language, timezone, ... }
  context_metadata JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE feedback_tickets IS
  'FEEDBACK — Tickets bug/idée signalés par l''équipe sur DESK. User '
  'voit ses propres tickets, admin/charge_prod voit tout. 3 statuts : '
  'proposed → in_progress → done.';


-- ── 2. CREATE TABLE feedback_attachments ────────────────────────────────
-- Screenshots de bugs, images de refs pour les idées. Path Storage dans
-- le bucket 'feedback' privé : <ticket_id>/<filename>
CREATE TABLE IF NOT EXISTS feedback_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ticket_id UUID NOT NULL
    REFERENCES feedback_tickets(id) ON DELETE CASCADE,

  file_path TEXT NOT NULL,        -- Storage path : <ticket_id>/<filename>
  file_name TEXT NOT NULL,        -- Nom d'origine (pour l'affichage)
  mime_type TEXT,                 -- ex: image/png, image/jpeg
  size_bytes BIGINT,              -- Taille pour info / quota

  -- Audit
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE feedback_attachments IS
  'FEEDBACK — Fichiers joints à un ticket (screenshots, refs visuelles). '
  'Path dans le bucket Storage privé feedback, signed URLs à la demande.';


-- ── 3. CREATE TABLE feedback_comments ───────────────────────────────────
-- Discussion par ticket. L'auteur du ticket et les admins peuvent
-- commenter. Texte plat 2000 chars max.
CREATE TABLE IF NOT EXISTS feedback_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ticket_id UUID NOT NULL
    REFERENCES feedback_tickets(id) ON DELETE CASCADE,

  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  body TEXT NOT NULL CHECK (LENGTH(body) BETWEEN 1 AND 2000),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE feedback_comments IS
  'FEEDBACK — Fil de discussion sur un ticket. Auteur ticket + admins '
  'peuvent ajouter. Édition/suppression réservée à l''auteur du comment.';


-- ── 4. Indexes ────────────────────────────────────────────────────────────
-- tickets : lookup par utilisateur (liste perso) + par statut (liste admin)
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_user
  ON feedback_tickets (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_tickets_status
  ON feedback_tickets (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_tickets_type
  ON feedback_tickets (type);

CREATE INDEX IF NOT EXISTS idx_feedback_tickets_duplicate_of
  ON feedback_tickets (duplicate_of)
  WHERE duplicate_of IS NOT NULL;

-- attachments : lookup par ticket
CREATE INDEX IF NOT EXISTS idx_feedback_attachments_ticket
  ON feedback_attachments (ticket_id);

-- comments : lookup par ticket + ordre chrono
CREATE INDEX IF NOT EXISTS idx_feedback_comments_ticket
  ON feedback_comments (ticket_id, created_at ASC);


-- ── 5. Triggers updated_at ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_feedback_tickets_updated_at
  ON feedback_tickets;
CREATE TRIGGER trg_feedback_tickets_updated_at
  BEFORE UPDATE ON feedback_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_feedback_comments_updated_at
  ON feedback_comments;
CREATE TRIGGER trg_feedback_comments_updated_at
  BEFORE UPDATE ON feedback_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 6. RLS — feedback_tickets ─────────────────────────────────────────────
-- Read   : auteur OU admin/charge_prod
-- Insert : self (user_id = auth.uid())
-- Update : auteur (limité) OU admin/charge_prod
-- Delete : admin uniquement
ALTER TABLE feedback_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_tickets_read"   ON feedback_tickets;
DROP POLICY IF EXISTS "feedback_tickets_insert" ON feedback_tickets;
DROP POLICY IF EXISTS "feedback_tickets_update" ON feedback_tickets;
DROP POLICY IF EXISTS "feedback_tickets_delete" ON feedback_tickets;

CREATE POLICY "feedback_tickets_read" ON feedback_tickets
  FOR SELECT USING (
    user_id = auth.uid()
    OR current_user_role() IN ('admin', 'charge_prod')
  );

CREATE POLICY "feedback_tickets_insert" ON feedback_tickets
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "feedback_tickets_update" ON feedback_tickets
  FOR UPDATE
  USING (
    -- Auteur : peut éditer son ticket tant qu'il est en 'proposed'
    (user_id = auth.uid())
    -- Admin : peut tout faire (changer statut, marquer duplicate_of, etc.)
    OR current_user_role() IN ('admin', 'charge_prod')
  )
  WITH CHECK (
    (user_id = auth.uid())
    OR current_user_role() IN ('admin', 'charge_prod')
  );

CREATE POLICY "feedback_tickets_delete" ON feedback_tickets
  FOR DELETE USING (
    current_user_role() = 'admin'
  );


-- ── 7. RLS — feedback_attachments (hérité via ticket) ───────────────────
ALTER TABLE feedback_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_attachments_read"   ON feedback_attachments;
DROP POLICY IF EXISTS "feedback_attachments_insert" ON feedback_attachments;
DROP POLICY IF EXISTS "feedback_attachments_delete" ON feedback_attachments;

CREATE POLICY "feedback_attachments_read" ON feedback_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM feedback_tickets t
      WHERE t.id = feedback_attachments.ticket_id
        AND (
          t.user_id = auth.uid()
          OR current_user_role() IN ('admin', 'charge_prod')
        )
    )
  );

CREATE POLICY "feedback_attachments_insert" ON feedback_attachments
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM feedback_tickets t
      WHERE t.id = feedback_attachments.ticket_id
        AND (
          t.user_id = auth.uid()
          OR current_user_role() IN ('admin', 'charge_prod')
        )
    )
  );

CREATE POLICY "feedback_attachments_delete" ON feedback_attachments
  FOR DELETE USING (
    uploaded_by = auth.uid()
    OR current_user_role() = 'admin'
  );


-- ── 8. RLS — feedback_comments (hérité via ticket) ──────────────────────
ALTER TABLE feedback_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_comments_read"   ON feedback_comments;
DROP POLICY IF EXISTS "feedback_comments_insert" ON feedback_comments;
DROP POLICY IF EXISTS "feedback_comments_update" ON feedback_comments;
DROP POLICY IF EXISTS "feedback_comments_delete" ON feedback_comments;

CREATE POLICY "feedback_comments_read" ON feedback_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM feedback_tickets t
      WHERE t.id = feedback_comments.ticket_id
        AND (
          t.user_id = auth.uid()
          OR current_user_role() IN ('admin', 'charge_prod')
        )
    )
  );

CREATE POLICY "feedback_comments_insert" ON feedback_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM feedback_tickets t
      WHERE t.id = feedback_comments.ticket_id
        AND (
          t.user_id = auth.uid()
          OR current_user_role() IN ('admin', 'charge_prod')
        )
    )
  );

CREATE POLICY "feedback_comments_update" ON feedback_comments
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "feedback_comments_delete" ON feedback_comments
  FOR DELETE USING (
    user_id = auth.uid()
    OR current_user_role() = 'admin'
  );


-- ── 9. Realtime publication ──────────────────────────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'feedback_tickets',
    'feedback_attachments',
    'feedback_comments'
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

ALTER TABLE feedback_tickets     REPLICA IDENTITY FULL;
ALTER TABLE feedback_attachments REPLICA IDENTITY FULL;
ALTER TABLE feedback_comments    REPLICA IDENTITY FULL;


-- ── 10. Storage bucket 'feedback' (PRIVÉ) ────────────────────────────────
-- Bucket dédié aux uploads liés au feedback (screenshots de bugs, images
-- de refs pour les idées). PRIVÉ : pas d'URL publique, on génère des
-- signed URLs côté client à la demande (avec expiration adaptée à l'usage).
--
-- Path convention : <ticket_id>/<filename>
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback', 'feedback', false)
ON CONFLICT (id) DO NOTHING;

-- SELECT : peut lire si auteur du ticket parent OU admin/charge_prod
DROP POLICY IF EXISTS "feedback_storage_read" ON storage.objects;
CREATE POLICY "feedback_storage_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'feedback'
    AND EXISTS (
      SELECT 1 FROM feedback_tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
        AND (
          t.user_id = auth.uid()
          OR current_user_role() IN ('admin', 'charge_prod')
        )
    )
  );

-- INSERT : peut uploader si auteur du ticket parent OU admin
DROP POLICY IF EXISTS "feedback_storage_insert" ON storage.objects;
CREATE POLICY "feedback_storage_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'feedback'
    AND EXISTS (
      SELECT 1 FROM feedback_tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
        AND (
          t.user_id = auth.uid()
          OR current_user_role() IN ('admin', 'charge_prod')
        )
    )
  );

-- DELETE : auteur ticket OU admin
DROP POLICY IF EXISTS "feedback_storage_delete" ON storage.objects;
CREATE POLICY "feedback_storage_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'feedback'
    AND EXISTS (
      SELECT 1 FROM feedback_tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
        AND (
          t.user_id = auth.uid()
          OR current_user_role() = 'admin'
        )
    )
  );


COMMIT;
