-- ═══════════════════════════════════════════════════════════════════════════
-- MUS-6.9 — Drop colonne statut de projet_musique_propositions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Le workflow vit désormais au niveau du couple track × livrable via
-- projet_musique_livrable_link.statut_local (3 stades : proposition / choix
-- / valide). Les statuts globaux par track (vrac / sélectionné / validé
-- festival / en nego / accordé / refusé) étaient devenus :
--   - redondants pour 'sélectionné' et 'validé festival' (couverts par les
--     stades par livrable)
--   - prématurés pour 'en nego' / 'accordé' / 'refusé' (ils iront dans
--     l'onglet Autorisations en V2 — cf. docs/CHANTIER_MUS-7_AUTORISATIONS.md)
--
-- On supprime donc proprement la colonne. Le CHECK constraint et le DEFAULT
-- partent avec elle.
--
-- IRREVERSIBLE : drop de colonne. À tester sur staging avant prod.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop la colonne (cascade le CHECK + DEFAULT + tout index éventuel).
ALTER TABLE projet_musique_propositions
  DROP COLUMN IF EXISTS statut;

COMMIT;
