-- ============================================================================
-- Migration : PLANS CANVAS — commentaires internes équipe
-- Date      : 2026-07-06
-- Chantier  : docs/CHANTIER_PLANS.md (sprint outil complet, axe #11)
-- ============================================================================
--
-- L'équipe peut poser des marqueurs de commentaire directement depuis le
-- desk. `internal = true` = discussion interne : jamais servi par l'edge
-- function plans-public, donc invisible de TOUS les liens de partage.
--
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE plans_canvas_comments
  ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN plans_canvas_comments.internal IS
  'Commentaire interne équipe : exclu des réponses de l''edge function plans-public (invisible des liens de partage).';

COMMIT;
