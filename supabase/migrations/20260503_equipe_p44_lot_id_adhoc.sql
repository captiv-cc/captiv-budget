-- ============================================================================
-- Migration : EQUIPE P4.4 — Lot direct sur projet_membres (rows ad-hoc)
-- Date      : 2026-05-03
-- Contexte  : Les attributions liées à une ligne de devis tirent leur lot du
--             devis_id de leur ligne (lineLotMap côté client). Mais les
--             attributions AD-HOC (ajout direct sans ligne de devis, via le
--             modal "Ajouter à l'équipe") n'ont pas de devis_line_id donc
--             pas de lot — alors qu'en multi-lot l'admin veut souvent
--             rattacher manuellement la personne à un lot précis (ex :
--             "Hugo Martin renfort réseaux sociaux").
--
--             Solution : ajouter une colonne `lot_id` direct sur
--             projet_membres, FK vers devis_lots, NULLABLE. Utilisée
--             uniquement quand devis_line_id IS NULL. Quand devis_line_id
--             est présent, le lot reste dérivé du devis (source de vérité
--             unique pour les rows liées au devis).
--
-- Périmètre :
--   1. Ajout colonne lot_id (idempotent IF NOT EXISTS)
--   2. FK vers devis_lots(id) ON DELETE SET NULL (si le lot est supprimé,
--      les rows orphelines retombent en "À trier" sans lot)
--   3. Index pour les filtres par lot
--   4. NOTIFY pgrst pour exposer le nouveau champ via PostgREST
--
-- Sécurité : la policy RLS existante `projet_membres_org` couvre
-- automatiquement la nouvelle colonne (filtre par project_id → org).
-- ============================================================================

BEGIN;

-- ── 1. Ajout colonne lot_id ─────────────────────────────────────────────────
ALTER TABLE projet_membres
  ADD COLUMN IF NOT EXISTS lot_id UUID;

-- ── 2. FK vers devis_lots ───────────────────────────────────────────────────
-- Pattern idempotent : DROP+ADD via DO bloc pour éviter "constraint already
-- exists" si la migration est rejouée.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'projet_membres_lot_id_fkey'
      AND table_name = 'projet_membres'
  ) THEN
    ALTER TABLE projet_membres DROP CONSTRAINT projet_membres_lot_id_fkey;
  END IF;
  ALTER TABLE projet_membres
    ADD CONSTRAINT projet_membres_lot_id_fkey
    FOREIGN KEY (lot_id) REFERENCES devis_lots(id) ON DELETE SET NULL;
END;
$$;

-- ── 3. Index pour le filtre par lot (vue Crew list / Attribution) ───────────
CREATE INDEX IF NOT EXISTS idx_projet_membres_lot_id
  ON projet_membres(lot_id)
  WHERE lot_id IS NOT NULL;

-- ── 4. Reload PostgREST pour exposer la nouvelle colonne ────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérification post-migration :
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'projet_membres' AND column_name = 'lot_id';
--
--   -- doit afficher : lot_id | uuid | YES
-- ============================================================================
