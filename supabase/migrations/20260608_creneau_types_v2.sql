-- ============================================================================
-- Migration : DÉROULÉ — Types de créneaux V2 (core enrichi + custom JSONB)
-- Date      : 2026-06-08
-- Contexte  : Le set initial (install/repas/prise/pause/transport/brief/live/
--             autre/indispo) était orienté Festival. On élargit pour couvrir
--             pub, doc, fiction, live, et on ajoute la possibilité de types
--             personnalisés par projet (stockés en JSONB).
--
-- Nouveau set core (14 types) :
--   install, brief, tournage, captation, show, interview, drone, ambiance,
--   repas, pause, transport, postprod, autre, indispo
--
-- Migrations data :
--   prise → tournage  (terme universel : couvre festival, pub, fiction, doc)
--   live  → show      (le terme 'live' désignait un set d'artiste = show)
--
-- Le CHECK constraint sur projet_deroule_creneaux.type est DROPPÉ (sans
-- nouveau check) car les types custom par projet sont stockés à part dans
-- projects.creneau_types JSONB. La validité du type est désormais portée
-- par le frontend (core ∪ project custom).
-- ============================================================================

BEGIN;

-- ── 1. Migration data ─────────────────────────────────────────────────────
UPDATE projet_deroule_creneaux SET type = 'tournage' WHERE type = 'prise';
UPDATE projet_deroule_creneaux SET type = 'show'     WHERE type = 'live';

-- ── 2. Drop l'ancien CHECK constraint (set fermé) ─────────────────────────
-- On ne remet pas de CHECK : la valeur peut être un type core OU un key
-- custom défini dans projects.creneau_types. Validation côté frontend.
ALTER TABLE projet_deroule_creneaux
  DROP CONSTRAINT IF EXISTS projet_deroule_creneaux_type_check;

-- ── 3. Ajout colonne creneau_types JSONB sur projects ─────────────────────
-- Structure : [{ key, libelle, couleur, sort_order }, ...]
-- Pas de CHECK ni de validation BDD : le frontend assure cohérence
-- (helpers dans lib/creneauTypes.js).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS creneau_types JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN projects.creneau_types IS
  'Types de créneaux personnalisés du projet (Sprint Festival types V2). '
  'Array d''objets {key, libelle, couleur, sort_order}. Limit 20 côté front. '
  'Mergeable avec le set core dans lib/creneauTypes.js.';

COMMIT;
