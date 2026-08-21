-- ════════════════════════════════════════════════════════════════════════════
-- CONTENUS — statut « non shooté »
-- Date      : 2026-08-21
-- ════════════════════════════════════════════════════════════════════════════
--
-- Retour Hugo : il manque l'étape AVANT la validation — un contenu prévu au
-- programme mais pas encore capté. Elle ouvre le cycle :
--
--   non_shoote → en_attente → valide | a_revoir | refuse
--
-- Ce n'est pas une décision de la presse : le trigger ne pose donc pas
-- decide_at pour cet état, au même titre que « en attente ».
--
-- Le défaut reste 'en_attente' : on ajoute le plus souvent un contenu qui
-- existe déjà. « Non shooté » se pose à la main sur ce qui est planifié.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE projet_contenus
  DROP CONSTRAINT IF EXISTS projet_contenus_statut_check;

ALTER TABLE projet_contenus
  ADD CONSTRAINT projet_contenus_statut_check
  CHECK (statut IN ('non_shoote', 'en_attente', 'valide', 'a_revoir', 'refuse'));

-- decide_at n'est posé que par une vraie décision (validé / à revoir /
-- refusé). Les deux états d'attente le remettent à NULL.
CREATE OR REPLACE FUNCTION touch_projet_contenus()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    NEW.decide_at := CASE
      WHEN NEW.statut IN ('en_attente', 'non_shoote') THEN NULL
      ELSE now()
    END;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS
-- ============================================================================
-- 1. Passer un contenu en « non shooté » vide decide_at.
-- 2. Les contenus existants ne bougent pas (aucune valeur n'est réécrite).
-- ============================================================================
