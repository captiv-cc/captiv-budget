-- ============================================================================
-- Migration : MUSIQUES MVP1.5 — Colonne sort_order pour drag and drop
-- Date      : 2026-06-08 (G — MUS-3.5)
-- Contexte  : Hugo veut pouvoir réordonner manuellement les propositions
--             dans la liste vrac via drag and drop. On ajoute une colonne
--             sort_order REAL nullable :
--               - NULL = pas de position manuelle, fallback sur created_at
--               - REAL = position dans l'ordre custom
--
--             REAL plutôt qu'INTEGER pour permettre l'insertion entre 2
--             rows existantes sans renumérotation globale (fractional
--             ordering). Insérer entre 1.0 et 2.0 → 1.5 ; entre 1.5 et
--             2.0 → 1.75 ; etc.
--
-- Périmètre :
--   ALTER TABLE projet_musique_propositions ADD COLUMN sort_order REAL
-- ============================================================================

BEGIN;

ALTER TABLE projet_musique_propositions
  ADD COLUMN IF NOT EXISTS sort_order REAL;

CREATE INDEX IF NOT EXISTS idx_musique_propositions_sort_order
  ON projet_musique_propositions (project_id, sort_order)
  WHERE sort_order IS NOT NULL;

COMMENT ON COLUMN projet_musique_propositions.sort_order IS
  'MUSIQUES MUS-3.5 — Position custom dans la liste vrac (drag and drop). '
  'NULL = ordre par created_at. REAL pour insertion fractionnaire '
  '(éviter renumérotation globale).';

COMMIT;
