-- ============================================================================
-- Migration : MUSIQUES MUS-6.8.a — statut_local : 3 stades internes
-- Date      : 2026-06-09 (c — MUS-6.8.a)
-- Contexte  : Refonte du modèle workflow musiques. Le statut_local initial
--             (propose / valide_client / refuse_client) couvrait la validation
--             client. Mais la validation client + presse + labels ira dans un
--             onglet "Autorisations" futur.
--
--             Ici on garde 3 valeurs pour les STADES INTERNES de sélection
--             par livrable :
--               - proposition : track candidate pour ce livrable (par défaut)
--               - choix       : shortlist (on l'a retenue comme candidate forte)
--               - valide      : tranchée, c'est celle qui sera utilisée
--
--             Map des données existantes :
--               - propose       → proposition
--               - valide_client → valide
--               - refuse_client → proposition (info validation client perdue,
--                                 sera re-saisie dans Autorisations futur)
--
-- Périmètre :
--   1. UPDATE des rows existantes avec mapping
--   2. DROP + ADD du CHECK constraint
-- ============================================================================

BEGIN;

-- ── 1. Migrate les données ──────────────────────────────────────────────
UPDATE projet_musique_livrable_link
   SET statut_local = CASE statut_local
                        WHEN 'valide_client' THEN 'valide'
                        WHEN 'refuse_client' THEN 'proposition'
                        WHEN 'propose'       THEN 'proposition'
                        ELSE 'proposition'
                      END;

-- ── 2. Remplace le CHECK constraint ─────────────────────────────────────
-- On droppe l'ancien (nom dérivé de Postgres) puis on ajoute le nouveau.
ALTER TABLE projet_musique_livrable_link
  DROP CONSTRAINT IF EXISTS projet_musique_livrable_link_statut_local_check;

ALTER TABLE projet_musique_livrable_link
  ADD CONSTRAINT projet_musique_livrable_link_statut_local_check
  CHECK (statut_local IN ('proposition', 'choix', 'valide'));

-- ── 3. Remet le default à la nouvelle valeur ────────────────────────────
ALTER TABLE projet_musique_livrable_link
  ALTER COLUMN statut_local SET DEFAULT 'proposition';

COMMENT ON COLUMN projet_musique_livrable_link.statut_local IS
  'MUSIQUES MUS-6.8 — Stade interne de sélection pour ce couple track+livrable. '
  '3 valeurs : proposition (candidate par défaut), choix (shortlist), valide '
  '(track tranchée pour ce livrable). La validation client + droits/labels '
  'sera gérée à part dans l''onglet Autorisations futur.';

COMMIT;
