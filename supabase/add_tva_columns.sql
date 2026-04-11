-- ============================================================================
-- Migration : ajout des taux de TVA par défaut
--   • contacts.default_tva     (humains : 0 par défaut, intermittents/cachets)
--   • fournisseurs.default_tva (sociétés : 20 par défaut)
--   • devis.tva_rate           (taux appliqué au client final, 20 par défaut)
--
-- Logique d'attribution sur budget_reel.tva_rate à la création d'une entrée :
--   1. Si la ligne devis a un membre  → contacts.default_tva (via projet_membres)
--   2. Sinon si fournisseur assigné   → fournisseurs.default_tva
--   3. Sinon                          → 0   (sécurité comptable : on ne récupère pas
--                                            une TVA sur laquelle on n'a pas d'info)
-- ============================================================================

-- 1) contacts.default_tva -----------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS default_tva NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN contacts.default_tva IS
  'Taux de TVA par défaut appliqué quand ce contact est utilisé sur une ligne budget_reel. 0 par défaut (intermittents, salariés). Mettre 20 pour un libéral facturant la TVA.';

-- 2) fournisseurs.default_tva -------------------------------------------------
ALTER TABLE fournisseurs
  ADD COLUMN IF NOT EXISTS default_tva NUMERIC NOT NULL DEFAULT 20;

COMMENT ON COLUMN fournisseurs.default_tva IS
  'Taux de TVA par défaut appliqué quand ce fournisseur est utilisé sur une ligne budget_reel ou un additif. 20 par défaut. 0 pour un fournisseur étranger ou exonéré.';

-- 3) devis.tva_rate -----------------------------------------------------------
ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS tva_rate NUMERIC NOT NULL DEFAULT 20;

COMMENT ON COLUMN devis.tva_rate IS
  'Taux de TVA appliqué au client final sur ce devis. 20 par défaut. 0 si exonération ou intracom.';

-- ============================================================================
-- Notes :
-- • budget_reel.tva_rate existe déjà et reste la source de vérité par ligne.
-- • Aucune mise à jour rétro nécessaire : les valeurs par défaut DDL prennent
--   effet automatiquement pour les enregistrements futurs.
-- ============================================================================
