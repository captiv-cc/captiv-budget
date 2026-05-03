-- ============================================================================
-- Migration : PLANS V1 polish — applicable_date → applicable_dates date[]
-- Date      : 2026-05-04
-- ============================================================================
--
-- Contexte :
--   En V1 initial, `applicable_date` était une date unique nullable (un plan
--   = un jour précis OU tous les jours si NULL). Retour Hugo : un plan peut
--   très bien valoir pour J1 + J3 mais pas J2 (multi-jour non contigu).
--
--   On bascule donc en `applicable_dates date[]`. Conventions :
--     - tableau vide ou NULL = "tous les jours" (pas de restriction)
--     - tableau non vide    = uniquement ces jours-là (sélection multi)
--
--   Ajout aussi de la colonne `thumbnail_path` qui sera utilisée dans le
--   prochain commit pour stocker le path Storage du thumbnail JPG (page 1
--   pour PDF, version compressée pour PNG/JPG).
--
-- Idempotent : ALTER … ADD COLUMN IF NOT EXISTS, DROP COLUMN IF EXISTS.
-- ============================================================================

BEGIN;

-- ── 1. Ajouter la nouvelle colonne (avec backfill depuis l'ancienne) ────────
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS applicable_dates date[] NOT NULL DEFAULT '{}';

-- Backfill : si applicable_date existait, on transfère dans applicable_dates.
UPDATE plans
   SET applicable_dates = ARRAY[applicable_date]
 WHERE applicable_date IS NOT NULL
   AND (applicable_dates IS NULL OR cardinality(applicable_dates) = 0);

-- ── 2. Drop l'ancienne colonne ──────────────────────────────────────────────
ALTER TABLE plans DROP COLUMN IF EXISTS applicable_date;

COMMENT ON COLUMN plans.applicable_dates IS
  'Jours de tournage / prépa auxquels le plan s''applique. Vide ou NULL = tous les jours (défaut). Non-vide = uniquement ces dates. Permet le multi-jour non contigu (ex: J1 + J3).';

-- ── 3. Ajouter thumbnail_path (utilisé dans le commit suivant — vignettes) ──
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS thumbnail_path text;

COMMENT ON COLUMN plans.thumbnail_path IS
  'Chemin Storage du thumbnail JPG (page 1 du PDF rendue côté front via PDF.js, ou version compressée d''une image). Format : <project_id>/<plan_id>/_thumb.jpg. NULL si pas encore généré (rétrocompatible).';

COMMIT;
