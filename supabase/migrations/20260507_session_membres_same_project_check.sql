-- ============================================================================
-- Migration : ÉQUIPE SESSIONS — Garde cross-project sur projet_session_membres
-- Date      : 2026-05-07
-- Contexte  : Suite à l'audit code-review (finding #15), on ajoute un trigger
--             qui empêche d'INSERT/UPDATE une participation où le membre et
--             la session appartiennent à des projets DIFFÉRENTS.
--
--             Risque : un user qui a `can_edit_outil` sur les projets A et B
--             pouvait UPDATE une participation pour faire pointer son
--             session_id vers une session du projet B alors que le
--             membre_id appartient au projet A. Ça créerait une row
--             aberrante (participation cross-project) que la RLS standard
--             ne capte pas (chaque side passe individuellement).
--
-- Pas exploitable via l'UI Captiv aujourd'hui (le front n'expose aucun
-- chemin pour modifier session_id ou membre_id directement). Mais une
-- requête API directe le permet. Garde-fou DB obligatoire pour la
-- défense en profondeur.
--
-- Idempotente : DROP TRIGGER IF EXISTS / CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

-- ── Fonction de check : membre.project_id == session.project_id ─────────────
-- NEW.project_id est déjà set par le trigger précédent
-- (`projet_session_membres_set_project_id` de la migration audit_fixes),
-- qui le copie depuis la session. On compare ici avec le project_id du
-- membre. Si différent, on raise une exception parlante.
CREATE OR REPLACE FUNCTION projet_session_membres_check_same_project()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  member_project_id UUID;
BEGIN
  SELECT pm.project_id INTO member_project_id
  FROM projet_membres pm
  WHERE pm.id = NEW.membre_id;

  IF member_project_id IS NULL THEN
    RAISE EXCEPTION 'projet_session_membres : membre_id introuvable (%)', NEW.membre_id;
  END IF;

  IF NEW.project_id IS DISTINCT FROM member_project_id THEN
    RAISE EXCEPTION 'projet_session_membres : cross-project denied. Le membre appartient au projet % mais la session appartient au projet %.',
      member_project_id, NEW.project_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Triggers BEFORE INSERT et BEFORE UPDATE ────────────────────────────────
-- Le trigger BEFORE INSERT s'exécute APRÈS celui qui set le project_id
-- (ordre alphabétique des noms : `set_project_id_ins` < `same_project_ins`).
-- Donc NEW.project_id est déjà dérivé de la session quand on arrive ici.
DROP TRIGGER IF EXISTS trg_projet_session_membres_same_project_ins ON projet_session_membres;
CREATE TRIGGER trg_projet_session_membres_same_project_ins
  BEFORE INSERT ON projet_session_membres
  FOR EACH ROW EXECUTE FUNCTION projet_session_membres_check_same_project();

DROP TRIGGER IF EXISTS trg_projet_session_membres_same_project_upd ON projet_session_membres;
CREATE TRIGGER trg_projet_session_membres_same_project_upd
  BEFORE UPDATE OF session_id, membre_id ON projet_session_membres
  FOR EACH ROW EXECUTE FUNCTION projet_session_membres_check_same_project();


-- ── Vérification d'intégrité existante ─────────────────────────────────────
-- Avant d'activer le trigger, on s'assure qu'il n'y a AUCUNE row
-- existante en violation. Si oui, on raise (l'admin devra investiguer).
DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM projet_session_membres psm
  JOIN projet_membres pm ON pm.id = psm.membre_id
  WHERE psm.project_id <> pm.project_id;

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Migration refusée : % rows projet_session_membres ont déjà un cross-project (membre.project_id <> psm.project_id). Investiguez avant d''activer ce trigger.', bad_count;
  END IF;

  RAISE NOTICE 'Vérification OK : aucune participation en cross-project. Garde activée.';
END
$$;


-- ── Reload PostgREST ──────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Tests post-migration (à lancer pour valider que le trigger marche)
-- ============================================================================
--
-- 1. Tentative d'insertion cross-project (doit échouer) :
--
--    -- Récupère 2 project_id différents avec leurs membres et sessions :
--    -- INSERT INTO projet_session_membres (session_id, membre_id, project_id)
--    -- VALUES (<session-projet-A>, <membre-projet-B>, ...)
--    -- → Doit raise: "cross-project denied"
--
-- 2. Tentative d'UPDATE qui change session_id vers un autre projet :
--
--    -- UPDATE projet_session_membres SET session_id = <session-projet-B>
--    -- WHERE id = <psm-existant-projet-A>;
--    -- → Doit raise: "cross-project denied"
--
-- 3. INSERT/UPDATE same-project (doit passer normalement) :
--
--    -- Toute opération où membre et session appartiennent au même projet
--    -- continue de fonctionner sans trigger error.
-- ============================================================================
