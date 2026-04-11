-- ============================================================
-- FOURNISSEURS — table globale (tous projets)
-- À exécuter dans Supabase Dashboard → SQL Editor
-- ============================================================

-- Table principale des fournisseurs
CREATE TABLE IF NOT EXISTS fournisseurs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        text        NOT NULL,
  type       text,         -- ex: 'Matériel', 'Logistique', 'Postprod', 'Catering', 'Autre'
  siret      text,
  email      text,
  phone      text,
  notes      text,
  created_at timestamptz DEFAULT now()
);

-- Lien fournisseur sur les lignes de devis (stocké sur devis_lines pour persistance)
ALTER TABLE devis_lines
  ADD COLUMN IF NOT EXISTS fournisseur_id uuid REFERENCES fournisseurs(id) ON DELETE SET NULL;

-- Index pour les jointures
CREATE INDEX IF NOT EXISTS idx_devis_lines_fournisseur_id ON devis_lines(fournisseur_id);

-- RLS — adapter selon votre politique Supabase
-- ALTER TABLE fournisseurs ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "fournisseurs_all" ON fournisseurs FOR ALL USING (true);
