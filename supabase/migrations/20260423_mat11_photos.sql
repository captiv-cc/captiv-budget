-- ============================================================================
-- Migration : MAT-11A — Photos par item / bloc (problème + pack)
-- Date      : 2026-04-23
-- ============================================================================
--
-- Contexte :
--   Deux usages distincts des photos pendant les essais matériel :
--
--   1. Photo "problème" (kind='probleme') — rayure sur une optique, câble
--      pété, vis manquante. Attachée à UN item précis. Objectif : apparaître
--      dans le bilan PDF envoyé au loueur comme justificatif.
--
--   2. Photo "pack" (kind='pack') — contenu d'un pelicase : 1 photo ouverte
--      qui montre tout ce qu'il y a dedans. Usage interne remballe "on remet
--      tout comme ça, on a pas oublié un truc". Attachée à UN BLOC
--      (typiquement un bloc "Pelicase 3 — HF" ou similaire). Objectif :
--      aide-mémoire visuelle côté équipe, PAS visible dans le bilan loueur
--      par défaut (Hugo : "visible en lecture seule dans /check/:token,
--      mais pas dans le PDF loueur").
--
-- Décisions Hugo (session en cours) :
--   1. ancrage XOR : une photo est liée SOIT à un item, SOIT à un bloc (jamais
--      aux deux). Les pack photos vivent au bloc parce qu'il n'y a pas d'item
--      "pelicase" dans la checklist (c'est le bloc entier).
--   2. compression par défaut + toggle "qualité originale" (côté client) →
--      rien à enforcer au SQL. On se contente de storer ce qu'on reçoit.
--   3. pas d'annotations / dessin → pas de colonne dédiée.
--   4. accès anon (/check/:token) : peut ajouter/modifier/supprimer SES
--      photos (matching soft sur uploaded_by_name, même niveau de confiance
--      que matos_item_comments et le check token lui-même).
--   5. admin (authed) peut tout supprimer.
--   6. limite 10 photos par item / par bloc (hard stop dans la RPC).
--   7. volumétrie prévue : 1 à 50 photos par projet, pas besoin d'index
--      exotique.
--
-- Architecture :
--   - Table matos_item_photos (dénormalisée : on stocke version_id directement
--     pour accélérer les RLS et aligner avec le storage path).
--   - Bucket storage.matos-item-photos distinct de matos-attachments (limites
--     de taille + MIME types différentes ; facilite la gestion du CDN si on
--     passe à Imgix/similaire plus tard).
--   - Path : <version_id>/<photo_uuid>.<ext>  (1er segment = version_id → RLS).
--   - 6 RPC SECURITY DEFINER (3 actions × 2 flows token/authed) qui valident
--     l'anchor (item ou bloc ; appartient bien à la version), la limite de
--     10 photos, et pour le flow token, la correspondance uploaded_by_name.
--
-- Suppression : la RPC ne supprime QUE la ligne DB. Le client supprime l'objet
-- storage en parallèle (les policies RLS sur storage.objects valident
-- l'autorisation symétriquement). On accepte le risque d'orphelin storage si
-- la 2e étape échoue — même pattern que MAT-10J attachments. Un sweeper
-- périodique pourra nettoyer plus tard si besoin.
--
-- Dépend de :
--   - 20260421_mat10_checklist_terrain.sql    (_check_token_get_version_id)
--   - 20260421_mat10j_attachments.sql         (pattern bucket + RLS)
--   - 20260422_mat14_authed_check_session.sql (_check_fetch_bundle,
--                                              _check_authed_gate_edit,
--                                              _check_authed_user_name)
--   - 20260422_mat20_version_loueur_infos.sql (dernière shape de
--                                              _check_fetch_bundle)
-- ============================================================================

BEGIN;


-- ── 1. Table matos_item_photos ──────────────────────────────────────────────
-- XOR : item_id XOR block_id via CHECK — exactement un des deux doit être non
-- NULL. Ce design évite de dupliquer les photos pack sur chaque item du bloc.
CREATE TABLE IF NOT EXISTS matos_item_photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        uuid NOT NULL REFERENCES matos_versions(id) ON DELETE CASCADE,
  item_id           uuid REFERENCES matos_items(id)  ON DELETE CASCADE,
  block_id          uuid REFERENCES matos_blocks(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('probleme', 'pack')),
  storage_path      text NOT NULL UNIQUE,
  mime_type         text,
  size_bytes        bigint,
  width             integer,
  height            integer,
  caption           text,
  uploaded_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_by_name  text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- XOR : exactement un des deux ancrages
  CONSTRAINT matos_item_photos_anchor_xor
    CHECK ((item_id IS NOT NULL)::int + (block_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS matos_item_photos_version_idx
  ON matos_item_photos(version_id);
CREATE INDEX IF NOT EXISTS matos_item_photos_item_idx
  ON matos_item_photos(item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS matos_item_photos_block_idx
  ON matos_item_photos(block_id) WHERE block_id IS NOT NULL;

COMMENT ON TABLE matos_item_photos IS
  'MAT-11 : photos prises pendant les essais. kind=probleme→photo d''un défaut (rayure, câble cassé) ancrée sur un item ; kind=pack→photo du contenu d''un pelicase ancrée sur un bloc. Ancrage XOR (exactement un de item_id/block_id non-NULL).';
COMMENT ON COLUMN matos_item_photos.version_id IS
  'Dénormalisé depuis items.blocks.version_id (resp. blocks.version_id) pour que les RLS et le storage path (<version_id>/...) soient directs. Cohérence garantie par la logique RPC (on dérive toujours version_id du block).';
COMMENT ON COLUMN matos_item_photos.uploaded_by_name IS
  'Nom saisi par l''utilisateur (mode token) ou nom du profil (mode authed). Sert de base au matching "propriétaire" pour la modification/suppression en mode token (soft control, case-insensitive trim).';
COMMENT ON COLUMN matos_item_photos.storage_path IS
  'Chemin complet dans le bucket matos-item-photos. Format : <version_id>/<uuid>.<ext>. Unique pour éviter toute collision.';


-- ── 2. RLS sur la table ─────────────────────────────────────────────────────
-- L'anon N'ACCÈDE PAS à la table directement — il passe par les RPC
-- SECURITY DEFINER. Les policies ici ne concernent que le trafic authed
-- (client SDK supabase loggé, dashboard, etc.).
ALTER TABLE matos_item_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_item_photos_read_authed"  ON matos_item_photos;
DROP POLICY IF EXISTS "matos_item_photos_write_authed" ON matos_item_photos;

CREATE POLICY "matos_item_photos_read_authed" ON matos_item_photos
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_item_photos.version_id
      AND can_read_outil(mv.project_id, 'materiel')
  ));

CREATE POLICY "matos_item_photos_write_authed" ON matos_item_photos
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_item_photos.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM matos_versions mv
    WHERE mv.id = matos_item_photos.version_id
      AND can_edit_outil(mv.project_id, 'materiel')
  ));


-- ── 3. Bucket Storage `matos-item-photos` ───────────────────────────────────
-- Private : toute lecture passe par signed URL. Taille limite 20 MB pour
-- accueillir des JPEG HD et HEIC natifs iPhone avant recompression client.
-- MIME types restreints à image/* — le check est côté Storage (mime_type
-- sniff du fichier), pas juste sur l'extension du nom.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'matos-item-photos',
  'matos-item-photos',
  false,
  20 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── 4. Policies Storage ──────────────────────────────────────────────────────
-- Path pattern : <version_id>/<uuid>.<ext>
-- Le 1er segment identifie la version → split_part(name, '/', 1).

DROP POLICY IF EXISTS "matos-item-photos read authed"   ON storage.objects;
DROP POLICY IF EXISTS "matos-item-photos read anon"     ON storage.objects;
DROP POLICY IF EXISTS "matos-item-photos insert authed" ON storage.objects;
DROP POLICY IF EXISTS "matos-item-photos insert anon"   ON storage.objects;
DROP POLICY IF EXISTS "matos-item-photos update authed" ON storage.objects;
DROP POLICY IF EXISTS "matos-item-photos delete authed" ON storage.objects;
DROP POLICY IF EXISTS "matos-item-photos delete anon"   ON storage.objects;

-- ░ SELECT authenticated : can_read_outil sur le project.
CREATE POLICY "matos-item-photos read authed"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'matos-item-photos'
    AND EXISTS (
      SELECT 1 FROM matos_versions mv
      WHERE mv.id::text = split_part(storage.objects.name, '/', 1)
        AND can_read_outil(mv.project_id, 'materiel')
    )
  );

-- ░ SELECT anon : valide tant qu'un token actif existe pour la version.
--   Même pattern que matos-attachments (MAT-10J).
CREATE POLICY "matos-item-photos read anon"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'matos-item-photos'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens mct
      WHERE mct.version_id::text = split_part(storage.objects.name, '/', 1)
        AND mct.revoked_at IS NULL
        AND (mct.expires_at IS NULL OR mct.expires_at > now())
    )
  );

-- ░ INSERT authenticated : can_edit_outil.
CREATE POLICY "matos-item-photos insert authed"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'matos-item-photos'
    AND EXISTS (
      SELECT 1 FROM matos_versions mv
      WHERE mv.id::text = split_part(storage.objects.name, '/', 1)
        AND can_edit_outil(mv.project_id, 'materiel')
    )
  );

-- ░ INSERT anon : token actif requis.
--   Nouveau par rapport à MAT-10J : on ouvre l'upload à l'anon (équivalent à
--   la policy bilan introduite par MAT-12, mais sans contrainte de préfixe —
--   tout le bucket est dédié aux photos de la checklist, pas besoin de sous-
--   dossier réservé).
CREATE POLICY "matos-item-photos insert anon"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'matos-item-photos'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens mct
      WHERE mct.version_id::text = split_part(storage.objects.name, '/', 1)
        AND mct.revoked_at IS NULL
        AND (mct.expires_at IS NULL OR mct.expires_at > now())
    )
  );

-- ░ UPDATE authenticated : can_edit_outil (rarement utilisé — les captions
--   sont stockées en DB, pas dans le fichier).
CREATE POLICY "matos-item-photos update authed"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'matos-item-photos'
    AND EXISTS (
      SELECT 1 FROM matos_versions mv
      WHERE mv.id::text = split_part(storage.objects.name, '/', 1)
        AND can_edit_outil(mv.project_id, 'materiel')
    )
  );

-- ░ DELETE authenticated : can_edit_outil.
CREATE POLICY "matos-item-photos delete authed"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'matos-item-photos'
    AND EXISTS (
      SELECT 1 FROM matos_versions mv
      WHERE mv.id::text = split_part(storage.objects.name, '/', 1)
        AND can_edit_outil(mv.project_id, 'materiel')
    )
  );

-- ░ DELETE anon : token actif requis.
--   Le matching uploader_name est fait côté RPC avant d'arriver ici. Le
--   storage-level ne bloque que la dérive totale (un anon sans token ne
--   peut rien supprimer). Même niveau de confiance que pour l'upload.
CREATE POLICY "matos-item-photos delete anon"
  ON storage.objects FOR DELETE
  TO anon
  USING (
    bucket_id = 'matos-item-photos'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens mct
      WHERE mct.version_id::text = split_part(storage.objects.name, '/', 1)
        AND mct.revoked_at IS NULL
        AND (mct.expires_at IS NULL OR mct.expires_at > now())
    )
  );


-- ── 5. Helper privé : résout l'anchor (item|block) → (version_id, block_id) ─
-- Factorisé parce que les 4 RPC upload/delete/update font toutes la même
-- gymnastique. Retourne le version_id de la version qui héberge l'anchor,
-- et block_id résolu (pour le cas pack où on reçoit block_id direct, et
-- pour le cas item où on dérive le block_id parent). Lève si l'anchor
-- n'existe pas ou si les deux / aucun ancrage sont fournis.
CREATE OR REPLACE FUNCTION _matos_photo_resolve_anchor(
  p_item_id  uuid,
  p_block_id uuid
) RETURNS TABLE (version_id uuid, block_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_matos_photo_resolve_anchor$
BEGIN
  -- XOR check côté input (redondant avec le CHECK DB, mais permet un
  -- message d'erreur plus clair avant insert).
  IF (p_item_id IS NULL AND p_block_id IS NULL)
     OR (p_item_id IS NOT NULL AND p_block_id IS NOT NULL) THEN
    RAISE EXCEPTION 'anchor invalide : fournir item_id OU block_id (exactement un)'
      USING ERRCODE = '22023';
  END IF;

  IF p_item_id IS NOT NULL THEN
    -- Photo problème : ancrage item → on remonte au bloc parent.
    RETURN QUERY
      SELECT mb.version_id, mi.block_id
        FROM matos_items mi
        JOIN matos_blocks mb ON mb.id = mi.block_id
       WHERE mi.id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item introuvable' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- Photo pack : ancrage bloc direct.
    RETURN QUERY
      SELECT mb.version_id, mb.id
        FROM matos_blocks mb
       WHERE mb.id = p_block_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bloc introuvable' USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$_matos_photo_resolve_anchor$;

REVOKE ALL ON FUNCTION _matos_photo_resolve_anchor(uuid, uuid) FROM PUBLIC;


-- ── 6. Helper privé : vérifie la limite de 10 photos / anchor ───────────────
CREATE OR REPLACE FUNCTION _matos_photo_enforce_limit(
  p_item_id  uuid,
  p_block_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_matos_photo_enforce_limit$
DECLARE
  v_count integer;
BEGIN
  IF p_item_id IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM matos_item_photos
     WHERE item_id = p_item_id;
  ELSE
    SELECT count(*) INTO v_count
      FROM matos_item_photos
     WHERE block_id = p_block_id;
  END IF;

  IF v_count >= 10 THEN
    RAISE EXCEPTION 'limite de 10 photos atteinte pour cet ancrage'
      USING ERRCODE = '23514';
  END IF;
END;
$_matos_photo_enforce_limit$;

REVOKE ALL ON FUNCTION _matos_photo_enforce_limit(uuid, uuid) FROM PUBLIC;


-- ── 7. RPC : upload photo (token anon) ──────────────────────────────────────
-- Contrat : le client a DÉJÀ uploadé l'objet dans storage.matos-item-photos
-- via son policy anon. Il appelle ensuite cette RPC pour enregistrer la ligne
-- DB (avec validation anchor + limite + attribution du uploaded_by_name).
--
-- storage_path doit commencer par `<version_id>/` où version_id = celle du
-- token. Sinon → exception (défense contre un client qui inventerait un
-- storage_path arbitraire ; la policy storage a déjà filtré mais double check).
DROP FUNCTION IF EXISTS check_upload_photo(text, uuid, uuid, text, text, text, bigint, integer, integer, text, text);

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
  v_anchor_version_id uuid;
  v_anchor_block_id   uuid;
  v_clean_name        text;
  v_new_id            uuid;
  v_now               timestamptz;
BEGIN
  v_token_version_id := _check_token_get_version_id(p_token);

  IF p_kind NOT IN ('probleme', 'pack') THEN
    RAISE EXCEPTION 'kind invalide : probleme|pack attendu' USING ERRCODE = '22023';
  END IF;

  SELECT r.version_id, r.block_id
    INTO v_anchor_version_id, v_anchor_block_id
    FROM _matos_photo_resolve_anchor(p_item_id, p_block_id) r;

  IF v_anchor_version_id <> v_token_version_id THEN
    RAISE EXCEPTION 'ancrage hors version du token' USING ERRCODE = '22023';
  END IF;

  -- Double check : le storage_path doit être préfixé par version_id. Sinon
  -- on laisse un orphelin ingérable si la DB et le storage divergent.
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

REVOKE ALL ON FUNCTION check_upload_photo(text, uuid, uuid, text, text, text, bigint, integer, integer, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_upload_photo(text, uuid, uuid, text, text, text, bigint, integer, integer, text, text)
  TO anon, authenticated;


-- ── 8. RPC : upload photo (authed) ──────────────────────────────────────────
DROP FUNCTION IF EXISTS check_upload_photo_authed(uuid, uuid, text, text, text, bigint, integer, integer, text);

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

  IF p_kind NOT IN ('probleme', 'pack') THEN
    RAISE EXCEPTION 'kind invalide : probleme|pack attendu' USING ERRCODE = '22023';
  END IF;

  SELECT r.version_id, r.block_id
    INTO v_anchor_version_id, v_anchor_block_id
    FROM _matos_photo_resolve_anchor(p_item_id, p_block_id) r;

  -- Gate can_edit_outil via le helper standard.
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

REVOKE ALL ON FUNCTION check_upload_photo_authed(uuid, uuid, text, text, text, bigint, integer, integer, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_upload_photo_authed(uuid, uuid, text, text, text, bigint, integer, integer, text)
  TO authenticated;


-- ── 9. RPC : delete photo (token anon) ──────────────────────────────────────
-- Matching soft sur uploaded_by_name (case/trim-insensitive). L'anon ne peut
-- supprimer QUE ses propres photos. Retourne le storage_path pour que le
-- client enchaîne avec storage.remove() — la RPC ne supprime que la ligne DB.
DROP FUNCTION IF EXISTS check_delete_photo(text, uuid, text);

CREATE OR REPLACE FUNCTION check_delete_photo(
  p_token     text,
  p_photo_id  uuid,
  p_user_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_delete_photo$
DECLARE
  v_token_version_id  uuid;
  v_photo_version_id  uuid;
  v_photo_uploader    text;
  v_storage_path      text;
  v_clean_name        text;
BEGIN
  v_token_version_id := _check_token_get_version_id(p_token);

  SELECT version_id, uploaded_by_name, storage_path
    INTO v_photo_version_id, v_photo_uploader, v_storage_path
    FROM matos_item_photos
   WHERE id = p_photo_id;
  IF v_photo_version_id IS NULL THEN
    RAISE EXCEPTION 'photo introuvable' USING ERRCODE = '22023';
  END IF;

  IF v_photo_version_id <> v_token_version_id THEN
    RAISE EXCEPTION 'photo hors version du token' USING ERRCODE = '22023';
  END IF;

  v_clean_name := COALESCE(NULLIF(trim(p_user_name), ''), '');
  IF lower(v_clean_name) <> lower(COALESCE(v_photo_uploader, '')) THEN
    RAISE EXCEPTION 'seul l''uploader peut supprimer sa photo'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM matos_item_photos WHERE id = p_photo_id;

  RETURN jsonb_build_object(
    'id', p_photo_id,
    'storage_path', v_storage_path
  );
END;
$check_delete_photo$;

REVOKE ALL ON FUNCTION check_delete_photo(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_delete_photo(text, uuid, text) TO anon, authenticated;


-- ── 10. RPC : delete photo (authed) ─────────────────────────────────────────
-- Admin : supprime n'importe quelle photo du projet dès lors que
-- can_edit_outil=true.
DROP FUNCTION IF EXISTS check_delete_photo_authed(uuid);

CREATE OR REPLACE FUNCTION check_delete_photo_authed(
  p_photo_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_delete_photo_authed$
DECLARE
  v_photo_version_id uuid;
  v_storage_path     text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT version_id, storage_path
    INTO v_photo_version_id, v_storage_path
    FROM matos_item_photos
   WHERE id = p_photo_id;
  IF v_photo_version_id IS NULL THEN
    RAISE EXCEPTION 'photo introuvable' USING ERRCODE = '22023';
  END IF;

  PERFORM _check_authed_gate_edit(v_photo_version_id);

  DELETE FROM matos_item_photos WHERE id = p_photo_id;

  RETURN jsonb_build_object(
    'id', p_photo_id,
    'storage_path', v_storage_path
  );
END;
$check_delete_photo_authed$;

REVOKE ALL ON FUNCTION check_delete_photo_authed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_delete_photo_authed(uuid) TO authenticated;


-- ── 11. RPC : update caption (token anon) ───────────────────────────────────
-- Même matching soft que le delete. Caption peut être vidée (chaîne vide → NULL).
DROP FUNCTION IF EXISTS check_update_photo_caption(text, uuid, text, text);

CREATE OR REPLACE FUNCTION check_update_photo_caption(
  p_token     text,
  p_photo_id  uuid,
  p_caption   text,
  p_user_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_update_photo_caption$
DECLARE
  v_token_version_id uuid;
  v_photo_version_id uuid;
  v_photo_uploader   text;
  v_clean_caption    text;
  v_clean_name       text;
BEGIN
  v_token_version_id := _check_token_get_version_id(p_token);

  SELECT version_id, uploaded_by_name
    INTO v_photo_version_id, v_photo_uploader
    FROM matos_item_photos
   WHERE id = p_photo_id;
  IF v_photo_version_id IS NULL THEN
    RAISE EXCEPTION 'photo introuvable' USING ERRCODE = '22023';
  END IF;

  IF v_photo_version_id <> v_token_version_id THEN
    RAISE EXCEPTION 'photo hors version du token' USING ERRCODE = '22023';
  END IF;

  v_clean_name := COALESCE(NULLIF(trim(p_user_name), ''), '');
  IF lower(v_clean_name) <> lower(COALESCE(v_photo_uploader, '')) THEN
    RAISE EXCEPTION 'seul l''uploader peut modifier sa photo'
      USING ERRCODE = '42501';
  END IF;

  v_clean_caption := NULLIF(trim(p_caption), '');

  UPDATE matos_item_photos
     SET caption = v_clean_caption
   WHERE id = p_photo_id;

  RETURN jsonb_build_object(
    'id', p_photo_id,
    'caption', v_clean_caption
  );
END;
$check_update_photo_caption$;

REVOKE ALL ON FUNCTION check_update_photo_caption(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_update_photo_caption(text, uuid, text, text) TO anon, authenticated;


-- ── 12. RPC : update caption (authed) ───────────────────────────────────────
DROP FUNCTION IF EXISTS check_update_photo_caption_authed(uuid, text);

CREATE OR REPLACE FUNCTION check_update_photo_caption_authed(
  p_photo_id uuid,
  p_caption  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_update_photo_caption_authed$
DECLARE
  v_photo_version_id uuid;
  v_clean_caption    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT version_id INTO v_photo_version_id
    FROM matos_item_photos
   WHERE id = p_photo_id;
  IF v_photo_version_id IS NULL THEN
    RAISE EXCEPTION 'photo introuvable' USING ERRCODE = '22023';
  END IF;

  PERFORM _check_authed_gate_edit(v_photo_version_id);

  v_clean_caption := NULLIF(trim(p_caption), '');

  UPDATE matos_item_photos
     SET caption = v_clean_caption
   WHERE id = p_photo_id;

  RETURN jsonb_build_object(
    'id', p_photo_id,
    'caption', v_clean_caption
  );
END;
$check_update_photo_caption_authed$;

REVOKE ALL ON FUNCTION check_update_photo_caption_authed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_update_photo_caption_authed(uuid, text) TO authenticated;


-- ── 13. Patch _check_fetch_bundle pour inclure les photos ───────────────────
-- Repart de la shape MAT-20 (dernière version) + nouvelle clé 'photos'.
-- ATTENTION : toute divergence avec MAT-20 casserait le reste du front
-- (le helper sert check_session_fetch ET check_session_fetch_authed).
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
    ), '[]'::jsonb),
    -- NEW MAT-11 : photos (probleme + pack). Ancrage XOR item|block
    -- déjà garanti côté insert.
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

-- Fin de MAT-11A.
