-- ============================================================================
-- Migration : PLANS CANVAS V1 — Plans techniques éditables (tldraw + Yjs)
-- Date      : 2026-07-05
-- Chantier  : docs/CHANTIER_PLANS.md
-- ============================================================================
--
-- Contexte :
--   PLANS V1 (20260504) = bibliothèque de FICHIERS (upload PDF/PNG/JPG).
--   Ce chantier ajoute les plans ÉDITABLES : documents dessinés dans un
--   canvas tldraw, collaboratifs en temps réel via Yjs + Supabase Realtime
--   broadcast (pattern useYjsCollab des Notes déroulé).
--
-- Architecture :
--   - plans_canvas          : un document canvas par row, scopé projet.
--                             fond_id → plans(id) : un fichier importé de la
--                             bibliothèque existante peut servir de fond.
--   - plans_canvas_versions : snapshots figés ("Créer une version", Phase 2).
--   - PAS de table plans_fonds : la table plans existante EST la
--     bibliothèque de fonds importés.
--   - PAS de bucket à créer : les fonds vivent dans le bucket plans existant.
--
-- Persistance du document :
--   ydoc_state = Y.encodeStateAsUpdate(doc) encodé base64 (colonne text).
--   Choix pragmatique vs bytea : supabase-js manipule mal le binaire brut,
--   et l'overhead base64 (~33%) est négligeable à l'échelle de ces docs.
--   L'autosave écrase ydoc_state ; les versions figées vont dans
--   plans_canvas_versions.
--
-- RLS : pattern outils existant — can_read_outil / can_edit_outil
--   (project_id, 'plans'). Même outil que les fonds : pas de nouvelle entrée
--   outils_catalogue.
--
-- Realtime : PAS de publication postgres_changes ici — la collab passe par
--   les channels broadcast Yjs (plan-canvas:<id>), pas par la table.
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS.
-- ============================================================================

BEGIN;


-- ── 1. Table plans_canvas — un plan éditable ────────────────────────────────
CREATE TABLE IF NOT EXISTS plans_canvas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  titre            text NOT NULL,
  description      text,
  category_id      uuid REFERENCES plan_categories(id) ON DELETE SET NULL,
  fond_id          uuid REFERENCES plans(id) ON DELETE SET NULL,
  ydoc_state       text,
  snapshot_svg     text,
  echelle_ratio    numeric,
  version_current  integer NOT NULL DEFAULT 1,
  statut           text NOT NULL DEFAULT 'brouillon'
                   CHECK (statut IN ('brouillon', 'partage_client', 'valide', 'archive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS plans_canvas_project_idx
  ON plans_canvas(project_id) WHERE statut != 'archive';

DROP TRIGGER IF EXISTS plans_canvas_updated_at ON plans_canvas;
CREATE TRIGGER plans_canvas_updated_at
  BEFORE UPDATE ON plans_canvas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE plans_canvas IS
  'Plans techniques ÉDITABLES (canvas tldraw collaboratif). Distinct de plans (fichiers importés, qui servent de fonds via fond_id). Cf. docs/CHANTIER_PLANS.md.';
COMMENT ON COLUMN plans_canvas.ydoc_state IS
  'État Yjs du document (Y.encodeStateAsUpdate) encodé base64. Écrasé par l''autosave (~2s après la dernière modif). Les snapshots figés sont dans plans_canvas_versions.';
COMMENT ON COLUMN plans_canvas.fond_id IS
  'Fichier de la bibliothèque de fonds (table plans) utilisé comme background du canvas. NULL = canvas vierge.';
COMMENT ON COLUMN plans_canvas.snapshot_svg IS
  'SVG rendu du plan pour la preview miniature de la liste (Phase 2 : généré au save).';
COMMENT ON COLUMN plans_canvas.echelle_ratio IS
  'Échelle du plan : 1 unité canvas = X mètres (Phase 4 : cotations, surfaces).';
COMMENT ON COLUMN plans_canvas.statut IS
  'brouillon → partage_client (un token client actif) → valide (validé par le client). archive = soft delete.';


-- ── 2. Table plans_canvas_versions — snapshots figés ────────────────────────
CREATE TABLE IF NOT EXISTS plans_canvas_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id     uuid NOT NULL REFERENCES plans_canvas(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  ydoc_state    text,
  snapshot_svg  text,
  commentaire   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (canvas_id, version)
);

CREATE INDEX IF NOT EXISTS plans_canvas_versions_canvas_idx
  ON plans_canvas_versions(canvas_id);

COMMENT ON TABLE plans_canvas_versions IS
  'Snapshots figés d''un plan éditable ("Créer une version"). La version courante vit dans plans_canvas (ydoc_state + version_current) ; ici uniquement les états figés manuellement.';
COMMENT ON COLUMN plans_canvas_versions.commentaire IS
  'Note libre au moment du figeage ("Envoyé au client", "Config validée DOP", …).';


-- ── 3. RLS — plans_canvas (via outil 'plans' scopé projet) ──────────────────
ALTER TABLE plans_canvas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_canvas_scoped_read"  ON plans_canvas;
DROP POLICY IF EXISTS "plans_canvas_scoped_write" ON plans_canvas;

CREATE POLICY "plans_canvas_scoped_read" ON plans_canvas
  FOR SELECT
  USING (can_read_outil(project_id, 'plans'));

CREATE POLICY "plans_canvas_scoped_write" ON plans_canvas
  FOR ALL
  USING      (can_edit_outil(project_id, 'plans'))
  WITH CHECK (can_edit_outil(project_id, 'plans'));


-- ── 4. RLS — plans_canvas_versions (via canvas_id → plans_canvas) ───────────
ALTER TABLE plans_canvas_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_canvas_versions_scoped_read"  ON plans_canvas_versions;
DROP POLICY IF EXISTS "plans_canvas_versions_scoped_write" ON plans_canvas_versions;

CREATE POLICY "plans_canvas_versions_scoped_read" ON plans_canvas_versions
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM plans_canvas c
    WHERE c.id = plans_canvas_versions.canvas_id
      AND can_read_outil(c.project_id, 'plans')
  ));

CREATE POLICY "plans_canvas_versions_scoped_write" ON plans_canvas_versions
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM plans_canvas c
    WHERE c.id = plans_canvas_versions.canvas_id
      AND can_edit_outil(c.project_id, 'plans')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plans_canvas c
    WHERE c.id = plans_canvas_versions.canvas_id
      AND can_edit_outil(c.project_id, 'plans')
  ));


COMMIT;
