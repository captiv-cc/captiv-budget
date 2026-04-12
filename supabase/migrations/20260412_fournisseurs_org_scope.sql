-- Scope fournisseurs à l'organisation + ajout archivage
-- À exécuter APRÈS avoir identifié l'org_id à attribuer aux fournisseurs existants

-- 1. Ajouter org_id (nullable d'abord pour ne pas casser les existants)
ALTER TABLE fournisseurs
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organisations(id),
  ADD COLUMN IF NOT EXISTS actif boolean DEFAULT true;

-- 2. Attribuer tous les fournisseurs existants à l'org ZQSD
UPDATE fournisseurs
  SET org_id = '222868b2-aced-4cc1-b98d-e0337b571462'
  WHERE org_id IS NULL;

-- 3. Rendre org_id NOT NULL maintenant que tous ont une valeur
ALTER TABLE fournisseurs
  ALTER COLUMN org_id SET NOT NULL;

-- 4. Index pour les requêtes filtrées par org
CREATE INDEX IF NOT EXISTS idx_fournisseurs_org ON fournisseurs(org_id);
CREATE INDEX IF NOT EXISTS idx_fournisseurs_actif ON fournisseurs(actif);
