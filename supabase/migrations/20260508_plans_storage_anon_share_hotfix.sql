-- ============================================================================
-- Migration : PLANS-SHARE — hotfix policy storage anon (portail projet)
-- Date      : 2026-05-08
-- Contexte  : Bug remonté par Hugo — sur le portail projet partage
--             (/share/projet/:token/plans), l'ouverture d'un plan en
--             navigation privée (ou nouvel appareil = anon vrai) échoue
--             avec "Cannot coerce the result to a single JSON object".
--
--             Cause : la policy `plans_storage_anon_share` doit autoriser
--             les visiteurs anon à appeler createSignedUrl quand le portail
--             projet (`project_share_tokens`) inclut 'plans' dans ses
--             enabled_pages. Sans cette autorisation, signed_url retourne
--             null côté client → PlanViewer fallback sur getPlan() →
--             bloqué par RLS plans table → l'erreur PostgREST "Cannot
--             coerce…" apparaît.
--
--             Cette migration ré-applique la policy de manière idempotente,
--             pour le cas où 20260504_project_share_plans.sql n'aurait
--             pas été appliquée OU aurait été overwritée par un déploiement
--             ultérieur. CREATE OR REPLACE n'existe pas pour les policies
--             → on fait DROP IF EXISTS + CREATE.
--
-- Idempotent : oui (DROP IF EXISTS + CREATE).
-- Dépend de  : 20260504_plans_share_tokens.sql (table + bucket plans),
--              20260504_project_share_tokens.sql (project_share_tokens).
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "plans_storage_anon_share" ON storage.objects;

CREATE POLICY "plans_storage_anon_share" ON storage.objects
  FOR SELECT
  TO anon
  USING (
    bucket_id = 'plans'
    AND (
      -- Cas 1 : token de share dédié plans actif sur le projet
      EXISTS (
        SELECT 1
          FROM plans_share_tokens t
         WHERE t.revoked_at IS NULL
           AND (t.expires_at IS NULL OR t.expires_at > now())
           AND t.project_id = ((storage.foldername(name))[1])::uuid
      )
      -- Cas 2 : portail projet actif avec page 'plans' activée
      OR EXISTS (
        SELECT 1
          FROM project_share_tokens t
         WHERE t.revoked_at IS NULL
           AND (t.expires_at IS NULL OR t.expires_at > now())
           AND t.enabled_pages ? 'plans'
           AND t.project_id = ((storage.foldername(name))[1])::uuid
      )
    )
  );

COMMENT ON POLICY "plans_storage_anon_share" ON storage.objects IS
  'Permet à anon de générer des signed URLs sur le bucket plans tant qu''un share token actif existe sur le projet (lien dédié plans_share_tokens OU portail projet project_share_tokens avec page plans activée).';

COMMIT;

-- ============================================================================
-- Vérifications post-deploy (Hugo) :
--
-- 1. Policy bien posée :
--    SELECT policyname FROM pg_policies
--     WHERE tablename = 'objects'
--       AND schemaname = 'storage'
--       AND policyname = 'plans_storage_anon_share';
--
-- 2. Test côté client : ouvre le portail projet en navigation privée.
--    Clique sur un plan → le viewer doit s'ouvrir et le PDF/PNG charger.
--    En cas d'échec, ouvrir DevTools → Console et chercher :
--      [plansShare] createSignedUrl error
--    Si présent, la policy n'autorise toujours pas l'anon à signer →
--    vérifier que project_share_tokens.enabled_pages contient 'plans'
--    pour le token utilisé :
--      SELECT id, label, enabled_pages, revoked_at, expires_at
--        FROM project_share_tokens
--       WHERE token = '<token>';
-- ============================================================================
