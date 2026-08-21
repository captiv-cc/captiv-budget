-- ════════════════════════════════════════════════════════════════════════════
-- CONTENUS — listes de référence (espaces, photographes, suivi)
-- Date      : 2026-08-21
-- ════════════════════════════════════════════════════════════════════════════
--
-- Retours Hugo sur la V1 : le dropdown natif (datalist) est inutilisable, et
-- il faut pouvoir GÉRER les listes — pas seulement suggérer ce qui a déjà
-- été tapé. Les contenus ne sont d'ailleurs pas tous rattachés à une scène :
-- le camping, le village ou le site concert sont des lieux de captation au
-- même titre. « scene » devient donc « espace ».
--
--   1. renommage scene → espace (la colonne est vide à ce stade) ;
--   2. table de listes par projet, alimentée à la volée depuis les champs.
--
-- Les valeurs restent propres au module : le festival gère ses espaces et
-- ses photographes sans toucher à la techlist ni au déroulé (l'UI propose
-- les scènes du déroulé en amorce, mais ne les impose pas).
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. scene → espace ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'projet_contenus' AND column_name = 'scene'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'projet_contenus' AND column_name = 'espace'
  ) THEN
    ALTER TABLE projet_contenus RENAME COLUMN scene TO espace;
  END IF;
END $$;

COMMENT ON COLUMN projet_contenus.espace IS
  'Lieu de captation : scène, mais aussi camping, village, site concert…';

-- ── 2. Listes de référence ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projet_contenu_refs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 'espace' | 'photographe' | 'suivi' — trois listes indépendantes.
  kind       text NOT NULL CHECK (kind IN ('espace', 'photographe', 'suivi')),
  valeur     text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Pas de doublon à la casse près : « Chateau » et « chateau » casseraient
-- les regroupements et les filtres.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contenu_refs_unique
  ON projet_contenu_refs(project_id, kind, lower(valeur));
CREATE INDEX IF NOT EXISTS idx_contenu_refs_project
  ON projet_contenu_refs(project_id, kind);

COMMENT ON TABLE projet_contenu_refs IS
  'Listes déroulantes du module Contenus (espaces, photographes, suivi). Alimentées à la volée depuis les champs de saisie.';

ALTER TABLE projet_contenu_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_contenu_refs_read"   ON projet_contenu_refs;
DROP POLICY IF EXISTS "projet_contenu_refs_insert" ON projet_contenu_refs;
DROP POLICY IF EXISTS "projet_contenu_refs_update" ON projet_contenu_refs;
DROP POLICY IF EXISTS "projet_contenu_refs_delete" ON projet_contenu_refs;

CREATE POLICY "projet_contenu_refs_read" ON projet_contenu_refs
  FOR SELECT USING (can_read_outil(project_id, 'contenus'));
CREATE POLICY "projet_contenu_refs_insert" ON projet_contenu_refs
  FOR INSERT WITH CHECK (can_edit_outil(project_id, 'contenus'));
CREATE POLICY "projet_contenu_refs_update" ON projet_contenu_refs
  FOR UPDATE USING (can_edit_outil(project_id, 'contenus'))
  WITH CHECK (can_edit_outil(project_id, 'contenus'));
CREATE POLICY "projet_contenu_refs_delete" ON projet_contenu_refs
  FOR DELETE USING (can_edit_outil(project_id, 'contenus'));

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE projet_contenu_refs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS
-- ============================================================================
-- 1. La colonne projet_contenus.espace existe, scene a disparu.
-- 2. Saisir un photographe inédit dans le formulaire l'ajoute à la liste ;
--    il est proposé au contenu suivant.
-- 3. Deux casses différentes du même espace sont refusées par l'index.
-- ============================================================================
