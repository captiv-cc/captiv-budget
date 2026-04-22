-- ============================================================================
-- Migration : MAT-10A — Checklist terrain (mode chantier)
-- Date      : 2026-04-21
-- Contexte  : Permet d'exposer une version matériel via une URL publique
--             (token) accessible sans compte, pour les essais cams sur le
--             set. L'équipe peut check tactilement chaque ligne, ajouter des
--             additifs, poster des commentaires en thread, consulter les
--             docs loueur et voir la présence live des autres participants.
--
--             Ce qu'on ajoute :
--               1. `matos_check_tokens`        — tokens d'accès anonymes
--               2. `matos_item_comments`       — thread de commentaires par item
--               3. `matos_version_attachments` — docs loueur (PDF, devis)
--               4. Colonnes `added_during_check`, `added_by`, `added_by_name`,
--                  `added_at` sur `matos_items` (additifs traçables)
--               5. Colonnes `pre_check_by_name` (+ post/prod) pour identifier
--                  les auteurs ANONYMES (pour les users auth, on a déjà
--                  `pre_check_by uuid` qui référence profiles)
--               6. RPC functions `check_*` (SECURITY DEFINER) que l'UI anon
--                  utilise pour lire/écrire via le token — bypass RLS et
--                  valide le token + expiration + révocation.
--
--             Le bucket Storage `matos-attachments` est créé dans une étape
--             séparée (Dashboard ou migration dédiée MAT-10B).
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--              DROP POLICY IF EXISTS, CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260421_mat_refonte_blocs.sql (tables matos_*),
--              schema.sql (profiles, set_updated_at),
--              ch3b_project_access.sql (can_read_outil / can_edit_outil).
-- ============================================================================

BEGIN;

-- ── 1. Tokens d'accès checklist terrain ──────────────────────────────────
-- Un token = un lien partageable donnant accès à UNE version matériel d'UN
-- projet, en lecture + écriture limitée (check tactile, additifs, comments,
-- upload de docs). Généré par un user auth, révocable, avec expiration
-- optionnelle. Le token lui-même est un secret opaque (~32 chars base64url).
CREATE TABLE IF NOT EXISTS matos_check_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token            text NOT NULL UNIQUE,
  version_id       uuid NOT NULL REFERENCES matos_versions(id) ON DELETE CASCADE,
  label            text,                 -- "Essais cams 21/04" (optionnel)
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,          -- soft delete
  expires_at       timestamptz,          -- NULL = pas d'expiration
  last_accessed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS matos_check_tokens_token_idx
  ON matos_check_tokens(token);
CREATE INDEX IF NOT EXISTS matos_check_tokens_version_idx
  ON matos_check_tokens(version_id);

COMMENT ON TABLE matos_check_tokens IS
  'Tokens d''accès au mode chantier /check/:token. Lecture + écriture scopée à UNE version. Révocable et expirable. Accès anon via RPC functions SECURITY DEFINER.';
COMMENT ON COLUMN matos_check_tokens.token IS
  'Secret opaque (~32 chars base64url). Généré côté client via crypto.getRandomValues.';


-- ── 2. Comments thread par item ──────────────────────────────────────────
-- Append-only : pas d'édition ni de suppression côté UX, on garde la trace
-- complète pour l'audit. author_id est NULL pour les users anon (accès par
-- token), author_name est toujours renseigné (nom saisi au 1er accès côté
-- terrain OU display_name du profil côté auth).
CREATE TABLE IF NOT EXISTS matos_item_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES matos_items(id) ON DELETE CASCADE,
  body         text NOT NULL,
  author_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author_name  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matos_item_comments_item_idx
  ON matos_item_comments(item_id, created_at);

COMMENT ON TABLE matos_item_comments IS
  'Thread append-only de commentaires par item matériel. author_id NULL si anon (token), author_name toujours renseigné.';


-- ── 3. Attachments par version (docs loueur) ─────────────────────────────
-- Fichiers PDF / images stockés dans le bucket Storage `matos-attachments`.
-- storage_path est la clé complète (ex: "versionId/uuid-devis.pdf"). Les
-- permissions d'accès au fichier côté Storage miroient les RLS de cette
-- table : auth classique via join version → project, anon via RPC.
CREATE TABLE IF NOT EXISTS matos_version_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        uuid NOT NULL REFERENCES matos_versions(id) ON DELETE CASCADE,
  filename          text NOT NULL,      -- nom affiché (original du fichier)
  storage_path      text NOT NULL,      -- clé Storage
  size_bytes        bigint,
  mime_type         text,
  uploaded_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_by_name  text,               -- pour upload anon via token
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matos_version_attachments_version_idx
  ON matos_version_attachments(version_id);

COMMENT ON TABLE matos_version_attachments IS
  'Documents attachés à une version matériel (devis loueur, fiches pack, BL). Fichiers dans bucket Storage matos-attachments.';


-- ── 4. matos_items : additifs + auteurs anon ─────────────────────────────
ALTER TABLE matos_items
  ADD COLUMN IF NOT EXISTS added_during_check boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS added_by           uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS added_by_name      text,
  ADD COLUMN IF NOT EXISTS added_at           timestamptz,
  ADD COLUMN IF NOT EXISTS pre_check_by_name  text,
  ADD COLUMN IF NOT EXISTS post_check_by_name text,
  ADD COLUMN IF NOT EXISTS prod_check_by_name text;

CREATE INDEX IF NOT EXISTS matos_items_added_check_idx
  ON matos_items(block_id) WHERE added_during_check = true;

COMMENT ON COLUMN matos_items.added_during_check IS
  'true = item ajouté en temps réel pendant les essais cams (mode chantier), affiché dans une section "Additifs" à part.';
COMMENT ON COLUMN matos_items.pre_check_by_name IS
  'Nom de l''auteur du pre_check pour les sessions ANONYMES (accès par token). pre_check_by (uuid) reste utilisé pour les users auth.';


-- ── 5. RLS — matos_check_tokens (auth seulement, anon via RPC) ───────────
-- Un user ne peut lister/créer/révoquer des tokens QUE sur les versions des
-- projets qu'il peut éditer.
ALTER TABLE matos_check_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_check_tokens_scoped_read"  ON matos_check_tokens;
DROP POLICY IF EXISTS "matos_check_tokens_scoped_write" ON matos_check_tokens;

CREATE POLICY "matos_check_tokens_scoped_read" ON matos_check_tokens
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_check_tokens.version_id
      AND can_read_outil(mv.project_id, 'materiel')
  ));

CREATE POLICY "matos_check_tokens_scoped_write" ON matos_check_tokens
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_check_tokens.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_check_tokens.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ));


-- ── 6. RLS — matos_item_comments (auth classique, anon via RPC) ──────────
ALTER TABLE matos_item_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_item_comments_scoped_read"  ON matos_item_comments;
DROP POLICY IF EXISTS "matos_item_comments_scoped_write" ON matos_item_comments;

CREATE POLICY "matos_item_comments_scoped_read" ON matos_item_comments
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_items  mi
    JOIN matos_blocks   mb ON mb.id = mi.block_id
    JOIN matos_versions mv ON mv.id = mb.version_id
    WHERE mi.id = matos_item_comments.item_id
      AND can_read_outil(mv.project_id, 'materiel')
  ));

CREATE POLICY "matos_item_comments_scoped_write" ON matos_item_comments
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_items  mi
    JOIN matos_blocks   mb ON mb.id = mi.block_id
    JOIN matos_versions mv ON mv.id = mb.version_id
    WHERE mi.id = matos_item_comments.item_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_items  mi
    JOIN matos_blocks   mb ON mb.id = mi.block_id
    JOIN matos_versions mv ON mv.id = mb.version_id
    WHERE mi.id = matos_item_comments.item_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ));


-- ── 7. RLS — matos_version_attachments ───────────────────────────────────
ALTER TABLE matos_version_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_attach_scoped_read"  ON matos_version_attachments;
DROP POLICY IF EXISTS "matos_attach_scoped_write" ON matos_version_attachments;

CREATE POLICY "matos_attach_scoped_read" ON matos_version_attachments
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_version_attachments.version_id
      AND can_read_outil(mv.project_id, 'materiel')
  ));

CREATE POLICY "matos_attach_scoped_write" ON matos_version_attachments
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_version_attachments.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_version_attachments.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ));


-- ── 8. RPC — résolution du token + fetch global ─────────────────────────
-- Stratégie d'accès anon : toutes les opérations passent par des functions
-- SECURITY DEFINER qui valident le token avant d'agir. Le token est vérifié
-- pour chaque appel (pas de session), ce qui simplifie la révocation.
-- Retour : JSON (plus souple que des TABLE types pour un bundle varié).

CREATE OR REPLACE FUNCTION _check_token_get_version_id(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_check_token_get_version_id$
DECLARE
  v_version_id uuid;
BEGIN
  SELECT version_id INTO v_version_id
    FROM matos_check_tokens
   WHERE token = p_token
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());
  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '28000';
  END IF;
  -- Touch last_accessed_at (best effort, on échoue pas l'appel si busy)
  UPDATE matos_check_tokens
     SET last_accessed_at = now()
   WHERE token = p_token;
  RETURN v_version_id;
END;
$_check_token_get_version_id$;

REVOKE ALL ON FUNCTION _check_token_get_version_id(text) FROM PUBLIC;
-- La fonction est marquée interne (underscore prefix) ; elle est appelée par
-- les autres check_* qui ont leur propre GRANT.


-- check_session_fetch : fetch global (version + blocks + items + loueurs +
-- comments + attachments). Un seul round-trip au chargement.
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


-- check_action_toggle : toggle pre_check_at sur un item.
-- Si pre_check_at est NULL → le remplit (coché). Sinon → remet à NULL.
-- Renvoie l'état nouveau sous forme { pre_check_at, pre_check_by_name }.
CREATE OR REPLACE FUNCTION check_action_toggle(
  p_token     text,
  p_item_id   uuid,
  p_user_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_toggle$
DECLARE
  v_version_id uuid;
  v_item_block uuid;
  v_is_checked boolean;
  v_new_checked_at  timestamptz;
  v_new_checked_by_name text;
BEGIN
  v_version_id := _check_token_get_version_id(p_token);

  -- Vérifie que l'item appartient à la version du token.
  SELECT mb.version_id INTO v_item_block
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_block IS NULL OR v_item_block <> v_version_id THEN
    RAISE EXCEPTION 'item not in this version' USING ERRCODE = '22023';
  END IF;

  SELECT (pre_check_at IS NOT NULL) INTO v_is_checked
    FROM matos_items WHERE id = p_item_id;

  IF v_is_checked THEN
    UPDATE matos_items
       SET pre_check_at = NULL,
           pre_check_by = NULL,
           pre_check_by_name = NULL
     WHERE id = p_item_id
     RETURNING pre_check_at, pre_check_by_name
          INTO v_new_checked_at, v_new_checked_by_name;
  ELSE
    UPDATE matos_items
       SET pre_check_at = now(),
           pre_check_by = NULL,  -- anon token, pas d'uuid
           pre_check_by_name = NULLIF(trim(p_user_name), '')
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
$check_action_toggle$;


-- check_action_add_item : ajoute un "additif" dans un bloc.
CREATE OR REPLACE FUNCTION check_action_add_item(
  p_token       text,
  p_block_id    uuid,
  p_designation text,
  p_quantite    integer,
  p_user_name   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_add_item$
DECLARE
  v_version_id uuid;
  v_block_version uuid;
  v_new_id uuid;
  v_next_sort integer;
  v_clean_desig text;
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

  RETURN jsonb_build_object('id', v_new_id);
END;
$check_action_add_item$;


-- check_action_add_comment : poste un commentaire sur un item.
CREATE OR REPLACE FUNCTION check_action_add_comment(
  p_token     text,
  p_item_id   uuid,
  p_body      text,
  p_user_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_add_comment$
DECLARE
  v_version_id uuid;
  v_item_version uuid;
  v_new_id uuid;
  v_clean_body text;
  v_clean_name text;
BEGIN
  v_version_id := _check_token_get_version_id(p_token);

  SELECT mb.version_id INTO v_item_version
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version IS NULL OR v_item_version <> v_version_id THEN
    RAISE EXCEPTION 'item not in this version' USING ERRCODE = '22023';
  END IF;

  v_clean_body := NULLIF(trim(p_body), '');
  IF v_clean_body IS NULL THEN
    RAISE EXCEPTION 'body required' USING ERRCODE = '23502';
  END IF;

  v_clean_name := COALESCE(NULLIF(trim(p_user_name), ''), 'Anonyme');

  INSERT INTO matos_item_comments (item_id, body, author_id, author_name)
  VALUES (p_item_id, v_clean_body, NULL, v_clean_name)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'item_id', p_item_id,
    'body', v_clean_body,
    'author_name', v_clean_name,
    'created_at', now()
  );
END;
$check_action_add_comment$;


-- check_action_set_flag : change le flag d'un item (ok/attention/probleme).
CREATE OR REPLACE FUNCTION check_action_set_flag(
  p_token   text,
  p_item_id uuid,
  p_flag    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_set_flag$
DECLARE
  v_version_id uuid;
  v_item_version uuid;
BEGIN
  v_version_id := _check_token_get_version_id(p_token);

  IF p_flag NOT IN ('ok', 'attention', 'probleme') THEN
    RAISE EXCEPTION 'invalid flag' USING ERRCODE = '22023';
  END IF;

  SELECT mb.version_id INTO v_item_version
    FROM matos_items mi
    JOIN matos_blocks mb ON mb.id = mi.block_id
   WHERE mi.id = p_item_id;
  IF v_item_version IS NULL OR v_item_version <> v_version_id THEN
    RAISE EXCEPTION 'item not in this version' USING ERRCODE = '22023';
  END IF;

  UPDATE matos_items SET flag = p_flag WHERE id = p_item_id;

  RETURN jsonb_build_object('item_id', p_item_id, 'flag', p_flag);
END;
$check_action_set_flag$;


-- check_attachment_signed_url : génère une URL signée de download pour un
-- attachment. N'utilise PAS storage.create_signed_url (pas dispo en RPC) —
-- à la place on renvoie le storage_path et le client demande le signed URL
-- côté Storage API avec la clé anon (qui PEUT générer un signed URL sur un
-- path dont il a le nom, tant que les policies Storage l'autorisent).
-- On ajoute aussi un token de preuve pour que les policies Storage valident.
-- → Pour la v1 on reste simple : on renvoie storage_path et le client appelle
--   supabase.storage.from('matos-attachments').createSignedUrl(path, 3600).
--   Les policies du bucket autorisent la lecture aux anon si le nom du
--   fichier est préfixé par un version_id lisible par le token courant.
-- C'est MAT-10B qui précisera les policies Storage.

-- ── 9. GRANTs : rendre les RPC callables par anon ────────────────────────
-- Par défaut, anon ne peut PAS appeler nos fonctions SECURITY DEFINER.
-- On accorde EXECUTE au rôle `anon` + `authenticated`.
REVOKE ALL ON FUNCTION check_session_fetch(text)                           FROM PUBLIC;
REVOKE ALL ON FUNCTION check_action_toggle(text, uuid, text)               FROM PUBLIC;
REVOKE ALL ON FUNCTION check_action_add_item(text, uuid, text, int, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION check_action_add_comment(text, uuid, text, text)    FROM PUBLIC;
REVOKE ALL ON FUNCTION check_action_set_flag(text, uuid, text)             FROM PUBLIC;

GRANT EXECUTE ON FUNCTION check_session_fetch(text)                           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_action_toggle(text, uuid, text)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_action_add_item(text, uuid, text, int, text)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_action_add_comment(text, uuid, text, text)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_action_set_flag(text, uuid, text)             TO anon, authenticated;


-- ── 10. Helper : révoquer un token (miroir de revoke_ical_token) ────────
CREATE OR REPLACE FUNCTION revoke_matos_check_token(p_token_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $revoke_matos_check_token$
BEGIN
  UPDATE matos_check_tokens
     SET revoked_at = COALESCE(revoked_at, now())
   WHERE id = p_token_id;
END;
$revoke_matos_check_token$;


-- ── 11. Realtime publication (comments + attachments + tokens) ──────────
-- Les items/blocs/versions sont déjà publiés par MAT-9B.
-- On ajoute les nouvelles tables pour que le front check-terrain reçoive
-- les inserts de comments / additifs en live.
DO $realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'matos_item_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE matos_item_comments;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'matos_version_attachments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE matos_version_attachments;
  END IF;
END;
$realtime$;


COMMIT;

-- ============================================================================
-- Fin de MAT-10A.
--
-- Prochaines étapes (hors migration SQL) :
--   MAT-10B : bucket Storage `matos-attachments` + policies
--   MAT-10C : lib/matosCheckToken.js + hook useCheckTokenSession
--   MAT-10D : route /check/:token
--   MAT-10E..M : UI mode chantier (check, additifs, comments, presence...)
-- ============================================================================
