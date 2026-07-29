-- ════════════════════════════════════════════════════════════════════════════
-- LOGISTIQUE V1 — P2c : documents sur trajets et hébergements
-- ════════════════════════════════════════════════════════════════════════════
--
-- Billets de train / réservations (PDF, PNG, JPG) attachés à un trajet ou à
-- un hébergement. Table générique + bucket dédié dont les paths commencent
-- par le project_id → policies storage directes sans lookup parent :
--   "<project_id>/<uuid>.<ext>"
--
-- Idempotent. À appliquer après 20260729a_logistique_v1_schema.sql.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS projet_logistique_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('trajet', 'hebergement')),
  parent_id UUID NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size_bytes BIGINT,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logi_docs_parent
  ON projet_logistique_docs(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_logi_docs_project
  ON projet_logistique_docs(project_id);

ALTER TABLE projet_logistique_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_logistique_docs_read"   ON projet_logistique_docs;
DROP POLICY IF EXISTS "projet_logistique_docs_insert" ON projet_logistique_docs;
DROP POLICY IF EXISTS "projet_logistique_docs_delete" ON projet_logistique_docs;

CREATE POLICY "projet_logistique_docs_read" ON projet_logistique_docs
  FOR SELECT USING (can_read_outil(project_id, 'logistique_v0'));
CREATE POLICY "projet_logistique_docs_insert" ON projet_logistique_docs
  FOR INSERT WITH CHECK (can_edit_outil(project_id, 'logistique_v0'));
CREATE POLICY "projet_logistique_docs_delete" ON projet_logistique_docs
  FOR DELETE USING (can_edit_outil(project_id, 'logistique_v0'));


-- ── Bucket ──────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('projet-logistique-docs', 'projet-logistique-docs', false)
ON CONFLICT (id) DO NOTHING;

-- ── Policies storage : 1er segment du path = project_id ────────────────────
DROP POLICY IF EXISTS "projet-logistique-docs read authed"   ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-docs read anon"     ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-docs insert authed" ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-docs delete authed" ON storage.objects;

CREATE POLICY "projet-logistique-docs read authed"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'projet-logistique-docs'
    AND can_read_outil(split_part(storage.objects.name, '/', 1)::uuid, 'logistique_v0')
  );

-- Anon : mêmes conditions que les docs V0 — au moins un token de partage
-- actif du projet incluant 'logistique_v0' (pour la page publique P4).
CREATE POLICY "projet-logistique-docs read anon"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'projet-logistique-docs'
    AND EXISTS (
      SELECT 1 FROM project_share_tokens t
      WHERE t.project_id = split_part(storage.objects.name, '/', 1)::uuid
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND (t.enabled_pages ? 'logistique_v0')
    )
  );

CREATE POLICY "projet-logistique-docs insert authed"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'projet-logistique-docs'
    AND can_edit_outil(split_part(storage.objects.name, '/', 1)::uuid, 'logistique_v0')
  );

CREATE POLICY "projet-logistique-docs delete authed"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'projet-logistique-docs'
    AND can_edit_outil(split_part(storage.objects.name, '/', 1)::uuid, 'logistique_v0')
  );

-- Vérification : SELECT id FROM storage.buckets WHERE id = 'projet-logistique-docs';
