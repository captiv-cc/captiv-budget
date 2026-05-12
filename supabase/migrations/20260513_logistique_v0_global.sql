-- ============================================================================
-- Migration : LOGISTIQUE V0 — bloc Global (infos générales projet)
-- Date      : 2026-05-13
-- Contexte  : Hugo veut un bloc "Global" (1 par projet) pour publier les infos
--             logistique valables pour toute l'équipe : stationnement, plan
--             d'accès, contacts régie, etc. Texte libre + documents PDF/PNG/JPG
--             en grand format avec preview (mêmes formats que les sous-blocs
--             membre).
--
-- Architecture :
--   - 1 table `projet_logistique_v0_global` : 1 row par projet (UNIQUE
--     project_id) avec un champ `text` libre. On utilise un upsert depuis
--     le front (si pas de row, INSERT ; sinon UPDATE).
--   - 1 table `projet_logistique_v0_global_documents` : N docs par global.
--     Mêmes colonnes que entry_documents, scopées via global_id.
--   - Mêmes bucket Storage et signed URLs que les sous-blocs membre, mais
--     les paths utilisent <global_id>/ au lieu de <entry_id>/. Les policies
--     storage.objects sont étendues pour gérer les 2 sources via OR.
--
-- Permissions : identiques aux sous-blocs membre — can_read_outil pour lecture,
-- can_edit_outil pour écriture, scopé sur 'logistique_v0'.
--
-- Effet :
--   1. CREATE TABLE projet_logistique_v0_global (UNIQUE project_id)
--   2. CREATE TABLE projet_logistique_v0_global_documents
--   3. Indexes + trigger updated_at
--   4. RLS sur les 2 tables
--   5. Update storage policies : ajout d'une branche OR pour les paths
--      qui commencent par un global_id
--   6. Update RPC share_projet_logistique_v0_fetch : ajout `global` + `global_documents`
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE.
-- ============================================================================

BEGIN;


-- ── 1. Table projet_logistique_v0_global (1 row par projet) ────────────────
CREATE TABLE IF NOT EXISTS projet_logistique_v0_global (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UNIQUE pour garantir 1 et 1 seul row par projet. Si l'UI fait un INSERT
  -- alors qu'un row existe déjà, on récupère le 23505 → on bascule sur UPDATE.
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,

  text TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE projet_logistique_v0_global IS
  'Logistique V0 (provisoire) : bloc "Infos générales" du projet (1 row par projet). Texte libre + N documents via projet_logistique_v0_global_documents.';


-- ── 2. Table projet_logistique_v0_global_documents ─────────────────────────
-- Mêmes colonnes que projet_logistique_v0_documents mais scoped via global_id.
-- Pas de `kind` ici — un seul "type" de doc dans le bloc Global.
CREATE TABLE IF NOT EXISTS projet_logistique_v0_global_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  global_id UUID NOT NULL REFERENCES projet_logistique_v0_global(id) ON DELETE CASCADE,

  -- Path Storage relatif au bucket. Format : `<global_id>/<doc_uuid>.<ext>`.
  -- Le préfixe global_id permet aux policies Storage de retrouver le projet
  -- parent via JOIN.
  storage_path TEXT NOT NULL,

  filename TEXT NOT NULL,
  mime_type  TEXT,
  size_bytes BIGINT,

  uploaded_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE projet_logistique_v0_global_documents IS
  'Logistique V0 (provisoire) : documents (PDF/PNG/JPG) attachés au bloc Global d''un projet.';


-- ── 3. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_logistique_v0_global_project
  ON projet_logistique_v0_global(project_id);

CREATE INDEX IF NOT EXISTS idx_logistique_v0_global_documents_global
  ON projet_logistique_v0_global_documents(global_id, created_at);


-- ── 4. Trigger updated_at ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_logistique_v0_global_updated_at
  ON projet_logistique_v0_global;
CREATE TRIGGER trg_logistique_v0_global_updated_at
  BEFORE UPDATE ON projet_logistique_v0_global
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 5. RLS — projet_logistique_v0_global ───────────────────────────────────
ALTER TABLE projet_logistique_v0_global ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_logistique_v0_global_read"   ON projet_logistique_v0_global;
DROP POLICY IF EXISTS "projet_logistique_v0_global_insert" ON projet_logistique_v0_global;
DROP POLICY IF EXISTS "projet_logistique_v0_global_update" ON projet_logistique_v0_global;
DROP POLICY IF EXISTS "projet_logistique_v0_global_delete" ON projet_logistique_v0_global;

CREATE POLICY "projet_logistique_v0_global_read" ON projet_logistique_v0_global
  FOR SELECT USING (can_read_outil(project_id, 'logistique_v0'));

CREATE POLICY "projet_logistique_v0_global_insert" ON projet_logistique_v0_global
  FOR INSERT WITH CHECK (can_edit_outil(project_id, 'logistique_v0'));

CREATE POLICY "projet_logistique_v0_global_update" ON projet_logistique_v0_global
  FOR UPDATE
  USING (can_edit_outil(project_id, 'logistique_v0'))
  WITH CHECK (can_edit_outil(project_id, 'logistique_v0'));

CREATE POLICY "projet_logistique_v0_global_delete" ON projet_logistique_v0_global
  FOR DELETE USING (can_edit_outil(project_id, 'logistique_v0'));


-- ── 6. RLS — projet_logistique_v0_global_documents (héritée via global) ────
ALTER TABLE projet_logistique_v0_global_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_logistique_v0_global_docs_read"   ON projet_logistique_v0_global_documents;
DROP POLICY IF EXISTS "projet_logistique_v0_global_docs_insert" ON projet_logistique_v0_global_documents;
DROP POLICY IF EXISTS "projet_logistique_v0_global_docs_update" ON projet_logistique_v0_global_documents;
DROP POLICY IF EXISTS "projet_logistique_v0_global_docs_delete" ON projet_logistique_v0_global_documents;

CREATE POLICY "projet_logistique_v0_global_docs_read" ON projet_logistique_v0_global_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_global g
      WHERE g.id = projet_logistique_v0_global_documents.global_id
        AND can_read_outil(g.project_id, 'logistique_v0')
    )
  );

CREATE POLICY "projet_logistique_v0_global_docs_insert" ON projet_logistique_v0_global_documents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_global g
      WHERE g.id = projet_logistique_v0_global_documents.global_id
        AND can_edit_outil(g.project_id, 'logistique_v0')
    )
  );

CREATE POLICY "projet_logistique_v0_global_docs_update" ON projet_logistique_v0_global_documents
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_global g
      WHERE g.id = projet_logistique_v0_global_documents.global_id
        AND can_edit_outil(g.project_id, 'logistique_v0')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_global g
      WHERE g.id = projet_logistique_v0_global_documents.global_id
        AND can_edit_outil(g.project_id, 'logistique_v0')
    )
  );

CREATE POLICY "projet_logistique_v0_global_docs_delete" ON projet_logistique_v0_global_documents
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_global g
      WHERE g.id = projet_logistique_v0_global_documents.global_id
        AND can_edit_outil(g.project_id, 'logistique_v0')
    )
  );


-- ── 7. Storage policies étendues (entry OR global) ─────────────────────────
-- Les paths peuvent désormais commencer par un entry_id (sous-bloc membre)
-- OU un global_id (bloc Global). On recrée les 5 policies avec une branche
-- OR pour les 2 sources. Le bucket reste le même : projet-logistique-v0-docs.

DROP POLICY IF EXISTS "projet-logistique-v0-docs read authed"   ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-v0-docs read anon"     ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-v0-docs insert authed" ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-v0-docs update authed" ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-v0-docs delete authed" ON storage.objects;

-- ░ SELECT authenticated : can_read_outil sur le projet (via entry OU global)
CREATE POLICY "projet-logistique-v0-docs read authed"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'projet-logistique-v0-docs'
    AND (
      EXISTS (
        SELECT 1 FROM projet_logistique_v0_entries e
        WHERE e.id::text = split_part(storage.objects.name, '/', 1)
          AND can_read_outil(e.project_id, 'logistique_v0')
      )
      OR EXISTS (
        SELECT 1 FROM projet_logistique_v0_global g
        WHERE g.id::text = split_part(storage.objects.name, '/', 1)
          AND can_read_outil(g.project_id, 'logistique_v0')
      )
    )
  );

-- ░ SELECT anon : via project_share_tokens actif avec 'logistique_v0' enabled
CREATE POLICY "projet-logistique-v0-docs read anon"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'projet-logistique-v0-docs'
    AND (
      EXISTS (
        SELECT 1
          FROM projet_logistique_v0_entries e
          JOIN project_share_tokens t ON t.project_id = e.project_id
         WHERE e.id::text = split_part(storage.objects.name, '/', 1)
           AND t.revoked_at IS NULL
           AND (t.expires_at IS NULL OR t.expires_at > now())
           AND (t.enabled_pages ? 'logistique_v0')
      )
      OR EXISTS (
        SELECT 1
          FROM projet_logistique_v0_global g
          JOIN project_share_tokens t ON t.project_id = g.project_id
         WHERE g.id::text = split_part(storage.objects.name, '/', 1)
           AND t.revoked_at IS NULL
           AND (t.expires_at IS NULL OR t.expires_at > now())
           AND (t.enabled_pages ? 'logistique_v0')
      )
    )
  );

-- ░ INSERT / UPDATE / DELETE authenticated : can_edit_outil
CREATE POLICY "projet-logistique-v0-docs insert authed"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'projet-logistique-v0-docs'
    AND (
      EXISTS (
        SELECT 1 FROM projet_logistique_v0_entries e
        WHERE e.id::text = split_part(storage.objects.name, '/', 1)
          AND can_edit_outil(e.project_id, 'logistique_v0')
      )
      OR EXISTS (
        SELECT 1 FROM projet_logistique_v0_global g
        WHERE g.id::text = split_part(storage.objects.name, '/', 1)
          AND can_edit_outil(g.project_id, 'logistique_v0')
      )
    )
  );

CREATE POLICY "projet-logistique-v0-docs update authed"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'projet-logistique-v0-docs'
    AND (
      EXISTS (
        SELECT 1 FROM projet_logistique_v0_entries e
        WHERE e.id::text = split_part(storage.objects.name, '/', 1)
          AND can_edit_outil(e.project_id, 'logistique_v0')
      )
      OR EXISTS (
        SELECT 1 FROM projet_logistique_v0_global g
        WHERE g.id::text = split_part(storage.objects.name, '/', 1)
          AND can_edit_outil(g.project_id, 'logistique_v0')
      )
    )
  );

CREATE POLICY "projet-logistique-v0-docs delete authed"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'projet-logistique-v0-docs'
    AND (
      EXISTS (
        SELECT 1 FROM projet_logistique_v0_entries e
        WHERE e.id::text = split_part(storage.objects.name, '/', 1)
          AND can_edit_outil(e.project_id, 'logistique_v0')
      )
      OR EXISTS (
        SELECT 1 FROM projet_logistique_v0_global g
        WHERE g.id::text = split_part(storage.objects.name, '/', 1)
          AND can_edit_outil(g.project_id, 'logistique_v0')
      )
    )
  );


-- ── 8. Update RPC share_projet_logistique_v0_fetch — ajout global ──────────
CREATE OR REPLACE FUNCTION share_projet_logistique_v0_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_projet_logistique_v0_fetch$
DECLARE
  v_project_id uuid;
  v_label      text;
  v_result     jsonb;
BEGIN
  SELECT project_id, label
    INTO v_project_id, v_label
    FROM _project_share_token_resolve(p_token, 'logistique_v0', p_password);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label', v_label
    ),
    'project', (
      SELECT jsonb_build_object(
        'id',         p.id,
        'title',      p.title,
        'ref_projet', p.ref_projet,
        'cover_url',  p.cover_url
      )
      FROM projects p WHERE p.id = v_project_id
    ),
    'org', (
      SELECT jsonb_build_object(
        'id',                o.id,
        'display_name',      o.display_name,
        'legal_name',        o.legal_name,
        'tagline',           o.tagline,
        'logo_url_clair',    o.logo_url_clair,
        'logo_url_sombre',   o.logo_url_sombre,
        'logo_banner_url',   o.logo_banner_url,
        'brand_color',       o.brand_color,
        'website_url',       o.website_url
      )
      FROM projects p
      LEFT JOIN organisations o ON o.id = p.org_id
      WHERE p.id = v_project_id
    ),
    -- Bloc Global (1 row max). NULL si pas encore créé pour ce projet.
    'global', (
      SELECT jsonb_build_object(
        'id',          g.id,
        'project_id',  g.project_id,
        'text',        g.text,
        'created_at',  g.created_at,
        'updated_at',  g.updated_at
      )
      FROM projet_logistique_v0_global g
      WHERE g.project_id = v_project_id
      LIMIT 1
    ),
    -- Documents du bloc Global. Toujours [] si pas de global.
    'global_documents', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           d.id,
          'global_id',    d.global_id,
          'storage_path', d.storage_path,
          'filename',     d.filename,
          'mime_type',    d.mime_type,
          'size_bytes',   d.size_bytes,
          'created_at',   d.created_at
        ) ORDER BY d.created_at
      )
      FROM projet_logistique_v0_global_documents d
      JOIN projet_logistique_v0_global g ON g.id = d.global_id
      WHERE g.project_id = v_project_id
    ), '[]'::jsonb),
    -- Entries (membres) — inchangé
    'entries', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                e.id,
          'project_id',        e.project_id,
          'membre_id',         e.membre_id,
          'transport_text',    e.transport_text,
          'hebergement_text',  e.hebergement_text,
          'repas_text',        e.repas_text,
          'hidden_kinds',      to_jsonb(COALESCE(e.hidden_kinds, '{}'::text[])),
          'created_at',        e.created_at,
          'updated_at',        e.updated_at
        ) ORDER BY COALESCE(m.nom, c.nom, ''), COALESCE(m.prenom, c.prenom, ''), e.created_at
      )
      FROM projet_logistique_v0_entries e
      JOIN projet_membres m ON m.id = e.membre_id
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE e.project_id = v_project_id
    ), '[]'::jsonb),
    'documents', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           d.id,
          'entry_id',     d.entry_id,
          'kind',         d.kind,
          'storage_path', d.storage_path,
          'filename',     d.filename,
          'mime_type',    d.mime_type,
          'size_bytes',   d.size_bytes,
          'created_at',   d.created_at
        ) ORDER BY d.entry_id, d.kind, d.created_at
      )
      FROM projet_logistique_v0_documents d
      JOIN projet_logistique_v0_entries e ON e.id = d.entry_id
      WHERE e.project_id = v_project_id
    ), '[]'::jsonb),
    'membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         m.id,
          'prenom',     COALESCE(m.prenom, c.prenom),
          'nom',        COALESCE(m.nom, c.nom),
          'specialite', m.specialite
        )
      )
      FROM projet_membres m
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE m.project_id = v_project_id
        AND m.id IN (
          SELECT e.membre_id
            FROM projet_logistique_v0_entries e
           WHERE e.project_id = v_project_id
        )
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, 'logistique_v0');

  RETURN v_result;
END;
$share_projet_logistique_v0_fetch$;

REVOKE ALL ON FUNCTION share_projet_logistique_v0_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_logistique_v0_fetch(text, text)
  TO anon, authenticated;


-- ── 9. Reload PostgREST ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
