-- ════════════════════════════════════════════════════════════════════════════
-- EMBAUCHES — le bon de commande revient
-- ════════════════════════════════════════════════════════════════════════════
--
-- 20261123b avait fusionné `bon_commande` dans `numero_objet` sur la foi d'un
-- retour. Correction de Hugo le même jour : ce sont deux références
-- distinctes.
--
--   - `numero_objet`  : attribué par France Travail, sert à la déclaration.
--   - `bon_commande`  : référence du client (« BC / Réf. projet »), sert à la
--                       facturation.
--
-- La colonne est recréée vide. Aucun dossier n'avait pu être enregistré avant
-- la correction du 23/11 (les listes client et projet échouaient), donc rien
-- à récupérer.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE embauche_dossiers
  ADD COLUMN IF NOT EXISTS bon_commande text;

COMMENT ON COLUMN embauche_dossiers.bon_commande IS
  'Bon de commande ou référence projet côté client, pour la facturation.';

COMMENT ON COLUMN embauche_dossiers.numero_objet IS
  'Numéro d''objet France Travail, récupéré sur le portail employeur.';

COMMIT;
