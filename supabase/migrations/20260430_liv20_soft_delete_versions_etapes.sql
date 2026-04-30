-- ════════════════════════════════════════════════════════════════════════════
-- LIV-20 — Soft delete sur livrable_versions et livrable_etapes
-- ════════════════════════════════════════════════════════════════════════════
--
-- Avant ce ticket, ces 2 tables étaient hard-deletées (DELETE direct). On
-- bascule sur soft delete pour les inclure dans la corbeille.
--
-- Les blocs (`livrable_blocks`) et livrables (`livrables`) ont déjà
-- `deleted_at` depuis LIV-1.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE livrable_versions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE livrable_etapes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Index partiels (perf : la majorité des rows ont deleted_at NULL).
CREATE INDEX IF NOT EXISTS livrable_versions_deleted_at_idx
  ON livrable_versions(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS livrable_etapes_deleted_at_idx
  ON livrable_etapes(deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN livrable_versions.deleted_at IS
  'Soft delete (LIV-20). NULL = actif, sinon date de mise en corbeille.';
COMMENT ON COLUMN livrable_etapes.deleted_at IS
  'Soft delete (LIV-20). NULL = actif, sinon date de mise en corbeille.';
