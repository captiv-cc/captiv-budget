-- ============================================================================
-- Migration : PLANS CANVAS — contenu des liens de partage (live | figé)
-- Date      : 2026-07-05 (registre de révisions, décision Hugo)
-- ============================================================================
--
-- mode = 'live'   : le lien montre le plan en cours (comportement historique)
-- mode = 'frozen' : le lien montre la DERNIÈRE VERSION FIGÉE (l'équipe
--                   travaille tranquille, le destinataire ne voit que les
--                   révisions diffusées). Fallback live si aucune version.

ALTER TABLE plans_canvas_share_tokens
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'live'
  CHECK (mode IN ('live', 'frozen'));

COMMENT ON COLUMN plans_canvas_share_tokens.mode IS
  'live = plan en cours ; frozen = dernière version figée (plans_canvas_versions).';
