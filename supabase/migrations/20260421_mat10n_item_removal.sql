-- ============================================================================
-- Migration : MAT-10N — Retrait d'items pendant les essais + suppression additif
-- Date      : 2026-04-21
-- Contexte  : Pendant les essais, on veut pouvoir :
--
--   1. Marquer un item "non pris" (soft) : ex. "on ne prend plus la caméra
--      PLV100 finalement". La ligne reste en base pour apparaître dans le
--      bilan et être exclue de la liste de rendu loueur (MAT-13).
--
--   2. Supprimer réellement un additif (hard DELETE) : quand on s'est trompé
--      en l'ajoutant. Réservé aux items `added_during_check=true`. Pour les
--      items de la liste d'origine, on utilise uniquement le soft-remove.
--
--      Logique métier :
--        - removed_at IS NULL             → item actif, dans le tournage
--        - removed_at IS NOT NULL         → item "non pris", exclu du rendu,
--                                           visible dans le bilan, non-checkable
--        - added_during_check AND removed_at → encore possible ; c'est un
--          additif qu'on a fini par ne pas prendre. L'utilisateur peut aussi
--          choisir de hard-delete cet additif (via check_action_delete_additif)
--          s'il préfère que la ligne n'apparaisse nulle part.
--
-- Idempotent : ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260421_mat10_checklist_terrain.sql (MAT-10A).
-- ============================================================================

BEGIN;

-- ── 1. Colonnes removed_* sur matos_items ────────────────────────────────
ALTER TABLE matos_items
  ADD COLUMN IF NOT EXISTS removed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS removed_by_name  text,
  ADD COLUMN IF NOT EXISTS removed_reason   text;

-- Index partiel pour filtrer rapidement les items actifs dans les rapports
-- (query type "SELECT ... WHERE removed_at IS NULL").
CREATE INDEX IF NOT EXISTS matos_items_active_idx
  ON matos_items(block_id) WHERE removed_at IS NULL;

COMMENT ON COLUMN matos_items.removed_at IS
  'Timestamp du retrait soft (on ne prend plus cet item). NULL = actif. L''item reste en base pour le bilan et l''exclusion de la liste rendu loueur.';
COMMENT ON COLUMN matos_items.removed_reason IS
  'Raison optionnelle du retrait (ex. "défaut optique", "remplacé par autre cam"). Saisie libre, affichée dans le bilan.';


-- ── 2. Patch check_session_fetch pour inclure les nouvelles colonnes ────
-- On régénère la fonction (CREATE OR REPLACE) en ajoutant removed_at,
-- removed_by_name, removed_reason au bundle items.
CREATE OR REPLACE FUNCTION check_session_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_session_fetch$
DECLARE
  v_version_id uuid;
  v_project_id uuid;
  v_result     jsonb;
BEGIN
  v_version_id := _check_token_get_version_id(p_token);

  SELECT project_id INTO v_project_id
    FROM matos_versions WHERE id = v_version_id;

  SELECT jsonb_build_object(
    'version', (
      SELECT jsonb_build_object(
        'id', mv.id,
        'project_id', mv.project_id,
        'numero', mv.numero,
        'label', mv.label,
        'notes', mv.notes,
        'is_active', mv.is_active
      )
      FROM matos_versions mv WHERE mv.id = v_version_id
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
      FROM matos_blocks mb WHERE mb.version_id = v_version_id
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
          -- NEW : champs de retrait soft
          'removed_at', mi.removed_at,
          'removed_by_name', mi.removed_by_name,
          'removed_reason', mi.removed_reason,
          'sort_order', mi.sort_order
        ) ORDER BY mi.sort_order, mi.created_at
      )
      FROM matos_items mi
      JOIN matos_blocks mb ON mb.id = mi.block_id
      WHERE mb.version_id = v_version_id
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
         WHERE mb.version_id = v_version_id
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
      WHERE mb.version_id = v_version_id
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
      JOIN matos_items  mi ON mi.id = mc.item_id
      JOIN matos_blocks mb ON mb.id = mi.block_id
      WHERE mb.version_id = v_version_id
    ), '[]'::jsonb),
    'attachments', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ma.id,
          'filename', ma.filename,
          'storage_path', ma.storage_path,
          'size_bytes', ma.size_bytes,
          'mime_type', ma.mime_type,
          'uploaded_by_name', ma.uploaded_by_name,
          'created_at', ma.created_at
        ) ORDER BY ma.created_at
      )
      FROM matos_version_attachments ma
      WHERE ma.version_id = v_version_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$check_session_fetch$;


-- ── 3. RPC : marquer un item comme "retiré du tournage" (soft, toggle) ──
-- Si p_removed=true  → enregistre removed_at/_by_name/_reason.
-- Si p_removed=false → efface ces colonnes (l'item redevient actif).
-- Idempotent : repasser true sur un item déjà retiré met à jour le reason
-- et éventuellement l'auteur (utile si un autre user corrige la raison).
CREATE OR REPLACE FUNCTION check_action_set_removed(
  p_token     text,
  p_item_id   uuid,
  p_removed   boolean,
  p_reason    text,
  p_user_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_set_removed$
DECLARE
  v_version_id   uuid;
  v_item_version uuid;
  v_clean_reason text;
  v_clean_name   text;
BEGIN
  v_version_id := _check_token_get_version_id(p_token);

  -- Vérifie que l'item appartient à la version du token.
  SELECT mb.version_id INTO v_item_version
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version IS NULL OR v_item_version <> v_version_id THEN
    RAISE EXCEPTION 'item not in this version' USING ERRCODE = '22023';
  END IF;

  IF p_removed THEN
    v_clean_reason := NULLIF(trim(p_reason), '');
    v_clean_name   := NULLIF(trim(p_user_name), '');
    UPDATE matos_items
       SET removed_at       = now(),
           removed_by       = NULL,  -- anon
           removed_by_name  = v_clean_name,
           removed_reason   = v_clean_reason
     WHERE id = p_item_id;
  ELSE
    UPDATE matos_items
       SET removed_at       = NULL,
           removed_by       = NULL,
           removed_by_name  = NULL,
           removed_reason   = NULL
     WHERE id = p_item_id;
  END IF;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'removed_at', (SELECT removed_at      FROM matos_items WHERE id = p_item_id),
    'removed_by_name', (SELECT removed_by_name FROM matos_items WHERE id = p_item_id),
    'removed_reason',  (SELECT removed_reason  FROM matos_items WHERE id = p_item_id)
  );
END;
$check_action_set_removed$;


-- ── 4. RPC : supprimer définitivement un additif (hard DELETE) ──────────
-- Garde-fou strict : réservé aux items `added_during_check=true`. Les items
-- de la liste d'origine doivent passer par check_action_set_removed (soft).
-- CASCADE supprime les comments et item_loueurs associés.
CREATE OR REPLACE FUNCTION check_action_delete_additif(
  p_token   text,
  p_item_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_delete_additif$
DECLARE
  v_version_id   uuid;
  v_item_version uuid;
  v_is_additif   boolean;
BEGIN
  v_version_id := _check_token_get_version_id(p_token);

  SELECT mb.version_id, mi.added_during_check
    INTO v_item_version, v_is_additif
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version IS NULL OR v_item_version <> v_version_id THEN
    RAISE EXCEPTION 'item not in this version' USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_additif THEN
    RAISE EXCEPTION 'only additifs (added_during_check=true) can be hard-deleted; use check_action_set_removed for base items'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM matos_items WHERE id = p_item_id;

  RETURN jsonb_build_object('item_id', p_item_id, 'deleted', true);
END;
$check_action_delete_additif$;


-- ── 5. GRANTs ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION check_action_set_removed(text, uuid, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_action_delete_additif(text, uuid)                   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION check_action_set_removed(text, uuid, boolean, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_action_delete_additif(text, uuid)                   TO anon, authenticated;


COMMIT;

-- ============================================================================
-- Fin de MAT-10N.
--
-- Côté front (à livrer après migration) :
--   - lib/matosCheckToken.js : wrappers setItemRemoved() + deleteAdditif()
--   - hooks/useCheckTokenSession.js : actions setRemoved, deleteAdditif
--   - components/check/CheckItemRow.jsx : menu kebab ⋯ avec les 2 actions
--   - CheckBlockCard : exclure removed_at IS NOT NULL du compteur total
--
-- MAT-13 (futur) — Checklist retour (rendu loueur) :
--   - Nouveau scope sur les tokens : 'pre' | 'post'
--   - Même UI de check mais sur post_check_at
--   - Filtre items removed_at IS NULL (on ne rend que ce qu'on a pris)
-- ============================================================================
