-- ============================================================================
-- Migration : MAT-12 — Clôture des essais + archivage du bilan PDF
-- Date      : 2026-04-22
-- Contexte  : Une fois les essais matériel terminés, l'équipe (terrain ou
--             admin) déclenche une "clôture" qui :
--
--   1. Pose un flag sur la version (closed_at / closed_by_name).
--   2. Archive un ZIP de bilans PDF (1 global + 1 par loueur) dans le bucket
--      `matos-attachments` sous le préfixe `<version_id>/bilan/`.
--   3. Enregistre le bilan comme une pièce jointe standard dans
--      `matos_version_attachments` (titre "Bilan essais V{n}"), pour qu'il
--      apparaisse naturellement dans le viewer de documents /check/:token.
--
-- Décision Hugo (2026-04-22) : clôture = "juste un flag + archive PDF".
--   - On ne verrouille PAS l'édition (les admins peuvent toujours modifier).
--   - On ne révoque PAS les tokens terrain (l'équipe peut encore lire, et
--     re-clôturer si besoin pour regen le bilan).
--   - L'anon peut déclencher depuis /check/:token ; risque d'accident limité
--     car rien n'est verrouillé. Bouton derrière une modale de confirmation
--     côté front.
--
-- Architecture upload côté anon :
--   Le client anon a désormais le droit d'INSERER/UPSERTER dans
--   `storage.objects` bucket=matos-attachments UNIQUEMENT pour un path
--   commençant par `<version_id>/bilan/` ET à condition qu'un token actif
--   existe pour cette version. Le filename est libre mais la policy bloque
--   tout upload hors préfixe bilan — les loueurs/devis/etc. restent réservés
--   aux authenticated.
--
-- Idempotent : ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF.
-- Dépend de  : 20260421_mat10_checklist_terrain.sql, 20260421_mat10j_attachments.sql,
--              20260421_mat10n_item_removal.sql
-- ============================================================================

BEGIN;

-- ── 1. Colonnes clôture sur matos_versions ──────────────────────────────
ALTER TABLE matos_versions
  ADD COLUMN IF NOT EXISTS closed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by            uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_by_name       text,
  ADD COLUMN IF NOT EXISTS bilan_archive_path   text;

COMMENT ON COLUMN matos_versions.closed_at IS
  'Timestamp de la dernière clôture (re-clôturable : écrasement à chaque ré-archivage). NULL = version encore en cours d''essais.';
COMMENT ON COLUMN matos_versions.bilan_archive_path IS
  'Storage path du ZIP bilan le plus récent (bucket matos-attachments, préfixe <version_id>/bilan/). Aligné avec une ligne dans matos_version_attachments.';


-- ── 2. Policy Storage : anon peut uploader sous <version_id>/bilan/ ────
-- Les paths loueur classiques sont `<version_id>/<uuid>.<ext>` (policy MAT-10J
-- réservée aux authenticated). On ouvre maintenant un second chemin dédié
-- au bilan : `<version_id>/bilan/<filename>.zip`, utilisable par l'anon tant
-- qu'un token actif existe pour la version. Le 2e segment de path = 'bilan'
-- est le seul marqueur qu'on reconnaît ; tout autre dépôt anon reste bloqué.
--
-- NOTE : on autorise aussi UPDATE (upsert) pour permettre de remplacer le
-- ZIP lors d'une re-clôture, sans jamais avoir à DELETE (garde l'ancien fichier
-- pour l'audit si la session bascule sur un nouvel uuid de filename).
DROP POLICY IF EXISTS "matos_attachments_anon_insert_bilan" ON storage.objects;
CREATE POLICY "matos_attachments_anon_insert_bilan"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'matos-attachments'
    AND (storage.foldername(name))[2] = 'bilan'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens t
      WHERE t.version_id::text = (storage.foldername(name))[1]
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
    )
  );

DROP POLICY IF EXISTS "matos_attachments_anon_update_bilan" ON storage.objects;
CREATE POLICY "matos_attachments_anon_update_bilan"
  ON storage.objects FOR UPDATE
  TO anon
  USING (
    bucket_id = 'matos-attachments'
    AND (storage.foldername(name))[2] = 'bilan'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens t
      WHERE t.version_id::text = (storage.foldername(name))[1]
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
    )
  )
  WITH CHECK (
    bucket_id = 'matos-attachments'
    AND (storage.foldername(name))[2] = 'bilan'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens t
      WHERE t.version_id::text = (storage.foldername(name))[1]
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
    )
  );

-- La SELECT policy anon MAT-10J s'applique déjà aux paths `<version_id>/...`
-- donc lire le bilan passe par le même check. Pas besoin d'étendre.


-- ── 3. Patch check_session_fetch : expose les champs de clôture ─────────
-- On régénère la fonction pour ajouter `closed_at`, `closed_by_name`,
-- `bilan_archive_path` dans le bloc `version` du JSON. Le front en a besoin
-- pour afficher la bannière "Essais clôturés" et le lien de téléchargement
-- du bilan archivé.
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
        'is_active', mv.is_active,
        -- NEW MAT-12 : champs de clôture
        'closed_at', mv.closed_at,
        'closed_by_name', mv.closed_by_name,
        'bilan_archive_path', mv.bilan_archive_path
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
      WHERE ma.version_id = v_version_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$check_session_fetch$;


-- ── 4. RPC : clôturer les essais (anon via token OU authenticated) ──────
-- Le client uploade d'abord le ZIP via le chemin Storage ouvert plus haut,
-- PUIS appelle cette RPC avec le path. La RPC :
--
--   1. Valide le token (SECURITY DEFINER ; lève si invalide/expiré)
--   2. Pose / met à jour closed_at, closed_by_name, bilan_archive_path
--   3. Insère une ligne dans matos_version_attachments pour exposer le ZIP
--      dans le viewer docs standard (titre "Bilan essais V{n}")
--   4. Retourne l'état final du bloc version (utile pour refresh côté client)
--
-- Idempotente : réappeler remplace l'archive précédente (on update la ligne
-- existante ou on en crée une nouvelle avec le même title). On ne supprime
-- PAS l'ancien fichier Storage — il reste comme audit trail, accessible via
-- la SELECT policy (mais pas référencé par bilan_archive_path).
CREATE OR REPLACE FUNCTION check_action_close_essais(
  p_token              text,
  p_user_name          text,
  p_archive_path       text,     -- '<version_id>/bilan/<filename>.zip' (NULL = clôture sans archive)
  p_archive_filename   text,     -- 'Bilan-Projet-V1.zip'
  p_archive_size_bytes bigint,   -- pour l'affichage du viewer
  p_archive_mime       text      -- 'application/zip'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $check_action_close_essais$
DECLARE
  v_version_id      uuid;
  v_numero          integer;
  v_title           text;
  v_clean_user_name text;
  v_attachment_id   uuid;
BEGIN
  -- 1. Valide le token et récupère la version
  v_version_id := _check_token_get_version_id(p_token);
  v_clean_user_name := NULLIF(trim(p_user_name), '');

  -- 2. Récupère le numéro de version pour le title de l'attachment
  SELECT numero INTO v_numero FROM matos_versions WHERE id = v_version_id;
  v_title := 'Bilan essais V' || COALESCE(v_numero::text, '?');

  -- 3. Pose / met à jour les champs clôture sur la version
  UPDATE matos_versions
     SET closed_at          = now(),
         closed_by          = NULL,  -- anon — côté authenticated un admin update direct via RLS
         closed_by_name     = v_clean_user_name,
         bilan_archive_path = COALESCE(p_archive_path, bilan_archive_path)
   WHERE id = v_version_id;

  -- 4. Si une archive a été uploadée, on enregistre la pièce jointe. Une
  --    ligne par clôture (pas d'UPSERT — on veut l'historique). L'UI peut
  --    filtrer pour n'afficher que la plus récente via title like 'Bilan%'.
  IF p_archive_path IS NOT NULL THEN
    INSERT INTO matos_version_attachments (
      version_id, title, filename, storage_path,
      size_bytes, mime_type, uploaded_by, uploaded_by_name
    ) VALUES (
      v_version_id, v_title,
      COALESCE(NULLIF(trim(p_archive_filename), ''), 'bilan.zip'),
      p_archive_path,
      p_archive_size_bytes,
      COALESCE(NULLIF(trim(p_archive_mime), ''), 'application/zip'),
      NULL,
      v_clean_user_name
    )
    RETURNING id INTO v_attachment_id;
  END IF;

  -- 5. Retour : snapshot des champs nouvellement posés + id de la pièce jointe
  RETURN jsonb_build_object(
    'version_id', v_version_id,
    'closed_at', (SELECT closed_at FROM matos_versions WHERE id = v_version_id),
    'closed_by_name', v_clean_user_name,
    'bilan_archive_path', (SELECT bilan_archive_path FROM matos_versions WHERE id = v_version_id),
    'attachment_id', v_attachment_id
  );
END;
$check_action_close_essais$;


-- ── 5. RPC : ré-ouvrir une version clôturée ─────────────────────────────
-- Réservé aux authenticated avec can_edit_outil (donc PAS de SECURITY DEFINER
-- et PAS de token anon). Efface closed_at/closed_by_name/bilan_archive_path
-- mais NE supprime PAS les pièces jointes bilan déjà archivées (audit trail).
CREATE OR REPLACE FUNCTION reopen_matos_version(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $reopen_matos_version$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT project_id INTO v_project_id FROM matos_versions WHERE id = p_version_id;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'version introuvable' USING ERRCODE = '22023';
  END IF;

  -- can_edit_outil fait la vérif fine (membre org + droit outil 'materiel')
  IF NOT can_edit_outil(v_project_id, 'materiel') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE matos_versions
     SET closed_at          = NULL,
         closed_by          = NULL,
         closed_by_name     = NULL,
         bilan_archive_path = NULL
   WHERE id = p_version_id;

  RETURN jsonb_build_object('version_id', p_version_id, 'reopened', true);
END;
$reopen_matos_version$;


-- ── 6. GRANTs ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION check_action_close_essais(text, text, text, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reopen_matos_version(uuid)                                       FROM PUBLIC;

GRANT EXECUTE ON FUNCTION check_action_close_essais(text, text, text, text, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION reopen_matos_version(uuid)                                       TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de MAT-12.
--
-- Côté front (à livrer après migration) :
--   - src/lib/matosCloture.js               : wrappers RPC + upload ZIP
--   - src/features/materiel/matosBilanPdf.js: builder PDF global + par loueur
--   - src/lib/matosCheckToken.js            : closeCheckEssais()
--   - src/hooks/useCheckTokenSession.js     : actions.close + exposition session.version.closed_at
--   - src/pages/CheckSession.jsx            : bouton "Clôturer les essais" + bannière clôturée
--   - src/features/materiel/components/MaterielHeader.jsx : bouton admin + badge
--
-- TODO MAT-11 (quand livré) :
--   Le builder matosBilanPdf réserve déjà une place "photos" qui restera vide
--   tant que MAT-11 n'aura pas exposé `item.photos[]`. Aucun SQL à modifier
--   pour brancher — juste lire les miniatures dans buildBilanSection.
-- ============================================================================
