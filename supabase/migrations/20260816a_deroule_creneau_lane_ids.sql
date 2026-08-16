-- ════════════════════════════════════════════════════════════════════════════
-- DÉROULÉ — Créneaux multi-colonnes (lane_ids)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Demande Hugo 16/08 : un créneau peut concerner PLUSIEURS colonnes précises
-- (ex : un bloc pour 3 cadreurs) — entre le mono-lane (lane_id) et le
-- multi_lane « toutes les colonnes ». Décision : multi-ASSIGNATION réelle
-- (liste de lanes), la contiguïté n'est qu'une affaire d'affichage :
--   - lanes contiguës dans l'ordre courant → un seul bloc large ;
--   - non contiguës → copies synchronisées avec indicateur (même créneau).
--
-- Sémantique :
--   - lane_ids NULL            → comportement historique (lane_id ou multi_lane)
--   - lane_ids (2+ éléments)   → créneau multi-colonnes ; lane_id = ANCRE
--     (première lane dans l'ordre des colonnes) pour la rétro-compat des
--     surfaces non migrées (liste, cadreur, exports) ; multi_lane = false.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE projet_deroule_creneaux
  ADD COLUMN IF NOT EXISTS lane_ids uuid[];

COMMENT ON COLUMN projet_deroule_creneaux.lane_ids IS
  'Multi-colonnes : liste des lanes assignées (2+). NULL = mono-lane (lane_id) ou multi_lane. lane_id reste l''ancre.';
