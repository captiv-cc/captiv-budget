-- ============================================================================
-- Migration : FIX — ordre triggers projet_session_membres (cross-project denied)
-- Date      : 2026-05-08
-- Contexte  : Bug remonté par Hugo : ajout d'un membre dans une session via
--             la modal Présence → erreur "cross-project denied. Le membre
--             appartient au projet X mais la session appartient au projet
--             <NULL>".
--
-- Cause : ordre alphabétique des triggers BEFORE INSERT dans Postgres :
--   - trg_projet_session_membres_same_project_ins   (s**a**me)
--   - trg_projet_session_membres_set_project_id_ins (s**e**t)
--
-- 'a' < 'e' donc same_project tourne AVANT set_project_id. Le check
-- cross-project voit NEW.project_id encore NULL (set_project_id pas
-- encore exécuté), d'où l'erreur "projet <NULL>".
--
-- Le commentaire de la migration 20260507_session_membres_same_project_check
-- affirmait l'inverse — il était faux.
--
-- Fix : on renomme set_project_id_ins en aa_set_project_id_ins pour le
-- forcer à passer en premier (préfixe 'aa' < 'sa'). Pareil pour UPDATE.
--
-- Idempotente : DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- ============================================================================

BEGIN;

-- ── Drop des anciens triggers (peu importe leur état) ───────────────────────
DROP TRIGGER IF EXISTS trg_projet_session_membres_set_project_id_ins
  ON projet_session_membres;
DROP TRIGGER IF EXISTS trg_projet_session_membres_set_project_id_upd
  ON projet_session_membres;

-- ── Re-crée avec un préfixe 'aa_' pour passer en premier alphabétiquement ──
CREATE TRIGGER aa_projet_session_membres_set_project_id_ins
  BEFORE INSERT ON projet_session_membres
  FOR EACH ROW EXECUTE FUNCTION projet_session_membres_set_project_id();

CREATE TRIGGER aa_projet_session_membres_set_project_id_upd
  BEFORE UPDATE OF session_id ON projet_session_membres
  FOR EACH ROW EXECUTE FUNCTION projet_session_membres_set_project_id();

-- ── Vérification finale : l'ordre est bon ───────────────────────────────────
-- pg_trigger.tgname trié alphabétiquement doit donner :
--   1. aa_projet_session_membres_set_project_id_ins (set d'abord)
--   2. trg_projet_session_membres_same_project_ins  (check ensuite)
DO $$
DECLARE
  v_first_name text;
BEGIN
  SELECT t.tgname INTO v_first_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'projet_session_membres'
     AND NOT t.tgisinternal
     AND t.tgenabled <> 'D'
     AND t.tgname LIKE '%project%_ins'
   ORDER BY t.tgname
   LIMIT 1;

  IF v_first_name LIKE 'aa_%' THEN
    RAISE NOTICE 'Ordre triggers OK : set_project_id passe en premier (% < same_project).', v_first_name;
  ELSE
    RAISE EXCEPTION 'Ordre triggers cassé : premier trigger = %, attendu aa_%%', v_first_name;
  END IF;
END
$$;

COMMIT;

-- ============================================================================
-- Test post-migration :
-- 1. Ajouter une participation via UI / SQL direct :
--    INSERT INTO projet_session_membres (session_id, membre_id)
--    VALUES ('<session-id>', '<membre-id-meme-projet>');
--    → doit passer (avant : erreur cross-project denied)
--
-- 2. Vérifier que le cross-project check fonctionne toujours :
--    INSERT INTO projet_session_membres (session_id, membre_id)
--    VALUES ('<session-projet-A>', '<membre-projet-B>');
--    → doit raise "cross-project denied" (les 2 IDs valides mais différents)
-- ============================================================================
