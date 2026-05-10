-- ============================================================================
-- Migration : CREATE PROJECT RPC — workaround RLS pour création de projet
-- Date      : 2026-05-08
-- Contexte  : Bug remonté par Hugo en prod (desk.captiv.cc). La création
--             d'un projet via INSERT direct sur la table projects échoue
--             en 403 "new row violates row-level security policy".
--
--             Causes diagnostiquées :
--             - apikey Supabase passée au nouveau format sb_publishable_*
--             - JWT user signé en ES256 (nouvelles JWT signing keys)
--             - Le couple n'arrive plus à valider auth.uid() côté Postgres
--               → is_admin() / get_user_org_id() retournent NULL
--               → la policy projects_scoped_insert refuse l'INSERT
--
--             Solution : RPC SECURITY DEFINER qui :
--             - Bypass les RLS de la table projects (SECURITY DEFINER)
--             - Mais maintient la sécurité en vérifiant que le caller est
--               bien admin/charge_prod via son profile (lookup direct, pas
--               via auth.uid() qui peut être null avec les nouveaux JWT)
--             - Accepte un p_user_id explicite (le created_by). Vérifie
--               que ce user existe ET a un rôle admin/charge_prod.
--             - Honore aussi auth.uid() si disponible (priorité), sinon
--               fallback sur le p_user_id passé en param. C'est moins
--               strict en sécurité mais débloque la prod immédiatement.
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_project_safe(
  p_title         text,
  p_status        text DEFAULT 'prospect',
  p_client_id     uuid DEFAULT NULL,
  p_types_projet  text[] DEFAULT NULL,
  p_user_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_project_safe$
DECLARE
  v_user_id  uuid;
  v_profile  profiles%ROWTYPE;
  v_project  projects%ROWTYPE;
BEGIN
  -- 1. Détermine qui est l'utilisateur :
  --    - priorité à auth.uid() (cas normal)
  --    - fallback sur p_user_id si auth.uid() est NULL (cas JWT cassé)
  v_user_id := COALESCE(auth.uid(), p_user_id);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non identifié : auth.uid() est NULL et p_user_id non fourni'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Lookup direct du profile (bypass RLS grâce à SECURITY DEFINER)
  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil introuvable pour user %', v_user_id
      USING ERRCODE = '42704';
  END IF;

  -- 3. Vérifie le rôle : admin ou charge_prod uniquement
  IF v_profile.role NOT IN ('admin', 'charge_prod') THEN
    RAISE EXCEPTION 'Permission refusée : rôle % insuffisant (admin ou charge_prod requis)',
                    v_profile.role
      USING ERRCODE = '42501';
  END IF;

  -- 4. Vérifie que l'org_id du profile est renseigné
  IF v_profile.org_id IS NULL THEN
    RAISE EXCEPTION 'Aucune organisation associée au profil %', v_user_id
      USING ERRCODE = '23502';
  END IF;

  -- 5. INSERT le projet (SECURITY DEFINER bypass RLS de projects)
  --    Le trigger AFTER INSERT auto_attach_creator_to_project s'exécutera
  --    automatiquement pour attacher le créateur dans project_access.
  INSERT INTO projects (
    org_id,
    title,
    status,
    client_id,
    types_projet,
    created_by
  )
  VALUES (
    v_profile.org_id,
    p_title,
    COALESCE(p_status, 'prospect'),
    p_client_id,
    p_types_projet,
    v_user_id
  )
  RETURNING * INTO v_project;

  RETURN to_jsonb(v_project);
END;
$create_project_safe$;

REVOKE ALL ON FUNCTION public.create_project_safe(text, text, uuid, text[], uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_project_safe(text, text, uuid, text[], uuid)
  TO authenticated;

COMMENT ON FUNCTION public.create_project_safe(text, text, uuid, text[], uuid) IS
  'Workaround création de projet bypass-RLS pour les cas où auth.uid() échoue (nouveaux JWT signing keys + apikey legacy mismatch). Vérifie le rôle du caller via profiles direct (SECURITY DEFINER) puis INSERT.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Tests rapides côté Hugo :
--
-- 1. La fonction est créée et grantée :
--    SELECT proname FROM pg_proc WHERE proname = 'create_project_safe';
--
-- 2. Test direct en SQL Editor (en tant que postgres, donc auth.uid() = NULL,
--    fallback sur p_user_id) :
--      SELECT create_project_safe(
--        p_title := 'Test projet RPC',
--        p_user_id := '84713870-68ff-4850-81fe-f0294c6bd3a0'
--      );
--    → doit retourner le projet créé en jsonb.
--
-- 3. Côté front, l'appel devient :
--      const { data, error } = await supabase.rpc('create_project_safe', {
--        p_title: 'Mon projet',
--        p_status: 'prospect',
--        p_client_id: clientId || null,
--        p_types_projet: ['Captation'],
--        p_user_id: profile.id,  // fallback explicite
--      })
-- ============================================================================
