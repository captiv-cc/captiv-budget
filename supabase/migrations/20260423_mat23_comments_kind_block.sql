-- ============================================================================
-- Migration : MAT-23A — Commentaires avec `kind` + ancrage bloc
-- Date      : 2026-04-23
-- Contexte  : Refonte UX checklist terrain — un seul menu "⋯" par item/bloc
--             qui expose 3 actions séparées "Signaler", "Photos pack" et
--             "Commentaires". Pour que le bilan loueur PDF puisse ne montrer
--             QUE les signalements (et pas les notes d'équipe interne), il
--             faut distinguer les deux kinds côté DB. Et pour que l'utilisateur
--             puisse aussi signaler/commenter un BLOC entier (ex. pelicase
--             fissuré, note sur la remballe d'un pack), on autorise l'ancrage
--             block_id en plus de item_id (XOR).
--
--             Ce qu'on ajoute :
--               1. Colonne `kind text` sur matos_item_comments
--                  ('probleme' | 'note', défaut 'note' pour le backfill)
--               2. Colonne `block_id uuid` nullable + FK matos_blocks
--               3. item_id devient nullable + CHECK XOR sur les 2 ancrages
--               4. Index sur block_id
--               5. RLS élargies pour gérer l'ancrage bloc
--               6. RPC check_action_add_comment* rewritée (DROP + CREATE avec
--                  nouvelle signature : p_kind + p_block_id)
--               7. _check_fetch_bundle : ajoute kind et block_id au payload
--
-- Idempotent : ADD COLUMN IF NOT EXISTS, DO $$ BEGIN ... EXCEPTION pour le
--              CHECK, DROP POLICY IF EXISTS, CREATE OR REPLACE FUNCTION,
--              DROP FUNCTION IF EXISTS avant redéfinition si signature change.
-- Dépend de  : 20260421_mat10_checklist_terrain.sql,
--              20260422_mat14_authed_check_session.sql,
--              20260423_mat11_photos.sql.
-- ============================================================================

BEGIN;

-- ── 1. Schema changes : kind + block_id + XOR ancrage ─────────────────────

ALTER TABLE matos_item_comments
  ADD COLUMN IF NOT EXISTS kind     text NOT NULL DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES matos_blocks(id) ON DELETE CASCADE;

-- CHECK sur kind (idempotent). Un bloc anonyme + EXCEPTION pour le cas où
-- la contrainte existe déjà (repeat-run safe).
DO $mig$
BEGIN
  BEGIN
    ALTER TABLE matos_item_comments
      ADD CONSTRAINT matos_item_comments_kind_check
        CHECK (kind IN ('probleme', 'note'));
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END
$mig$;

-- item_id devient nullable pour autoriser l'ancrage bloc. On ne supprime
-- PAS les FK existants, ils continuent à valider quand item_id est non-NULL.
ALTER TABLE matos_item_comments
  ALTER COLUMN item_id DROP NOT NULL;

-- XOR ancrage : exactement UN des deux (item_id, block_id) doit être set.
-- Garantit qu'on ne peut pas créer un commentaire "flottant" (les deux NULL)
-- ni "double ancré" (les deux non-NULL).
DO $mig$
BEGIN
  BEGIN
    ALTER TABLE matos_item_comments
      ADD CONSTRAINT matos_item_comments_anchor_xor
        CHECK ((item_id IS NOT NULL) <> (block_id IS NOT NULL));
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END
$mig$;

-- Index secondaire pour la lecture par bloc (thread de notes de bloc).
CREATE INDEX IF NOT EXISTS matos_item_comments_block_idx
  ON matos_item_comments(block_id, created_at)
  WHERE block_id IS NOT NULL;

-- Index de kind pour permettre des count() rapides (badges UI) et filtrage
-- "afficher que les signalements" dans les exports PDF.
CREATE INDEX IF NOT EXISTS matos_item_comments_kind_idx
  ON matos_item_comments(kind);

COMMENT ON COLUMN matos_item_comments.kind IS
  'probleme = signalement loueur (apparait dans bilan PDF). note = commentaire interne équipe (NE sort PAS du cadre interne).';
COMMENT ON COLUMN matos_item_comments.block_id IS
  'Ancrage bloc entier (remballe / pelicase). XOR avec item_id : exactement un des deux set.';


-- ── 2. RLS — élargir les policies pour gérer l'ancrage bloc ──────────────
-- Les anciennes policies filtraient uniquement via item_id → matos_items →
-- matos_blocks → matos_versions. On réécrit pour accepter soit item_id
-- (même chaîne) soit block_id (directement vers matos_blocks → matos_versions).

DROP POLICY IF EXISTS "matos_item_comments_scoped_read"  ON matos_item_comments;
DROP POLICY IF EXISTS "matos_item_comments_scoped_write" ON matos_item_comments;

CREATE POLICY "matos_item_comments_scoped_read" ON matos_item_comments
  FOR SELECT
  USING (
    -- Cas A : commentaire ancré sur un item
    (item_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM matos_items  mi
        JOIN matos_blocks mb ON mb.id = mi.block_id
        JOIN matos_versions mv ON mv.id = mb.version_id
       WHERE mi.id = matos_item_comments.item_id
         AND can_read_outil(mv.project_id, 'materiel')
    ))
    OR
    -- Cas B : commentaire ancré sur un bloc
    (block_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM matos_blocks mb
        JOIN matos_versions mv ON mv.id = mb.version_id
       WHERE mb.id = matos_item_comments.block_id
         AND can_read_outil(mv.project_id, 'materiel')
    ))
  );

CREATE POLICY "matos_item_comments_scoped_write" ON matos_item_comments
  FOR ALL
  USING (
    (item_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM matos_items  mi
        JOIN matos_blocks mb ON mb.id = mi.block_id
        JOIN matos_versions mv ON mv.id = mb.version_id
       WHERE mi.id = matos_item_comments.item_id
         AND can_edit_outil(mv.project_id, 'materiel')
    ))
    OR
    (block_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM matos_blocks mb
        JOIN matos_versions mv ON mv.id = mb.version_id
       WHERE mb.id = matos_item_comments.block_id
         AND can_edit_outil(mv.project_id, 'materiel')
    ))
  )
  WITH CHECK (
    (item_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM matos_items  mi
        JOIN matos_blocks mb ON mb.id = mi.block_id
        JOIN matos_versions mv ON mv.id = mb.version_id
       WHERE mi.id = matos_item_comments.item_id
         AND can_edit_outil(mv.project_id, 'materiel')
    ))
    OR
    (block_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM matos_blocks mb
        JOIN matos_versions mv ON mv.id = mb.version_id
       WHERE mb.id = matos_item_comments.block_id
         AND can_edit_outil(mv.project_id, 'materiel')
    ))
  );


-- ── 3. _check_fetch_bundle : ajoute kind + block_id aux comments ─────────
-- Le bundle est partagé entre check_session_fetch (token) et
-- check_session_fetch_authed. On repart de la shape EXACTE laissée par MAT-11A
-- (section 13 de 20260423_mat11_photos.sql) et on ne change QUE la section
-- 'comments' : ajout des clés kind + block_id, et UNION ALL pour inclure les
-- comments ancrés au bloc (en plus de ceux ancrés à un item).
-- ATTENTION : toute divergence avec MAT-11A casserait le front (le bundle
-- sert ET check_session_fetch ET check_session_fetch_authed).
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
    -- MAT-23A : inclure kind et block_id. UNION ALL pour agréger les
    -- comments ancrés item ET ceux ancrés bloc (XOR garanti côté DB).
    'comments', COALESCE((
      SELECT jsonb_agg(c ORDER BY (c->>'created_at')::timestamptz)
      FROM (
        SELECT jsonb_build_object(
          'id', mc.id,
          'item_id', mc.item_id,
          'block_id', mc.block_id,
          'kind', mc.kind,
          'body', mc.body,
          'author_id', mc.author_id,
          'author_name', mc.author_name,
          'created_at', mc.created_at
        ) AS c
        FROM matos_item_comments mc
        JOIN matos_items  mi ON mc.item_id = mi.id
        JOIN matos_blocks mb ON mb.id = mi.block_id
        WHERE mb.version_id = p_version_id

        UNION ALL

        SELECT jsonb_build_object(
          'id', mc.id,
          'item_id', mc.item_id,
          'block_id', mc.block_id,
          'kind', mc.kind,
          'body', mc.body,
          'author_id', mc.author_id,
          'author_name', mc.author_name,
          'created_at', mc.created_at
        ) AS c
        FROM matos_item_comments mc
        JOIN matos_blocks mb ON mb.id = mc.block_id
        WHERE mb.version_id = p_version_id
      ) sub
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
    ), '[]'::jsonb),
    'photos', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', mp.id,
          'version_id', mp.version_id,
          'item_id', mp.item_id,
          'block_id', mp.block_id,
          'kind', mp.kind,
          'storage_path', mp.storage_path,
          'mime_type', mp.mime_type,
          'size_bytes', mp.size_bytes,
          'width', mp.width,
          'height', mp.height,
          'caption', mp.caption,
          'uploaded_by', mp.uploaded_by,
          'uploaded_by_name', mp.uploaded_by_name,
          'created_at', mp.created_at
        ) ORDER BY mp.created_at
      )
      FROM matos_item_photos mp
      WHERE mp.version_id = p_version_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$_check_fetch_bundle$;

REVOKE ALL ON FUNCTION _check_fetch_bundle(uuid) FROM PUBLIC;


-- ── 4. RPC token — check_action_add_comment (nouvelle signature) ─────────
-- DROP + CREATE car changement de signature (ajout de p_kind et p_block_id).
-- Le client est mis à jour en même temps (pas de support multi-versions).

DROP FUNCTION IF EXISTS check_action_add_comment(text, uuid, text, text);

CREATE OR REPLACE FUNCTION check_action_add_comment(
  p_token     text,
  p_item_id   uuid,
  p_block_id  uuid,
  p_kind      text,
  p_body      text,
  p_user_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_add_comment$
DECLARE
  v_version_id uuid;
  v_anchor_version uuid;
  v_new_id uuid;
  v_clean_body text;
  v_clean_name text;
  v_clean_kind text;
  v_now timestamptz;
BEGIN
  v_version_id := _check_token_get_version_id(p_token);

  -- XOR : exactement un ancrage.
  IF (p_item_id IS NOT NULL) = (p_block_id IS NOT NULL) THEN
    RAISE EXCEPTION 'exactement un ancrage (item_id XOR block_id) requis' USING ERRCODE = '22023';
  END IF;

  -- Kind normalisé.
  v_clean_kind := COALESCE(NULLIF(trim(p_kind), ''), 'note');
  IF v_clean_kind NOT IN ('probleme', 'note') THEN
    RAISE EXCEPTION 'kind invalide (probleme|note)' USING ERRCODE = '22023';
  END IF;

  -- Résout la version de l'ancrage et vérifie qu'elle == version du token.
  IF p_item_id IS NOT NULL THEN
    SELECT mb.version_id INTO v_anchor_version
      FROM matos_items mi
      JOIN matos_blocks mb ON mb.id = mi.block_id
     WHERE mi.id = p_item_id;
    IF v_anchor_version IS NULL THEN
      RAISE EXCEPTION 'item introuvable' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT version_id INTO v_anchor_version
      FROM matos_blocks WHERE id = p_block_id;
    IF v_anchor_version IS NULL THEN
      RAISE EXCEPTION 'bloc introuvable' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_anchor_version <> v_version_id THEN
    RAISE EXCEPTION 'ancrage hors de cette version' USING ERRCODE = '22023';
  END IF;

  v_clean_body := NULLIF(trim(p_body), '');
  IF v_clean_body IS NULL THEN
    RAISE EXCEPTION 'body required' USING ERRCODE = '23502';
  END IF;

  v_clean_name := COALESCE(NULLIF(trim(p_user_name), ''), 'Anonyme');

  INSERT INTO matos_item_comments (item_id, block_id, kind, body, author_id, author_name)
  VALUES (p_item_id, p_block_id, v_clean_kind, v_clean_body, NULL, v_clean_name)
  RETURNING id, created_at INTO v_new_id, v_now;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'item_id', p_item_id,
    'block_id', p_block_id,
    'kind', v_clean_kind,
    'body', v_clean_body,
    'author_id', NULL,
    'author_name', v_clean_name,
    'created_at', v_now
  );
END;
$check_action_add_comment$;

REVOKE ALL ON FUNCTION check_action_add_comment(text, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_add_comment(text, uuid, uuid, text, text, text) TO anon, authenticated;


-- ── 5. RPC authed — check_action_add_comment_authed (nouvelle signature) ─

DROP FUNCTION IF EXISTS check_action_add_comment_authed(uuid, text);

CREATE OR REPLACE FUNCTION check_action_add_comment_authed(
  p_item_id  uuid,
  p_block_id uuid,
  p_kind     text,
  p_body     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_add_comment_authed$
DECLARE
  v_anchor_version uuid;
  v_user_name      text;
  v_new_id         uuid;
  v_clean_body     text;
  v_clean_kind     text;
  v_now            timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF (p_item_id IS NOT NULL) = (p_block_id IS NOT NULL) THEN
    RAISE EXCEPTION 'exactement un ancrage (item_id XOR block_id) requis' USING ERRCODE = '22023';
  END IF;

  v_clean_kind := COALESCE(NULLIF(trim(p_kind), ''), 'note');
  IF v_clean_kind NOT IN ('probleme', 'note') THEN
    RAISE EXCEPTION 'kind invalide (probleme|note)' USING ERRCODE = '22023';
  END IF;

  IF p_item_id IS NOT NULL THEN
    SELECT mb.version_id INTO v_anchor_version
      FROM matos_items mi
      JOIN matos_blocks mb ON mb.id = mi.block_id
     WHERE mi.id = p_item_id;
    IF v_anchor_version IS NULL THEN
      RAISE EXCEPTION 'item introuvable' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT version_id INTO v_anchor_version
      FROM matos_blocks WHERE id = p_block_id;
    IF v_anchor_version IS NULL THEN
      RAISE EXCEPTION 'bloc introuvable' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM _check_authed_gate_edit(v_anchor_version);

  v_clean_body := NULLIF(trim(p_body), '');
  IF v_clean_body IS NULL THEN
    RAISE EXCEPTION 'body required' USING ERRCODE = '23502';
  END IF;

  v_user_name := _check_authed_user_name();

  INSERT INTO matos_item_comments (item_id, block_id, kind, body, author_id, author_name)
  VALUES (p_item_id, p_block_id, v_clean_kind, v_clean_body, auth.uid(), v_user_name)
  RETURNING id, created_at INTO v_new_id, v_now;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'item_id', p_item_id,
    'block_id', p_block_id,
    'kind', v_clean_kind,
    'body', v_clean_body,
    'author_id', auth.uid(),
    'author_name', v_user_name,
    'created_at', v_now
  );
END;
$check_action_add_comment_authed$;

REVOKE ALL ON FUNCTION check_action_add_comment_authed(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_add_comment_authed(uuid, uuid, text, text) TO authenticated;


COMMIT;
