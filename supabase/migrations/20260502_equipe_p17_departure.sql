-- ============================================================================
-- Migration : ÉQUIPE Phase 1.7 — Champs retour (symétrique arrivée)
-- Date      : 2026-05-02
-- Contexte  : retour Hugo après test P1.6. Besoin de symétriser arrivée/retour
--             dans la techlist (date + heure). `logistique_notes` reste un
--             champ libre commun pour le transport / contraintes diverses.
--
-- Persona-level : une personne a un seul jour de retour, indépendamment de
-- ses N rôles. Synchronisés via bulkUpdate côté front.
-- ============================================================================

BEGIN;

ALTER TABLE projet_membres
  -- Jour de retour. Optionnel : si NULL, l'admin n'a pas besoin de
  -- distinguer du dernier jour de présence.
  ADD COLUMN IF NOT EXISTS departure_date DATE,

  -- Heure de retour — TEXT pour autoriser les valeurs floues
  -- ("18h45", "soir", "selon TGV").
  ADD COLUMN IF NOT EXISTS departure_time TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
