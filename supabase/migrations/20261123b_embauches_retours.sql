-- ════════════════════════════════════════════════════════════════════════════
-- EMBAUCHES — retours de première prise en main (23/11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Deux corrections de modèle, aucune table nouvelle :
--
--   1. `numero_objet` et `bon_commande` désignaient la même référence. Hugo :
--      « numéro d'objet = bon de commande, c'est la même chose ». On garde
--      `numero_objet` (le vocabulaire France Travail, celui du portail où on
--      va le chercher) et on supprime le doublon après recopie.
--
--   2. `convention` stockait un libellé long saisi à la main. Captiv n'en
--      utilise que deux, et Movinmotion les désigne par leur IDCC : on
--      normalise en '2642' / '3252'. Le front affiche le libellé complet.
--      Cette clé décide aussi si la grille `minimas_convention` (CCN de la
--      production audiovisuelle) s'applique : sous la 3252 elle ne vaut rien.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Fusion bon_commande → numero_objet ───────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'embauche_dossiers'
      AND column_name  = 'bon_commande'
  ) THEN
    EXECUTE $q$
      UPDATE embauche_dossiers
         SET numero_objet = bon_commande
       WHERE COALESCE(numero_objet, '') = ''
         AND COALESCE(bon_commande, '') <> ''
    $q$;
    EXECUTE 'ALTER TABLE embauche_dossiers DROP COLUMN bon_commande';
  END IF;
END $$;

COMMENT ON COLUMN embauche_dossiers.numero_objet IS
  'Numéro d''objet France Travail, qui sert aussi de bon de commande client. Récupéré sur le portail employeur.';

-- ── 2. Conventions normalisées en IDCC ──────────────────────────────────────
UPDATE embauche_dossiers SET convention = '2642'
 WHERE convention IS NOT NULL AND convention <> '2642' AND convention LIKE '%2642%';

UPDATE embauche_dossiers SET convention = '3252'
 WHERE convention IS NOT NULL AND convention <> '3252' AND convention LIKE '%3252%';

COMMENT ON COLUMN embauche_dossiers.convention IS
  'Convention collective par IDCC : 2642 (production audiovisuelle) ou 3252 (entreprises au service de la création et de l''événement).';

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS
-- ============================================================================
-- 1. \d embauche_dossiers ne montre plus de colonne bon_commande.
-- 2. SELECT DISTINCT convention FROM embauche_dossiers; ne rend que
--    '2642', '3252' ou NULL.
-- ============================================================================
