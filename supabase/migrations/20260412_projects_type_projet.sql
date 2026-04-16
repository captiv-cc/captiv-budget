-- Ajout du champ types_projet (array de tags) à la table projects
-- Remplace l'ancien type_projet text s'il existait
DO $$
BEGIN
  -- Si l'ancienne colonne text existe, la supprimer
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'type_projet' AND data_type = 'text'
  ) THEN
    ALTER TABLE projects DROP COLUMN type_projet;
  END IF;
END $$;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS types_projet text[];

-- Index GIN pour recherche rapide dans les arrays
CREATE INDEX IF NOT EXISTS idx_projects_types_projet ON projects USING gin(types_projet);
