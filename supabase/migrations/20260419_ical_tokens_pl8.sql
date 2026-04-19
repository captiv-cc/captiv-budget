-- ============================================================================
-- Migration : Planning PL-8 v1 — Tokens d'export iCal
-- Date      : 2026-04-19
-- Contexte  : Permet aux utilisateurs de générer des URLs d'abonnement iCal
--             (lecture seule) consommables par Google Calendar, Apple Calendar,
--             Outlook, etc. Chaque ligne = un lien actif (ou révoqué).
--
--             Deux scopes possibles (XOR strict) :
--               (a) 'project' : project_id set, user_id NULL
--                   → exporte TOUS les events du projet (filtrés par dates).
--               (b) 'my'      : user_id set, project_id NULL
--                   → exporte tous les events où le user est assigné
--                     (event_members.profile_id), cross-projets.
--
--             Le token lui-même est un secret opaque (~32 chars base64url)
--             généré côté client. La résolution token → events se fait via
--             une edge function Supabase (ical-feed) en service_role, donc
--             bypass RLS — le token fait office d'authentification.
--
--             Révocation : on setse `revoked_at`. La ligne est conservée pour
--             l'historique (qui a créé quoi, quand, dernier accès). Une
--             nouvelle URL = un nouveau token = une nouvelle ligne.
-- ============================================================================

BEGIN;

-- ── 1. ical_tokens ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ical_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Token secret (opaque, ~32 chars base64url). Généré côté client via
  -- crypto.getRandomValues pour éviter que le serveur voie un secret en
  -- clair avant hashing éventuel. Pour la v1 on stocke en clair (OK si la
  -- base est elle-même chiffrée au repos) ; on pourra passer sur un hash
  -- (bcrypt / argon2id) en v2 sans casser l'API.
  token            TEXT NOT NULL UNIQUE,

  -- Toujours l'org_id pour que les RLS puissent filtrer simplement.
  org_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  -- Scope XOR : exactement un des deux doit être non-NULL.
  project_id       UUID REFERENCES projects(id)  ON DELETE CASCADE,
  user_id          UUID REFERENCES profiles(id)  ON DELETE CASCADE,

  -- Libellé affiché à l'utilisateur ("Équipe tournage", "Client externe"…).
  -- Optionnel : on peut afficher un fallback type "Lien iCal #abc123" si vide.
  label            TEXT,

  created_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Révocation soft : si non NULL, l'edge function renvoie 404. On garde la
  -- ligne pour pouvoir lister l'historique côté UI (Audit : qui / quand /
  -- dernier accès) et détecter d'éventuels abus.
  revoked_at       TIMESTAMPTZ,

  -- Mis à jour par l'edge function (service_role) à chaque hit. Utile pour
  -- montrer "consulté il y a 3h" côté UI et pour éventuellement purger les
  -- tokens dormants.
  last_accessed_at TIMESTAMPTZ,

  CONSTRAINT ical_tokens_scope_xor CHECK (
    (project_id IS NOT NULL AND user_id IS NULL)
    OR
    (project_id IS NULL AND user_id IS NOT NULL)
  )
);

-- Index : recherche par token (hot path de l'edge function).
CREATE UNIQUE INDEX IF NOT EXISTS ical_tokens_token_idx      ON ical_tokens(token);
CREATE INDEX        IF NOT EXISTS ical_tokens_org_id_idx     ON ical_tokens(org_id);
CREATE INDEX        IF NOT EXISTS ical_tokens_project_id_idx ON ical_tokens(project_id);
CREATE INDEX        IF NOT EXISTS ical_tokens_user_id_idx    ON ical_tokens(user_id);

ALTER TABLE ical_tokens ENABLE ROW LEVEL SECURITY;

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
-- Lecture :
--   - Tokens 'my'      : seul le propriétaire (user_id = auth.uid()) les voit.
--   - Tokens 'project' : tout membre de l'org du projet peut les lister
--                        (besoin de voir les liens actifs dans la modale
--                        "Exports iCal" du projet, révoquer ceux d'un
--                        collègue parti, etc.).
DROP POLICY IF EXISTS "ical_tokens_read" ON ical_tokens;
CREATE POLICY "ical_tokens_read" ON ical_tokens FOR SELECT
  USING (
    org_id = get_user_org_id()
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- Écriture (INSERT/UPDATE/DELETE) :
--   - Tokens 'my'      : seul le propriétaire.
--   - Tokens 'project' : tout membre de l'org peut créer et révoquer.
--     (On pourra tighten à admin/charge_prod plus tard si besoin — alignement
--      avec invite-user ; en v1 on fait confiance à l'org.)
-- NB : pour l'edge function, l'écriture de `last_accessed_at` passe par
-- service_role qui bypass les RLS de toute façon.
DROP POLICY IF EXISTS "ical_tokens_write" ON ical_tokens;
CREATE POLICY "ical_tokens_write" ON ical_tokens FOR ALL
  USING (
    org_id = get_user_org_id()
    AND (user_id IS NULL OR user_id = auth.uid())
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND (user_id IS NULL OR user_id = auth.uid())
  );


-- ── 3. Helper : révoquer un token ───────────────────────────────────────────
-- Sucre syntaxique côté client. Une simple UPDATE fonctionnerait aussi
-- (RLS-scoped), mais cette fonction rend l'intention explicite et garantit
-- l'idempotence (réappel sans effet).
CREATE OR REPLACE FUNCTION revoke_ical_token(p_token_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $revoke_ical_token$
BEGIN
  UPDATE ical_tokens
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE id = p_token_id;
END;
$revoke_ical_token$;


COMMIT;

-- ============================================================================
-- Fin de la migration PL-8 v1.
--
-- Prochaines étapes (non couvertes par cette migration) :
--   - Edge function `ical-feed` : résout ?token=xxx en events puis .ics.
--   - Helper `buildICS()` côté src/lib/ical.js (pur, testable).
--   - UI projet : modale "Exports iCal" dans PlanningTab.
--   - UI perso  : section "Mon planning" dans menu utilisateur.
--
-- PL-8 v2 (OAuth Google Calendar bidirectionnel) : pas avant validation v1
-- en usage réel. Quand on s'y mettra, on ajoutera une table
-- `google_calendar_connections` distincte (refresh_token chiffré, scopes,
-- last_sync_at) sans impacter `ical_tokens`.
-- ============================================================================
