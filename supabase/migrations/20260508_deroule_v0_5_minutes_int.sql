-- ============================================================================
-- Migration : DÉROULÉ V0.5 — Heures stockées en INTEGER minutes (débordement nuit)
-- Date      : 2026-05-08
-- Contexte  : Les types TIME PostgreSQL ne supportent que 00:00:00 - 23:59:59,
--             ce qui empêche les créneaux qui débordent sur le lendemain
--             (ex: live qui finit à 02:00 J+1). Hugo a remonté ce besoin
--             explicitement (live broadcast ZLAN 2026 finissant après minuit).
--
-- Solution : remplacer les TIME par INTEGER (minutes depuis 00:00 du jour J).
--            Range autorisée : 0-1680 (28h = 04:00 du J+1, limite max V0.5).
--
-- Effet :
--   1. ADD heure_debut_min, heure_fin_min INTEGER nullable sur les 2 tables
--   2. Backfill depuis TIME : conversion HH:MM → minutes
--   3. NOT NULL + DEFAULT
--   4. DROP heure_debut, heure_fin (TIME)
--   5. DROP CHECK contraintes anciennes, ADD nouvelles avec range 0-1680
--   6. UPDATE les triggers qui référençaient les anciennes colonnes
--
-- Idempotent : Oui (ADD COLUMN IF NOT EXISTS, conversion guard).
-- Réversible : Reconvertir INT → TIME via une migration inverse (mais perdrait
--              les rows avec heure > 23:59 si applicable).
-- ============================================================================

BEGIN;

-- ── 1. projet_deroules ──────────────────────────────────────────────────────

ALTER TABLE projet_deroules
  ADD COLUMN IF NOT EXISTS heure_debut_min INTEGER,
  ADD COLUMN IF NOT EXISTS heure_fin_min   INTEGER;

-- Backfill depuis les anciennes colonnes TIME. EXTRACT(EPOCH FROM ...) / 60
-- donne le nombre de minutes depuis 00:00 (le résultat EPOCH est en secondes).
UPDATE projet_deroules
   SET heure_debut_min = COALESCE(heure_debut_min,
         (EXTRACT(EPOCH FROM heure_debut) / 60)::INTEGER),
       heure_fin_min = COALESCE(heure_fin_min,
         (EXTRACT(EPOCH FROM heure_fin) / 60)::INTEGER)
 WHERE heure_debut_min IS NULL OR heure_fin_min IS NULL;

ALTER TABLE projet_deroules
  ALTER COLUMN heure_debut_min SET NOT NULL,
  ALTER COLUMN heure_debut_min SET DEFAULT 0,         -- 00:00
  ALTER COLUMN heure_fin_min   SET NOT NULL,
  ALTER COLUMN heure_fin_min   SET DEFAULT 1439;      -- 23:59

-- Drop l'ancien CHECK (qui dépend de heure_debut TIME)
ALTER TABLE projet_deroules
  DROP CONSTRAINT IF EXISTS projet_deroules_heures_check;

-- Drop les anciennes colonnes TIME
ALTER TABLE projet_deroules
  DROP COLUMN IF EXISTS heure_debut,
  DROP COLUMN IF EXISTS heure_fin;

-- Nouveau CHECK : range valide + cohérence début/fin
-- Limite max 1680 = 28h = 04:00 J+1 (V0.5 — débordement nuit limité)
ALTER TABLE projet_deroules
  ADD CONSTRAINT projet_deroules_heures_check CHECK (
    heure_debut_min >= 0
    AND heure_debut_min < 1440
    AND heure_fin_min  > heure_debut_min
    AND heure_fin_min  <= 1680
  );


-- ── 2. projet_deroule_creneaux ──────────────────────────────────────────────

ALTER TABLE projet_deroule_creneaux
  ADD COLUMN IF NOT EXISTS heure_debut_min INTEGER,
  ADD COLUMN IF NOT EXISTS heure_fin_min   INTEGER;

UPDATE projet_deroule_creneaux
   SET heure_debut_min = COALESCE(heure_debut_min,
         (EXTRACT(EPOCH FROM heure_debut) / 60)::INTEGER),
       heure_fin_min = COALESCE(heure_fin_min,
         (EXTRACT(EPOCH FROM heure_fin) / 60)::INTEGER)
 WHERE heure_debut_min IS NULL OR heure_fin_min IS NULL;

ALTER TABLE projet_deroule_creneaux
  ALTER COLUMN heure_debut_min SET NOT NULL,
  ALTER COLUMN heure_fin_min   SET NOT NULL;

-- Drop l'ancien CHECK qui référençait heure_fin > heure_debut TIME
ALTER TABLE projet_deroule_creneaux
  DROP CONSTRAINT IF EXISTS projet_deroule_creneaux_horaires_check;

-- Drop les anciennes colonnes TIME (en dernier, après le drop du CHECK)
ALTER TABLE projet_deroule_creneaux
  DROP COLUMN IF EXISTS heure_debut,
  DROP COLUMN IF EXISTS heure_fin;

-- Nouveau CHECK : créneau dans la fenêtre 0-1680 + fin > début
ALTER TABLE projet_deroule_creneaux
  ADD CONSTRAINT projet_deroule_creneaux_horaires_check CHECK (
    heure_debut_min >= 0
    AND heure_debut_min < 1680
    AND heure_fin_min  > heure_debut_min
    AND heure_fin_min  <= 1680
  );


-- ── 3. Mettre à jour les indexes (heure_debut → heure_debut_min) ────────────

DROP INDEX IF EXISTS idx_projet_deroule_creneaux_deroule;
CREATE INDEX IF NOT EXISTS idx_projet_deroule_creneaux_deroule
  ON projet_deroule_creneaux(deroule_id, heure_debut_min);


NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifs post-deploy :
--
-- 1. Roundtrip backfill propre :
--    SELECT id, heure_debut_min, heure_fin_min FROM projet_deroules;
--    -- Pour un déroulé default (00:00-23:59) : heure_debut_min = 0,
--    -- heure_fin_min = 1439.
--
-- 2. Insert créneau qui déborde nuit (live finissant à 02:00 J+1) :
--    INSERT INTO projet_deroule_creneaux (deroule_id, heure_debut_min,
--      heure_fin_min, lane_id, multi_lane, titre)
--    VALUES ('<deroule>', 1200, 1560, '<lane>', false, 'Live nuit');
--    -- 1200 = 20:00, 1560 = 26:00 = 02:00 J+1 ✓
--
-- 3. Tentative au-delà de 04:00 J+1 → CHECK violé :
--    INSERT ... heure_fin_min = 1700 (28h20)  → ERREUR violates check
-- ============================================================================
