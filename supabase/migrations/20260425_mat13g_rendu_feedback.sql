-- ============================================================================
-- Migration : MAT-13G — Champ libre "Feedback rendu" (global + par loueur)
-- Date      : 2026-04-25
-- Contexte  : Hugo veut pouvoir inscrire en tête de la checklist retour un
--             message libre destiné au loueur / à l'équipe (instructions,
--             remarques, feedbacks). Ce message se retrouve sur le PDF du
--             bon de retour.
--
--             Choix Hugo (AskUserQuestion MAT-13G, 2026-04-25) :
--               - Stockage : LES DEUX — un global (sur la version) + un par
--                 loueur (dans le pivot matos_version_loueur_infos, nouvelle
--                 colonne `rendu_feedback` à côté de `infos_logistique`).
--               - Permission : TOUT LE MONDE peut écrire (token + authed) —
--                 pas de gate admin. Un assistant cam qui suit le rendu via
--                 /rendu/:token doit pouvoir noter "batterie B34 rendue au
--                 technicien, pas encore testée" sans login.
--
--             Comme les anon n'ont pas accès direct à la table (RLS MAT-20
--             limite write à `can_edit_outil`, authed-only), on passe par des
--             RPC SECURITY DEFINER gatées par `_check_token_get_phase` +
--             phase='rendu' (miroir du pattern check_action_toggle rendu).
--             Côté authed on expose les mêmes RPC pour simplifier les hooks
--             (pas besoin de deux chemins d'écriture).
--
-- Portée :
--   - `matos_versions.rendu_feedback`                 TEXT NOT NULL DEFAULT ''
--   - `matos_version_loueur_infos.rendu_feedback`     TEXT NOT NULL DEFAULT ''
--   - 4 RPC : set_rendu_feedback (token + authed), set_rendu_feedback_loueur
--             (token + authed). Les variantes loueur upsertent la ligne pivot
--             pour éviter au front de pré-créer les couples.
--   - _check_fetch_bundle : expose `rendu_feedback` sur version + sur chaque
--                            ligne de version_loueur_infos.
--
-- Idempotent : ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
--              _check_fetch_bundle est ré-écrite intégralement (shape totale)
--              — évite les divergences avec MAT-13A/MAT-20.
--
-- Dépend de  : 20260422_mat20_version_loueur_infos.sql (pivot + RLS)
--              20260424_mat13_rendu_phase.sql           (_check_token_get_phase,
--                                                        rendu_closed_*, bundle)
-- ============================================================================

BEGIN;

-- ── 1. Schema : ajouter rendu_feedback sur matos_versions ─────────────────
ALTER TABLE matos_versions
  ADD COLUMN IF NOT EXISTS rendu_feedback text NOT NULL DEFAULT '';

COMMENT ON COLUMN matos_versions.rendu_feedback IS
  'MAT-13G : texte libre de feedback global affiché en tête de la checklist retour et inséré dans le bon de retour PDF (global). Peut être vide. Éditable par tous (token phase=rendu + authed can_edit_outil).';


-- ── 2. Schema : ajouter rendu_feedback sur matos_version_loueur_infos ─────
ALTER TABLE matos_version_loueur_infos
  ADD COLUMN IF NOT EXISTS rendu_feedback text NOT NULL DEFAULT '';

COMMENT ON COLUMN matos_version_loueur_infos.rendu_feedback IS
  'MAT-13G : texte libre de feedback spécifique à un couple (version, loueur), affiché en tête du bon de retour "un seul loueur" et dans la section loueur du ZIP. Peut être vide. Éditable par tous (token phase=rendu + authed can_edit_outil). Distinct d''`infos_logistique` qui sert aux PDFs essais (MAT-20).';


-- ── 3. RPC token — check_action_set_rendu_feedback (global) ───────────────
-- Écriture anon via token phase='rendu'. Met à jour matos_versions.rendu_feedback.
-- Pas de user_name stocké (le feedback est collectif, pas signé) — mais on
-- l'accepte en param pour homogénéité du signal d'appel côté front.

DROP FUNCTION IF EXISTS check_action_set_rendu_feedback(text, text, text);

CREATE OR REPLACE FUNCTION check_action_set_rendu_feedback(
  p_token     text,
  p_user_name text,
  p_body      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_set_rendu_feedback$
DECLARE
  v_version_id  uuid;
  v_token_phase text;
  v_body        text;
BEGIN
  v_version_id  := _check_token_get_version_id(p_token);
  v_token_phase := _check_token_get_phase(p_token);

  IF v_token_phase <> 'rendu' THEN
    RAISE EXCEPTION 'set_rendu_feedback requires a rendu-phase token (token scope = %)', v_token_phase
      USING ERRCODE = '42501';
  END IF;

  -- body NULL → chaîne vide (le front peut clear le champ)
  v_body := COALESCE(p_body, '');

  UPDATE matos_versions
     SET rendu_feedback = v_body
   WHERE id = v_version_id;

  RETURN jsonb_build_object(
    'version_id', v_version_id,
    'rendu_feedback', v_body
  );
END;
$check_action_set_rendu_feedback$;

REVOKE ALL ON FUNCTION check_action_set_rendu_feedback(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_set_rendu_feedback(text, text, text) TO anon, authenticated;


-- ── 4. RPC authed — check_action_set_rendu_feedback_authed (global) ───────
-- Miroir authed. Gate via _check_authed_gate_edit (can_edit_outil).

DROP FUNCTION IF EXISTS check_action_set_rendu_feedback_authed(uuid, text);

CREATE OR REPLACE FUNCTION check_action_set_rendu_feedback_authed(
  p_version_id uuid,
  p_body       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_set_rendu_feedback_authed$
DECLARE
  v_body text;
BEGIN
  PERFORM _check_authed_gate_edit(p_version_id);

  v_body := COALESCE(p_body, '');

  UPDATE matos_versions
     SET rendu_feedback = v_body
   WHERE id = p_version_id;

  RETURN jsonb_build_object(
    'version_id', p_version_id,
    'rendu_feedback', v_body
  );
END;
$check_action_set_rendu_feedback_authed$;

REVOKE ALL ON FUNCTION check_action_set_rendu_feedback_authed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_set_rendu_feedback_authed(uuid, text) TO authenticated;


-- ── 5. RPC token — check_action_set_rendu_feedback_loueur (par loueur) ────
-- Upsert dans matos_version_loueur_infos (version_id, loueur_id) → rendu_feedback.
-- Si la ligne n'existe pas encore (pas d'infos_logistique saisie), on la crée
-- avec infos_logistique='' pour ne pas perdre la valeur par défaut NOT NULL.
-- Si elle existe, on UPDATE uniquement rendu_feedback (préserve infos_logistique).

DROP FUNCTION IF EXISTS check_action_set_rendu_feedback_loueur(text, text, uuid, text);

CREATE OR REPLACE FUNCTION check_action_set_rendu_feedback_loueur(
  p_token     text,
  p_user_name text,
  p_loueur_id uuid,
  p_body      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_set_rendu_feedback_loueur$
DECLARE
  v_version_id  uuid;
  v_token_phase text;
  v_body        text;
  v_row_id      uuid;
BEGIN
  v_version_id  := _check_token_get_version_id(p_token);
  v_token_phase := _check_token_get_phase(p_token);

  IF v_token_phase <> 'rendu' THEN
    RAISE EXCEPTION 'set_rendu_feedback_loueur requires a rendu-phase token (token scope = %)', v_token_phase
      USING ERRCODE = '42501';
  END IF;

  IF p_loueur_id IS NULL THEN
    RAISE EXCEPTION 'loueur_id is required' USING ERRCODE = '22023';
  END IF;

  -- Vérifie que le loueur est bien un fournisseur (pas d'id orphelin)
  IF NOT EXISTS (SELECT 1 FROM fournisseurs WHERE id = p_loueur_id) THEN
    RAISE EXCEPTION 'loueur introuvable' USING ERRCODE = '22023';
  END IF;

  v_body := COALESCE(p_body, '');

  INSERT INTO matos_version_loueur_infos (
    version_id, loueur_id, infos_logistique, rendu_feedback, updated_by
  ) VALUES (
    v_version_id, p_loueur_id, '', v_body, NULL
  )
  ON CONFLICT (version_id, loueur_id) DO UPDATE
    SET rendu_feedback = EXCLUDED.rendu_feedback,
        updated_at     = now(),
        updated_by     = NULL
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object(
    'id', v_row_id,
    'version_id', v_version_id,
    'loueur_id', p_loueur_id,
    'rendu_feedback', v_body
  );
END;
$check_action_set_rendu_feedback_loueur$;

REVOKE ALL ON FUNCTION check_action_set_rendu_feedback_loueur(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_set_rendu_feedback_loueur(text, text, uuid, text) TO anon, authenticated;


-- ── 6. RPC authed — check_action_set_rendu_feedback_loueur_authed ─────────
-- Miroir authed. Même upsert, gate via _check_authed_gate_edit.

DROP FUNCTION IF EXISTS check_action_set_rendu_feedback_loueur_authed(uuid, uuid, text);

CREATE OR REPLACE FUNCTION check_action_set_rendu_feedback_loueur_authed(
  p_version_id uuid,
  p_loueur_id  uuid,
  p_body       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_set_rendu_feedback_loueur_authed$
DECLARE
  v_body   text;
  v_row_id uuid;
  v_user   uuid;
BEGIN
  PERFORM _check_authed_gate_edit(p_version_id);

  IF p_loueur_id IS NULL THEN
    RAISE EXCEPTION 'loueur_id is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM fournisseurs WHERE id = p_loueur_id) THEN
    RAISE EXCEPTION 'loueur introuvable' USING ERRCODE = '22023';
  END IF;

  v_body := COALESCE(p_body, '');
  v_user := auth.uid();

  INSERT INTO matos_version_loueur_infos (
    version_id, loueur_id, infos_logistique, rendu_feedback, updated_by
  ) VALUES (
    p_version_id, p_loueur_id, '', v_body, v_user
  )
  ON CONFLICT (version_id, loueur_id) DO UPDATE
    SET rendu_feedback = EXCLUDED.rendu_feedback,
        updated_at     = now(),
        updated_by     = v_user
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object(
    'id', v_row_id,
    'version_id', p_version_id,
    'loueur_id', p_loueur_id,
    'rendu_feedback', v_body
  );
END;
$check_action_set_rendu_feedback_loueur_authed$;

REVOKE ALL ON FUNCTION check_action_set_rendu_feedback_loueur_authed(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_set_rendu_feedback_loueur_authed(uuid, uuid, text) TO authenticated;


-- ── 7. _check_fetch_bundle : exposer rendu_feedback (version + pivot) ─────
-- Shape référence : 20260424_mat13_rendu_phase.sql (MAT-13A). On ajoute deux
-- champs :
--   - version.rendu_feedback
--   - version_loueur_infos[*].rendu_feedback
-- Le reste est strictement identique.

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
        'bilan_archive_path', mv.bilan_archive_path,
        -- MAT-13A : champs de clôture rendu
        'rendu_closed_at', mv.rendu_closed_at,
        'rendu_closed_by_name', mv.rendu_closed_by_name,
        'bon_retour_archive_path', mv.bon_retour_archive_path,
        -- MAT-13G : feedback global (texte libre en tête de checklist retour)
        'rendu_feedback', mv.rendu_feedback
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
          -- MAT-13A : post_check pour la phase rendu
          'post_check_at', mi.post_check_at,
          'post_check_by', mi.post_check_by,
          'post_check_by_name', mi.post_check_by_name,
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
          -- MAT-13G : feedback par loueur (texte libre affiché sur bon retour)
          'rendu_feedback', vli.rendu_feedback,
          'updated_at', vli.updated_at
        )
      )
      FROM matos_version_loueur_infos vli
      WHERE vli.version_id = p_version_id
    ), '[]'::jsonb),
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


COMMIT;

-- ============================================================================
-- Fin de MAT-13G.
--
-- Vérifications post-migration :
--   1. SELECT column_name, column_default FROM information_schema.columns
--        WHERE table_name='matos_versions' AND column_name='rendu_feedback';
--      → 1 ligne, default ''::text
--   2. SELECT column_name, column_default FROM information_schema.columns
--        WHERE table_name='matos_version_loueur_infos'
--          AND column_name='rendu_feedback';
--      → 1 ligne, default ''::text
--   3. SELECT proname FROM pg_proc WHERE proname IN (
--        'check_action_set_rendu_feedback',
--        'check_action_set_rendu_feedback_authed',
--        'check_action_set_rendu_feedback_loueur',
--        'check_action_set_rendu_feedback_loueur_authed'
--      ); → 4 lignes
--   4. SELECT _check_fetch_bundle('<uuid d''une version>')->'version'->>'rendu_feedback';
--      → '' (ou la valeur si set)
--   5. Smoke test token (SQL) :
--        SELECT check_action_set_rendu_feedback(
--          p_token      := 'TOKEN_RENDU',
--          p_user_name  := 'Test',
--          p_body       := 'Hello'
--        );
--      → jsonb { version_id, rendu_feedback: 'Hello' }
--   6. Smoke test phase mismatch : un token phase='essais' qui appelle
--      set_rendu_feedback → 42501.
--
-- Côté front (livré dans MAT-13G/H) :
--   - src/lib/matosRendu.js            : setRenduFeedback + setRenduFeedbackAuthed
--                                         + setRenduFeedbackLoueur + *_authed
--   - src/hooks/useRenduTokenSession.js  : actions setRenduFeedback / ...Loueur
--   - src/hooks/useRenduAuthedSession.js : idem, miroir authed
--   - src/pages/RenduSession.jsx       : RenduFeedbackBanner en tête (textarea
--                                         autosave), per-loueur feedback UI
--   - src/features/materiel/matosBonRetourPdf.js : render feedback global +
--                                         feedback loueur, split builder en
--                                         Global / Loueur / Zip
--   - src/features/materiel/components/BonRetourExportModal.jsx : miroir de
--                                         BilanExportModal (3 modes).
-- ============================================================================
