-- Migration : enrichissement contacts v2 (logistique + adresse)
-- Nouveaux champs pour la fiche crew complète

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS date_naissance date,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS code_postal text,
  ADD COLUMN IF NOT EXISTS ville text,
  ADD COLUMN IF NOT EXISTS pays text DEFAULT 'France',
  ADD COLUMN IF NOT EXISTS taille_tshirt text,
  ADD COLUMN IF NOT EXISTS regime_alimentaire text,
  ADD COLUMN IF NOT EXISTS permis boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS vehicule boolean DEFAULT false;

-- Index sur ville pour faciliter le filtrage/recherche
CREATE INDEX IF NOT EXISTS idx_contacts_ville ON contacts(ville);

COMMENT ON COLUMN contacts.date_naissance IS 'Date de naissance (DPAE, contrats)';
COMMENT ON COLUMN contacts.address IS 'Adresse postale (rue + numéro)';
COMMENT ON COLUMN contacts.code_postal IS 'Code postal';
COMMENT ON COLUMN contacts.ville IS 'Ville';
COMMENT ON COLUMN contacts.pays IS 'Pays (défaut France)';
COMMENT ON COLUMN contacts.taille_tshirt IS 'Taille t-shirt (XS, S, M, L, XL, XXL)';
COMMENT ON COLUMN contacts.regime_alimentaire IS 'Régime alimentaire (omnivore, végétarien, végan, sans gluten, etc.)';
COMMENT ON COLUMN contacts.permis IS 'Possède le permis de conduire';
COMMENT ON COLUMN contacts.vehicule IS 'Possède un véhicule';
