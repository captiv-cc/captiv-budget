-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE — bucket "project-covers"
-- Stockage des avatars/visuels de projet (référencé par projects.cover_url)
-- À exécuter une fois dans la console SQL Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Création du bucket (public en lecture, écriture restreinte par policies)
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-covers', 'project-covers', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Policies RLS sur storage.objects pour ce bucket
--    Convention de path : project-covers/<project_id>/<filename>

-- Lecture publique (le bucket est public, mais on garde l'explicite)
DROP POLICY IF EXISTS "project-covers read public" ON storage.objects;
CREATE POLICY "project-covers read public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'project-covers');

-- Upload : tout utilisateur authentifié ayant accès au projet (RLS via projects)
DROP POLICY IF EXISTS "project-covers insert authed" ON storage.objects;
CREATE POLICY "project-covers insert authed"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-covers'
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id::text = (storage.foldername(name))[1]
    )
  );

-- Update : idem (pour remplacer l'image existante)
DROP POLICY IF EXISTS "project-covers update authed" ON storage.objects;
CREATE POLICY "project-covers update authed"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'project-covers'
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id::text = (storage.foldername(name))[1]
    )
  );

-- Delete : idem
DROP POLICY IF EXISTS "project-covers delete authed" ON storage.objects;
CREATE POLICY "project-covers delete authed"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-covers'
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id::text = (storage.foldername(name))[1]
    )
  );
