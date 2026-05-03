-- ============================================================================
-- Migration : PROJECT-SHARE PASSWORD FIX — search_path pour pgcrypto
-- Date      : 2026-05-04
-- Contexte  : Supabase installe pgcrypto dans le schéma `extensions`, pas
--             `public`. La précédente migration faisait
--             `SET search_path = public` ce qui empêche `gen_salt('bf')` et
--             `crypt(...)` d'être résolues.
--
--             Erreur observée :
--               42883 · function gen_salt(unknown) does not exist
--
-- Action    : recréer les 2 fonctions concernées (set_project_share_password
--             et _project_share_token_resolve) avec
--             `SET search_path = public, extensions`. C'est le pattern
--             officiel Supabase pour utiliser pgcrypto depuis du SECURITY
--             DEFINER (cf. docs Supabase auth/secrets).
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

-- ─── set_project_share_password ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_project_share_password(
  p_token_id uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $set_project_share_password$
DECLARE
  v_can boolean;
BEGIN
  PERFORM 1
    FROM project_share_tokens t
   WHERE t.id = p_token_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token not found' USING ERRCODE = '42704';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM project_share_tokens t
     WHERE t.id = p_token_id
       AND (
         is_admin()
         OR t.created_by = auth.uid()
         OR is_project_member(t.project_id)
       )
  ) INTO v_can;

  IF NOT v_can THEN
    RAISE EXCEPTION 'permission denied to modify this token'
      USING ERRCODE = '42501';
  END IF;

  UPDATE project_share_tokens
     SET password_hash = CASE
           WHEN p_password IS NULL OR length(trim(p_password)) = 0 THEN NULL
           ELSE crypt(p_password, gen_salt('bf'))
         END
   WHERE id = p_token_id;
END;
$set_project_share_password$;


-- ─── _project_share_token_resolve ──────────────────────────────────────────
-- Le check de mdp utilise crypt() — même contrainte.
CREATE OR REPLACE FUNCTION _project_share_token_resolve(
  p_token text,
  p_page text DEFAULT NULL,
  p_password text DEFAULT NULL
)
RETURNS TABLE(project_id uuid, page_config jsonb, enabled_pages jsonb, label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $_project_share_token_resolve$
DECLARE
  v_password_hash text;
  v_password_hint text;
  v_found         boolean := false;
BEGIN
  SELECT t.password_hash, t.password_hint, true
    INTO v_password_hash, v_password_hint, v_found
    FROM project_share_tokens t
   WHERE t.token = p_token
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND (p_page IS NULL OR t.enabled_pages ? p_page);

  IF NOT v_found THEN
    RAISE EXCEPTION 'invalid or expired token (or page not enabled)'
      USING ERRCODE = '28000';
  END IF;

  IF v_password_hash IS NOT NULL THEN
    IF p_password IS NULL OR length(p_password) = 0 THEN
      RAISE EXCEPTION 'password required'
        USING ERRCODE = '28P01',
              HINT    = COALESCE(v_password_hint, '');
    END IF;
    IF crypt(p_password, v_password_hash) <> v_password_hash THEN
      RAISE EXCEPTION 'invalid password'
        USING ERRCODE = '28P01',
              HINT    = COALESCE(v_password_hint, '');
    END IF;
  END IF;

  RETURN QUERY
    SELECT t.project_id,
           CASE
             WHEN p_page IS NULL THEN '{}'::jsonb
             ELSE COALESCE(t.page_configs->p_page, '{}'::jsonb)
           END,
           t.enabled_pages,
           t.label
      FROM project_share_tokens t
     WHERE t.token = p_token;
END;
$_project_share_token_resolve$;

NOTIFY pgrst, 'reload schema';

COMMIT;
