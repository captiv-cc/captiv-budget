-- ════════════════════════════════════════════════════════════════════════════
-- Chantier 4 — Ajout d'une colonne lot_id directe sur factures
-- ----------------------------------------------------------------------------
-- Cohérent avec budget_reel.lot_id : permet un regroupement SQL direct par
-- lot (Dashboard, RecapPaiements, exports compta) sans avoir à joindre devis.
--
-- Règles :
--   - lot_id NULLABLE : une facture peut exister sans être rattachée à un lot
--     (ex : acompte initial avant signature du devis). Cas rare mais légitime.
--   - Backfill depuis devis.lot_id quand factures.devis_id est défini.
--   - Pas de contrainte de cohérence entre factures.lot_id et devis.lot_id
--     (on fait confiance au code applicatif — un CHECK triggerisé serait
--     couteux pour un invariant qu'on tient de toute façon).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Ajout de la colonne (nullable)
ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES devis_lots(id) ON DELETE SET NULL;

-- 2. Backfill depuis devis.lot_id pour les factures qui ont un devis_id
UPDATE factures f
SET lot_id = d.lot_id
FROM devis d
WHERE f.devis_id = d.id
  AND f.lot_id IS NULL;

-- 3. Index pour accélérer les queries par lot (Dashboard, RecapPaiements)
CREATE INDEX IF NOT EXISTS factures_lot_id_idx ON factures(lot_id);

-- 4. Rafraîchir la vue v_compta_factures pour qu'elle utilise factures.lot_id
--    en priorité (plus direct qu'un join via devis)
DROP VIEW IF EXISTS v_compta_factures;
CREATE VIEW v_compta_factures AS
SELECT
  f.*,
  p.title        AS project_title,
  p.ref_projet   AS project_ref,
  p.client_id,
  c.nom_commercial AS client_name,
  -- lot : priorité à factures.lot_id, sinon dérivé via devis
  COALESCE(f.lot_id, d.lot_id) AS resolved_lot_id,
  l.title AS lot_title
FROM factures f
LEFT JOIN projects p ON p.id = f.project_id
LEFT JOIN clients  c ON c.id = p.client_id
LEFT JOIN devis    d ON d.id = f.devis_id
LEFT JOIN devis_lots l ON l.id = COALESCE(f.lot_id, d.lot_id);

COMMENT ON COLUMN factures.lot_id IS
  'Lot commercial auquel la facture est rattachée. Nullable (facture hors lot possible, ex : acompte avant signature). Quand définie avec devis_id, doit correspondre à devis.lot_id (invariant applicatif, non contraint en DB).';

COMMIT;
