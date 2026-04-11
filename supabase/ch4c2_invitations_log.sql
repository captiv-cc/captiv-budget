-- ==========================================================================
-- Chantier 4C.2 — Table invitations_log
-- --------------------------------------------------------------------------
-- Trace toutes les invitations envoyées à des contacts crew :
--   - qui a envoyé l'invite (invited_by → profiles.id)
--   - à qui (contact_id → contacts.id, email dénormalisé au cas où)
--   - quand (invited_at)
--   - comment (mode : 'email' ou 'link')
--   - quand le contact a accepté (accepted_at, NULL si encore en attente)
--   - dernier renvoi d'invitation (last_resent_at)
--
-- Utilisé par :
--   1. L'Edge Function invite-user pour loguer chaque envoi
--   2. La page AcceptInvite pour marquer accepted_at = now() après
--      définition du mot de passe
--   3. L'UI Contacts pour afficher le statut "En attente depuis X jours"
--      et le bouton "Renvoyer l'invitation"
-- ==========================================================================

CREATE TABLE IF NOT EXISTS invitations_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE CASCADE,
  email           text NOT NULL,
  full_name       text,
  role            text,                    -- rôle assigné (prestataire / coordinateur / …)
  mode            text NOT NULL CHECK (mode IN ('email', 'link')),
  invited_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invited_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  last_resent_at  timestamptz,
  resend_count    int NOT NULL DEFAULT 0,
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_invitations_log_org       ON invitations_log(org_id);
CREATE INDEX IF NOT EXISTS idx_invitations_log_contact   ON invitations_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_invitations_log_email     ON invitations_log(lower(email));
CREATE INDEX IF NOT EXISTS idx_invitations_log_pending   ON invitations_log(org_id, accepted_at)
  WHERE accepted_at IS NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE invitations_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invitations_log_read"   ON invitations_log;
DROP POLICY IF EXISTS "invitations_log_write"  ON invitations_log;
DROP POLICY IF EXISTS "invitations_log_update" ON invitations_log;

-- Lecture : admin + charge_prod de l'org
CREATE POLICY "invitations_log_read" ON invitations_log
  FOR SELECT
  USING (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod')
  );

-- Insertion : admin + charge_prod de l'org (l'Edge Function bypass RLS via
-- service role mais on garde cette policy pour un usage côté client)
CREATE POLICY "invitations_log_write" ON invitations_log
  FOR INSERT
  WITH CHECK (
    org_id = get_user_org_id()
    AND current_user_role() IN ('admin', 'charge_prod')
  );

-- Update : admin + charge_prod de l'org + l'utilisateur lui-même (pour
-- pouvoir marquer accepted_at depuis AcceptInvite avec sa propre session)
CREATE POLICY "invitations_log_update" ON invitations_log
  FOR UPDATE
  USING (
    org_id = get_user_org_id()
    AND (
      current_user_role() IN ('admin', 'charge_prod')
      OR lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
    )
  );

COMMENT ON TABLE invitations_log IS
  'Chantier 4C.2 : trace des invitations envoyées aux contacts crew (pending/accepted).';
