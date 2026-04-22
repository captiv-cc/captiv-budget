-- ════════════════════════════════════════════════════════════════════════════
-- MAT-10J : Documents loueur — finalisation bucket + title + accès anon
-- ════════════════════════════════════════════════════════════════════════════
--
-- Cette migration :
--   1. Ajoute la colonne `title` à `matos_version_attachments` (libellé libre
--      tapé par l'utilisateur lors de l'upload — ex. "Devis VDEF LoueurA").
--      `filename` reste le nom original du fichier côté disque ; `title` sert
--      uniquement à l'affichage (liste + viewer).
--
--   2. Crée (idempotent) le bucket Storage `matos-attachments` + policies RLS
--      sur `storage.objects`. Les fichiers sont organisés par `version_id/` :
--        - facilite le nettoyage au drop d'une version (préfixe unique)
--        - permet aux policies de vérifier l'appartenance via le path
--
--      Policies :
--        - authenticated : CRUD sur matos-attachments/<version_id>/* si
--          can_read/edit_outil('materiel') sur le project parent.
--        - anon : SELECT si au moins 1 token actif existe pour la version
--          dans le path (la révocation de tous les tokens coupe l'accès).
--
--   3. Patche `check_session_fetch` pour inclure `title` dans le payload.
--
-- Idempotent : ADD COLUMN IF NOT EXISTS, bucket INSERT ON CONFLICT DO NOTHING,
-- CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS avant CREATE POLICY.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. Colonne title ────────────────────────────────────────────────────
ALTER TABLE matos_version_attachments
  ADD COLUMN IF NOT EXISTS title text;

COMMENT ON COLUMN matos_version_attachments.title IS
  'Libellé libre saisi par l''utilisateur lors de l''upload (ex. "Devis VDEF LoueurA"). Peut être NULL → fallback sur filename.';


-- ── 2. Bucket Storage `matos-attachments` ───────────────────────────────
-- Créé private : tout accès passe par policies RLS + signed URL côté client.
INSERT INTO storage.buckets (id, name, public)
VALUES ('matos-attachments', 'matos-attachments', false)
ON CONFLICT (id) DO NOTHING;


-- ── 3. Policies Storage sur storage.objects ─────────────────────────────
-- Pattern des paths : "<version_id>/<uuid>.<ext>"
-- La partie avant le premier "/" est donc le version_id (UUID text).

DROP POLICY IF EXISTS "matos-attachments read authed"   ON storage.objects;
DROP POLICY IF EXISTS "matos-attachments read anon"     ON storage.objects;
DROP POLICY IF EXISTS "matos-attachments insert authed" ON storage.objects;
DROP POLICY IF EXISTS "matos-attachments update authed" ON storage.objects;
DROP POLICY IF EXISTS "matos-attachments delete authed" ON storage.objects;

-- ░ SELECT authenticated : can_read_outil sur le project de la version.
CREATE POLICY "matos-attachments read authed"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'matos-attachments'
    AND EXISTS (
      SELECT 1 FROM matos_versions mv
      WHERE mv.id::text = split_part(storage.objects.name, '/', 1)
        AND can_read_outil(mv.project_id, 'materiel')
    )
  );

-- ░ SELECT anon : ouvert tant qu'au moins un token actif existe pour la
--   version dans le path. Ça sert les utilisateurs `/check/:token` qui
--   téléchargent les docs loueur. Une fois tous les tokens révoqués pour
--   cette version, l'accès anon est coupé automatiquement.
--
--   Rationale sécurité : le storage_path contient deux UUID (version +
--   filename) → impossible à deviner. Si quelqu'un a l'URL, il a déjà eu
--   accès à la session via un token valide. La policy ne fait que refuser
--   les lectures si TOUS les tokens sont révoqués (p.ex. après le tournage).
CREATE POLICY "matos-attachments read anon"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'matos-attachments'
    AND EXISTS (
      SELECT 1 FROM matos_check_tokens mct
      WHERE mct.version_id::text = split_part(storage.objects.name, '/', 1)
        AND mct.revoked_at IS NULL
        AND (mct.expires_at IS NULL OR mct.expires_at > now())
    )
  );

-- ░ INSERT / UPDATE / DELETE authenticated : can_edit_outil.
CREATE POLICY "matos-attachments insert authed"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'matos-attachments'
    AND EXISTS (
      SELECT 1 FROM matos_versions mv
      WHERE mv.id::text = split_part(storage.objects.name, '/', 1)
        AND can_edit_outil(mv.project_id, 'materiel')
    )
  );

CREATE POLICY "matos-attachments update authed"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'matos-attachments'
    AND EXISTS (
      SELECT 1 FROM matos_versions mv
      WHERE mv.id::text = split_part(storage.objects.name, '/', 1)
        AND can_edit_outil(mv.project_id, 'materiel')
    )
  );

CREATE POLICY "matos-attachments delete authed"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'matos-attachments'
    AND EXISTS (
      SELECT 1 FROM matos_versions mv
      WHERE mv.id::text = split_part(storage.objects.name, '/', 1)
        AND can_edit_outil(mv.project_id, 'materiel')
    )
  );


-- ── 4. Patch check_session_fetch pour inclure title ─────────────────────
-- ATTENTION : shape strictement identique à MAT-10N
-- (20260421_mat10n_item_removal.sql), seul le bloc 'attachments' change pour
-- inclure `title` + `version_id`. Tables & colonnes à respecter :
--   - Table projet = `projects` (pas projets) ; colonnes `title`, `ref_projet`
--   - Table loueurs = `fournisseurs` (pas loueurs)
--   - matos_items n'a PAS `post_check_*` ni `prod_check_*`
--   - Pivot loueurs = `item_loueurs` en snake_case (et non itemLoueurs)
--
-- Toute divergence = RPC qui jette une exception = client qui reçoit null =
-- écran "Lien invalide ou expiré" côté field crew.
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
      JOIN matos_items  mi ON mc.item_id = mi.id
      JOIN matos_blocks mb ON mb.id = mi.block_id
      WHERE mb.version_id = v_version_id
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
      WHERE ma.version_id = v_version_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$check_session_fetch$;

GRANT EXECUTE ON FUNCTION check_session_fetch(text) TO anon, authenticated;


-- Fin de MAT-10J.
