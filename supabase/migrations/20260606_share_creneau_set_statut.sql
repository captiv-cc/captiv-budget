-- ============================================================================
-- Migration : DÉROULÉ FESTIVAL Sprint B-1 — RPC publique set_creneau_statut
-- Date      : 2026-06-06
-- Contexte  : Sprint B (Vue mobile cadreur).
--             Permettre à un cadreur de marquer un créneau "fait" / "en_cours"
--             / "annule" depuis sa vue partagée (/share/deroule/:token),
--             SANS être authentifié dans DESK.
--
-- Sécurité  : SECURITY DEFINER. Le token sert d'authentification :
--             - le créneau ciblé DOIT appartenir au projet du token
--             - le statut DOIT être dans l'enum existant
--             Le trigger updated_at sur projet_deroule_creneaux est conservé.
--
-- API publique :
--   share_deroule_set_creneau_statut(p_token, p_creneau_id, p_statut)
--   → jsonb { id, statut }
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION share_deroule_set_creneau_statut(
  p_token      text,
  p_creneau_id uuid,
  p_statut     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_deroule_set_creneau_statut$
DECLARE
  v_project_id         uuid;
  v_creneau_project_id uuid;
BEGIN
  -- 1. Valider le token (existant + non révoqué + non expiré).
  --    Lève une exception si invalide.
  SELECT project_id INTO v_project_id
    FROM _deroule_share_resolve(p_token);

  -- 2. Valider la valeur de statut côté serveur (defense in depth — le CHECK
  --    sur la table lèverait aussi, mais on veut une erreur claire).
  IF p_statut NOT IN ('planifie', 'en_cours', 'fait', 'annule') THEN
    RAISE EXCEPTION 'invalid statut: %', p_statut USING ERRCODE = '22023';
  END IF;

  -- 3. Vérifier que le créneau appartient bien au projet du token.
  SELECT d.project_id INTO v_creneau_project_id
    FROM projet_deroule_creneaux c
    JOIN projet_deroules d ON d.id = c.deroule_id
   WHERE c.id = p_creneau_id;

  IF v_creneau_project_id IS NULL THEN
    RAISE EXCEPTION 'creneau not found: %', p_creneau_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_creneau_project_id <> v_project_id THEN
    -- Cas malveillant : un token valide d'un autre projet essaie d'éditer
    -- un créneau qui ne lui appartient pas.
    RAISE EXCEPTION 'creneau does not belong to token project'
      USING ERRCODE = '28000';
  END IF;

  -- 4. UPDATE (trigger updated_at touche automatiquement updated_at).
  UPDATE projet_deroule_creneaux
     SET statut = p_statut
   WHERE id = p_creneau_id;

  -- 5. Stats du token (utilisé pour traçabilité accès).
  UPDATE deroule_share_tokens
     SET last_accessed_at = now()
   WHERE token = p_token;

  RETURN jsonb_build_object(
    'id',     p_creneau_id,
    'statut', p_statut
  );
END;
$share_deroule_set_creneau_statut$;

REVOKE ALL ON FUNCTION share_deroule_set_creneau_statut(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_deroule_set_creneau_statut(text, uuid, text)
  TO anon, authenticated;

COMMIT;
