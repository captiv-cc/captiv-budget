-- ════════════════════════════════════════════════════════════════════════════
-- LIV-19 — Lien lot devis ↔ bloc de livrables (refonte design 2026-04-30)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Le pointeur `livrable.devis_lot_id` (créé en LIV-1) était au mauvais niveau :
-- la règle métier dit "tous les livrables d'un même bloc partagent le même
-- lot" (un bloc = un thème commercial = un lot). On déplace donc le pointeur
-- du livrable vers le bloc.
--
-- `livrables.devis_lot_id` est conservé en DB pour l'instant (rétro-compat,
-- jamais utilisé en prod) — pourra être dropé dans une migration suivante
-- une fois qu'on sera sûr qu'aucun code ne s'y réfère plus.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE livrable_blocks
  ADD COLUMN IF NOT EXISTS devis_lot_id uuid
    REFERENCES devis_lots(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS livrable_blocks_devis_lot_id_idx
  ON livrable_blocks(devis_lot_id)
  WHERE devis_lot_id IS NOT NULL;

COMMENT ON COLUMN livrable_blocks.devis_lot_id IS
  'Lot du devis auquel ce bloc est rattaché. NULL = générique (apparaît sur tous les devis du projet). LIV-19.';
