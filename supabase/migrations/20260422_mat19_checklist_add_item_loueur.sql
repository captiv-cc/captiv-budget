-- ============================================================================
-- MAT-19 — Checklist : attribuer un loueur à un additif
-- ============================================================================
--
-- Contexte : depuis MAT-10F un utilisateur peut ajouter un additif (item créé
-- pendant les essais) via `check_action_add_item` / `check_action_add_item_authed`.
-- Ces RPC ne prenaient pas de loueur, donc l'additif apparaissait toujours dans
-- le groupe "Non assigné" du récap loueur (MAT-18). C'est contre-productif :
-- quand on ajoute un bras magique pendant les essais, on sait déjà à qui il
-- faut demander de le facturer — autant l'attribuer tout de suite.
--
-- Cette migration étend les deux RPC d'ajout d'additif avec un paramètre
-- optionnel `p_loueur_id uuid`. Quand fourni, on insère aussi la ligne pivot
-- `matos_item_loueurs` (même transaction) pour que l'item apparaisse bien
-- dans le récap du bon loueur dès l'ajout.
--
-- Validation :
--   - Le loueur doit exister dans `fournisseurs` (contrainte FK du pivot).
--   - Le loueur doit appartenir à la même `org_id` que le projet hébergeant
--     la version → on le vérifie explicitement (défense en profondeur vis-à-vis
--     du mode SECURITY DEFINER qui court-circuite les RLS).
--   - Le loueur doit avoir `is_loueur_matos = true` (sinon ce n'est pas un
--     loueur matos — on refuse l'attribution).
--
-- On DROP les anciennes signatures avant de CRÉER les nouvelles pour éviter
-- toute ambiguïté d'overload Postgres.
-- ============================================================================

BEGIN;

-- ── 1. DROP des anciennes signatures ─────────────────────────────────────────
DROP FUNCTION IF EXISTS check_action_add_item(text, uuid, text, integer, text);
DROP FUNCTION IF EXISTS check_action_add_item_authed(uuid, text, integer);


-- ── 2. check_action_add_item (token anonyme) — signature étendue ────────────
CREATE OR REPLACE FUNCTION check_action_add_item(
  p_token       text,
  p_block_id    uuid,
  p_designation text,
  p_quantite    integer,
  p_user_name   text,
  p_loueur_id   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_add_item$
DECLARE
  v_version_id      uuid;
  v_block_version   uuid;
  v_project_org_id  uuid;
  v_loueur_org_id   uuid;
  v_loueur_is_matos boolean;
  v_new_id          uuid;
  v_pivot_id        uuid := NULL;
  v_next_sort       integer;
  v_clean_desig     text;
BEGIN
  v_version_id := _check_token_get_version_id(p_token);

  SELECT version_id INTO v_block_version
    FROM matos_blocks WHERE id = p_block_id;
  IF v_block_version IS NULL OR v_block_version <> v_version_id THEN
    RAISE EXCEPTION 'block not in this version' USING ERRCODE = '22023';
  END IF;

  v_clean_desig := NULLIF(trim(p_designation), '');
  IF v_clean_desig IS NULL THEN
    RAISE EXCEPTION 'designation required' USING ERRCODE = '23502';
  END IF;

  -- Validation loueur (si fourni) : même org que le projet + is_loueur_matos.
  IF p_loueur_id IS NOT NULL THEN
    SELECT p.org_id INTO v_project_org_id
      FROM matos_versions mv
      JOIN projects p ON p.id = mv.project_id
     WHERE mv.id = v_version_id;

    SELECT f.org_id, f.is_loueur_matos
      INTO v_loueur_org_id, v_loueur_is_matos
      FROM fournisseurs f
     WHERE f.id = p_loueur_id;

    IF v_loueur_org_id IS NULL THEN
      RAISE EXCEPTION 'loueur introuvable' USING ERRCODE = '22023';
    END IF;
    IF v_loueur_org_id <> v_project_org_id THEN
      RAISE EXCEPTION 'loueur hors org du projet' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_loueur_is_matos, false) = false THEN
      RAISE EXCEPTION 'fournisseur non marqué loueur matos' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_next_sort
    FROM matos_items WHERE block_id = p_block_id;

  INSERT INTO matos_items (
    block_id, designation, quantite,
    added_during_check, added_by, added_by_name, added_at,
    sort_order
  ) VALUES (
    p_block_id,
    v_clean_desig,
    GREATEST(COALESCE(p_quantite, 1), 1),
    true,
    NULL,
    NULLIF(trim(p_user_name), ''),
    now(),
    v_next_sort
  )
  RETURNING id INTO v_new_id;

  -- Insertion pivot loueur si demandé.
  IF p_loueur_id IS NOT NULL THEN
    INSERT INTO matos_item_loueurs (item_id, loueur_id, numero_reference, sort_order)
    VALUES (v_new_id, p_loueur_id, NULL, 0)
    RETURNING id INTO v_pivot_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'item_loueur_id', v_pivot_id,
    'loueur_id', p_loueur_id
  );
END;
$check_action_add_item$;


-- ── 3. check_action_add_item_authed (utilisateur connecté) ──────────────────
CREATE OR REPLACE FUNCTION check_action_add_item_authed(
  p_block_id    uuid,
  p_designation text,
  p_quantite    integer,
  p_loueur_id   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_add_item_authed$
DECLARE
  v_block_version_id uuid;
  v_project_org_id   uuid;
  v_loueur_org_id    uuid;
  v_loueur_is_matos  boolean;
  v_user_name        text;
  v_new_id           uuid;
  v_pivot_id         uuid := NULL;
  v_next_sort        integer;
  v_clean_desig      text;
BEGIN
  SELECT version_id INTO v_block_version_id
    FROM matos_blocks WHERE id = p_block_id;
  IF v_block_version_id IS NULL THEN
    RAISE EXCEPTION 'bloc introuvable' USING ERRCODE = '22023';
  END IF;
  PERFORM _check_authed_gate_edit(v_block_version_id);

  v_clean_desig := NULLIF(trim(p_designation), '');
  IF v_clean_desig IS NULL THEN
    RAISE EXCEPTION 'designation required' USING ERRCODE = '23502';
  END IF;

  IF p_loueur_id IS NOT NULL THEN
    SELECT p.org_id INTO v_project_org_id
      FROM matos_versions mv
      JOIN projects p ON p.id = mv.project_id
     WHERE mv.id = v_block_version_id;

    SELECT f.org_id, f.is_loueur_matos
      INTO v_loueur_org_id, v_loueur_is_matos
      FROM fournisseurs f
     WHERE f.id = p_loueur_id;

    IF v_loueur_org_id IS NULL THEN
      RAISE EXCEPTION 'loueur introuvable' USING ERRCODE = '22023';
    END IF;
    IF v_loueur_org_id <> v_project_org_id THEN
      RAISE EXCEPTION 'loueur hors org du projet' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_loueur_is_matos, false) = false THEN
      RAISE EXCEPTION 'fournisseur non marqué loueur matos' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_user_name := _check_authed_user_name();

  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_next_sort
    FROM matos_items WHERE block_id = p_block_id;

  INSERT INTO matos_items (
    block_id, designation, quantite,
    added_during_check, added_by, added_by_name, added_at,
    sort_order
  ) VALUES (
    p_block_id,
    v_clean_desig,
    GREATEST(COALESCE(p_quantite, 1), 1),
    true,
    auth.uid(),
    v_user_name,
    now(),
    v_next_sort
  )
  RETURNING id INTO v_new_id;

  IF p_loueur_id IS NOT NULL THEN
    INSERT INTO matos_item_loueurs (item_id, loueur_id, numero_reference, sort_order)
    VALUES (v_new_id, p_loueur_id, NULL, 0)
    RETURNING id INTO v_pivot_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'item_loueur_id', v_pivot_id,
    'loueur_id', p_loueur_id
  );
END;
$check_action_add_item_authed$;


-- ── 4. GRANTs pour les nouvelles signatures ──────────────────────────────────
REVOKE ALL ON FUNCTION check_action_add_item(text, uuid, text, integer, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_add_item(text, uuid, text, integer, text, uuid)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION check_action_add_item_authed(uuid, text, integer, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_add_item_authed(uuid, text, integer, uuid)
  TO authenticated;

COMMIT;
