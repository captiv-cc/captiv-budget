-- ============================================================================
-- Migration : PLANS CANVAS — cartouche d'export PDF (config par plan)
-- Date      : 2026-07-06
-- Chantier  : docs/CHANTIER_PLANS.md (axe #9, cadré avec Hugo)
-- ============================================================================
--
-- Config du cartouche PDF, persistée par plan (jsonb) :
--   { projet, ref, client, lieu, dateEvenement, contact, mention,
--     format ('a3'|'a4'), personnes: [{role, nom}],
--     logos: [{kind: 'storage'|'url', ref}] }
-- Les logos uploadés vivent dans le bucket plans
-- (<project_id>/cartouche/<canvas_id>/…), jamais en base64 dans le jsonb.
--
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE plans_canvas
  ADD COLUMN IF NOT EXISTS cartouche jsonb;

COMMENT ON COLUMN plans_canvas.cartouche IS
  'Config du cartouche PDF (bande bas : logos, projet, personnes, échelle graphique). Cf. lib/plansCanvasCartouche.js.';

COMMIT;
