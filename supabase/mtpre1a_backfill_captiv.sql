-- =====================================================================
-- MT-PRE-1.A — Backfill manuel des données Captiv
-- =====================================================================
--
-- À lancer si la migration 20260502_mtpre1a_branding_schema.sql n'a
-- pas réussi à backfiller automatiquement (parce que la condition
-- WHERE n'a pas matché ton legal_name initial). Sinon, ignorer ce
-- fichier — tu peux remplir le formulaire Paramètres > Organisation
-- toi-même via l'UI.
--
-- Idempotent : ne touche que les colonnes vides (COALESCE).
-- À exécuter dans le SQL Editor Supabase.
-- =====================================================================

-- Adapter l'UPDATE à ton org : remplace l'ID ou la condition WHERE
-- selon ce qui marche pour toi. Le plus simple : prendre l'ID Captiv.

-- Étape 1 : retrouver l'ID Captiv
SELECT id, legal_name, display_name FROM organisations LIMIT 10;

-- Étape 2 : copier l'ID retourné dans le UPDATE ci-dessous, dé-commenter,
-- adapter si besoin et exécuter.

/*
UPDATE organisations
SET
  display_name        = COALESCE(NULLIF(display_name, ''), 'Captiv'),
  legal_name          = COALESCE(NULLIF(legal_name, ''), 'CAPTIV SARL OMNI Films'),
  tagline             = COALESCE(NULLIF(tagline, ''), 'Production audiovisuelle'),
  forme_juridique     = COALESCE(NULLIF(forme_juridique, ''), 'SARL'),
  capital_social      = COALESCE(NULLIF(capital_social, ''), '800 €'),
  siret               = COALESCE(NULLIF(siret, ''), '898201025 00019'),
  code_ape            = COALESCE(NULLIF(code_ape, ''), '5911A'),
  tva_number          = COALESCE(NULLIF(tva_number, ''), 'FR 26898201025'),
  ville_rcs           = COALESCE(NULLIF(ville_rcs, ''), 'Montpellier'),
  website_url         = COALESCE(NULLIF(website_url, ''), 'https://captiv.cc'),
  brand_color         = COALESCE(NULLIF(brand_color, ''), '#3B82F6')
WHERE id = 'COLLE_ICI_TON_ID_ORG_CAPTIV';
*/

-- Étape 3 : vérifier le résultat
-- SELECT display_name, legal_name, forme_juridique, capital_social,
--        siret, code_ape, tva_number, ville_rcs, website_url
-- FROM organisations WHERE id = 'COLLE_ICI_TON_ID_ORG_CAPTIV';
