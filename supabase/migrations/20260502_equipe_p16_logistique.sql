-- ============================================================================
-- Migration : ÉQUIPE Phase 1.6 — Champs logistique (arrivée + notes)
-- Date      : 2026-05-02
-- Contexte  : retour Hugo après test P1.5. Besoin d'enregistrer dans la
--             techlist :
--               - le jour d'arrivée (souvent ≠ du 1er jour de présence,
--                 ex: arrivée la veille pour un tournage tôt le matin)
--               - l'heure d'arrivée (texte libre type "12h50", "matin")
--               - notes logistique (texte libre type "train Lyon 12h50",
--                 "vient en voiture, place de parking demandée", etc.)
--
-- Ces champs sont persona-level (= une personne arrive un seul jour, pas
-- N fois selon ses N rôles). Ils sont synchronisés via bulkUpdate côté
-- front, comme secteur/hebergement/chauffeur/presence_days/couleur.
--
-- Idempotent : ADD COLUMN IF NOT EXISTS.
-- ============================================================================

BEGIN;

ALTER TABLE projet_membres
  -- Jour d'arrivée. Optionnel : si NULL, l'admin n'a pas besoin de
  -- distinguer du 1er jour de présence.
  ADD COLUMN IF NOT EXISTS arrival_date DATE,

  -- Heure d'arrivée — TEXT plutôt que TIME pour autoriser les valeurs
  -- floues type "matin", "ETA 14h", "selon train SNCF".
  ADD COLUMN IF NOT EXISTS arrival_time TEXT,

  -- Notes logistique libres (transport, contraintes, etc.).
  ADD COLUMN IF NOT EXISTS logistique_notes TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérification :
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'projet_membres'
--     AND column_name IN ('arrival_date', 'arrival_time', 'logistique_notes')
--   ORDER BY column_name;
-- ============================================================================
