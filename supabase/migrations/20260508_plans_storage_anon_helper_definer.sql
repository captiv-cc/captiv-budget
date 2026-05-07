-- ============================================================================
-- Migration : PLANS-SHARE — helper SECURITY DEFINER pour policy storage anon
-- Date      : 2026-05-08
-- Contexte  : Suite du hotfix précédent. Le sub-SELECT direct dans la policy
--             storage (EXISTS FROM project_share_tokens / plans_share_tokens)
--             est lui-même contraint par les RLS de ces tables, qui bloquent
--             les visiteurs anon (RLS org-scoped via get_user_org_id()).
--             Résultat : la policy storage retourne false même quand un
--             token actif existe → createSignedUrl échoue → "Object not found".
--
-- Solution : wrapper le check dans une fonction SECURITY DEFINER. La fonction
--            tourne avec les privilèges du créateur (postgres) et bypass les
--            RLS des tables share_tokens. La policy storage appelle juste
--            cette fonction → check fiable même en mode anon.
--
-- Sécurité : la fonction ne révèle JAMAIS la valeur du token. Elle retourne
--            uniquement un booléen (existe-t-il un token actif sur ce projet
--            avec la bonne page activée ?). Pas de leak d'énumération possible
--            depuis un anon.
--
-- ATTENTION : la modification de la policy `plans_storage_anon_share` elle-même
--             ne peut PAS être faite via SQL Editor sur les projets Supabase
--             modernes (ERROR 42501: must be owner of relation objects). Il
--             faut passer par Dashboard → Storage → bucket plans → Policies →
--             Edit policy. La nouvelle USING expression doit être :
--
--               bucket_id = 'plans' AND _plans_storage_can_anon_access(name)
--
-- Idempotent : oui (CREATE OR REPLACE FUNCTION).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._plans_storage_can_anon_access(p_path text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, storage
AS $$
  SELECT
    -- Cas 1 : lien dédié plans actif sur le projet
    EXISTS (
      SELECT 1
      FROM plans_share_tokens t
      WHERE t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND t.project_id = ((storage.foldername(p_path))[1])::uuid
    )
    -- Cas 2 : portail projet actif avec page 'plans' activée
    OR EXISTS (
      SELECT 1
      FROM project_share_tokens t
      WHERE t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND t.enabled_pages ? 'plans'
        AND t.project_id = ((storage.foldername(p_path))[1])::uuid
    );
$$;

REVOKE ALL ON FUNCTION public._plans_storage_can_anon_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._plans_storage_can_anon_access(text) TO anon, authenticated;

COMMENT ON FUNCTION public._plans_storage_can_anon_access(text) IS
  'Helper SECURITY DEFINER pour la policy storage plans_storage_anon_share. Vérifie si le path appartient à un projet ayant un share token actif (lien dédié plans OU portail projet avec page plans). Bypass les RLS de plans_share_tokens / project_share_tokens.';

COMMIT;

-- ============================================================================
-- Étapes manuelles côté Hugo après cette migration
-- ============================================================================
-- 1. Vérifier que la fonction fonctionne :
--      SELECT public._plans_storage_can_anon_access(
--        '<project_id>/<plan_id>/<filename>'
--      );
--    Doit retourner true si un share token actif couvre ce projet (avec
--    page 'plans' si c'est un portail projet).
--
-- 2. Modifier la policy storage `plans_storage_anon_share` via Dashboard
--    Storage → bucket plans → Policies → Edit. Nouvelle USING expression :
--      bucket_id = 'plans' AND _plans_storage_can_anon_access(name)
--    Target roles : anon. Operation : SELECT.
--
-- 3. Tester en navigation privée : ouvrir le portail projet partagé,
--    cliquer sur un plan → le viewer doit s'ouvrir et le PDF/PNG charger.
-- ============================================================================
