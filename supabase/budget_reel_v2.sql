-- ============================================================
-- BUDGET RÉEL v2 — Migration
-- À exécuter dans Supabase Dashboard > SQL Editor
-- ============================================================

-- Ajout des colonnes manquantes
ALTER TABLE budget_reel ADD COLUMN IF NOT EXISTS valide     boolean  DEFAULT false;
ALTER TABLE budget_reel ADD COLUMN IF NOT EXISTS paye       boolean  DEFAULT false;
ALTER TABLE budget_reel ADD COLUMN IF NOT EXISTS tva_rate   numeric  DEFAULT 20;
ALTER TABLE budget_reel ADD COLUMN IF NOT EXISTS qonto_ok   boolean  DEFAULT false;
ALTER TABLE budget_reel ADD COLUMN IF NOT EXISTS is_additif boolean  DEFAULT false;
ALTER TABLE budget_reel ADD COLUMN IF NOT EXISTS bloc_name  text;

-- La colonne devis_line_id existait déjà (FK vers devis_lines)
-- La colonne fournisseur existait déjà
-- La colonne description existait déjà
-- La colonne montant_ht existait déjà
-- La colonne facture_ref existait déjà (non utilisée dans v2, conservée)
-- La colonne categorie existait déjà (remplacée par bloc_name, conservée pour compatibilité)
