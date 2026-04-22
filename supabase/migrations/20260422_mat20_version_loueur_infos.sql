-- ============================================================================
-- MAT-20 — Infos logistique loueurs (per-version)
-- ============================================================================
--
-- Contexte : sur un tournage, chaque loueur a des infos logistiques propres
-- au projet courant qu'on veut voir apparaître en tête des exports PDF :
-- horaires de retrait, adresse précise, modalités de caution, contact
-- chantier, etc. Ces infos ne sont PAS permanentes (elles changent d'un
-- projet à l'autre) → on les stocke en pivot `matos_version_loueur_infos`
-- (version_id, loueur_id) → `infos_logistique text`.
--
-- Rendu UI (choix Hugo AskUserQuestion MAT-20) :
--   - PDF par loueur (exportMatosLoueurSinglePDF + exportMatosLoueursPDF) ✓
--   - PDF global (exportMatosListePDF) — bloc consolidé en tête ✓
--   - Slide-over LoueurRecapPanel : NON (l'édition y vit, mais pas le rendu
--     en mode browsing — pas de clutter).
--
-- Portée :
--   - Un couple (version, loueur) a au plus une ligne (UNIQUE).
--   - ON DELETE CASCADE sur les deux FK : si on supprime une version OU
--     un fournisseur, les infos disparaissent avec (elles n'ont plus de
--     sens sans leur contexte).
--   - `infos_logistique` est NOT NULL mais peut être vide — on évite de
--     gérer NULL-vs-empty-string côté client (toujours un `text`).
--
-- RLS : même pattern que les autres matos_* tables, on dérive l'accès via
--       matos_versions.project_id → can_read_outil / can_edit_outil.
--
-- Dépend de :
--   - 20260421_mat_refonte_blocs.sql  (matos_versions.project_id)
--   - 20260420_mat1_materiel_schema.sql (fournisseurs.is_loueur_matos)
--   - can_read_outil / can_edit_outil (permissions.sql)
--   - _check_fetch_bundle (20260422_mat14_authed_check_session.sql)
-- ============================================================================

BEGIN;

-- ── 1. Table matos_version_loueur_infos ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS matos_version_loueur_infos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        uuid NOT NULL REFERENCES matos_versions(id) ON DELETE CASCADE,
  loueur_id         uuid NOT NULL REFERENCES fournisseurs(id)   ON DELETE CASCADE,
  infos_logistique  text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (version_id, loueur_id)
);

CREATE INDEX IF NOT EXISTS matos_version_loueur_infos_version_idx
  ON matos_version_loueur_infos(version_id);
CREATE INDEX IF NOT EXISTS matos_version_loueur_infos_loueur_idx
  ON matos_version_loueur_infos(loueur_id);

DROP TRIGGER IF EXISTS matos_version_loueur_infos_updated_at
  ON matos_version_loueur_infos;
CREATE TRIGGER matos_version_loueur_infos_updated_at
  BEFORE UPDATE ON matos_version_loueur_infos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE matos_version_loueur_infos IS
  'MAT-20 : texte libre d''infos logistique par couple (version, loueur). Rendu en tête des PDFs par loueur et du PDF global. Une ligne par couple max (UNIQUE).';
COMMENT ON COLUMN matos_version_loueur_infos.infos_logistique IS
  'Texte libre multi-ligne. Ex: "Retrait mercredi 23/04 avant 10h chez TSF Jean Jaurès. Caution 20k€ CB. Contact: Jean-Pierre 06xx." Peut être vide (chaîne vide, pas NULL).';


-- ── 2. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE matos_version_loueur_infos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_vli_scoped_read"  ON matos_version_loueur_infos;
DROP POLICY IF EXISTS "matos_vli_scoped_write" ON matos_version_loueur_infos;

CREATE POLICY "matos_vli_scoped_read" ON matos_version_loueur_infos
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_version_loueur_infos.version_id
      AND can_read_outil(mv.project_id, 'materiel')
  ));

CREATE POLICY "matos_vli_scoped_write" ON matos_version_loueur_infos
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_version_loueur_infos.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_version_loueur_infos.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ));


-- ── 3. Rewire _check_fetch_bundle pour inclure version_loueur_infos ─────────
-- On ajoute la clé `version_loueur_infos` au bundle JSON pour que le chemin
-- /check/:token puisse lire ces infos sans round-trip supplémentaire (rendu
-- PDF par loueur côté navigateur, même shape que la route authed).
--
-- Note : on ne renvoie que les lignes pour lesquelles un loueur est
-- effectivement tagué sur la version (même filtre que `loueurs`), pour
-- éviter de renvoyer des infos orphelines si un fournisseur a été
-- dé-taggué de tous les items sans que la ligne d'infos ait été purgée.
CREATE OR REPLACE FUNCTION _check_fetch_bundle(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_check_fetch_bundle$
DECLARE
  v_project_id uuid;
  v_result     jsonb;
BEGIN
  SELECT project_id INTO v_project_id
    FROM matos_versions WHERE id = p_version_id;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'version introuvable' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'version', (
      SELECT jsonb_build_object(
        'id', mv.id,
        'project_id', mv.project_id,
        'numero', mv.numero,
        'label', mv.label,
        'notes', mv.notes,
        'is_active', mv.is_active,
        'closed_at', mv.closed_at,
        'closed_by_name', mv.closed_by_name,
        'bilan_archive_path', mv.bilan_archive_path
      )
      FROM matos_versions mv WHERE mv.id = p_version_id
    ),
    'project', (
      SELECT jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'ref_projet', p.ref_projet
      )
      FROM projects p WHERE p.id = v_project_id
    ),
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', mb.id,
          'titre', mb.titre,
          'couleur', mb.couleur,
          'affichage', mb.affichage,
          'sort_order', mb.sort_order
        ) ORDER BY mb.sort_order, mb.created_at
      )
      FROM matos_blocks mb WHERE mb.version_id = p_version_id
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', mi.id,
          'block_id', mi.block_id,
          'materiel_bdd_id', mi.materiel_bdd_id,
          'label', mi.label,
          'designation', mi.designation,
          'quantite', mi.quantite,
          'remarques', mi.remarques,
          'flag', mi.flag,
          'pre_check_at', mi.pre_check_at,
          'pre_check_by', mi.pre_check_by,
          'pre_check_by_name', mi.pre_check_by_name,
          'added_during_check', mi.added_during_check,
          'added_by', mi.added_by,
          'added_by_name', mi.added_by_name,
          'added_at', mi.added_at,
          'removed_at', mi.removed_at,
          'removed_by_name', mi.removed_by_name,
          'removed_reason', mi.removed_reason,
          'sort_order', mi.sort_order
        ) ORDER BY mi.sort_order, mi.created_at
      )
      FROM matos_items mi
      JOIN matos_blocks mb ON mb.id = mi.block_id
      WHERE mb.version_id = p_version_id
    ), '[]'::jsonb),
    'loueurs', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'nom', f.nom,
          'couleur', f.couleur
        )
      )
      FROM fournisseurs f
      WHERE f.id IN (
        SELECT DISTINCT mil.loueur_id
          FROM matos_item_loueurs mil
          JOIN matos_items mi  ON mi.id = mil.item_id
          JOIN matos_blocks mb ON mb.id = mi.block_id
         WHERE mb.version_id = p_version_id
      )
    ), '[]'::jsonb),
    'item_loueurs', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', mil.id,
          'item_id', mil.item_id,
          'loueur_id', mil.loueur_id,
          'numero_reference', mil.numero_reference,
          'sort_order', mil.sort_order
        )
      )
      FROM matos_item_loueurs mil
      JOIN matos_items  mi ON mi.id = mil.item_id
      JOIN matos_blocks mb ON mb.id = mi.block_id
      WHERE mb.version_id = p_version_id
    ), '[]'::jsonb),
    'version_loueur_infos', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', vli.id,
          'version_id', vli.version_id,
          'loueur_id', vli.loueur_id,
          'infos_logistique', vli.infos_logistique,
          'updated_at', vli.updated_at
        )
      )
      FROM matos_version_loueur_infos vli
      WHERE vli.version_id = p_version_id
    ), '[]'::jsonb),
    'comments', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', mc.id,
          'item_id', mc.item_id,
          'body', mc.body,
          'author_id', mc.author_id,
          'author_name', mc.author_name,
          'created_at', mc.created_at
        ) ORDER BY mc.created_at
      )
      FROM matos_item_comments mc
      JOIN matos_items  mi ON mc.item_id = mi.id
      JOIN matos_blocks mb ON mb.id = mi.block_id
      WHERE mb.version_id = p_version_id
    ), '[]'::jsonb),
    'attachments', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ma.id,
          'version_id', ma.version_id,
          'title', ma.title,
          'filename', ma.filename,
          'storage_path', ma.storage_path,
          'size_bytes', ma.size_bytes,
          'mime_type', ma.mime_type,
          'uploaded_by_name', ma.uploaded_by_name,
          'created_at', ma.created_at
        ) ORDER BY ma.created_at
      )
      FROM matos_version_attachments ma
      WHERE ma.version_id = p_version_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$_check_fetch_bundle$;

REVOKE ALL ON FUNCTION _check_fetch_bundle(uuid) FROM PUBLIC;

COMMIT;
