-- ==========================================================================
-- Chantier 4C.2 — RPC mark_invitation_accepted()
-- --------------------------------------------------------------------------
-- Le UPDATE côté client depuis AcceptInvite.jsx n'arrive pas à passer la
-- RLS (la comparaison auth.jwt() ->> 'email' ne match pas toujours selon
-- le format du JWT ou le timing après updateUser).
--
-- On expose une fonction SECURITY DEFINER qui :
--   - lit l'email de l'appelant depuis auth.jwt()
--   - marque TOUTES ses invitations pending comme acceptées
-- Côté client on appelle simplement supabase.rpc('mark_invitation_accepted')
-- ==========================================================================

CREATE OR REPLACE FUNCTION mark_invitation_accepted()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text;
  updated      int;
BEGIN
  -- Récupère l'email de l'utilisateur courant (depuis la table auth.users
  -- plutôt que auth.jwt() qui peut être vide selon le contexte).
  SELECT lower(email) INTO caller_email
  FROM auth.users
  WHERE id = auth.uid();

  IF caller_email IS NULL THEN
    RAISE EXCEPTION 'Aucun utilisateur authentifié';
  END IF;

  UPDATE invitations_log
  SET    accepted_at = now()
  WHERE  lower(email) = caller_email
    AND  accepted_at IS NULL;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

-- Permet à tout utilisateur authentifié d'appeler la fonction
GRANT EXECUTE ON FUNCTION mark_invitation_accepted() TO authenticated;

COMMENT ON FUNCTION mark_invitation_accepted() IS
  'Chantier 4C.2 : marque les invitations_log de l''appelant comme acceptées. Appelée depuis AcceptInvite après définition du mot de passe.';
