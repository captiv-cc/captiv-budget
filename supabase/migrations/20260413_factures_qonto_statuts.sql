-- =====================================================================
-- Factures — Alignement sur le flux Qonto
-- =====================================================================
-- Contexte : les vraies factures sont émises depuis Qonto. CAPTIV DESK
-- sert à planifier, suivre le statut et référencer la facture Qonto.
--
-- Changements :
--  1. Ajout de la colonne qonto_url (URL vers la facture dans Qonto)
--  2. Migration des statuts vers un schéma simplifié 4 états :
--     planifiee / emise / reglee / annulee
--     ("en_retard" devient un indicateur visuel dérivé de date_echeance)
-- =====================================================================

BEGIN;

-- 1. Ajout de la colonne qonto_url
ALTER TABLE factures ADD COLUMN IF NOT EXISTS qonto_url TEXT;

-- 2. Migration des données existantes vers les nouveaux statuts
--    (on effectue la migration AVANT de changer la contrainte)
UPDATE factures SET statut = 'planifiee' WHERE statut = 'brouillon';
UPDATE factures SET statut = 'emise'
  WHERE statut IN ('envoyee', 'en_attente', 'en_retard');
-- 'reglee' reste inchangé

-- 3. Remplacement de la contrainte CHECK sur statut
ALTER TABLE factures DROP CONSTRAINT IF EXISTS factures_statut_check;
ALTER TABLE factures ADD CONSTRAINT factures_statut_check
  CHECK (statut IN ('planifiee', 'emise', 'reglee', 'annulee'));

-- 4. Mise à jour de la valeur par défaut
ALTER TABLE factures ALTER COLUMN statut SET DEFAULT 'planifiee';

-- 5. Mise à jour de la vue v_compta_factures pour refléter les nouveaux statuts
--    (DROP + CREATE car on insère une nouvelle colonne qonto_url au milieu,
--     ce que CREATE OR REPLACE VIEW n'autorise pas en Postgres)
DROP VIEW IF EXISTS v_compta_factures;
CREATE VIEW v_compta_factures AS
SELECT
  f.id,
  f.project_id,
  p.title                             AS project_title,
  COALESCE(c.raison_sociale, c.nom_commercial) AS client_name,
  f.type,
  f.numero,
  f.qonto_url,
  f.objet,
  f.montant_ht,
  f.tva_pct,
  f.montant_ttc,
  f.statut,
  f.date_emission,
  f.date_envoi,
  f.delai_paiement,
  f.date_echeance,
  f.date_reglement,
  -- Jours restants avant échéance (négatif = en retard)
  CASE
    WHEN f.date_echeance IS NOT NULL AND f.statut NOT IN ('reglee', 'annulee')
    THEN f.date_echeance - CURRENT_DATE
    ELSE NULL
  END                                 AS jours_avant_echeance,
  -- Flag urgence (en_retard est désormais dérivé)
  CASE
    WHEN f.statut = 'reglee'                                         THEN 'regle'
    WHEN f.statut = 'annulee'                                        THEN 'annule'
    WHEN f.statut = 'planifiee'                                      THEN 'a_planifier'
    WHEN f.date_echeance < CURRENT_DATE                              THEN 'en_retard'
    WHEN f.date_echeance <= CURRENT_DATE + 7                         THEN 'urgent'
    WHEN f.date_echeance <= CURRENT_DATE + 30                        THEN 'a_venir'
    ELSE 'ok'
  END                                 AS urgence,
  p.org_id
FROM factures f
JOIN projects p ON f.project_id = p.id
LEFT JOIN clients c ON p.client_id = c.id
ORDER BY
  CASE
    WHEN f.statut IN ('reglee', 'annulee')     THEN 3
    WHEN f.date_echeance < CURRENT_DATE        THEN 0
    WHEN f.date_echeance <= CURRENT_DATE + 7   THEN 1
    ELSE 2
  END,
  f.date_echeance ASC NULLS LAST;

COMMIT;
