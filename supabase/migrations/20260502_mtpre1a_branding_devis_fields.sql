-- =====================================================================
-- MT-PRE-1.A — Champs branding additionnels (logo bannière + mentions devis)
-- =====================================================================
--
-- Compléments à la migration 20260502_mtpre1a_branding_schema.sql,
-- ajoutés après retour Hugo sur les champs nécessaires aux devis.
--
-- Ajoute 4 nouveaux champs à `organisations` :
--   - logo_banner_url           : logo horizontal pour les en-têtes PDF
--                                 (différent du logo carré UI). Utilisé
--                                 pour tous les PDFs (devis, factures,
--                                 bilan matériel, etc.).
--   - pdf_devis_annulation_text : bloc "Annulation / report"
--   - pdf_devis_reglement_text  : bloc "Modalités de règlement" (sans
--                                 mention du % d'acompte ni du montant,
--                                 qui sont calculés dynamiquement à
--                                 partir des données du devis)
--   - pdf_devis_cgv_text        : bloc CGV / mention légale
--
-- Idempotent : safe à rejouer.
-- =====================================================================

BEGIN;

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS logo_banner_url           TEXT,
  ADD COLUMN IF NOT EXISTS pdf_devis_annulation_text TEXT,
  ADD COLUMN IF NOT EXISTS pdf_devis_reglement_text  TEXT,
  ADD COLUMN IF NOT EXISTS pdf_devis_cgv_text        TEXT;

COMMENT ON COLUMN organisations.logo_banner_url IS
  'MT-PRE-1.A : Logo horizontal (lockup) utilisé en en-tête de tous les PDFs (devis, facture, bilan…). Différent du logo_url_clair/sombre qui sont versions UI.';
COMMENT ON COLUMN organisations.pdf_devis_annulation_text IS
  'MT-PRE-1.A : Texte du bloc "Annulation / report" en pied de devis (laisser vide pour masquer le bloc).';
COMMENT ON COLUMN organisations.pdf_devis_reglement_text IS
  'MT-PRE-1.A : Texte du bloc "Modalités de règlement". Le pourcentage d''acompte et le montant calculé sont injectés dynamiquement par le PDF AVANT ce texte (à partir des données du devis).';
COMMENT ON COLUMN organisations.pdf_devis_cgv_text IS
  'MT-PRE-1.A : Texte du bloc "CGV" en pied de devis (laisser vide pour masquer).';

-- Backfill avec les valeurs Captiv actuelles (extraites du devis exemple)
UPDATE organisations
SET
  pdf_devis_annulation_text = COALESCE(NULLIF(pdf_devis_annulation_text, ''),
    'À moins de 5 jours ouvrables du tournage : 50% du montant total de la production' || E'\n' ||
    'À moins de 72h du tournage : 100% du montant total de la production'),
  pdf_devis_reglement_text = COALESCE(NULLIF(pdf_devis_reglement_text, ''),
    'Solde : sous 30 jours après réception de la facture' || E'\n' ||
    'Majoration de 10% après 60 jours'),
  pdf_devis_cgv_text = COALESCE(NULLIF(pdf_devis_cgv_text, ''),
    'Toute commande est soumise à l''acceptation préalable de nos conditions générales de ventes, consultables sur www.captiv.cc ou sur simple demande.')
WHERE display_name ILIKE '%captiv%' OR legal_name ILIKE '%captiv%';

COMMIT;

-- =====================================================================
-- VÉRIFICATIONS POST-MIGRATION
-- =====================================================================
-- 1. Les 4 nouveaux champs sont présents :
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name='organisations'
--      AND column_name IN ('logo_banner_url','pdf_devis_annulation_text',
--                          'pdf_devis_reglement_text','pdf_devis_cgv_text');
--    -- Doit renvoyer 4 lignes
--
-- 2. Captiv a bien les textes pré-remplis :
--    SELECT pdf_devis_annulation_text, pdf_devis_reglement_text, pdf_devis_cgv_text
--    FROM organisations LIMIT 1;
-- =====================================================================
