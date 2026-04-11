-- ─────────────────────────────────────────────────────────────────────────────
-- Fix contrainte CHECK sur devis_lines.regime
-- Les nouvelles CAT (Frais, Technique, Externe, Interne...)  ne sont pas
-- dans l'ancienne contrainte → violation à chaque INSERT de nouvelle ligne.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Supprimer l'ancienne contrainte
ALTER TABLE devis_lines DROP CONSTRAINT IF EXISTS devis_lines_regime_check;

-- 2. Ajouter la nouvelle contrainte avec toutes les valeurs :
--    - nouvelles CAT (système actuel)
--    - anciennes valeurs (rétrocompatibilité avec les lignes déjà en base)
ALTER TABLE devis_lines
  ADD CONSTRAINT devis_lines_regime_check CHECK (regime IN (
    -- ── Nouvelles CAT (système actuel) ──────────────────────────────────────
    'Intermittent Technicien',
    'Intermittent Artiste',
    'Ext. Intermittent',
    'Interne',
    'Externe',
    'Technique',
    'Frais',
    -- ── Anciennes valeurs (lignes déjà en base) ─────────────────────────────
    'Salarié CDD',
    'Prestation facturée',
    'Location matériel',
    'Frais divers',
    'Prestation',
    'Intermittent'
  ));
