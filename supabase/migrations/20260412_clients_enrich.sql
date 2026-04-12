-- ============================================================================
-- Migration : Enrichissement de la table clients
-- Date : 2026-04-12
-- Description : Ajout nom commercial / raison sociale, type, statut,
--               contact enrichi, adresse structurée, email facturation.
-- ============================================================================

-- 1. Renommer "name" → "nom_commercial" (le nom d'usage au quotidien)
ALTER TABLE clients RENAME COLUMN name TO nom_commercial;

-- 2. Ajouter les nouveaux champs
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS raison_sociale    TEXT,          -- nom légal (devis, factures)
  ADD COLUMN IF NOT EXISTS type_client       TEXT DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS statut            TEXT DEFAULT 'actif',
  ADD COLUMN IF NOT EXISTS contact_fonction  TEXT,          -- poste du contact principal
  ADD COLUMN IF NOT EXISTS email_facturation TEXT,          -- email compta séparé
  ADD COLUMN IF NOT EXISTS code_postal       TEXT,
  ADD COLUMN IF NOT EXISTS ville             TEXT,
  ADD COLUMN IF NOT EXISTS pays              TEXT DEFAULT 'France';

-- 3. Contraintes CHECK pour type_client et statut
ALTER TABLE clients
  ADD CONSTRAINT clients_type_client_check
    CHECK (type_client IN ('production', 'agence', 'marque', 'institution', 'association', 'particulier')),
  ADD CONSTRAINT clients_statut_check
    CHECK (statut IN ('actif', 'inactif', 'prospect'));

-- 4. Index pour les filtres courants
CREATE INDEX IF NOT EXISTS idx_clients_statut      ON clients (statut);
CREATE INDEX IF NOT EXISTS idx_clients_type_client  ON clients (type_client);
CREATE INDEX IF NOT EXISTS idx_clients_ville        ON clients (ville);

-- ============================================================================
-- NOTE : Le champ "address" existant est conservé (adresse libre / ligne 1).
-- Les nouveaux champs code_postal, ville, pays permettent le filtrage.
-- "raison_sociale" est utilisé sur les documents légaux (devis PDF, factures).
-- Fallback : si raison_sociale est NULL, on affiche nom_commercial.
-- ============================================================================
