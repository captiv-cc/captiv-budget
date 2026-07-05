-- ============================================================================
-- Migration : PLANS CANVAS — libellé interne des liens de partage
-- Date      : 2026-07-05 (complément de 20260705b, aligné sur la modale du
--             module de partage des fichiers plans : « Régisseur Paul », …)
-- ============================================================================

ALTER TABLE plans_canvas_share_tokens
  ADD COLUMN IF NOT EXISTS label text;

COMMENT ON COLUMN plans_canvas_share_tokens.label IS
  'Libellé interne du lien (destinataire), jamais montré au destinataire.';
