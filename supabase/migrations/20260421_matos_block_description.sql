-- ============================================================================
-- Migration : MAT — Bloc description + duplicate support
-- Date      : 2026-04-21
-- Contexte  : Ajout d'un champ `description` libre sur chaque matos_block, à
--             remplir manuellement par l'utilisateur (contexte du bloc, notes
--             de prépa, etc.). Visible toujours, même en mode compressé.
--
-- Dépend de  : 20260421_mat_refonte_blocs.sql
-- Idempotent : ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- ============================================================================

BEGIN;

ALTER TABLE matos_blocks
  ADD COLUMN IF NOT EXISTS description text NULL;

COMMENT ON COLUMN matos_blocks.description IS
  'Description libre du bloc, rédigée manuellement (contexte, notes de prépa…). Toujours visible dans l''UI.';

COMMIT;
