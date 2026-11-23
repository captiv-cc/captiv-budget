-- ════════════════════════════════════════════════════════════════════════════
-- 20261123e — La plage de nuit commence à minuit
-- ════════════════════════════════════════════════════════════════════════════
--
-- Retour Hugo (23/11) : en production audiovisuelle, les heures de nuit se
-- comptent à partir de minuit, pas de 22 h. La plage reste un paramètre PAR
-- convention — une convention qui compte la nuit dès 22 h se règle dans
-- « Règles de calcul » sans toucher au code.
--
-- Seule la valeur par défaut de la colonne change. Les lignes déjà
-- enregistrées ne sont pas touchées : une plage saisie à la main est un
-- choix, pas un oubli à corriger. Une organisation qui a déjà réglé ses
-- règles avant cette migration doit donc repasser la plage à la main.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE embauche_params ALTER COLUMN nuit_debut SET DEFAULT '00:00';

COMMENT ON COLUMN embauche_params.nuit_debut IS
  'Début de la plage de nuit. Minuit par défaut (CCN production audiovisuelle).';
COMMENT ON COLUMN embauche_params.nuit_fin IS
  'Fin de la plage de nuit. 6 h par défaut.';
