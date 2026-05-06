-- ============================================================================
-- Migration : DÉROULÉ V1 — 24h par défaut sur les bornes timeline
-- Date      : 2026-05-08
-- Contexte  : Hugo a constaté qu'un test à 23h48 ne montrait pas la now line :
--             la borne `heure_fin` par défaut était '23:00', donc les heures
--             > 23:00 n'étaient pas affichées. Décision : passer la fenêtre
--             par défaut à 00:00 → 23:59 pour couvrir 24h complètes.
--
--             Le débordement nuit (live qui finit à 02:00 J+1) reste un V0.5
--             à part — il nécessite un changement de schéma TIME → INTEGER
--             minutes pour permettre des heures > 23:59. Documenté dans
--             CHANTIER_DEROULE.md.
--
-- Effet :
--   1. ALTER COLUMN heure_debut SET DEFAULT '00:00:00'
--   2. ALTER COLUMN heure_fin   SET DEFAULT '23:59:00'
--   3. UPDATE rows existants qui ont les anciens defaults (06:00 / 23:00)
--      pour passer à 00:00 / 23:59. On ne touche PAS les rows où l'admin a
--      explicitement personnalisé les bornes (détecté par valeur ≠ defaut).
--
-- Idempotent : Oui (ALTER ... SET DEFAULT, UPDATE conditionnel).
-- Réversible : ALTER ... SET DEFAULT '06:00:00' / '23:00:00'.
-- ============================================================================

BEGIN;

-- 1. Nouveaux defaults
ALTER TABLE projet_deroules
  ALTER COLUMN heure_debut SET DEFAULT '00:00:00';

ALTER TABLE projet_deroules
  ALTER COLUMN heure_fin SET DEFAULT '23:59:00';

-- 2. Backfill des rows existants qui avaient les anciens defaults
--    (uniquement si l'admin n'a pas customisé : on cible exactement
--    06:00 / 23:00 qui étaient les anciennes valeurs par défaut).
UPDATE projet_deroules
   SET heure_debut = '00:00:00',
       heure_fin   = '23:59:00'
 WHERE heure_debut = '06:00:00'
   AND heure_fin   = '23:00:00';

NOTIFY pgrst, 'reload schema';

COMMIT;
