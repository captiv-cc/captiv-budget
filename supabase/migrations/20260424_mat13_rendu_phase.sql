-- ============================================================================
-- Migration : MAT-13A — Phase Rendu (checklist retour / rendu loueur)
-- Date      : 2026-04-24
-- Contexte  : Une fois les essais cams clôturés, on doit refaire une passe
--             "Rendu" avant de rapporter le matériel au loueur : même checklist
--             tactile, mais sur `post_check_at` (et plus `pre_check_at`). Les
--             additifs ajoutés en cours d'essais doivent être rendus aussi ;
--             les items retirés restent affichés "pour mémoire" en lecture
--             seule. Un PDF "Bon de retour" synthétique clôt la phase.
--
--             L'architecture réutilise l'infra MAT-10 / MAT-11 / MAT-14 :
--               - Toggle routable par phase (pre_check_at | post_check_at)
--               - Tokens scopés par phase (un token rendu ≠ un token essais)
--               - Photos kind='retour' (en plus de 'probleme' et 'pack')
--               - Commentaires kind='rendu' (en plus de 'probleme' et 'note')
--               - Clôture rendu (rendu_closed_at + bon_retour_archive_path)
--               - Storage path <version_id>/bon-retour/ avec policy anon
--                 (miroir de bilan/ mais réservée aux tokens phase='rendu').
--
-- Décisions Hugo (2026-04-24) :
--   - Pas de blocage si essais non clôturés : simple alerte en tête du
--     /rendu/:token. Un admin peut initier le rendu même essais en cours.
--   - Tokens gardés pour le rendu (assistant cam sans compte doit pouvoir
--     participer, pas de régression UX vs. essais).
--   - Kind `'rendu'` distinct de `'probleme'` : le bilan distingue "problèmes
--     constatés à la prise" (kind=probleme, pendant essais) de "problèmes
--     apparus pendant le chantier" (kind=retour pour photos, kind=rendu pour
--     commentaires).
--   - Items retirés : restent lisibles en bas ("pour mémoire") — côté front.
--   - Additifs : chip "ADDITIF" dans l'UI rendu — côté front.
--
-- Idempotent : ALTER ... DROP CONSTRAINT IF EXISTS puis ADD CONSTRAINT,
--              ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS,
--              CREATE OR REPLACE FUNCTION, DROP FUNCTION IF EXISTS avant
--              redéfinition quand la signature change.
-- Dépend de  : 20260421_mat10_checklist_terrain.sql (tokens + check_*)
--              20260422_mat12_cloture_bilan.sql      (closed_at + bilan)
--              20260422_mat14_authed_check_session.sql (*_authed + helpers)
--              20260423_mat11_photos.sql             (matos_item_photos)
--              20260423_mat23_comments_kind_block.sql (kind + block anchor)
-- ============================================================================

BEGIN;

-- ── 1. Schema : étendre les CHECK kind (photos + comments) ──────────────
-- Les CHECK inline de MAT-11 et MAT-23 sont auto-nommés par Postgres selon
-- la convention `<table>_<column>_check`. On DROP + RECREATE avec le même
-- nom pour étendre le set de valeurs autorisées. Idempotent via IF EXISTS.

-- matos_item_photos.kind : 'probleme' | 'pack' | 'retour'
ALTER TABLE matos_item_photos
  DROP CONSTRAINT IF EXISTS matos_item_photos_kind_check;

ALTER TABLE matos_item_photos
  ADD CONSTRAINT matos_item_photos_kind_check
    CHECK (kind IN ('probleme', 'pack', 'retour'));

COMMENT ON CONSTRAINT matos_item_photos_kind_check ON matos_item_photos IS
  'MAT-13 : kind étendu avec ''retour'' (photo d''un problème constaté au rendu loueur, après les essais).';


-- matos_item_comments.kind : 'probleme' | 'note' | 'rendu'
ALTER TABLE matos_item_comments
  DROP CONSTRAINT IF EXISTS matos_item_comments_kind_check;

ALTER TABLE matos_item_comments
  ADD CONSTRAINT matos_item_comments_kind_check
    CHECK (kind IN ('probleme', 'note', 'rendu'));

COMMENT ON CONSTRAINT matos_item_comments_kind_check ON matos_item_comments IS
  'MAT-13 : kind étendu avec ''rendu'' (commentaire signalé à la phase rendu : "câble perdu", "bouton cassé", ...). Distinct de ''probleme'' (signalement d''essais) et ''note'' (commentaire interne).';


-- ── 2. matos_check_tokens.phase : scoper les tokens par phase ───────────
-- Un assistant cam reçoit un token spécifique pour la phase à laquelle il
-- participe. Un token 'essais' ne peut PAS toggler post_check_at (ni fermer
-- le rendu). Un token 'rendu' ne peut PAS toggler pre_check_at (ni fermer les
-- essais). Les tokens existants sont tous 'essais' via le DEFAULT.
ALTER TABLE matos_check_tokens
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'essais';

ALTER TABLE matos_check_tokens
  DROP CONSTRAINT IF EXISTS matos_check_tokens_phase_check;

ALTER TABLE matos_check_tokens
  ADD CONSTRAINT matos_check_tokens_phase_check
    CHECK (phase IN ('essais', 'rendu'));

CREATE INDEX IF NOT EXISTS matos_check_tokens_phase_idx
  ON matos_check_tokens(version_id, phase)
  WHERE revoked_at IS NULL;

COMMENT ON COLUMN matos_check_tokens.phase IS
  'MAT-13 : phase scope du token — essais (pre_check_*) OU rendu (post_check_*). Un token ne peut pas agir sur l''autre phase. Existant = ''essais'' (DEFAULT).';


-- ── 3. matos_versions : colonnes de clôture rendu (miroir bilan) ────────
ALTER TABLE matos_versions
  ADD COLUMN IF NOT EXISTS rendu_closed_at           timestamptz,
  ADD COLUMN IF NOT EXISTS rendu_closed_by           uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rendu_closed_by_name      text,
  ADD COLUMN IF NOT EXISTS bon_retour_archive_path   text;

COMMENT ON COLUMN matos_versions.rendu_closed_at IS
  'MAT-13 : timestamp de la dernière clôture rendu (re-clôturable : écrasement à chaque ré-archivage). NULL = phase rendu encore en cours / pas commencée.';
COMMENT ON COLUMN matos_versions.bon_retour_archive_path IS
  'MAT-13 : Storage path du PDF bon de retour (bucket matos-attachments, préfixe <version_id>/bon-retour/). Aligné avec une ligne dans matos_version_attachments titrée "Bon de retour V{n}".';


-- ── 4. Storage : policy anon pour upload sous <version_id>/bon-retour/ ──
-- Miroir des policies bilan de MAT-12, mais gated par un token phase='rendu'
-- (un token essais ne peut PAS déposer un bon de retour). Lecture : la policy
-- SELECT existante de MAT-10J/MAT-12 s'applique déjà — tout anon avec un token
-- valide sur la version peut lire.

DROP POLICY IF EXISTS "matos_attachments_anon_insert_bon_retour" ON storage.objects;
CREATE POLICY "matos_attachments_anon_insert_bon_retour"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'matos-attachments'
    AND (storage.foldername(name))[2] = 'bon-retour'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens t
      WHERE t.version_id::text = (storage.foldername(name))[1]
        AND t.phase = 'rendu'
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
    )
  );

DROP POLICY IF EXISTS "matos_attachments_anon_update_bon_retour" ON storage.objects;
CREATE POLICY "matos_attachments_anon_update_bon_retour"
  ON storage.objects FOR UPDATE
  TO anon
  USING (
    bucket_id = 'matos-attachments'
    AND (storage.foldername(name))[2] = 'bon-retour'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens t
      WHERE t.version_id::text = (storage.foldername(name))[1]
        AND t.phase = 'rendu'
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
    )
  )
  WITH CHECK (
    bucket_id = 'matos-attachments'
    AND (storage.foldername(name))[2] = 'bon-retour'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens t
      WHERE t.version_id::text = (storage.foldername(name))[1]
        AND t.phase = 'rendu'
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
    )
  );


-- ── 5. Helper _check_token_get_phase : scope du token ────────────────────
-- Retourne la phase du token (+ valide revoked/expires). Utilisé par les RPC
-- qui doivent gater selon la phase (toggle, close, photos/comments kind).
CREATE OR REPLACE FUNCTION _check_token_get_phase(p_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_check_token_get_phase$
DECLARE
  v_phase text;
BEGIN
  SELECT phase INTO v_phase
    FROM matos_check_tokens
   WHERE token = p_token
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());
  IF v_phase IS NULL THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '28000';
  END IF;
  RETURN v_phase;
END;
$_check_token_get_phase$;

REVOKE ALL ON FUNCTION _check_token_get_phase(text) FROM PUBLIC;


-- ── 6. RPC token — check_action_toggle : routage phase (pre|post) ────────
-- DROP + CREATE car changement de signature (ajout p_phase). p_phase a un
-- DEFAULT 'essais' donc les appels existants (3 args nommés p_token, p_item_id,
-- p_user_name) restent compatibles. Phase mismatch avec le token = 42501.

DROP FUNCTION IF EXISTS check_action_toggle(text, uuid, text);

CREATE OR REPLACE FUNCTION check_action_toggle(
  p_token     text,
  p_item_id   uuid,
  p_user_name text,
  p_phase     text DEFAULT 'essais'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_toggle$
DECLARE
  v_version_id         uuid;
  v_token_phase        text;
  v_item_version       uuid;
  v_is_checked         boolean;
  v_new_checked_at     timestamptz;
  v_new_checked_by_name text;
BEGIN
  v_version_id  := _check_token_get_version_id(p_token);
  v_token_phase := _check_token_get_phase(p_token);

  IF p_phase NOT IN ('essais', 'rendu') THEN
    RAISE EXCEPTION 'invalid phase (essais|rendu attendu)' USING ERRCODE = '22023';
  END IF;
  IF v_token_phase <> p_phase THEN
    RAISE EXCEPTION 'phase mismatch (token scope = %, requested = %)', v_token_phase, p_phase
      USING ERRCODE = '42501';
  END IF;

  -- Vérifie que l'item appartient à la version du token
  SELECT mb.version_id INTO v_item_version
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version IS NULL OR v_item_version <> v_version_id THEN
    RAISE EXCEPTION 'item not in this version' USING ERRCODE = '22023';
  END IF;

  IF p_phase = 'essais' THEN
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
             pre_check_by      = NULL,
             pre_check_by_name = NULLIF(trim(p_user_name), '')
       WHERE id = p_item_id
       RETURNING pre_check_at, pre_check_by_name
            INTO v_new_checked_at, v_new_checked_by_name;
    END IF;

    RETURN jsonb_build_object(
      'item_id', p_item_id,
      'phase', 'essais',
      'pre_check_at', v_new_checked_at,
      'pre_check_by_name', v_new_checked_by_name
    );
  ELSE
    -- phase = 'rendu' → toggle post_check_*
    SELECT (post_check_at IS NOT NULL) INTO v_is_checked
      FROM matos_items WHERE id = p_item_id;

    IF v_is_checked THEN
      UPDATE matos_items
         SET post_check_at      = NULL,
             post_check_by      = NULL,
             post_check_by_name = NULL
       WHERE id = p_item_id
       RETURNING post_check_at, post_check_by_name
            INTO v_new_checked_at, v_new_checked_by_name;
    ELSE
      UPDATE matos_items
         SET post_check_at      = now(),
             post_check_by      = NULL,
             post_check_by_name = NULLIF(trim(p_user_name), '')
       WHERE id = p_item_id
       RETURNING post_check_at, post_check_by_name
            INTO v_new_checked_at, v_new_checked_by_name;
    END IF;

    RETURN jsonb_build_object(
      'item_id', p_item_id,
      'phase', 'rendu',
      'post_check_at', v_new_checked_at,
      'post_check_by_name', v_new_checked_by_name
    );
  END IF;
END;
$check_action_toggle$;

REVOKE ALL ON FUNCTION check_action_toggle(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_toggle(text, uuid, text, text) TO anon, authenticated;


-- ── 7. RPC authed — check_action_toggle_authed : routage phase ───────────
-- Pas de contrainte de phase côté authed : un admin peut toggle pre OU post
-- via le même RPC, avec p_phase en paramètre. Le gate d'accès reste identique
-- (_check_authed_gate_edit).

DROP FUNCTION IF EXISTS check_action_toggle_authed(uuid);

CREATE OR REPLACE FUNCTION check_action_toggle_authed(
  p_item_id uuid,
  p_phase   text DEFAULT 'essais'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_toggle_authed$
DECLARE
  v_item_version_id    uuid;
  v_is_checked         boolean;
  v_user_name          text;
  v_new_checked_at     timestamptz;
  v_new_checked_by_name text;
BEGIN
  IF p_phase NOT IN ('essais', 'rendu') THEN
    RAISE EXCEPTION 'invalid phase (essais|rendu attendu)' USING ERRCODE = '22023';
  END IF;

  SELECT mb.version_id INTO v_item_version_id
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version_id IS NULL THEN
    RAISE EXCEPTION 'item introuvable' USING ERRCODE = '22023';
  END IF;
  PERFORM _check_authed_gate_edit(v_item_version_id);

  v_user_name := _check_authed_user_name();

  IF p_phase = 'essais' THEN
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
      'phase', 'essais',
      'pre_check_at', v_new_checked_at,
      'pre_check_by_name', v_new_checked_by_name
    );
  ELSE
    SELECT (post_check_at IS NOT NULL) INTO v_is_checked
      FROM matos_items WHERE id = p_item_id;

    IF v_is_checked THEN
      UPDATE matos_items
         SET post_check_at      = NULL,
             post_check_by      = NULL,
             post_check_by_name = NULL
       WHERE id = p_item_id
       RETURNING post_check_at, post_check_by_name
            INTO v_new_checked_at, v_new_checked_by_name;
    ELSE
      UPDATE matos_items
         SET post_check_at      = now(),
             post_check_by      = auth.uid(),
             post_check_by_name = v_user_name
       WHERE id = p_item_id
       RETURNING post_check_at, post_check_by_name
            INTO v_new_checked_at, v_new_checked_by_name;
    END IF;

    RETURN jsonb_build_object(
      'item_id', p_item_id,
      'phase', 'rendu',
      'post_check_at', v_new_checked_at,
      'post_check_by_name', v_new_checked_by_name
    );
  END IF;
END;
$check_action_toggle_authed$;

REVOKE ALL ON FUNCTION check_action_toggle_authed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_toggle_authed(uuid, text) TO authenticated;


-- ── 8. RPC token — check_action_add_comment : accepter kind='rendu' ──────
-- Extension de la signature MAT-23A : on ajoute 'rendu' au set valide et on
-- vérifie la cohérence phase/kind côté token (kind='rendu' ⇒ phase='rendu').
-- Signature inchangée (text, uuid, uuid, text, text, text) — juste le corps
-- change. Donc CREATE OR REPLACE sans DROP.

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
  v_version_id     uuid;
  v_token_phase    text;
  v_anchor_version uuid;
  v_new_id         uuid;
  v_clean_body     text;
  v_clean_name     text;
  v_clean_kind     text;
  v_now            timestamptz;
BEGIN
  v_version_id  := _check_token_get_version_id(p_token);
  v_token_phase := _check_token_get_phase(p_token);

  IF (p_item_id IS NOT NULL) = (p_block_id IS NOT NULL) THEN
    RAISE EXCEPTION 'exactement un ancrage (item_id XOR block_id) requis' USING ERRCODE = '22023';
  END IF;

  v_clean_kind := COALESCE(NULLIF(trim(p_kind), ''), 'note');
  IF v_clean_kind NOT IN ('probleme', 'note', 'rendu') THEN
    RAISE EXCEPTION 'kind invalide (probleme|note|rendu attendu)' USING ERRCODE = '22023';
  END IF;

  -- Cohérence phase / kind
  IF v_clean_kind = 'rendu' AND v_token_phase <> 'rendu' THEN
    RAISE EXCEPTION 'kind=rendu requires a rendu-phase token (token scope = %)', v_token_phase
      USING ERRCODE = '42501';
  END IF;
  IF v_clean_kind IN ('probleme', 'note') AND v_token_phase <> 'essais' THEN
    RAISE EXCEPTION 'kind=% requires an essais-phase token (token scope = %)', v_clean_kind, v_token_phase
      USING ERRCODE = '42501';
  END IF;

  -- Résout la version de l'ancrage et vérifie qu'elle == version du token
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


-- ── 9. RPC authed — check_action_add_comment_authed : accepter 'rendu' ──
-- Même extension que token : on ajoute 'rendu' au set valide. Pas de gate
-- phase côté authed (un admin peut toujours commenter les 2 phases).

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
  IF v_clean_kind NOT IN ('probleme', 'note', 'rendu') THEN
    RAISE EXCEPTION 'kind invalide (probleme|note|rendu attendu)' USING ERRCODE = '22023';
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


-- ── 10. RPC token — check_upload_photo : accepter kind='retour' ──────────
-- Signature inchangée ; on étend le set kind et on gate phase/kind côté token.

CREATE OR REPLACE FUNCTION check_upload_photo(
  p_token        text,
  p_item_id      uuid,
  p_block_id     uuid,
  p_kind         text,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   bigint,
  p_width        integer,
  p_height       integer,
  p_caption      text,
  p_user_name    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_upload_photo$
DECLARE
  v_token_version_id  uuid;
  v_token_phase       text;
  v_anchor_version_id uuid;
  v_anchor_block_id   uuid;
  v_clean_name        text;
  v_new_id            uuid;
  v_now               timestamptz;
BEGIN
  v_token_version_id := _check_token_get_version_id(p_token);
  v_token_phase      := _check_token_get_phase(p_token);

  IF p_kind NOT IN ('probleme', 'pack', 'retour') THEN
    RAISE EXCEPTION 'kind invalide : probleme|pack|retour attendu' USING ERRCODE = '22023';
  END IF;

  -- Cohérence phase / kind
  IF p_kind = 'retour' AND v_token_phase <> 'rendu' THEN
    RAISE EXCEPTION 'kind=retour requires a rendu-phase token (token scope = %)', v_token_phase
      USING ERRCODE = '42501';
  END IF;
  IF p_kind IN ('probleme', 'pack') AND v_token_phase <> 'essais' THEN
    RAISE EXCEPTION 'kind=% requires an essais-phase token (token scope = %)', p_kind, v_token_phase
      USING ERRCODE = '42501';
  END IF;

  SELECT r.version_id, r.block_id
    INTO v_anchor_version_id, v_anchor_block_id
    FROM _matos_photo_resolve_anchor(p_item_id, p_block_id) r;

  IF v_anchor_version_id <> v_token_version_id THEN
    RAISE EXCEPTION 'ancrage hors version du token' USING ERRCODE = '22023';
  END IF;

  IF split_part(p_storage_path, '/', 1) <> v_token_version_id::text THEN
    RAISE EXCEPTION 'storage_path invalide (préfixe version_id attendu)'
      USING ERRCODE = '22023';
  END IF;

  PERFORM _matos_photo_enforce_limit(p_item_id, p_block_id);

  v_clean_name := COALESCE(NULLIF(trim(p_user_name), ''), 'Anonyme');

  INSERT INTO matos_item_photos (
    version_id, item_id, block_id, kind,
    storage_path, mime_type, size_bytes, width, height, caption,
    uploaded_by, uploaded_by_name
  ) VALUES (
    v_token_version_id,
    p_item_id,
    p_block_id,
    p_kind,
    p_storage_path,
    NULLIF(trim(p_mime_type), ''),
    p_size_bytes,
    p_width,
    p_height,
    NULLIF(trim(p_caption), ''),
    NULL,
    v_clean_name
  )
  RETURNING id, created_at INTO v_new_id, v_now;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'version_id', v_token_version_id,
    'item_id', p_item_id,
    'block_id', p_block_id,
    'kind', p_kind,
    'storage_path', p_storage_path,
    'mime_type', NULLIF(trim(p_mime_type), ''),
    'size_bytes', p_size_bytes,
    'width', p_width,
    'height', p_height,
    'caption', NULLIF(trim(p_caption), ''),
    'uploaded_by', NULL,
    'uploaded_by_name', v_clean_name,
    'created_at', v_now
  );
END;
$check_upload_photo$;


-- ── 11. RPC authed — check_upload_photo_authed : accepter 'retour' ──────

CREATE OR REPLACE FUNCTION check_upload_photo_authed(
  p_item_id      uuid,
  p_block_id     uuid,
  p_kind         text,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   bigint,
  p_width        integer,
  p_height       integer,
  p_caption      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_upload_photo_authed$
DECLARE
  v_anchor_version_id uuid;
  v_anchor_block_id   uuid;
  v_user_name         text;
  v_new_id            uuid;
  v_now               timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_kind NOT IN ('probleme', 'pack', 'retour') THEN
    RAISE EXCEPTION 'kind invalide : probleme|pack|retour attendu' USING ERRCODE = '22023';
  END IF;

  SELECT r.version_id, r.block_id
    INTO v_anchor_version_id, v_anchor_block_id
    FROM _matos_photo_resolve_anchor(p_item_id, p_block_id) r;

  PERFORM _check_authed_gate_edit(v_anchor_version_id);

  IF split_part(p_storage_path, '/', 1) <> v_anchor_version_id::text THEN
    RAISE EXCEPTION 'storage_path invalide (préfixe version_id attendu)'
      USING ERRCODE = '22023';
  END IF;

  PERFORM _matos_photo_enforce_limit(p_item_id, p_block_id);

  v_user_name := _check_authed_user_name();

  INSERT INTO matos_item_photos (
    version_id, item_id, block_id, kind,
    storage_path, mime_type, size_bytes, width, height, caption,
    uploaded_by, uploaded_by_name
  ) VALUES (
    v_anchor_version_id,
    p_item_id,
    p_block_id,
    p_kind,
    p_storage_path,
    NULLIF(trim(p_mime_type), ''),
    p_size_bytes,
    p_width,
    p_height,
    NULLIF(trim(p_caption), ''),
    auth.uid(),
    v_user_name
  )
  RETURNING id, created_at INTO v_new_id, v_now;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'version_id', v_anchor_version_id,
    'item_id', p_item_id,
    'block_id', p_block_id,
    'kind', p_kind,
    'storage_path', p_storage_path,
    'mime_type', NULLIF(trim(p_mime_type), ''),
    'size_bytes', p_size_bytes,
    'width', p_width,
    'height', p_height,
    'caption', NULLIF(trim(p_caption), ''),
    'uploaded_by', auth.uid(),
    'uploaded_by_name', v_user_name,
    'created_at', v_now
  );
END;
$check_upload_photo_authed$;


-- ── 12. RPC token — check_action_close_rendu (anon via token phase=rendu) ─
-- Miroir de check_action_close_essais, gated par un token phase='rendu'.
-- Pose rendu_closed_at + bon_retour_archive_path + enregistre le PDF comme
-- attachment (titre "Bon de retour V{n}").

CREATE OR REPLACE FUNCTION check_action_close_rendu(
  p_token              text,
  p_user_name          text,
  p_archive_path       text,     -- '<version_id>/bon-retour/<filename>.pdf' (NULL = clôture sans archive)
  p_archive_filename   text,     -- 'Bon-retour-Projet-V1.pdf'
  p_archive_size_bytes bigint,
  p_archive_mime       text      -- 'application/pdf'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_close_rendu$
DECLARE
  v_version_id      uuid;
  v_token_phase     text;
  v_numero          integer;
  v_title           text;
  v_clean_user_name text;
  v_attachment_id   uuid;
BEGIN
  v_version_id  := _check_token_get_version_id(p_token);
  v_token_phase := _check_token_get_phase(p_token);

  IF v_token_phase <> 'rendu' THEN
    RAISE EXCEPTION 'close_rendu requires a rendu-phase token (token scope = %)', v_token_phase
      USING ERRCODE = '42501';
  END IF;

  v_clean_user_name := NULLIF(trim(p_user_name), '');

  SELECT numero INTO v_numero FROM matos_versions WHERE id = v_version_id;
  v_title := 'Bon de retour V' || COALESCE(v_numero::text, '?');

  UPDATE matos_versions
     SET rendu_closed_at         = now(),
         rendu_closed_by         = NULL,
         rendu_closed_by_name    = v_clean_user_name,
         bon_retour_archive_path = COALESCE(p_archive_path, bon_retour_archive_path)
   WHERE id = v_version_id;

  IF p_archive_path IS NOT NULL THEN
    INSERT INTO matos_version_attachments (
      version_id, title, filename, storage_path,
      size_bytes, mime_type, uploaded_by, uploaded_by_name
    ) VALUES (
      v_version_id, v_title,
      COALESCE(NULLIF(trim(p_archive_filename), ''), 'bon-retour.pdf'),
      p_archive_path,
      p_archive_size_bytes,
      COALESCE(NULLIF(trim(p_archive_mime), ''), 'application/pdf'),
      NULL,
      v_clean_user_name
    )
    RETURNING id INTO v_attachment_id;
  END IF;

  RETURN jsonb_build_object(
    'version_id', v_version_id,
    'rendu_closed_at', (SELECT rendu_closed_at FROM matos_versions WHERE id = v_version_id),
    'rendu_closed_by_name', v_clean_user_name,
    'bon_retour_archive_path', (SELECT bon_retour_archive_path FROM matos_versions WHERE id = v_version_id),
    'attachment_id', v_attachment_id
  );
END;
$check_action_close_rendu$;

REVOKE ALL ON FUNCTION check_action_close_rendu(text, text, text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_close_rendu(text, text, text, text, bigint, text) TO anon, authenticated;


-- ── 13. RPC authed — check_action_close_rendu_authed ────────────────────
-- Miroir de check_action_close_essais_authed pour la phase rendu.

CREATE OR REPLACE FUNCTION check_action_close_rendu_authed(
  p_version_id         uuid,
  p_archive_path       text,
  p_archive_filename   text,
  p_archive_size_bytes bigint,
  p_archive_mime       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_close_rendu_authed$
DECLARE
  v_numero        integer;
  v_title         text;
  v_user_name     text;
  v_attachment_id uuid;
BEGIN
  PERFORM _check_authed_gate_edit(p_version_id);

  v_user_name := _check_authed_user_name();

  SELECT numero INTO v_numero FROM matos_versions WHERE id = p_version_id;
  v_title := 'Bon de retour V' || COALESCE(v_numero::text, '?');

  UPDATE matos_versions
     SET rendu_closed_at         = now(),
         rendu_closed_by         = auth.uid(),
         rendu_closed_by_name    = v_user_name,
         bon_retour_archive_path = COALESCE(p_archive_path, bon_retour_archive_path)
   WHERE id = p_version_id;

  IF p_archive_path IS NOT NULL THEN
    INSERT INTO matos_version_attachments (
      version_id, title, filename, storage_path,
      size_bytes, mime_type, uploaded_by, uploaded_by_name
    ) VALUES (
      p_version_id, v_title,
      COALESCE(NULLIF(trim(p_archive_filename), ''), 'bon-retour.pdf'),
      p_archive_path,
      p_archive_size_bytes,
      COALESCE(NULLIF(trim(p_archive_mime), ''), 'application/pdf'),
      auth.uid(),
      v_user_name
    )
    RETURNING id INTO v_attachment_id;
  END IF;

  RETURN jsonb_build_object(
    'version_id', p_version_id,
    'rendu_closed_at', (SELECT rendu_closed_at FROM matos_versions WHERE id = p_version_id),
    'rendu_closed_by_name', v_user_name,
    'bon_retour_archive_path', (SELECT bon_retour_archive_path FROM matos_versions WHERE id = p_version_id),
    'attachment_id', v_attachment_id
  );
END;
$check_action_close_rendu_authed$;

REVOKE ALL ON FUNCTION check_action_close_rendu_authed(uuid, text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_action_close_rendu_authed(uuid, text, text, bigint, text) TO authenticated;


-- ── 14. RPC authed — reopen_matos_version_rendu ─────────────────────────
-- Miroir de reopen_matos_version pour la phase rendu. Efface rendu_closed_*
-- mais NE supprime PAS les attachments bon-retour (audit).

CREATE OR REPLACE FUNCTION reopen_matos_version_rendu(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $reopen_matos_version_rendu$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT project_id INTO v_project_id FROM matos_versions WHERE id = p_version_id;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'version introuvable' USING ERRCODE = '22023';
  END IF;

  IF NOT can_edit_outil(v_project_id, 'materiel') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE matos_versions
     SET rendu_closed_at         = NULL,
         rendu_closed_by         = NULL,
         rendu_closed_by_name    = NULL,
         bon_retour_archive_path = NULL
   WHERE id = p_version_id;

  RETURN jsonb_build_object('version_id', p_version_id, 'reopened', true);
END;
$reopen_matos_version_rendu$;

REVOKE ALL ON FUNCTION reopen_matos_version_rendu(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reopen_matos_version_rendu(uuid) TO authenticated;


-- ── 15. _check_fetch_bundle : ajouter post_check_* et rendu_* ───────────
-- Shape référence : 20260423_mat23_comments_kind_block.sql (dernière version).
-- On ajoute :
--   - items : post_check_at, post_check_by, post_check_by_name
--   - version : rendu_closed_at, rendu_closed_by_name, bon_retour_archive_path
-- Le reste est strictement identique à la shape MAT-23A.

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
        -- MAT-13 : champs de clôture rendu
        'rendu_closed_at', mv.rendu_closed_at,
        'rendu_closed_by_name', mv.rendu_closed_by_name,
        'bon_retour_archive_path', mv.bon_retour_archive_path
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
          -- MAT-13 : post_check pour la phase rendu
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
-- Fin de MAT-13A.
--
-- Vérifications post-migration (à dérouler à la main après déploiement) :
--   1. SELECT pg_get_constraintdef(oid) FROM pg_constraint
--        WHERE conname='matos_item_photos_kind_check';
--      → Doit contenir 'probleme', 'pack', 'retour'
--   2. SELECT pg_get_constraintdef(oid) FROM pg_constraint
--        WHERE conname='matos_item_comments_kind_check';
--      → Doit contenir 'probleme', 'note', 'rendu'
--   3. SELECT column_name, data_type FROM information_schema.columns
--        WHERE table_name='matos_check_tokens' AND column_name='phase';
--      → Doit retourner une ligne (text, DEFAULT 'essais')
--   4. SELECT column_name FROM information_schema.columns
--        WHERE table_name='matos_versions' AND column_name LIKE 'rendu_%';
--      → rendu_closed_at, rendu_closed_by, rendu_closed_by_name, bon_retour_archive_path
--   5. SELECT proname FROM pg_proc WHERE proname IN (
--        '_check_token_get_phase', 'check_action_close_rendu',
--        'check_action_close_rendu_authed', 'reopen_matos_version_rendu'
--      ); → 4 lignes
--
-- Tokens existants : tous passent à phase='essais' via le DEFAULT.
-- Compatibilité : les appels 3-args à check_action_toggle (p_token, p_item_id,
-- p_user_name) continuent à marcher grâce au DEFAULT 'essais' sur p_phase.
--
-- Côté front (à livrer dans MAT-13B+) :
--   - src/lib/matosRendu.js         : wrappers RPC (token + authed) rendu
--   - src/lib/matosCheckToken.js    : étendre toggleCheckTokenAction avec
--                                     { phase } et créer closeCheckRendu
--   - src/lib/matosCheckAuthed.js   : toggleCheckAuthedAction avec { phase }
--                                     et closeCheckRenduAuthed
--   - src/hooks/useRenduTokenSession.js  : mirror de useCheckTokenSession
--   - src/hooks/useRenduAuthedSession.js : mirror de useCheckAuthedSession
--   - src/pages/RenduSession.jsx    : route /rendu/:token
--   - src/features/materiel/components/MaterielHeader.jsx : bouton "Rendu"
--     à droite du bouton "Essais" + alerte essais non clos
--   - src/features/materiel/matosBonRetourPdf.js : builder PDF synthétique
-- ============================================================================
