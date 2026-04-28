-- ════════════════════════════════════════════════════════════════════════════
-- LIV-9 — livrable_etapes : assignee_external + event_type_id
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. `assignee_external` (texte libre) — pendant pour les étapes du champ
--    `livrables.assignee_external`. On reste aligné sur le pattern adopté en
--    LIV-7 : `assignee_profile_id` (référence) coexiste avec `assignee_external`
--    (texte libre). L'autocomplete profiles arrivera plus tard sur un ticket
--    dédié.
--
-- 2. `event_type_id` (référence event_types) — pendant la phase de test, Hugo
--    a observé que les étapes héritaient toutes du type "Pré-production" côté
--    planning, alors que les types existent déjà (Dérush, Étalonnage, VFX…).
--    On expose donc directement le choix du type d'event sur l'étape : le
--    dropdown d'étape liste les `event_types` de l'org au lieu d'une enum
--    `kind` figée. La couleur de la carte étape reprend `event_type.color`,
--    cohérente avec ce qui s'affiche sur le planning.
--
--    Le champ `kind` (production / da / montage / sound / delivery / feedback /
--    autre) reste en place pour rétrocompat (il alimente notamment les
--    swimlanes Vague 2 / stats), mais n'est plus exposé dans l'UI LIV-9.
--    On pourra le déprécier plus tard si on confirme qu'il ne sert plus.
--
-- Migrations sans risque (colonnes nullables, table peu peuplée — outil
-- Livrables en cours de mise en route).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE livrable_etapes
  ADD COLUMN IF NOT EXISTS assignee_external text;

COMMENT ON COLUMN livrable_etapes.assignee_external IS
  'Nom d''un responsable externe en texte libre (freelance, presta hors équipe). Coexiste avec assignee_profile_id (référence interne). Si les deux sont remplis, c''est `assignee_profile_id` qui prime côté UI.';

ALTER TABLE livrable_etapes
  ADD COLUMN IF NOT EXISTS event_type_id uuid
    REFERENCES event_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS livrable_etapes_event_type_idx
  ON livrable_etapes(event_type_id) WHERE event_type_id IS NOT NULL;

COMMENT ON COLUMN livrable_etapes.event_type_id IS
  'Type d''event associé à l''étape (référence event_types). Utilisé directement comme `type_id` lors de la création de l''event miroir (sync planning). Permet d''utiliser TOUS les types planning de l''org (Dérush, Étalonnage, VFX, types custom…) au lieu d''une enum figée. Le champ `kind` reste pour rétrocompat / swimlanes.';
