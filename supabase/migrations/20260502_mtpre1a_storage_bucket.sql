-- =====================================================================
-- MT-PRE-1.A — Bucket Storage org-assets pour logos/signatures
-- =====================================================================
--
-- Bucket dédié au stockage des actifs visuels des organisations
-- (logos clair/sombre, signatures producteur). Distinct de
-- project-covers (covers de projets) pour clarté.
--
-- Path convention : <org_id>/<type>-<timestamp>.<ext>
--   ex: 6f3a.../logo-clair-1714668000.png
--       6f3a.../logo-sombre-1714668000.png
--       6f3a.../signature-1714668000.png
--
-- RLS : SELECT public (les URLs sont publiques par nature, on les
-- met dans <img src>), WRITE réservé aux admins/charge_prod de l'org
-- du préfixe.
--
-- Idempotent.
-- =====================================================================

BEGIN;

-- Créer le bucket s'il n'existe pas
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-assets', 'org-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Lecture publique
DROP POLICY IF EXISTS "org_assets_public_read" ON storage.objects;
CREATE POLICY "org_assets_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'org-assets');

-- Upload : admin/charge_prod peuvent uploader dans le préfixe de leur org
DROP POLICY IF EXISTS "org_assets_admin_upload" ON storage.objects;
CREATE POLICY "org_assets_admin_upload" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'org-assets'
    AND current_user_role() IN ('admin', 'charge_prod')
    AND (storage.foldername(name))[1] = get_user_org_id()::text
  );

-- Update : idem
DROP POLICY IF EXISTS "org_assets_admin_update" ON storage.objects;
CREATE POLICY "org_assets_admin_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'org-assets'
    AND current_user_role() IN ('admin', 'charge_prod')
    AND (storage.foldername(name))[1] = get_user_org_id()::text
  );

-- Delete : idem (utile pour remplacer un logo proprement)
DROP POLICY IF EXISTS "org_assets_admin_delete" ON storage.objects;
CREATE POLICY "org_assets_admin_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'org-assets'
    AND current_user_role() IN ('admin', 'charge_prod')
    AND (storage.foldername(name))[1] = get_user_org_id()::text
  );

COMMIT;
