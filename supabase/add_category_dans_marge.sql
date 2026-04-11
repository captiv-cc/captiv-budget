-- Ajoute le flag "dans_marge" au niveau de chaque catégorie de devis
-- Permet d'exclure un bloc entier (ex: MATÉRIEL) du calcul de marge globale
ALTER TABLE devis_categories
  ADD COLUMN IF NOT EXISTS dans_marge boolean NOT NULL DEFAULT true;
