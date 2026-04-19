-- ============================================================================
-- Migration : BUDGET-PERM — Ajout des outils "devis" et "budget" au catalogue
-- Date      : 2026-04-20
-- Contexte  : Jusqu'ici, l'accès aux onglets Devis / Budget réel / Factures /
--             Dashboard projet était gouverné par un flag applicatif
--             `canSeeFinance` (admin OR charge_prod) ; les coordinateurs et
--             prestataires ne les voyaient jamais. Hugo veut désormais pouvoir
--             donner à un prestataire attaché à un projet un accès granulaire
--             en lecture ou édition à :
--               * l'outil "Devis"  → onglet Devis
--               * l'outil "Budget" → onglets Factures + Budget réel + Dashboard
--             Cette migration (BP-2) se contente d'ajouter les 2 clés dans
--             `outils_catalogue`. L'étape BP-3 migrera les RLS de devis/
--             factures/budget_reel/… pour s'appuyer sur can_read_outil /
--             can_edit_outil, et BP-5/BP-6 cableront l'UI.
--
-- Choix produit (confirmés par Hugo) :
--   * Dashboard reste regroupé avec "budget" (pas d'outil dédié).
--   * Admin / chargé_prod / coordinateur attachés conservent leur bypass via
--     can_read_outil / can_edit_outil (cf. ch3b_project_access.sql).
--   * Aucune permission template n'est semée : Hugo a demandé explicitement
--     "ne coche rien pour le reste" — les prestataires existants n'obtiennent
--     donc AUCUN accès par défaut à ces 2 nouveaux outils. Il faudra les
--     cocher manuellement par métier ou par override utilisateur.
--
-- Idempotent : INSERT … ON CONFLICT (key) DO NOTHING. Safe à rejouer.
-- ============================================================================

BEGIN;

INSERT INTO outils_catalogue (key, label, description, icon, sort_order) VALUES
  ('devis',  'Devis',  'Catalogue, versions et validation des devis du projet',                'FileSpreadsheet', 90),
  ('budget', 'Budget', 'Factures, budget réel et dashboard financier du projet',               'Wallet',          95)
ON CONFLICT (key) DO NOTHING;

COMMIT;
