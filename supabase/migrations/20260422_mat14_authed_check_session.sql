-- ============================================================================
-- Migration : MAT-14 — Accès authentifié au mode chantier (checklist terrain)
-- Date      : 2026-04-22
-- Contexte  : Jusqu'ici, la checklist terrain n'était accessible que via un
--             token public (/check/:token). On ajoute un second chemin :
--             un utilisateur loggé avec les droits projet peut ouvrir la
--             même checklist directement, sans devoir générer un token.
--
--             Stratégie : des RPC sibling `check_*_authed` qui miroitent les
--             RPC `check_*` existantes, mais au lieu de valider un token
--             (`_check_token_get_version_id`) elles valident :
--               - auth.uid() IS NOT NULL
--               - can_edit_outil(project_id, 'materiel')  (pour les writes)
--               - can_read_outil(project_id, 'materiel')  (pour le fetch)
--
--             Schéma DB : ZÉRO changement. Les colonnes *_by (uuid, nullable)
--             et *_by_name (text, nullable) sont déjà conçues pour accueillir
--             les deux mondes (uuid = auth, NULL = token anon).
--
--             Refactor : on extrait le body de `check_session_fetch` dans un
--             helper privé `_check_fetch_bundle(p_version_id uuid)` partagé
--             par les deux fonctions publiques — évite la duplication d'un
--             jsonb_build_object de ~100 lignes et garantit que les deux
--             chemins retournent exactement la même shape.
--
-- Idempotent : CREATE OR REPLACE FUNCTION partout, DROP FUNCTION ... IF EXISTS
--              pour `check_session_fetch` (signature inchangée mais body qui
--              appelle maintenant `_check_fetch_bundle`).
--
-- Dépend de  : 20260421_mat10_checklist_terrain.sql (tables + can_*_outil),
--              20260421_mat10j_attachments.sql (title attachment),
--              20260421_mat10n_item_removal.sql (removed_* + set_removed + delete_additif),
--              20260422_mat12_cloture_bilan.sql (closed_* + close_essais).
-- ============================================================================

BEGIN;

-- ── 1. Helper privé : builder du bundle JSON à partir d'un version_id ────
-- Reprend le body de check_session_fetch (MAT-12 dernière version) mais
-- paramétré par version_id au lieu du token. Les deux fonctions publiques
-- (token et authed) l'appellent après avoir validé leur propre gate.
--
-- SECURITY DEFINER : cette fonction est privée (préfixe _) et appelée
-- uniquement par les wrappers publics qui ont déjà validé l'autorisation.
-- GRANT EXECUTE seulement aux fonctions appelantes (implicite en PG via
-- REVOKE ALL FROM PUBLIC + appel cross-DEFINER).
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
-- La fonction est privée (underscore prefix) et n'est appelée que par les
-- wrappers publics check_session_fetch / check_session_fetch_authed.


-- ── 2. Re-wire check_session_fetch(p_token) pour déléguer au helper ─────
-- Signature publique inchangée, body simplifié : valide le token puis
-- appelle _check_fetch_bundle. Garantit que le chemin token et le chemin
-- authed renvoient exactement la même shape JSON.
CREATE OR REPLACE FUNCTION check_session_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_session_fetch$
DECLARE
  v_version_id uuid;
BEGIN
  v_version_id := _check_token_get_version_id(p_token);
  RETURN _check_fetch_bundle(v_version_id);
END;
$check_session_fetch$;

GRANT EXECUTE ON FUNCTION check_session_fetch(text) TO anon, authenticated;


-- ── 3. Helper privé : récupère le nom affiché de l'utilisateur connecté ──
-- Lit `profiles.full_name` (alimenté par le trigger handle_new_user + la
-- edge function invite-user). Fallback sur 'Utilisateur' si NULL — ne
-- devrait jamais arriver avec le flux invitation actuel.
CREATE OR REPLACE FUNCTION _check_authed_user_name()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_check_authed_user_name$
DECLARE
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT NULLIF(trim(full_name), '')
    INTO v_name
    FROM profiles
   WHERE id = auth.uid();

  RETURN COALESCE(v_name, 'Utilisateur');
END;
$_check_authed_user_name$;

REVOKE ALL ON FUNCTION _check_authed_user_name() FROM PUBLIC;


-- ── 4. Helper privé : résout version_id → project_id avec auth check ────
-- Encapsule la gate "l'utilisateur peut-il ÉDITER le matériel de ce projet".
-- Renvoie le project_id pour usage ultérieur (logs, triggers, etc.).
CREATE OR REPLACE FUNCTION _check_authed_gate_edit(p_version_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_check_authed_gate_edit$
DECLARE
  v_project_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT project_id INTO v_project_id
    FROM matos_versions WHERE id = p_version_id;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'version introuvable' USING ERRCODE = '22023';
  END IF;

  IF NOT can_edit_outil(v_project_id, 'materiel') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN v_project_id;
END;
$_check_authed_gate_edit$;

REVOKE ALL ON FUNCTION _check_authed_gate_edit(uuid) FROM PUBLIC;


-- ── 5. RPC — fetch authed (lecture) ──────────────────────────────────────
-- Équivalent de check_session_fetch(token) mais pour un user connecté.
-- Gate : can_read_outil (lecture seule suffit pour voir la checklist).
CREATE OR REPLACE FUNCTION check_session_fetch_authed(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_session_fetch_authed$
DECLARE
  v_project_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT project_id INTO v_project_id
    FROM matos_versions WHERE id = p_version_id;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'version introuvable' USING ERRCODE = '22023';
  END IF;

  IF NOT can_read_outil(v_project_id, 'materiel') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN _check_fetch_bundle(p_version_id);
END;
$check_session_fetch_authed$;

REVOKE ALL ON FUNCTION check_session_fetch_authed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_session_fetch_authed(uuid) TO authenticated;


-- ── 6. RPC — toggle pre_check_at authed ──────────────────────────────────
-- Miroir de check_action_toggle(p_token, p_item_id, p_user_name). Le user
-- est déterminé par auth.uid() ; le nom affiché est lu depuis profiles.
CREATE OR REPLACE FUNCTION check_action_toggle_authed(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_toggle_authed$
DECLARE
  v_item_version_id uuid;
  v_is_checked      boolean;
  v_user_name       text;
  v_new_checked_at  timestamptz;
  v_new_checked_by_name text;
BEGIN
  -- Résout la version de l'item puis gate edit.
  SELECT mb.version_id INTO v_item_version_id
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version_id IS NULL THEN
    RAISE EXCEPTION 'item introuvable' USING ERRCODE = '22023';
  END IF;
  PERFORM _check_authed_gate_edit(v_item_version_id);

  v_user_name := _check_authed_user_name();

  SELECT (pre_check_at IS NOT NULL) INTO v_is_checked
    FROM matos_items WHERE id = p_item_id;

  IF v_is_checked THEN
    UPDATE matos_items
       SET pre_check_at      = NULL,
           pre_check_by      = NULL,
           pre_check_by_name = NULL
     WHERE id = p_item_id
     RETURNING pre_check_at, pre_check_by_name
          INTO v_new_checked_at, v_new_checked_by_name;
  ELSE
    UPDATE matos_items
       SET pre_check_at      = now(),
           pre_check_by      = auth.uid(),
           pre_check_by_name = v_user_name
     WHERE id = p_item_id
     RETURNING pre_check_at, pre_check_by_name
          INTO v_new_checked_at, v_new_checked_by_name;
  END IF;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'pre_check_at', v_new_checked_at,
    'pre_check_by_name', v_new_checked_by_name
  );
END;
$check_action_toggle_authed$;

REVOKE ALL ON FUNCTION check_action_toggle_authed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_toggle_authed(uuid) TO authenticated;


-- ── 7. RPC — ajouter un additif authed ───────────────────────────────────
CREATE OR REPLACE FUNCTION check_action_add_item_authed(
  p_block_id    uuid,
  p_designation text,
  p_quantite    integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_add_item_authed$
DECLARE
  v_block_version_id uuid;
  v_user_name        text;
  v_new_id           uuid;
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

  RETURN jsonb_build_object('id', v_new_id);
END;
$check_action_add_item_authed$;

REVOKE ALL ON FUNCTION check_action_add_item_authed(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_add_item_authed(uuid, text, integer) TO authenticated;


-- ── 8. RPC — poster un commentaire authed ────────────────────────────────
CREATE OR REPLACE FUNCTION check_action_add_comment_authed(
  p_item_id uuid,
  p_body    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_add_comment_authed$
DECLARE
  v_item_version_id uuid;
  v_user_name       text;
  v_new_id          uuid;
  v_clean_body      text;
  v_now             timestamptz;
BEGIN
  SELECT mb.version_id INTO v_item_version_id
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version_id IS NULL THEN
    RAISE EXCEPTION 'item introuvable' USING ERRCODE = '22023';
  END IF;
  PERFORM _check_authed_gate_edit(v_item_version_id);

  v_clean_body := NULLIF(trim(p_body), '');
  IF v_clean_body IS NULL THEN
    RAISE EXCEPTION 'body required' USING ERRCODE = '23502';
  END IF;

  v_user_name := _check_authed_user_name();

  INSERT INTO matos_item_comments (item_id, body, author_id, author_name)
  VALUES (p_item_id, v_clean_body, auth.uid(), v_user_name)
  RETURNING id, created_at INTO v_new_id, v_now;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'item_id', p_item_id,
    'body', v_clean_body,
    'author_id', auth.uid(),
    'author_name', v_user_name,
    'created_at', v_now
  );
END;
$check_action_add_comment_authed$;

REVOKE ALL ON FUNCTION check_action_add_comment_authed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_add_comment_authed(uuid, text) TO authenticated;


-- ── 9. RPC — set flag authed (ok / attention / probleme) ────────────────
CREATE OR REPLACE FUNCTION check_action_set_flag_authed(
  p_item_id uuid,
  p_flag    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_set_flag_authed$
DECLARE
  v_item_version_id uuid;
BEGIN
  IF p_flag NOT IN ('ok', 'attention', 'probleme') THEN
    RAISE EXCEPTION 'invalid flag' USING ERRCODE = '22023';
  END IF;

  SELECT mb.version_id INTO v_item_version_id
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version_id IS NULL THEN
    RAISE EXCEPTION 'item introuvable' USING ERRCODE = '22023';
  END IF;
  PERFORM _check_authed_gate_edit(v_item_version_id);

  UPDATE matos_items SET flag = p_flag WHERE id = p_item_id;

  RETURN jsonb_build_object('item_id', p_item_id, 'flag', p_flag);
END;
$check_action_set_flag_authed$;

REVOKE ALL ON FUNCTION check_action_set_flag_authed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_set_flag_authed(uuid, text) TO authenticated;


-- ── 10. RPC — soft remove (on ne prend plus cet item) authed ────────────
CREATE OR REPLACE FUNCTION check_action_set_removed_authed(
  p_item_id uuid,
  p_removed boolean,
  p_reason  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_set_removed_authed$
DECLARE
  v_item_version_id uuid;
  v_user_name       text;
  v_clean_reason    text;
BEGIN
  SELECT mb.version_id INTO v_item_version_id
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version_id IS NULL THEN
    RAISE EXCEPTION 'item introuvable' USING ERRCODE = '22023';
  END IF;
  PERFORM _check_authed_gate_edit(v_item_version_id);

  IF p_removed THEN
    v_clean_reason := NULLIF(trim(p_reason), '');
    v_user_name    := _check_authed_user_name();
    UPDATE matos_items
       SET removed_at      = now(),
           removed_by      = auth.uid(),
           removed_by_name = v_user_name,
           removed_reason  = v_clean_reason
     WHERE id = p_item_id;
  ELSE
    UPDATE matos_items
       SET removed_at      = NULL,
           removed_by      = NULL,
           removed_by_name = NULL,
           removed_reason  = NULL
     WHERE id = p_item_id;
  END IF;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'removed_at',      (SELECT removed_at      FROM matos_items WHERE id = p_item_id),
    'removed_by_name', (SELECT removed_by_name FROM matos_items WHERE id = p_item_id),
    'removed_reason',  (SELECT removed_reason  FROM matos_items WHERE id = p_item_id)
  );
END;
$check_action_set_removed_authed$;

REVOKE ALL ON FUNCTION check_action_set_removed_authed(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_set_removed_authed(uuid, boolean, text) TO authenticated;


-- ── 11. RPC — hard delete d'un additif authed ───────────────────────────
-- Garde-fou strict : réservé aux items `added_during_check=true`.
CREATE OR REPLACE FUNCTION check_action_delete_additif_authed(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_delete_additif_authed$
DECLARE
  v_item_version_id uuid;
  v_is_additif      boolean;
BEGIN
  SELECT mb.version_id, mi.added_during_check
    INTO v_item_version_id, v_is_additif
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version_id IS NULL THEN
    RAISE EXCEPTION 'item introuvable' USING ERRCODE = '22023';
  END IF;
  PERFORM _check_authed_gate_edit(v_item_version_id);

  IF NOT v_is_additif THEN
    RAISE EXCEPTION 'only additifs (added_during_check=true) can be hard-deleted; use check_action_set_removed for base items'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM matos_items WHERE id = p_item_id;

  RETURN jsonb_build_object('item_id', p_item_id, 'deleted', true);
END;
$check_action_delete_additif_authed$;

REVOKE ALL ON FUNCTION check_action_delete_additif_authed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_delete_additif_authed(uuid) TO authenticated;


-- ── 12. RPC — clôture des essais authed ─────────────────────────────────
-- Équivalent de check_action_close_essais(token, ...) mais pour un user
-- connecté. Différence : closed_by = auth.uid() au lieu de NULL, et
-- uploaded_by sur l'attachment est également rempli.
--
-- L'upload du ZIP se fait via la Storage API (authenticated a déjà CRUD
-- sur <version_id>/* via la policy MAT-10J). Cette RPC n'uploade rien,
-- elle référence juste le path déjà écrit par le client.
CREATE OR REPLACE FUNCTION check_action_close_essais_authed(
  p_version_id         uuid,
  p_archive_path       text,     -- '<version_id>/bilan/<filename>.zip' (NULL = clôture sans archive)
  p_archive_filename   text,     -- 'Bilan-Projet-V1.zip'
  p_archive_size_bytes bigint,   -- pour l'affichage du viewer
  p_archive_mime       text      -- 'application/zip'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_close_essais_authed$
DECLARE
  v_numero        integer;
  v_title         text;
  v_user_name     text;
  v_attachment_id uuid;
BEGIN
  PERFORM _check_authed_gate_edit(p_version_id);

  v_user_name := _check_authed_user_name();

  SELECT numero INTO v_numero FROM matos_versions WHERE id = p_version_id;
  v_title := 'Bilan essais V' || COALESCE(v_numero::text, '?');

  UPDATE matos_versions
     SET closed_at          = now(),
         closed_by          = auth.uid(),
         closed_by_name     = v_user_name,
         bilan_archive_path = COALESCE(p_archive_path, bilan_archive_path)
   WHERE id = p_version_id;

  IF p_archive_path IS NOT NULL THEN
    INSERT INTO matos_version_attachments (
      version_id, title, filename, storage_path,
      size_bytes, mime_type, uploaded_by, uploaded_by_name
    ) VALUES (
      p_version_id, v_title,
      COALESCE(NULLIF(trim(p_archive_filename), ''), 'bilan.zip'),
      p_archive_path,
      p_archive_size_bytes,
      COALESCE(NULLIF(trim(p_archive_mime), ''), 'application/zip'),
      auth.uid(),
      v_user_name
    )
    RETURNING id INTO v_attachment_id;
  END IF;

  RETURN jsonb_build_object(
    'version_id', p_version_id,
    'closed_at', (SELECT closed_at FROM matos_versions WHERE id = p_version_id),
    'closed_by_name', v_user_name,
    'bilan_archive_path', (SELECT bilan_archive_path FROM matos_versions WHERE id = p_version_id),
    'attachment_id', v_attachment_id
  );
END;
$check_action_close_essais_authed$;

REVOKE ALL ON FUNCTION check_action_close_essais_authed(uuid, text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_close_essais_authed(uuid, text, text, bigint, text) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de MAT-14.
--
-- Côté front (à livrer après migration) :
--   MAT-14B : src/lib/matosCheckAuthed.js (miroir de matosCheckToken.js)
--             + split useCheckTokenSession → useCheckSessionCore + wrappers
--             + rekey presence channel : check-presence:version:${versionId}
--   MAT-14C : route /projets/:id/materiel/check/:versionId? (fullscreen,
--             PrivateRoute) + branching dans CheckSession.jsx
--             + dropdown "Essais" : [Checklist, Partager] dans MaterielHeader
--   MAT-14D : retirer le hack ephemeral-token de matosCloture.js
--             (closeEssaisAsAdmin, previewBilanAsAdmin) → utiliser directement
--             check_session_fetch_authed + check_action_close_essais_authed.
--
-- Note sécurité : les RPC _authed n'acceptent QUE le rôle authenticated
-- (jamais anon). Un bug qui laisserait anon appeler check_action_*_authed
-- se ferait rejeter à la couche GRANT. Double ceinture avec le check
-- auth.uid() IS NOT NULL en début de fonction.
-- ============================================================================
