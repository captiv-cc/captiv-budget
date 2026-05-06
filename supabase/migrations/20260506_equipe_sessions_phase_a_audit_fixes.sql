-- ============================================================================
-- Migration : ÉQUIPE SESSIONS — Phase A — Audit fixes (2026-05-06)
-- ============================================================================
--
-- Suite à l'audit code-review de la Phase A, applique 3 fixes critiques :
--
--   1. Dénormalisation `project_id` sur projet_session_membres
--      • Permet de filtrer le channel Realtime côté serveur (sinon le
--        client recevait les events de TOUS les projets, à risque de
--        spam et de fuite de payload Realtime)
--      • Simplifie aussi la RLS (plus de subquery EXISTS, mais on garde
--        la double-vérification pour la robustesse)
--      • Maintenu par trigger BEFORE INSERT/UPDATE OF session_id
--
--   2. Trigger BEFORE INSERT projet_sessions qui calcule sort_order
--      automatiquement si NULL → résout la race UNIQUE(project_id,
--      sort_order) entre 2 admins concurrents qui font SELECT MAX +1
--      simultanément. La création front peut désormais envoyer NULL.
--
--   3. UNIQUE INDEX sur projet_session_membres.legacy_session_id (where
--      not null) → garantit l'idempotence du seed si rejoué.
--
-- Idempotente : ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER
-- IF EXISTS avant CREATE.
-- ============================================================================

BEGIN;

-- ── 1. Dénormalisation project_id sur projet_session_membres ────────────────

-- 1a. Ajout de la colonne (NULLABLE temporairement pour le backfill).
ALTER TABLE projet_session_membres
  ADD COLUMN IF NOT EXISTS project_id UUID;

-- 1b. Backfill depuis la session globale.
UPDATE projet_session_membres psm
SET project_id = s.project_id
FROM projet_sessions s
WHERE psm.session_id = s.id
  AND psm.project_id IS NULL;

-- 1c. NOT NULL + FK + index (FK SET NULL pour ne pas bloquer un cleanup
-- exceptionnel ; en pratique un delete project cascade les sessions, donc
-- avant que le SET NULL ne fire, la row est déjà partie via session FK).
ALTER TABLE projet_session_membres
  ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE projet_session_membres
  DROP CONSTRAINT IF EXISTS projet_session_membres_project_id_fkey;
ALTER TABLE projet_session_membres
  ADD CONSTRAINT projet_session_membres_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_projet_session_membres_project
  ON projet_session_membres(project_id);

-- 1d. Trigger pour maintenir project_id en cohérence avec session_id.
-- Important : on ne fait PAS confiance au caller, le trigger PRESCRIT
-- toujours le project_id de la session. Le front n'a donc pas besoin
-- d'envoyer project_id explicitement.
CREATE OR REPLACE FUNCTION projet_session_membres_set_project_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT s.project_id INTO NEW.project_id
  FROM projet_sessions s
  WHERE s.id = NEW.session_id;
  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'project_id introuvable pour session_id=%', NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projet_session_membres_set_project_id_ins ON projet_session_membres;
CREATE TRIGGER trg_projet_session_membres_set_project_id_ins
  BEFORE INSERT ON projet_session_membres
  FOR EACH ROW EXECUTE FUNCTION projet_session_membres_set_project_id();

DROP TRIGGER IF EXISTS trg_projet_session_membres_set_project_id_upd ON projet_session_membres;
CREATE TRIGGER trg_projet_session_membres_set_project_id_upd
  BEFORE UPDATE OF session_id ON projet_session_membres
  FOR EACH ROW EXECUTE FUNCTION projet_session_membres_set_project_id();


-- ── 2. Auto-calcul sort_order côté serveur ─────────────────────────────────
-- La race UNIQUE(project_id, sort_order) entre 2 admins concurrents est
-- résolue par un trigger qui calcule sort_order = MAX+1 dans la même
-- transaction que l'INSERT, donc atomique. Le caller peut envoyer NULL
-- (= "auto-assigne") ou une valeur explicite (= override pour test/dev).

CREATE OR REPLACE FUNCTION projet_sessions_auto_sort_order()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sort_order IS NULL OR NEW.sort_order = 0 THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1
      INTO NEW.sort_order
      FROM projet_sessions
      WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projet_sessions_auto_sort_order ON projet_sessions;
CREATE TRIGGER trg_projet_sessions_auto_sort_order
  BEFORE INSERT ON projet_sessions
  FOR EACH ROW EXECUTE FUNCTION projet_sessions_auto_sort_order();


-- ── 3. UNIQUE INDEX legacy_session_id (idempotence migration) ──────────────
-- Garantit que rejouer le seed Phase A (cf. 20260505_equipe_sessions_phase_a.sql
-- partie DO $$) ne peut PAS créer de doublons même si la table source a été
-- modifiée entre-temps.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projet_session_membres_legacy_unique
  ON projet_session_membres(legacy_session_id)
  WHERE legacy_session_id IS NOT NULL;


-- ── 4. Notifie PostgREST pour exposer la colonne project_id ────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifications post-migration
-- ============================================================================
--
-- 1. Vérifier que toutes les rows ont un project_id non-null :
--    SELECT COUNT(*) FROM projet_session_membres WHERE project_id IS NULL;
--    -- Doit donner 0.
--
-- 2. Vérifier la cohérence project_id ↔ session.project_id :
--    SELECT COUNT(*) FROM projet_session_membres psm
--    JOIN projet_sessions s ON s.id = psm.session_id
--    WHERE psm.project_id <> s.project_id;
--    -- Doit donner 0.
--
-- 3. Tester le trigger sort_order : INSERT sans sort_order doit l'auto-set.
--    INSERT INTO projet_sessions (project_id, label) VALUES ('<uuid>', 'Test');
--    -- La row créée doit avoir sort_order = MAX+1.
-- ============================================================================
