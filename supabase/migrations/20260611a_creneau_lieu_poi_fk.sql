-- ============================================================================
-- Migration : LIEU V1.1 — creneau.lieu_id → POI de la carte
-- Date      : 2026-06-11
-- ============================================================================
--
-- Contexte :
--   On réactive la colonne `projet_deroule_creneaux.lieu_id` (jusque-là libre,
--   prévue "FK future") pour pointer vers un POI de la carte interactive
--   (projet_lieu_pois). Permet de placer PRÉCISÉMENT un événement du déroulé
--   sur la carte → le "Y aller" mobile résout en priorité ce lien.
--
--   Résolution mobile (priorité) :
--     1. creneau.lieu_id            → POI explicite sur l'event (le plus précis)
--     2. POI.creneau_id = creneau   → lien posé côté carte sur ce créneau
--     3. POI.lane_id = lane(creneau)→ lien de lane (scènes)
--     4. POI.deroule_id = jour      → point générique du jour
--     5. fallback : match lieu_text ↔ label POI
--
-- ON DELETE SET NULL : si le POI est supprimé, le créneau perd juste son lieu.
-- Idempotent.
-- ============================================================================

BEGIN;

-- Nettoyage défensif : annule les lieu_id qui ne pointent pas (encore) vers un
-- POI valide (la colonne était libre auparavant — en pratique tout est NULL).
UPDATE projet_deroule_creneaux c
   SET lieu_id = NULL
 WHERE lieu_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM projet_lieu_pois p WHERE p.id = c.lieu_id);

ALTER TABLE projet_deroule_creneaux
  DROP CONSTRAINT IF EXISTS projet_deroule_creneaux_lieu_id_fkey;

ALTER TABLE projet_deroule_creneaux
  ADD CONSTRAINT projet_deroule_creneaux_lieu_id_fkey
  FOREIGN KEY (lieu_id) REFERENCES projet_lieu_pois(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projet_deroule_creneaux_lieu_id_idx
  ON projet_deroule_creneaux(lieu_id) WHERE lieu_id IS NOT NULL;

COMMENT ON COLUMN projet_deroule_creneaux.lieu_id IS
  'FK vers projet_lieu_pois : lieu précis de l''événement sur la carte (placé via le sélecteur "Lieu sur la carte" de l''éditeur de créneau). Prioritaire pour le "Y aller" mobile. NULL = pas de lieu précis (on retombe sur les liens POI→lane/jour ou le match par nom).';

COMMIT;
