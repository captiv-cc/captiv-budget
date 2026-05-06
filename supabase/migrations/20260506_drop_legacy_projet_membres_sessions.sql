-- ============================================================================
-- Migration : ÉQUIPE SESSIONS — Drop table legacy projet_membres_sessions
-- Date      : 2026-05-06
-- Contexte  : La Phase A a transféré 1:1 toutes les rows
--             projet_membres_sessions vers projet_sessions +
--             projet_session_membres (cf. 20260505_equipe_sessions_phase_a.sql).
--             Le front ne lit plus la table legacy depuis le commit
--             "EQUIPE Sessions Phase A/2 — bascule data layer".
--
-- Garde-fou : avant le DROP, on vérifie que TOUTES les rows source ont
-- bien une participation legacy_session_id qui pointe dessus. Si la
-- vérif échoue, on RAISE (pas de DROP silencieux).
--
-- Rollback : la table peut être recréée depuis le code de
-- 20260505_equipe_sessions.sql, mais les données seront perdues. La
-- prudence appelle à valider en staging avant de pousser ici.
-- ============================================================================

BEGIN;

-- ── 1. Vérification d'intégrité de la migration Phase A ────────────────────
-- Toutes les rows legacy doivent avoir été migrées (= au moins une
-- participation avec leur legacy_session_id). Si une row source n'a pas
-- été migrée, on refuse le DROP (l'admin devra rejouer la Phase A
-- migration ou investiguer manuellement).
DO $$
DECLARE
  unmigrated_count INTEGER;
BEGIN
  -- IF NOT EXISTS pour rester idempotente (si la table a déjà été drop,
  -- on ne fait rien — idempotence garantit le rejeu).
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE tablename = 'projet_membres_sessions'
  ) THEN
    RAISE NOTICE 'projet_membres_sessions déjà absente — migration déjà passée.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO unmigrated_count
  FROM projet_membres_sessions s
  WHERE NOT EXISTS (
    SELECT 1 FROM projet_session_membres psm
    WHERE psm.legacy_session_id = s.id
  );

  IF unmigrated_count > 0 THEN
    RAISE EXCEPTION 'DROP refusé : % rows projet_membres_sessions n''ont pas été migrées vers projet_session_membres. Rejouez 20260505_equipe_sessions_phase_a.sql ou investiguez avant de DROP.', unmigrated_count;
  END IF;

  RAISE NOTICE 'Vérification OK : toutes les rows legacy ont été migrées. DROP autorisé.';
END
$$;


-- ── 2. DROP de la table legacy ─────────────────────────────────────────────
-- DROP CASCADE pour aussi virer les policies RLS, triggers, indexes
-- attachés à cette table. PostgreSQL refusera les FK pointant vers la
-- table — il n'y en a pas (la migration Phase A a stocké
-- legacy_session_id sans FK pour cette raison).
DROP TABLE IF EXISTS projet_membres_sessions CASCADE;


-- ── 3. La colonne legacy_session_id reste pour traçabilité ─────────────────
-- On NE drop PAS `projet_session_membres.legacy_session_id`. Elle sert
-- d'archive (en cas de question type "d'où vient cette participation",
-- ou pour un éventuel rollback partiel). Coût : ~16 octets par row,
-- négligeable. Sera nettoyée à un cleanup ultérieur si besoin.


-- ── 4. Reload PostgREST ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifications post-drop
-- ============================================================================
--
-- 1. La table est bien partie :
--    SELECT 1 FROM pg_tables WHERE tablename = 'projet_membres_sessions';
--    -- Doit retourner 0 row.
--
-- 2. Les sessions sont toujours là :
--    SELECT COUNT(*) FROM projet_sessions;
--    SELECT COUNT(*) FROM projet_session_membres;
--    -- Doivent être inchangés.
--
-- 3. legacy_session_id encore renseigné pour traçabilité :
--    SELECT COUNT(*) FILTER (WHERE legacy_session_id IS NOT NULL),
--           COUNT(*) FILTER (WHERE legacy_session_id IS NULL)
--    FROM projet_session_membres;
--    -- Le 1er nombre = rows migrées, le 2nd = rows créées post-Phase A.
-- ============================================================================
